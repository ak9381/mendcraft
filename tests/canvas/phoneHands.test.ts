// Phone hand control (phoneHands.ts): the Hands pill (persisted, off on
// first run), camera only on toggle, frames → the pointer (mirrored to camera
// space) only while on, the facing gate from the same frames, the look-to-edit
// lock, the camera indicator, a denied camera turning it back off — and that
// touch is never intercepted and hand actions never reach the AI feed.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { mountPhoneHands, PHONE_HANDS_FACE_LINE, PHONE_HANDS_LOST_LINE, PHONE_HANDS_ON_LINE } from '../../src/canvas/phoneHands';
import { CameraLostError, createPhoneCamera, PHONE_HANDS_KEY, phoneHandsAllowed } from '../../src/canvas/phoneCamera';
import { phoneReach } from '../../src/canvas/handFeel';
import type { PresenceFrame } from '../../src/input/presence';

type Listener = (e: { type: string; target: unknown }) => void;
class El {
  className = ''; title = ''; textContent = ''; innerHTML = ''; hidden = false; type = '';
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: El[] = [];
  parent: El | null = null;
  listeners = new Map<string, Listener[]>();
  classes = new Set<string>();
  ownerDocument: unknown;
  constructor(doc: unknown) { this.ownerDocument = doc; }
  classList = {
    toggle: (c: string, on?: boolean) => { const v = on ?? !this.classes.has(c); if (v) this.classes.add(c); else this.classes.delete(c); return v; },
    remove: (c: string) => { this.classes.delete(c); },
    contains: (c: string) => this.classes.has(c),
  };
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  append(...els: El[]) { for (const e of els) { e.parent = this; this.children.push(e); } }
  get lastElementChild() { return this.children.at(-1) ?? null; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  addEventListener(type: string, fn: Listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener(type: string, fn: Listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn)); }
  click() { for (const fn of this.listeners.get('click') ?? []) fn({ type: 'click', target: this }); }
}
function fakeRoot() {
  const doc: { createElement: (t: string) => El } = { createElement: () => new El(doc) };
  return new El(doc);
}
function fakeStream() {
  const track = { readyState: 'live', stop: vi.fn(() => { track.readyState = 'ended'; }) };
  return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
}
function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}
const pt = (x: number, y: number) => ({ x, y });
const frame = (opts: { hands?: number; handGate?: boolean | null; face?: boolean } = {}): PresenceFrame => ({
  hands: Array.from({ length: opts.hands ?? 1 }, () => ({ points: Array.from({ length: 21 }, () => pt(0.3, 0.5)), label: 'Right' })) as unknown as PresenceFrame['hands'],
  rejectedHands: [],
  faces: opts.face === false ? [] : [{ box: { x: 0, y: 0, w: 1, h: 1, cx: 0.5, cy: 0.5 }, isOperator: true, facing: true, handGate: opts.handGate ?? null, dim: false }],
  facing: true, registered: false, paused: false, aspect: 640 / 480,
});

function setup(opts: { storage?: ReturnType<typeof memStorage>; gumFails?: Error; locked?: () => boolean; startGate?: Promise<void> } = {}) {
  const getUserMedia = vi.fn(async () => { if (opts.gumFails) throw opts.gumFails; return fakeStream(); });
  let feed: ((f: PresenceFrame) => void) | null = null;
  let lost: (() => void) | null = null;
  const createTracker = vi.fn((_e: () => void, onFrame: (f: PresenceFrame) => void, o: { onCameraLost: () => void }) => {
    feed = onFrame;
    lost = o.onCameraLost;
    return { start: vi.fn(async () => { await opts.startGate; }), stop: vi.fn() };
  });
  const timers: (() => void)[] = [];
  const camera = createPhoneCamera({
    getUserMedia, createTracker, doc: null, win: null, now: () => 0,
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => undefined,
  });
  let gated = false;
  const pointer = { update: vi.fn(), lost: vi.fn(), setFacing: vi.fn(), cursors: vi.fn(() => []), handsLocked: vi.fn(() => gated) };
  const say = vi.fn();
  const storage = opts.storage ?? memStorage();
  const root = fakeRoot();
  const aspects: number[] = [];
  const hands = mountPhoneHands(root as unknown as HTMLElement, {
    camera, pointer, reach: () => phoneReach(null), storage, say, overlay: false,
    locked: opts.locked, onAspect: (a) => aspects.push(a), now: () => 1000,
  });
  return {
    hands, camera, pointer, say, storage, root, getUserMedia, createTracker, aspects, timers,
    feed: (f: PresenceFrame) => feed?.(f),
    lose: () => lost?.(),
    gate: (on: boolean) => { gated = on; },
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('phone Hands pill', () => {
  it('is off on first run and opens no camera until tapped', async () => {
    const s = setup();
    await flush();
    expect(s.hands.isOn()).toBe(false);
    expect(s.hands.pill.getAttribute('aria-pressed')).toBe('false');
    expect(s.getUserMedia).not.toHaveBeenCalled();
    expect(s.hands.indicator.hidden).toBe(true);
    (s.hands.pill as unknown as El).click();
    await flush(); await flush();
    expect(s.getUserMedia).toHaveBeenCalledTimes(1);
    expect(s.hands.isOn()).toBe(true);
    expect(s.hands.pill.getAttribute('aria-pressed')).toBe('true');
    expect(s.storage.m.get(PHONE_HANDS_KEY)).toBe('1');
    expect(s.hands.indicator.hidden).toBe(false); // camera-on indicator
    expect(s.root.classes.has('is-phone-hands')).toBe(true);
    expect(s.say).toHaveBeenCalledWith(PHONE_HANDS_ON_LINE);
    await s.hands.setOn(false);
    expect(s.storage.m.has(PHONE_HANDS_KEY)).toBe(false);
    expect(s.hands.indicator.hidden).toBe(true);
    expect(s.camera.status()).toBe('off');
  });

  it('a second tap while the camera is still starting turns it straight back off', async () => {
    const s = setup();
    const first = s.hands.setOn(true);
    await s.hands.setOn(false);
    await first;
    expect(s.hands.isOn()).toBe(false);
    expect(s.hands.pill.getAttribute('aria-pressed')).toBe('false');
    expect(s.camera.status()).toBe('off');
    expect(s.storage.m.has(PHONE_HANDS_KEY)).toBe(false);
  });

  it('resumes when it was left on (persisted)', async () => {
    const s = setup({ storage: memStorage({ [PHONE_HANDS_KEY]: '1' }) });
    await flush(); await flush();
    expect(s.hands.isOn()).toBe(true);
    expect(s.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('a denied camera turns Hands back off and says why', async () => {
    const s = setup({ gumFails: Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }) });
    await s.hands.setOn(true);
    await flush();
    expect(s.hands.isOn()).toBe(false);
    expect(s.storage.m.has(PHONE_HANDS_KEY)).toBe(false);
    expect(s.say).toHaveBeenCalled();
    expect(String(s.say.mock.calls.at(-1)?.[0])).toMatch(/camera|blocked|allow|permission/i);
  });
});

describe('phone hand frames', () => {
  it('feed the pointer un-mirrored (camera space) only while on, with the aspect', async () => {
    const s = setup();
    await s.hands.setOn(true);
    s.feed(frame());
    expect(s.pointer.update).toHaveBeenCalledTimes(1);
    const [hands] = s.pointer.update.mock.calls[0] as [{ x: number }[][]];
    expect(hands[0][0].x).toBeCloseTo(0.7); // selfie 0.3 → camera 0.7
    expect((hands[0] as unknown as { label?: string }).label).toBe('Right');
    expect(s.aspects).toEqual([640 / 480]);
    await s.hands.setOn(false);
    s.hands.frame(frame());
    expect(s.pointer.update).toHaveBeenCalledTimes(1);
    expect(s.pointer.lost).toHaveBeenCalled();
  });

  it('facing gate: the operator handGate from the same frame; no face = unknown (null)', async () => {
    const s = setup();
    await s.hands.setOn(true);
    s.feed(frame({ handGate: false }));
    expect(s.pointer.setFacing).toHaveBeenLastCalledWith(false, 1000);
    s.feed(frame({ handGate: true }));
    expect(s.pointer.setFacing).toHaveBeenLastCalledWith(true, 1000);
    s.feed(frame({ face: false }));
    expect(s.pointer.setFacing).toHaveBeenLastCalledWith(null, 1000);
    s.feed(frame({ handGate: null }));
    expect(s.pointer.setFacing).toHaveBeenLastCalledWith(null, 1000);
  });

  it('look-to-edit lock: hands do nothing while the board is locked', async () => {
    let locked = false;
    const s = setup({ locked: () => locked });
    await s.hands.setOn(true);
    s.feed(frame());
    locked = true;
    s.feed(frame());
    expect(s.pointer.update).toHaveBeenCalledTimes(1);
    expect(s.pointer.lost).toHaveBeenCalledTimes(1);
  });

  it('touch is never intercepted: no touch/pointer listeners anywhere, only the pill click', async () => {
    const s = setup();
    await s.hands.setOn(true);
    const all = [s.root, ...s.root.children];
    for (const el of all) {
      for (const type of el.listeners.keys()) expect(['click']).toContain(type);
    }
    expect(s.root.listeners.size).toBe(0);
    // A control tapped while hands are on still gets its own click.
    const tile = new El(s.root.ownerDocument);
    const onTap = vi.fn();
    tile.addEventListener('click', onTap);
    s.root.append(tile);
    s.feed(frame());
    tile.click();
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});

describe('phone Hands status on the pill and indicator', () => {
  it('the pill says "face the phone" while the facing gate locks the hands', async () => {
    const s = setup();
    await s.hands.setOn(true);
    s.feed(frame({ handGate: true }));
    expect(s.hands.pill.textContent).toBe('Hands ✓');
    s.gate(true);
    s.feed(frame({ handGate: false }));
    expect(s.hands.pill.textContent).toBe(PHONE_HANDS_FACE_LINE);
    s.gate(false);
    s.feed(frame({ handGate: true }));
    expect(s.hands.pill.textContent).toBe('Hands ✓');
  });

  it('the indicator says "Loading hand model…" while starting, then "Camera"', async () => {
    let release: () => void = () => undefined;
    const s = setup({ startGate: new Promise<void>((r) => { release = r; }) });
    const p = s.hands.setOn(true);
    await flush(); await flush();
    expect(s.hands.indicator.hidden).toBe(false);
    expect(s.hands.indicator.innerHTML).toContain('Loading hand model…');
    release();
    await p;
    expect(s.hands.indicator.innerHTML).toContain('Camera');
    expect(s.hands.indicator.innerHTML).not.toContain('Loading');
  });

  it('a camera taken for good (retries spent) turns Hands off with a plain message', async () => {
    const s = setup();
    await s.hands.setOn(true);
    for (let i = 0; i < 3; i++) {
      s.lose();
      expect(s.hands.isOn()).toBe(true); // retrying
      for (const fn of s.timers.splice(0)) fn();
      await flush(); await flush();
    }
    s.lose();
    await flush();
    expect(s.camera.lastError()).toBeInstanceOf(CameraLostError);
    expect(s.hands.isOn()).toBe(false);
    expect(s.hands.pill.getAttribute('aria-pressed')).toBe('false');
    expect(s.say).toHaveBeenLastCalledWith(PHONE_HANDS_LOST_LINE);
  });
});

describe('Android only: the iPhone (gimbal) never gets hands', () => {
  it('phoneHandsAllowed: Android phone shell yes; iPhone, desktop no', () => {
    expect(phoneHandsAllowed(true, 'android')).toBe(true);
    expect(phoneHandsAllowed(true, 'ios')).toBe(false);
    expect(phoneHandsAllowed(false, 'android')).toBe(false);
    expect(phoneHandsAllowed(true, null)).toBe(false);
  });

  it('canvasMain creates the camera hub only when allowed; mountCanvas mounts the pill only with a hub', () => {
    const main = readFileSync(new URL('../../src/canvas/canvasMain.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/const phoneCamera = phoneHandsAllowed\(phoneShell, phonePlatform\)\s*\?\s*createPhoneCamera\(/);
    expect(main).toMatch(/const phonePlatform = capacitor\?\.getPlatform\?\.\(\) === 'ios' \? 'ios' as const : 'android' as const;/);
    expect(main.match(/createPhoneCamera\(/g)).toHaveLength(1);
    const app = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
    expect(app).toMatch(/const phoneHands = phoneShell && opts\.phoneCamera && handPointer/);
    expect(app.match(/mountPhoneHands\(/g)).toHaveLength(1);
  });

  it('an iPhone (no hub) → no pill, no tracker, no getUserMedia for hands', async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    try {
      // What canvasMain does on iOS: no hub, so there is nothing to mount.
      const hub = phoneHandsAllowed(true, 'ios') ? createPhoneCamera({ doc: null, win: null }) : undefined;
      expect(hub).toBeUndefined();
      await flush();
      expect(getUserMedia).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('hand actions are not AI', () => {
  it('phoneHands has no AI feed; canvasApp sends hand clicks/grabs to the local activity log only', () => {
    const src = readFileSync(new URL('../../src/canvas/phoneHands.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/aiFeed|phoneAiFeed|AiFeed/);
    const app = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
    const onHand = app.slice(app.indexOf('onHandEvent: (ev) => {'), app.indexOf('onBoardMove: (ev) => {'));
    expect(onHand).toMatch(/activityLog\.push/);
    expect(onHand).not.toMatch(/aiFeed|phoneAiFeed|panels\./);
  });

  it('the phone CSS keeps every hand layer pointer-events: none', () => {
    const css = readFileSync(new URL('../../src/canvas/canvas.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.mc-canvas \.hand-overlay \{[^}]*pointer-events: none/);
    expect(css).toMatch(/\.mc-hand-frame, \.mc-hand-cursor \{[^}]*pointer-events: none/);
    expect(css).toMatch(/\.mc-phone-simple \.mc-cam-on:not\(\[hidden\]\) \{[^}]*pointer-events: none/);
  });
});
