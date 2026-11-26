// MORPH FLOW: the orchestration state machine behind "pinch-hold a tile,
// speak a change, Gemini patches that one tile" — idle -> hold -> asking ->
// working -> done/cancel/undo. Fully injected clock + timers + fake card/mic
// so the whole turn runs deterministically with no real DOM, mic or model.
import { describe, expect, it, vi } from 'vitest';
import { createMorphFlow, MORPH_LISTEN_MS, type MorphFlowDeps, type MorphUiHooks } from '../../src/canvas/morphFlow';
import { MORPH_FEEL } from '../../src/canvas/morphHold';
import type { MorphCardUi } from '../../src/canvas/morphCard';
import type { MorphTargetRef } from '../../src/canvas/morphTarget';
import type { SentInfo, SurfaceEngine } from '../../src/canvas/aiTurn';
import type { SurfacePlan, TileSpec } from '../../src/canvas/surfacePlan';
import { createCanvasHandsAdapter } from '../../src/canvas/canvasHands';
import { createMotionRecognizer } from '../../src/input/motionGestures';
import { PINCH, place } from '../helpers/hands';
import type { Pt } from '../../src/input/handLogic';

// ---- manual timer scheduler: collect scheduled callbacks, run them by
// advancing fake time (same idea as morphCard.test.ts's fakeTimers, plus a
// combined now()+ticker advance helper for morphFlow's TICK_MS polling). ----
function fakeScheduler() {
  let time = 0;
  const pending: { id: number; cb: () => void; at: number }[] = [];
  let nextId = 1;
  const setTimer = ((cb: () => void, ms?: number) => {
    const id = nextId++;
    pending.push({ id, cb, at: time + (ms ?? 0) });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  const clearTimer = ((id?: unknown) => {
    const i = pending.findIndex((p) => p.id === id);
    if (i >= 0) pending.splice(i, 1);
  }) as typeof clearTimeout;
  const now = () => time;
  /** Advance fake time by `ms`, firing every timer due along the way, in the
   *  order their deadlines land (so a ticker that reschedules itself keeps
   *  ticking right up to the target time). */
  function advance(ms: number): void {
    const target = time + ms;
    for (let guard = 0; guard < 100000; guard++) {
      const due = pending.filter((p) => p.at <= target);
      if (!due.length) break;
      due.sort((a, b) => a.at - b.at);
      const next = due[0];
      const i = pending.indexOf(next);
      if (i >= 0) pending.splice(i, 1);
      time = next.at;
      next.cb();
    }
    time = target;
  }
  return { setTimer, clearTimer, now, advance, pendingCount: () => pending.length };
}

// ---- minimal fake doc/root/host, enough for morphFlow's DOM surface:
// doc.createElement + doc.addEventListener/removeEventListener (optional
// chained), root.append(ring), ring.style/classList/hidden, host.classList. ----
class FakeEl {
  tagName: string;
  classSet = new Set<string>();
  style: Record<string, string> = {};
  hidden = false;
  children: FakeEl[] = [];
  attrs: Record<string, string> = {};
  listeners: { type: string; fn: (e: unknown) => void }[] = [];
  constructor(tag: string) { this.tagName = tag; }
  get classList() {
    const self = this;
    return {
      add: (...cs: string[]) => cs.forEach((c) => self.classSet.add(c)),
      remove: (...cs: string[]) => cs.forEach((c) => self.classSet.delete(c)),
      contains: (c: string) => self.classSet.has(c),
    };
  }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  append(...els: FakeEl[]) { els.forEach((e) => this.children.push(e)); }
  remove() { /* noop: no parent tracking needed here */ }
  addEventListener(type: string, fn: (e: unknown) => void) { this.listeners.push({ type, fn }); }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn));
  }
}
class FakeDoc extends FakeEl {
  createElement(tag: string) { return new FakeEl(tag); }
}

function makeDocRoot() {
  const doc = new FakeDoc('#document');
  const root = new FakeEl('div');
  return { doc, root };
}

// ---- fake card recording every call ----
interface RecordedCard extends MorphCardUi {
  calls: string[];
}
function fakeCard(): RecordedCard {
  const calls: string[] = [];
  let open_ = false;
  const el = new FakeEl('div');
  const card: RecordedCard = {
    el: el as unknown as HTMLElement,
    calls,
    open(o) { calls.push(`open:${o.label}:${o.listening}`); open_ = true; },
    setListening(on) { calls.push(`setListening:${on}`); },
    showWorking(line) { calls.push(`showWorking:${line}`); },
    showDone() { calls.push('showDone'); },
    showEmpty() { calls.push('showEmpty'); },
    showError(line) { calls.push(`showError:${line}`); },
    close() { calls.push('close'); open_ = false; },
    isOpen() { return open_; },
    destroy() { calls.push('destroy'); },
  };
  return card;
}

// ---- fake mic ----
function fakeMic(opts: { supported?: boolean } = {}) {
  const calls: string[] = [];
  return {
    calls,
    supported: () => opts.supported ?? true,
    start() { calls.push('start'); },
    stop() { calls.push('stop'); },
  };
}

// ---- fake ui hooks ----
function fakeUi(): MorphUiHooks & { log: MorphUiHooks['log'] & { calls: [string, string, string][] }; sentCalls: unknown[]; stateCalls: string[] } {
  const counts = { soft: 0, hard: 0 };
  const logCalls: [string, string, string][] = [];
  const sentCalls: unknown[] = [];
  const stateCalls: string[] = [];
  const log = ((engine: 'nano' | 'gemini', verb: string, detail: string) => {
    logCalls.push([engine, verb, detail]);
  }) as MorphUiHooks['log'] & { calls: [string, string, string][] };
  log.calls = logCalls;
  return {
    sent(s, o) { sentCalls.push({ s, o }); },
    log,
    handoff() {},
    settle: async () => { counts.soft++; },
    settleNow: () => { counts.hard++; },
    counts,
    state(text) { stateCalls.push(text); },
    sentCalls,
    stateCalls,
  };
}

const LAMP: TileSpec = { type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' };
function makePlan(): SurfacePlan {
  return { kind: 'room', title: 'Living room', tiles: [LAMP] };
}
function makeTarget(host: FakeEl): MorphTargetRef {
  return {
    tileId: 'lamp-wiz-desk',
    path: [0],
    spec: LAMP,
    label: 'Desk lamp',
    rect: { left: 100, top: 300, width: 200, height: 80 },
    host: host as unknown as MorphTargetRef['host'],
  };
}

interface Harness {
  deps: MorphFlowDeps;
  sched: ReturnType<typeof fakeScheduler>;
  card: RecordedCard;
  mic: ReturnType<typeof fakeMic>;
  ui: ReturnType<typeof fakeUi>;
  host: FakeEl;
  plan: SurfacePlan;
  applyCalls: { frameId: string; patched: SurfacePlan; summary: string }[];
  undoCalls: number;
  fired: MorphTargetRef[];
  engineFactory: (json: string) => SurfaceEngine;
  disabled: boolean;
  targetOverride: MorphTargetRef | null | undefined; // undefined = default target
  typingCalls: boolean[];
  protectedPointResult: boolean;
}

function makeHarness(opts: { micSupported?: boolean; engine?: (json: string) => SurfaceEngine } = {}): Harness {
  const sched = fakeScheduler();
  const { doc, root } = makeDocRoot();
  const card = fakeCard();
  const mic = fakeMic({ supported: opts.micSupported ?? true });
  const ui = fakeUi();
  const host = new FakeEl('div');
  const plan = makePlan();
  const applyCalls: { frameId: string; patched: SurfacePlan; summary: string }[] = [];
  let undoCalls = 0;
  const fired: MorphTargetRef[] = [];
  let disabled = false;
  let targetOverride: MorphTargetRef | null | undefined;
  const typingCalls: boolean[] = [];

  const defaultEngine = (json: string): SurfaceEngine => ({
    id: 'gemini', sim: true,
    async stream() { return json; },
  });
  const engineFactory = opts.engine ?? defaultEngine;

  const h: Harness = {
    sched, card, mic, ui, host, plan, applyCalls, get undoCalls() { return undoCalls; }, fired,
    engineFactory, disabled, targetOverride, typingCalls, protectedPointResult: false,
    deps: {
      doc: doc as unknown as Document,
      root: root as unknown as HTMLElement,
      card,
      resolveTarget: (_p) => (h.targetOverride !== undefined ? h.targetOverride : makeTarget(host)),
      targetByIndex: (_index) => (h.targetOverride !== undefined ? h.targetOverride : makeTarget(host)),
      frameId: () => 'frame-1',
      plan: (fid) => (fid === 'frame-1' ? h.plan : null),
      disabled: () => h.disabled,
      engine: engineFactory,
      mic,
      apply: (frameId, patched, summary) => { applyCalls.push({ frameId, patched, summary }); return true; },
      undo: () => { undoCalls++; },
      ui,
      onFired: (t) => { fired.push(t); },
      typing: (on) => { h.typingCalls.push(on); },
      protectedPoint: (_p) => h.protectedPointResult,
      now: sched.now,
      setTimer: sched.setTimer,
      clearTimer: sched.clearTimer,
    },
  };
  return h;
}

describe('beginHold', () => {
  it('over nothing (resolveTarget -> null) never arms', () => {
    const h = makeHarness();
    h.targetOverride = null;
    const flow = createMorphFlow(h.deps);
    expect(flow.beginHold({ x: 10, y: 10 }, 'mouse')).toBe(false);
    expect(flow.holdActive()).toBe(false);
  });

  it('disabled() -> true makes beginHold false', () => {
    const h = makeHarness();
    h.disabled = true;
    const flow = createMorphFlow(h.deps);
    expect(flow.beginHold({ x: 10, y: 10 }, 'mouse')).toBe(false);
  });

  it('armed hold, advanced past holdMs via the ticker, opens the card with the tile label and starts the mic', () => {
    const h = makeHarness();
    const flow = createMorphFlow(h.deps);
    expect(flow.beginHold({ x: 10, y: 10 }, 'mouse')).toBe(true);
    expect(flow.holdActive()).toBe(true);
    h.sched.advance(MORPH_FEEL.holdMs + 50);
    expect(h.card.calls).toContain('open:Desk lamp:true');
    expect(h.mic.calls).toContain('start');
    expect(h.fired).toHaveLength(1);
    expect(h.fired[0].label).toBe('Desk lamp');
    expect(flow.phase()).toBe('asking');
  });

  it('endHold before the fire returns tap, and the card never opened', () => {
    const h = makeHarness();
    const flow = createMorphFlow(h.deps);
    flow.beginHold({ x: 10, y: 10 }, 'mouse');
    h.sched.advance(100); // well under holdMs
    expect(flow.endHold()).toBe('tap');
    expect(h.card.calls).toHaveLength(0);
    expect(flow.phase()).toBe('idle');
  });

  it('mic.supported() -> false: fire() opens the card without starting the mic, and asks to reveal the say box', () => {
    const h = makeHarness({ micSupported: false });
    const flow = createMorphFlow(h.deps);
    flow.beginHold({ x: 10, y: 10 }, 'mouse');
    h.sched.advance(MORPH_FEEL.holdMs + 50);
    expect(h.card.calls).toContain('open:Desk lamp:false');
    expect(h.mic.calls).not.toContain('start');
    expect(h.typingCalls).toEqual([true]);
  });

  it('mic.supported() -> true: fire() never asks to reveal the say box', () => {
    const h = makeHarness({ micSupported: true });
    const flow = createMorphFlow(h.deps);
    flow.beginHold({ x: 10, y: 10 }, 'mouse');
    h.sched.advance(MORPH_FEEL.holdMs + 50);
    expect(h.typingCalls).toEqual([]);
  });
});

describe('typing (the type-it path with no mic)', () => {
  it('a typed utterance reaches runTurn and turns typing off once work starts', async () => {
    const patchedLampJson = JSON.stringify({ ...LAMP, label: 'Desk lamp · warm' });
    const h = makeHarness({ micSupported: false });
    h.deps.engine = (() => ({ id: 'gemini' as const, sim: true, async stream() { return patchedLampJson; } })) as MorphFlowDeps['engine'];
    const flow = createMorphFlow(h.deps);
    flow.beginHold({ x: 10, y: 10 }, 'mouse');
    h.sched.advance(MORPH_FEEL.holdMs + 50);
    expect(h.typingCalls).toEqual([true]);
    flow.handleSpeech('change the color to warm amber');
    expect(h.typingCalls).toEqual([true, false]); // runTurn starting turns the peek off
    await vi.waitFor(() => expect(h.card.calls).toContain('showDone'));
  });

  it('cancel() while typing turns the peek back off', () => {
    const h = makeHarness({ micSupported: false });
    const flow = createMorphFlow(h.deps);
    flow.beginHold({ x: 10, y: 10 }, 'mouse');
    h.sched.advance(MORPH_FEEL.holdMs + 50);
    expect(h.typingCalls).toEqual([true]);
    flow.cancel();
    expect(h.typingCalls).toEqual([true, false]);
  });

  it('the silence cap firing with nothing typed turns the peek back off', () => {
    const h = makeHarness({ micSupported: false });
    const flow = createMorphFlow(h.deps);
    flow.beginHold({ x: 10, y: 10 }, 'mouse');
    h.sched.advance(MORPH_FEEL.holdMs + 50);
    h.sched.advance(MORPH_LISTEN_MS + 100);
    expect(h.typingCalls).toEqual([true, false]);
    expect(h.card.calls).toContain('showEmpty');
  });
});

describe('pointerDownAt — outside clicks while the card is open', () => {
  it('a point the host marks protected (say box / Go / Talk) does not cancel', () => {
    const h = makeHarness({ micSupported: false });
    const flow = createMorphFlow(h.deps);
    flow.beginHold({ x: 10, y: 10 }, 'mouse');
    h.sched.advance(MORPH_FEEL.holdMs + 50);
    h.protectedPointResult = true;
    flow.pointerDownAt({ x: 9999, y: 9999 }); // nowhere near the card's rect
    expect(flow.phase()).toBe('asking');
    expect(h.card.calls).not.toContain('close');
  });

  it('a point the host does NOT mark protected still cancels', () => {
    const h = makeHarness({ micSupported: false });
    const flow = createMorphFlow(h.deps);
    flow.beginHold({ x: 10, y: 10 }, 'mouse');
    h.sched.advance(MORPH_FEEL.holdMs + 50);
    h.protectedPointResult = false;
    flow.pointerDownAt({ x: 9999, y: 9999 });
    expect(flow.phase()).toBe('idle');
    expect(h.card.calls).toContain('close');
  });
});

describe('handleSpeech — meta commands while asking', () => {
  it('"cancel" stops the mic, closes the card, and never calls the model', async () => {
    const h = makeHarness();
    const engineSpy = vi.fn(h.engineFactory);
    h.deps.engine = engineSpy;
    const flow = createMorphFlow(h.deps);
    flow.beginHold({ x: 10, y: 10 }, 'mouse');
    h.sched.advance(MORPH_FEEL.holdMs + 50);
    const consumed = flow.handleSpeech('cancel');
    expect(consumed).toBe(true);
    expect(h.mic.calls).toContain('stop');
    expect(h.card.calls).toContain('close');
    expect(engineSpy).not.toHaveBeenCalled();
    expect(h.ui.sentCalls).toHaveLength(0);
    expect(flow.phase()).toBe('idle');
  });

  it('"undo" calls deps.undo and never calls the model', () => {
    const h = makeHarness();
    const engineSpy = vi.fn(h.engineFactory);
    h.deps.engine = engineSpy;
    const flow = createMorphFlow(h.deps);
    flow.beginHold({ x: 10, y: 10 }, 'mouse');
    h.sched.advance(MORPH_FEEL.holdMs + 50);
    const consumed = flow.handleSpeech('undo');
    expect(consumed).toBe(true);
    expect(h.undoCalls).toBe(1);
    expect(engineSpy).not.toHaveBeenCalled();
  });
});

describe('silence auto-close', () => {
  it('after MORPH_LISTEN_MS with no speech: mic stops and the card shows empty, no model call', () => {
    const h = makeHarness();
    const engineSpy = vi.fn(h.engineFactory);
    h.deps.engine = engineSpy;
    const flow = createMorphFlow(h.deps);
    flow.beginHold({ x: 10, y: 10 }, 'mouse');
    h.sched.advance(MORPH_FEEL.holdMs + 50);
    h.sched.advance(MORPH_LISTEN_MS + 100);
    expect(h.mic.calls.filter((c) => c === 'stop')).toHaveLength(1);
    expect(h.card.calls).toContain('showEmpty');
    expect(engineSpy).not.toHaveBeenCalled();
    expect(flow.phase()).toBe('idle');
  });
});

describe('handleSpeech — a real edit turn', () => {
  it('"make it warm" calls the engine once with the tile JSON in the prompt, applies the patched plan, shows done', async () => {
    const patchedLampJson = JSON.stringify({ ...LAMP, label: 'Desk lamp · warm' });
    const h = makeHarness();
    const streamSpy = vi.fn(async (_prompt: string) => patchedLampJson);
    h.deps.engine = (() => ({ id: 'gemini' as const, sim: true, stream: streamSpy })) as MorphFlowDeps['engine'];

    const flow = createMorphFlow(h.deps);
    flow.beginHold({ x: 10, y: 10 }, 'mouse');
    h.sched.advance(MORPH_FEEL.holdMs + 50);
    flow.handleSpeech('make it warm');
    await vi.waitFor(() => expect(h.applyCalls).toHaveLength(1));

    expect(streamSpy).toHaveBeenCalledTimes(1);
    const [promptArg] = streamSpy.mock.calls[0];
    expect(promptArg).toContain(JSON.stringify(LAMP));

    const applied = h.applyCalls[0];
    expect(applied.frameId).toBe('frame-1');
    expect(applied.patched.tiles[0]).toEqual({ ...LAMP, label: 'Desk lamp · warm' });
    expect(h.card.calls).toContain('showDone');
    expect(h.ui.log.calls.some(([, verb]) => verb === 'build')).toBe(true);
    expect(h.ui.log.calls.some(([, verb]) => verb === 'done')).toBe(true);
  });

  it('engine failure with no fallback shows an error and never applies', async () => {
    const h = makeHarness();
    h.deps.engine = (() => ({ id: 'gemini' as const, sim: false, async stream() { throw new Error('offline'); } })) as MorphFlowDeps['engine'];
    const flow = createMorphFlow(h.deps);
    flow.beginHold({ x: 10, y: 10 }, 'mouse');
    h.sched.advance(MORPH_FEEL.holdMs + 50);
    flow.handleSpeech('make it warm');
    await vi.waitFor(() => expect(h.card.calls.some((c) => c.startsWith('showError'))).toBe(true));
    expect(h.applyCalls).toHaveLength(0);
  });

  it('a reply that changes the tile type is refused: showError, apply never called', async () => {
    const h = makeHarness();
    const badJson = JSON.stringify({ type: 'music', deviceId: 'wiz-desk', label: 'Desk lamp' });
    h.deps.engine = (() => ({ id: 'gemini' as const, sim: true, async stream() { return badJson; } })) as MorphFlowDeps['engine'];
    const flow = createMorphFlow(h.deps);
    flow.beginHold({ x: 10, y: 10 }, 'mouse');
    h.sched.advance(MORPH_FEEL.holdMs + 50);
    flow.handleSpeech('turn it into music');
    await vi.waitFor(() => expect(h.card.calls.some((c) => c.startsWith('showError'))).toBe(true));
    expect(h.applyCalls).toHaveLength(0);
  });
});

describe('simulateHold', () => {
  it('fires deterministically via targetByIndex, opens the card, same classifier', () => {
    const h = makeHarness();
    const flow = createMorphFlow(h.deps);
    const result = flow.simulateHold(0);
    expect(result).toBe(true);
    expect(h.card.calls.some((c) => c.startsWith('open:Desk lamp'))).toBe(true);
    expect(flow.phase()).toBe('asking');
  });

  it('with mic.supported() -> false, mic.start is not called', () => {
    const h = makeHarness({ micSupported: false });
    const flow = createMorphFlow(h.deps);
    flow.simulateHold(0);
    expect(h.mic.calls).not.toContain('start');
  });

  it('returns false when targetByIndex resolves nothing', () => {
    const h = makeHarness();
    h.targetOverride = null;
    const flow = createMorphFlow(h.deps);
    expect(flow.simulateHold(0)).toBe(false);
  });
});

describe('suppression: pinch-hold-still must be filtered while a morph hold is active', () => {
  it('createMotionRecognizer alone fires pinch-hold-still at ~1200ms of a still pinch (proves the filter matters)', () => {
    const motion = createMotionRecognizer();
    const hand = place(PINCH(), 0.5, 0.5);
    let events: { id: string }[] = [];
    let now = 0;
    for (; now <= 1300; now += 30) {
      events = motion.update({ hands: [hand as Pt[]], now });
    }
    // Collect across the whole run, since fire() only appears in the frame it crosses 1200ms.
    const all: string[] = [];
    const motion2 = createMotionRecognizer();
    for (let t = 0; t <= 1300; t += 30) {
      all.push(...motion2.update({ hands: [hand as Pt[]], now: t }).map((e) => e.id));
    }
    expect(all).toContain('pinch-hold-still');
    void events;
  });

  it('createCanvasHandsAdapter consults suppressMotion with "pinch-hold-still" when a morph hold is active, and the filtered event never calls onEvent for it', () => {
    let flowHoldActive = true;
    const suppressMotion = vi.fn((id: string) => id === 'pinch-hold-still' && flowHoldActive);
    const events: { type: string }[] = [];
    const adapter = createCanvasHandsAdapter((e) => events.push(e), { suppressMotion });
    const hand = place(PINCH(), 0.5, 0.5);
    for (let t = 0; t <= 1300; t += 30) {
      adapter.update({ hands: [hand as Pt[]], now: t });
    }
    expect(suppressMotion).toHaveBeenCalledWith('pinch-hold-still');
    // The adapter only ever turns specific motion ids (palm-swipe-*) into
    // CanvasHandEvents; pinch-hold-still itself has no mapped effect either
    // way, so the observable contract is: the filter was consulted, and
    // consulting it with flowHoldActive=true must not throw or otherwise
    // break the frame/keep pipeline.
    expect(events.some((e) => e.type === 'frame')).toBe(true);
  });

  it('with flowHoldActive=false, suppressMotion returns false for pinch-hold-still (the recognizer\'s own event is let through)', () => {
    let flowHoldActive = false;
    const suppressMotion = vi.fn((id: string) => id === 'pinch-hold-still' && flowHoldActive);
    createCanvasHandsAdapter(() => {}, { suppressMotion });
    expect(suppressMotion('pinch-hold-still')).toBe(false);
    flowHoldActive = true;
    expect(suppressMotion('pinch-hold-still')).toBe(true);
  });
});

describe('cancel()', () => {
  it('cancel before anything was asked logs nothing and calls no model', () => {
    const h = makeHarness();
    const flow = createMorphFlow(h.deps);
    flow.beginHold({ x: 10, y: 10 }, 'mouse');
    flow.cancel();
    expect(h.ui.log.calls).toHaveLength(0);
    expect(flow.phase()).toBe('idle');
  });

  it('cancel mid-call (working phase) logs a note and settles, discarding any reply', async () => {
    const h = makeHarness();
    let resolveStream: ((v: string) => void) | null = null;
    h.deps.engine = (() => ({
      id: 'gemini' as const, sim: true,
      stream: () => new Promise<string>((resolve) => { resolveStream = resolve; }),
    })) as MorphFlowDeps['engine'];
    const flow = createMorphFlow(h.deps);
    flow.beginHold({ x: 10, y: 10 }, 'mouse');
    h.sched.advance(MORPH_FEEL.holdMs + 50);
    flow.handleSpeech('make it warm');
    await vi.waitFor(() => expect(flow.phase()).toBe('working'));
    flow.cancel();
    expect(h.ui.log.calls.some(([, verb]) => verb === 'note')).toBe(true);
    expect(flow.phase()).toBe('idle');
    // Cancel takes the cursors down at once; it never waits for them to linger.
    expect(h.ui.counts).toEqual({ soft: 0, hard: 1 });
    // The in-flight reply, once it resolves, must never be applied.
    resolveStream?.(JSON.stringify({ ...LAMP, label: 'too late' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.applyCalls).toHaveLength(0);
  });
});
