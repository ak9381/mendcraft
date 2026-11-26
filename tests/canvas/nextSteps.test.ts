import { describe, expect, it, vi } from 'vitest';
import type { JourneyStep } from '../../src/canvas/journey';
import {
  createNextStepChips, nextStepsPrompt, parseNanoPick, planExtraRan, ruleSuggestions, suggestNextSteps,
  type NextStep, type NextStepCtx,
} from '../../src/canvas/nextSteps';
import { isBuildDashboard } from '../../src/canvas/pairedRow';
import { routeLine, type RouteWorld } from '../../src/canvas/routeLine';

const STEPS: JourneyStep[] = ['empty', 'devices', 'dashboard', 'music', 'saved', 'floorplan', 'checked', 'language', 'offline', 'shared'];
const ctx: NextStepCtx = { lang: 'en', online: true, phones: 0 };
// The router's world for each step: a plan board exists from the floor-plan
// step on; a speaker exists on the music step.
const world = (step: JourneyStep): RouteWorld => ({
  hasPlanBoard: ['floorplan', 'checked', 'language'].includes(step),
  devices: step === 'music'
    ? [{ id: 'wiz-desk', label: 'Desk lamp', kind: 'lamp' }, { id: 'speaker-1', label: 'Speaker', kind: 'music' }]
    : [{ id: 'wiz-desk', label: 'Desk lamp', kind: 'lamp' }],
});
/** A chip phrase reaches a real command: the pair-first flow claims its own
 *  phrase before routeLine; everything else must not hit the open-ended turn. */
const routes = (s: NextStep, w: RouteWorld) => (s.id === 'build-dashboard' ? isBuildDashboard(s.say) : routeLine(s.say, w).name !== 'openEnded');

describe('ruleSuggestions', () => {
  const cases: [JourneyStep, NextStepCtx][] = [...STEPS.map((s): [JourneyStep, NextStepCtx] => [s, ctx]), ['devices', { ...ctx, pairing: true }], ['empty', { ...ctx, savedRoom: true }]];
  it.each(cases)('%s gives 2–3 steps, each routing to a real command through routeLine()', (step, c) => {
    const steps = ruleSuggestions(step, c);
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps.length).toBeLessThanOrEqual(3);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    for (const s of steps) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(routes(s, world(step)), `${step}: "${s.say}" → ${routeLine(s.say, world(step)).name}`).toBe(true);
    }
  });
  it('is deterministic and follows the journey', () => {
    expect(ruleSuggestions('dashboard', ctx)).toEqual(ruleSuggestions('dashboard', ctx));
    expect(ruleSuggestions('music', ctx).map((s) => s.id)).toEqual(['play-music', 'save', 'floorplan']);
    expect(ruleSuggestions('floorplan', ctx).map((s) => s.id)).toEqual(['check', '3d', 'dxf']);
    expect(ruleSuggestions('empty', ctx).map((s) => s.id)).toEqual(['connect-devices', 'floorplan', 'connect-device']);
    expect(ruleSuggestions('devices', { ...ctx, pairing: true }).map((s) => s.id)[0]).toBe('build-dashboard');
    // Phones paired by "connect devices": point / name / build, in that order.
    expect(ruleSuggestions('devices', { ...ctx, pairing: true, phones: 1 }).map((s) => s.label)).toEqual(['Point at a device', 'Name a device', 'Build the dashboard']);
    expect(ruleSuggestions('checked', ctx).map((s) => s.id)).toContain('kannada');
  });
  it('the empty-board chip starts the pair-first connect flow', () => {
    expect(routeLine(ruleSuggestions('empty', ctx)[0].say, world('empty')).name).toBe('connectDevices');
  });
  it('drops steps already done on this board and never offers Kannada twice', () => {
    expect(ruleSuggestions('floorplan', { ...ctx, done: ['check'] }).map((s) => s.id)).not.toContain('check');
    expect(ruleSuggestions('saved', { ...ctx, lang: 'kn' }).map((s) => s.id)).not.toContain('kannada');
    expect(ruleSuggestions('floorplan', { ...ctx, done: ['check', '3d', 'dxf'] }).length).toBeGreaterThanOrEqual(2);
  });
  it('only routes a step whose command exists in this build (no phone / offline phrases yet)', () => {
    const all = STEPS.flatMap((s) => ruleSuggestions(s, ctx).map((x) => x.say.toLowerCase()));
    expect(all.some((s) => /phone|offline/.test(s))).toBe(false);
    expect(routeLine('send it to my phone', world('checked')).name).toBe('openEnded');
  });
  it('planExtraRan: only a real result counts as done', () => {
    expect(planExtraRan('4 accessibility issues, 4 hard fails.')).toBe(true);
    expect(planExtraRan('Downloaded mendcraft-plan.dxf.')).toBe(true);
    expect(planExtraRan('Nothing to check yet — draw or generate a plan first.')).toBe(false);
    expect(planExtraRan('3D is not available on this board.')).toBe(false);
  });
});

describe('parseNanoPick', () => {
  const allowed = ruleSuggestions('floorplan', ctx);
  it('keeps Nano order and drops unknown ids', () => {
    expect(parseNanoPick('{"ids":["dxf","hack","check"]}', allowed)?.map((s) => s.id)).toEqual(['dxf', 'check']);
  });
  it('rejects junk, non-arrays, duplicates-only and too-short picks', () => {
    expect(parseNanoPick('not json', allowed)).toBeNull();
    expect(parseNanoPick('{"ids":"check"}', allowed)).toBeNull();
    expect(parseNanoPick('{"ids":["nope","zzz"]}', allowed)).toBeNull();
    expect(parseNanoPick('{"ids":["check","check"]}', allowed)).toBeNull();
    expect(parseNanoPick('', allowed)).toBeNull();
  });
  it('caps at three', () => {
    const many = ruleSuggestions('empty', ctx);
    const ids = JSON.stringify({ ids: [...many.map((s) => s.id), ...many.map((s) => s.id)] });
    expect(parseNanoPick(ids, many)!.length).toBeLessThanOrEqual(3);
  });
});

describe('suggestNextSteps', () => {
  it('no Nano → rules, labelled rules', async () => {
    const r = await suggestNextSteps('dashboard', ctx);
    expect(r.source).toBe('rules');
    expect(r.steps).toEqual(ruleSuggestions('dashboard', ctx));
  });
  it('Nano reorders from the allowed list only', async () => {
    const nano = vi.fn(async () => '{"ids":["floorplan","save"]}');
    const r = await suggestNextSteps('music', ctx, nano);
    expect(r.source).toBe('nano');
    expect(r.steps.map((s) => s.id)).toEqual(['floorplan', 'save']);
    const prompt = (nano.mock.calls[0] as unknown as [string])[0];
    for (const s of ruleSuggestions('music', ctx)) expect(prompt).toContain(s.id);
  });
  it('invalid Nano reply → rules', async () => {
    const r = await suggestNextSteps('music', ctx, async () => 'Sure! Play music first.');
    expect(r).toEqual({ steps: ruleSuggestions('music', ctx), source: 'rules' });
  });
  it('Nano reply with only unknown ids → rules', async () => {
    const r = await suggestNextSteps('music', ctx, async () => '{"ids":["delete-everything"]}');
    expect(r.source).toBe('rules');
  });
  it('Nano throwing → rules', async () => {
    const r = await suggestNextSteps('floorplan', ctx, async () => { throw new Error('not ready'); });
    expect(r.source).toBe('rules');
  });
  it('?sim=1 uses rules and never calls Nano', async () => {
    const nano = vi.fn(async () => '{"ids":["save"]}');
    const r = await suggestNextSteps('music', { ...ctx, sim: true }, nano);
    expect(nano).not.toHaveBeenCalled();
    expect(r.source).toBe('rules');
  });
  it('the prompt carries no board content, only the step and allowed ids', () => {
    const p = nextStepsPrompt('music', ruleSuggestions('music', ctx));
    expect(p).toContain('music');
    expect(p).toMatch(/ids/);
  });
});

// ---- chip row (minimal fake DOM; the suite runs in node) -------------------
class FakeEl {
  children: FakeEl[] = [];
  parentElement: FakeEl | null = null;
  className = '';
  textContent = '';
  type = '';
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  listeners: Record<string, Array<(e: { stopPropagation(): void }) => void>> = {};
  isConnected = true;
  constructor(public ownerDocument: { createElement(t: string): FakeEl }) {}
  append(...els: FakeEl[]) { for (const e of els) { e.parentElement = this; this.children.push(e); } }
  remove() { const p = this.parentElement; if (p) p.children = p.children.filter((c) => c !== this); this.parentElement = null; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  addEventListener(t: string, f: (e: { stopPropagation(): void }) => void) { (this.listeners[t] ??= []).push(f); }
  click() { this.listeners.click?.forEach((f) => f({ stopPropagation() {} })); }
  all(): FakeEl[] { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel: string) { const cls = sel.slice(1); return this.all().filter((e) => e.className.split(' ').includes(cls)); }
  querySelector(sel: string) { return sel === ':scope > .mc-next' ? this.children.find((c) => c.className === 'mc-next') ?? null : null; }
}
const fakeDoc = { createElement: (): FakeEl => new FakeEl(fakeDoc) };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createNextStepChips', () => {
  function setup(nano?: (p: string) => Promise<string>, runWorks = true, idle?: { delayMs: number; ready(): boolean }) {
    const root = new FakeEl(fakeDoc);
    const frame = new FakeEl(fakeDoc);
    root.append(frame);
    const state = { focused: true, tiles: ['plan'], kind: 'plan' };
    const ran: string[] = [];
    const nanoLines: string[] = [];
    // run() stand-in: it marks a one-shot step done only when it worked.
    const chips: ReturnType<typeof createNextStepChips> = createNextStepChips({
      root: root as unknown as ParentNode,
      focused: () => state.focused ? { id: 'f1', el: frame as unknown as HTMLElement, board: { kind: state.kind, tiles: state.tiles.map((k) => ({ kind: k })), pinned: false } } : null,
      ctx: () => ({ lang: 'en', online: true, phones: 0 }),
      nano,
      idle,
      run: (s) => { ran.push(s); if (runWorks && s === 'check accessibility') chips.markDone('f1', 'check'); },
      onNano: (l) => nanoLines.push(l),
    });
    return { chips, root, frame, state, ran, nanoLines };
  }
  const row = (frame: FakeEl) => frame.children.find((c) => c.className === 'mc-next');
  const labels = (frame: FakeEl) => row(frame)!.children.filter((c) => c.className.includes('mc-next-chip')).map((c) => c.textContent);

  it('with an idle gate: rules at once, Nano only after the board sat still — and not while the model is busy', async () => {
    vi.useFakeTimers();
    try {
      const nano = vi.fn(async () => '{"ids":["check","3d"]}');
      let ready = false;
      const t = setup(nano, true, { delayMs: 3000, ready: () => ready });
      t.chips.refresh();
      expect(row(t.frame)!.dataset.source).toBe('rules'); // on screen immediately
      await vi.advanceTimersByTimeAsync(2999);
      expect(nano).not.toHaveBeenCalled(); // not on load
      await vi.advanceTimersByTimeAsync(10);
      expect(nano).not.toHaveBeenCalled(); // idle time passed, but a turn holds the model
      // the model frees up: the next idle check asks, once
      ready = true;
      await vi.advanceTimersByTimeAsync(2900);
      expect(nano).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      expect(nano).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(nano).toHaveBeenCalledTimes(1);
      // she leaves the board before the idle time is up: nothing is asked
      const away = setup(nano, true, { delayMs: 3000, ready: () => true });
      away.chips.refresh();
      away.state.focused = false;
      away.chips.refresh();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(nano).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('renders the rule chips at once with an honest "Suggested" tag; the chip runs its say', () => {
    const t = setup();
    t.chips.refresh();
    expect(labels(t.frame)).toEqual(['Check accessibility', 'Show 3D', 'Export DXF']);
    expect(row(t.frame)!.children[0].textContent).toBe('Suggested');
    row(t.frame)!.children[1].click();
    expect(t.ran).toEqual(['check accessibility']);
    // run() marked it done: the journey moves on to Kannada.
    expect(labels(t.frame)[0]).toBe('Add Kannada');
  });
  it('a step that did not work is not marked done', () => {
    const t = setup(undefined, false);
    t.chips.refresh();
    row(t.frame)!.children[1].click();
    expect(labels(t.frame)[0]).toBe('Check accessibility');
  });
  it('voice runs count too: markDone from run() moves the chips without a click', () => {
    const t = setup();
    t.chips.refresh();
    t.chips.markDone('f1', 'check');
    expect(labels(t.frame)[0]).toBe('Add Kannada'); // redrawn without a sync
    t.chips.markDone('f1', 'save'); // not one-shot: ignored
    expect(labels(t.frame)[0]).toBe('Add Kannada');
  });
  it('rules first, then Nano order swapped in and logged as a nano line', async () => {
    const t = setup(async () => '{"ids":["3d","check"]}');
    t.chips.refresh();
    expect(labels(t.frame)).toEqual(['Check accessibility', 'Show 3D', 'Export DXF']);
    await flush();
    expect(labels(t.frame)).toEqual(['Show 3D', 'Check accessibility']);
    expect(row(t.frame)!.children[0].textContent).toBe('Nano · on device');
    expect(t.nanoLines[0]).toMatch(/next steps/);
  });
  it('caches Nano picks per state; a new step asks again; overview clears the row', async () => {
    const nano = vi.fn(async () => '{"ids":["check","3d"]}');
    const t = setup(nano);
    t.chips.refresh(); t.chips.refresh(); await flush(); t.chips.refresh(); await flush();
    expect(nano).toHaveBeenCalledTimes(1);
    t.state.kind = 'room'; t.state.tiles = ['lamp', 'music'];
    t.chips.refresh(); await flush();
    expect(nano).toHaveBeenCalledTimes(2);
    t.state.kind = 'plan'; t.state.tiles = ['plan'];
    t.chips.refresh();
    expect(nano).toHaveBeenCalledTimes(2); // cached: no second ask, Nano order at once
    expect(labels(t.frame)).toEqual(['Check accessibility', 'Show 3D']);
    t.state.focused = false;
    t.chips.refresh();
    expect(t.root.querySelectorAll('.mc-next')).toHaveLength(0);
  });
  it('a slow Nano pick never queues another; its late answer is ignored', async () => {
    let resolve!: (s: string) => void;
    const nano = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
    vi.useFakeTimers();
    try {
      const t = setup(nano);
      t.chips.refresh();
      await vi.advanceTimersByTimeAsync(3000); // past the pick timeout: rules stay
      t.state.kind = 'room'; t.state.tiles = ['lamp', 'music'];
      t.chips.refresh();
      expect(nano).toHaveBeenCalledTimes(1); // still busy: no second call queued
      expect(labels(t.frame)[0]).toBe('Play music');
      resolve('{"ids":["dxf","3d"]}');
      await vi.advanceTimersByTimeAsync(0);
      expect(labels(t.frame)[0]).toBe('Play music');
      expect(row(t.frame)!.children[0].textContent).toBe('Suggested');
    } finally { vi.useRealTimers(); }
  });
});
