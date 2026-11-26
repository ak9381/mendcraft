// Phone path, end to end without a browser: presence frames from the shared
// front camera → mountPhoneHands → the REAL gestureControl (shape read, hold
// engine, peace-and-move scroll driver) → the element under the hand scrolls.
// A small fake DOM stands in for the page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountPhoneHands } from '../../src/canvas/phoneHands';
import { createPhoneCamera } from '../../src/canvas/phoneCamera';
import { createGestureControl } from '../../src/canvas/gestureControl';
import { LAPTOP_GESTURES, PHONE_GESTURES } from '../../src/canvas/gestureBindings';
import { REACH } from '../../src/canvas/handPointer';
import { phoneReach } from '../../src/canvas/handFeel';
import { syntheticHand } from '../../src/canvas/handShapeFixtures';
import type { PresenceFrame } from '../../src/input/presence';

type Listener = (e: { type: string; target: unknown }) => void;
class FakeEl {
  className = ''; title = ''; textContent = ''; innerHTML = ''; hidden = false; type = ''; id = '';
  scrollTop = 0; scrollLeft = 0; scrollHeight = 0; clientHeight = 0; scrollWidth = 0; clientWidth = 0;
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  parentElement: FakeEl | null = null;
  shadowRoot = null;
  listeners = new Map<string, Listener[]>();
  classes = new Set<string>();
  lazy = new Map<string, FakeEl>();
  props: Record<string, string> = {};
  style = {
    setProperty: (k: string, v: string) => { this.props[k] = v; },
    removeProperty: (k: string) => { delete this.props[k]; },
  } as unknown as Record<string, unknown>;
  constructor(public ownerDocument: FakeDoc) {}
  classList = {
    add: (c: string) => { this.classes.add(c); },
    remove: (c: string) => { this.classes.delete(c); },
    toggle: (c: string, on?: boolean) => { const v = on ?? !this.classes.has(c); if (v) this.classes.add(c); else this.classes.delete(c); return v; },
    contains: (c: string) => this.classes.has(c),
  };
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  append(...els: FakeEl[]) { for (const e of els) { e.parent = this; this.children.push(e); } }
  get lastElementChild() { return this.children.at(-1) ?? null; }
  get isConnected() { return true; }
  get offsetWidth() { return 0; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  querySelector(sel: string) { let e = this.lazy.get(sel); if (!e) { e = new FakeEl(this.ownerDocument); this.lazy.set(sel, e); } return e; }
  querySelectorAll() { return []; }
  closest() { return null; }
  getRootNode() { return this.ownerDocument; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  addEventListener(type: string, fn: Listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener(type: string, fn: Listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn)); }
  click() { for (const fn of this.listeners.get('click') ?? []) fn({ type: 'click', target: this }); }
  matches() { return false; }
}
class FakeDoc {
  under: FakeEl | null = null;
  defaultView = { getComputedStyle: () => ({ overflowY: 'auto', overflowX: 'hidden' }) };
  createElement() { return new FakeEl(this); }
  querySelectorAll() { return []; }
  elementFromPoint() { return this.under; }
}

function fakeStream() {
  const track = { readyState: 'live', stop: vi.fn(() => { track.readyState = 'ended'; }) };
  return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
}

describe('phone: peace-and-move scrolls the element under the hand (through phoneHands)', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).innerWidth = 390;
    (globalThis as Record<string, unknown>).innerHeight = 844;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).innerWidth;
    delete (globalThis as Record<string, unknown>).innerHeight;
  });

  async function setup() {
    const doc = new FakeDoc();
    const root = new FakeEl(doc);
    const list = new FakeEl(doc);
    list.scrollHeight = 3000; list.clientHeight = 400; list.scrollTop = 900;
    doc.under = list;
    let feed: ((f: PresenceFrame) => void) | null = null;
    const camera = createPhoneCamera({
      getUserMedia: async () => fakeStream(),
      createTracker: (_e, onFrame) => { feed = onFrame; return { start: async () => {}, stop: () => {} } as never; },
      doc: null, win: null, now: () => 0, setTimeout: () => 1, clearTimeout: () => undefined,
    });
    const reach = () => phoneReach(null);
    const gestures = createGestureControl({ root: root as unknown as HTMLElement, bindings: PHONE_GESTURES, reach });
    let clock = 0;
    const pointer = { update: vi.fn(), lost: vi.fn(), setFacing: vi.fn(), cursors: vi.fn(() => []), handsLocked: vi.fn(() => false) };
    const hands = mountPhoneHands(root as unknown as HTMLElement, {
      camera, pointer, reach, storage: null, overlay: false, now: () => clock, gestures,
    });
    await hands.setOn(true);
    const frame = (pts: ReturnType<typeof syntheticHand>[], facing: boolean | null = true): PresenceFrame => ({
      hands: pts.map((p) => ({ points: p, label: p.label })) as unknown as PresenceFrame['hands'],
      rejectedHands: [],
      faces: [{ box: { x: 0.4, y: 0.1, w: 0.2, h: 0.2, cx: 0.5, cy: 0.2 }, isOperator: true, facing: true, handGate: facing, dim: false }],
      facing: true, registered: false, paused: false, aspect: 640 / 480,
    });
    /** A right peace moving in camera y from y0 to y1 over `ms`. */
    const move = (y0: number, y1: number, ms: number, facing: boolean | null = true) => {
      const n = Math.round(ms / 33);
      for (let k = 0; k <= n; k++) { clock += 33; feed!(frame([syntheticHand('peace', 'R', { at: { x: 0.6, y: y0 + ((y1 - y0) * k) / n } })], facing)); }
    };
    return { list, gestures, hands, move, cleanup: () => { gestures.setActive(false); hands.destroy(); } };
  }

  it('peace moving DOWN scrolls the list down (scroll-wheel style)', async () => {
    const s = await setup();
    s.move(0.55, 0.85, 900);
    expect(s.list.scrollTop).toBeGreaterThan(1000);
    expect(s.list.classes.has('mc-scroll-target')).toBe(true);
    s.cleanup();
  });

  it('not facing: nothing scrolls', async () => {
    const s = await setup();
    s.move(0.55, 0.85, 900, false);
    expect(s.list.scrollTop).toBe(900);
    s.cleanup();
  });

  it('a peace held still never scrolls', async () => {
    const s = await setup();
    s.move(0.6, 0.6, 2500);
    expect(s.list.scrollTop).toBe(900);
    s.cleanup();
  });
});

describe('laptop: a one-frame second peace never unlatches a scroll (real gestureControl)', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).innerWidth = 1440;
    (globalThis as Record<string, unknown>).innerHeight = 900;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).innerWidth;
    delete (globalThis as Record<string, unknown>).innerHeight;
  });

  function run(secondPeaceFrames: number) {
    const doc = new FakeDoc();
    const root = new FakeEl(doc);
    const list = new FakeEl(doc);
    list.scrollHeight = 3000; list.clientHeight = 400; list.scrollTop = 900;
    doc.under = list;
    const g = createGestureControl({ root: root as unknown as HTMLElement, bindings: LAPTOP_GESTURES, reach: () => REACH });
    g.setActive(true);
    const fired: string[] = [];
    let t = 0;
    const R = (y: number) => syntheticHand('peace', 'R', { at: { x: 0.62, y } });
    const L = () => syntheticHand('peace', 'L', { at: { x: 0.3, y: 0.75 } });
    const frame = (hands: ReturnType<typeof syntheticHand>[]) => {
      t += 33;
      const s = g.frame(hands, t, { facing: true, faceX: 0.5 });
      if (s.fired) fired.push(s.fired);
    };
    // R scrolls: a deliberate move down.
    for (let k = 0; k <= 24; k++) frame([R(0.55 + k * 0.012)]);
    const scrolled = list.scrollTop > 900;
    // The resting left hand misreads as a peace for `secondPeaceFrames` frame(s).
    for (let k = 0; k < secondPeaceFrames; k++) frame([R(0.838), L()]);
    // R holds its V still for 2.5 s.
    for (let k = 0; k < 76; k++) frame([R(0.838)]);
    g.setActive(false);
    return { scrolled, fired };
  }

  it('R scrolls, a ONE-frame second peace, R holds still 2 s → no chip-2 (R peace) fire', () => {
    const r = run(1);
    expect(r.scrolled).toBe(true);
    expect(r.fired).not.toContain('R:peace');
    expect(r.fired).not.toContain('L:peace');
  });

  it('two peaces held together still unlatch (Register takes over) — after the grace', () => {
    const r = run(80); // both held 2.6 s
    expect(r.fired).toContain('2:peace');
    expect(r.fired).not.toContain('L:peace');
  });
});
