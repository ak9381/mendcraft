// The ONE facing gate, through the REAL laptop hand path: presence frame →
// handFacing router → createHandPointer() (cursor, dwell, fist tap, grabs)
// → createGestureControl() (palm highlight, 2 s button holds, peace scroll).
// While the user is not facing the screen — including NO FACE SEEN at all
// (the head turned past what the face model can see) — nothing acts or
// moves, a running drag is cancelled (not committed), and facing again only
// unlocks after FACING_RESUME_MS.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandPointer, FACING_RESUME_MS, REACH, type HandPointer } from '../../src/canvas/handPointer';
import { createGestureControl, type GestureControl, type HighlightHook } from '../../src/canvas/gestureControl';
import { LAPTOP_GESTURES } from '../../src/canvas/gestureBindings';
import { createLaptopHandRouter, presenceHandFacing, type LaptopHandRouter } from '../../src/canvas/handFacing';
import { syntheticHand } from '../../src/canvas/handShapeFixtures';
import type { HoldState } from '../../src/canvas/gestureHold';
import type { FaceFrame } from '../../src/input/presence';
import { synthFist, synthHand } from '../helpers/synthHands';
import { cursorsOf, fakeButton, fakeFrame, fakeHandDoc, type FakeEl } from '../helpers/fakeHandDoc';

const W = 1000;
const H = 800;
const FRAME = 33;

// ---- a small fake DOM for the gesture layer + the scroll target (as phoneScroll.test)
class GEl {
  className = ''; title = ''; textContent = ''; innerHTML = ''; hidden = false; id = '';
  scrollTop = 0; scrollLeft = 0; scrollHeight = 0; clientHeight = 0; scrollWidth = 0; clientWidth = 0;
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: GEl[] = [];
  parent: GEl | null = null;
  parentElement: GEl | null = null;
  shadowRoot = null;
  classes = new Set<string>();
  lazy = new Map<string, GEl>();
  style = { setProperty: () => {}, removeProperty: () => {} } as unknown as Record<string, unknown>;
  constructor(public ownerDocument: GDoc) {}
  classList = {
    add: (c: string) => { this.classes.add(c); },
    remove: (c: string) => { this.classes.delete(c); },
    toggle: (c: string, on?: boolean) => { const v = on ?? !this.classes.has(c); if (v) this.classes.add(c); else this.classes.delete(c); return v; },
    contains: (c: string) => this.classes.has(c),
  };
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  append(...els: GEl[]) { for (const e of els) { e.parent = this; this.children.push(e); } }
  get isConnected() { return true; }
  remove() {}
  querySelector(sel: string) { let e = this.lazy.get(sel); if (!e) { e = new GEl(this.ownerDocument); this.lazy.set(sel, e); } return e; }
  querySelectorAll() { return []; }
  closest() { return null; }
  getRootNode() { return this.ownerDocument; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  addEventListener() {}
  removeEventListener() {}
  matches() { return false; }
}
class GDoc {
  under: GEl | null = null;
  defaultView = { getComputedStyle: () => ({ overflowY: 'auto', overflowX: 'hidden' }) };
  createElement() { return new GEl(this); }
  querySelectorAll() { return []; }
  elementFromPoint() { return this.under; }
}

const face = (handGate: boolean | null): FaceFrame => ({
  box: { x: 0.4, y: 0.1, w: 0.2, h: 0.2, cx: 0.5, cy: 0.2 }, isOperator: true, facing: !!handGate, handGate, dim: false,
});
/** Camera-space synthetic hand (synthHands) → selfie space (what presence sends). */
const selfie = <T extends { x: number; y: number }>(h: readonly T[]) => h.map((p) => ({ ...p, x: 1 - p.x }));

describe('the one facing gate, through the real laptop hand path', () => {
  let t: number;
  let hp: HandPointer;
  let gestures: GestureControl;
  let router: LaptopHandRouter;
  let doc: ReturnType<typeof fakeHandDoc>;
  let board: { phase: string; dx: number; dy: number }[];
  let pans: { phase: string }[];
  let states: HoldState[];
  let palms: (unknown | null)[];
  let list: GEl;
  let btn: FakeEl;
  /** What the camera says about the face, sent with every frame. */
  let faces: FaceFrame[];

  beforeEach(() => {
    (globalThis as Record<string, unknown>).innerWidth = W;
    (globalThis as Record<string, unknown>).innerHeight = H;
    t = 0;
    board = []; pans = []; states = []; palms = [];
    btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    const f1 = fakeFrame({ left: 100, top: 500, width: 300, height: 250 }, 'f1');
    doc = fakeHandDoc([btn], [f1]);
    hp = createHandPointer(doc, {
      onBoardMove: (ev) => board.push(ev),
      onWorldPan: (ev) => pans.push(ev),
      dwellClick: () => true, // the opt-in dwell click too: it must not fill while away
    });
    const gdoc = new GDoc();
    const root = new GEl(gdoc);
    list = new GEl(gdoc);
    list.scrollHeight = 3000; list.clientHeight = 400; list.scrollTop = 900;
    gdoc.under = list;
    const highlight: HighlightHook = {
      update: (palm) => { palms.push(palm); },
      current: () => null, lost: () => {}, setActive: () => {}, destroy: () => {},
    };
    const g = createGestureControl({ root: root as unknown as HTMLElement, bindings: LAPTOP_GESTURES, highlight, reach: () => REACH });
    g.setActive(true);
    gestures = { ...g, frame: (h, n, c) => { const s = g.frame(h, n, c); states.push({ ...s }); return s; } };
    router = createLaptopHandRouter({ pointer: hp, gestures });
    faces = [face(true)];
  });
  afterEach(() => {
    gestures.setActive(false);
    hp.destroy();
    delete (globalThis as Record<string, unknown>).innerWidth;
    delete (globalThis as Record<string, unknown>).innerHeight;
  });

  /** One camera frame: presence (face) first, then the hands — canvasHands' order. */
  const frame = (hands: readonly (readonly { x: number; y: number }[])[]) => {
    t += FRAME;
    router.presence({ faces }, t);
    router.frame(hands, t);
  };
  const open = (x: number, y: number, n = 1) => { for (let i = 0; i < n; i++) frame([selfie(synthHand(x, y, false, W, H))]); };
  const fist = (x: number, y: number, n = 1) => { for (let i = 0; i < n; i++) frame([selfie(synthFist(x, y, W, H))]); };
  const tap = (x: number, y: number) => { open(x, y, 8); fist(x, y, 4); open(x, y, 4); };
  const thumbsUp = (n: number) => { for (let i = 0; i < n; i++) frame([syntheticHand('thumbsUp', 'R')]); };
  const peaceMove = (y0: number, y1: number, ms: number) => {
    const n = Math.round(ms / FRAME);
    for (let k = 0; k <= n; k++) frame([syntheticHand('peace', 'R', { at: { x: 0.6, y: y0 + ((y1 - y0) * k) / n } })]);
  };
  const cursorAt = () => cursorsOf(doc)[0]?.style.transform;

  it('presenceHandFacing: only a settled operator face that faces the screen is "facing"', () => {
    expect(presenceHandFacing({ faces: [] })).toBe(false); // no face = NOT facing
    expect(presenceHandFacing({ faces: [face(null)] })).toBe(false); // not settled
    expect(presenceHandFacing({ faces: [face(false)] })).toBe(false); // turned
    expect(presenceHandFacing({ faces: [{ ...face(true), isOperator: false }] })).toBe(false); // a stranger
    expect(presenceHandFacing({ faces: [face(true)] })).toBe(true);
    // The frame-level gate (with the lost-face grace) wins over the face list.
    expect(presenceHandFacing({ faces: [], handGate: true })).toBe(true);
    expect(presenceHandFacing({ faces: [face(true)], handGate: null })).toBe(false);
  });

  it('control: facing, the same moves click, hold, scroll and highlight', () => {
    tap(500, 400);
    expect(btn.click).toHaveBeenCalled();
    btn.click.mockClear();
    thumbsUp(75); // 2.5 s
    expect(states.some((s) => s.fired === 'R:thumbsUp')).toBe(true);
    peaceMove(0.55, 0.85, 900);
    expect(list.scrollTop).toBeGreaterThan(1000);
    open(500, 400, 3);
    expect(palms.at(-1)).not.toBeNull();
  });

  it('NO FACE seen (looked far away): no cursor movement, no target, no dwell, no tap', () => {
    open(500, 200, 6);
    faces = [];
    open(500, 200, 1);
    expect(hp.handsLocked!()).toBe(true); // at once — no 300 ms of live hands
    const frozen = cursorAt();
    open(600, 300, 10); open(500, 400, 90); // across the button, ~3 s (dwell is 1.5 s)
    expect(cursorAt()).toBe(frozen);
    expect(hp.target).toBeNull();
    tap(500, 400);
    expect(btn.click).not.toHaveBeenCalled();
    expect(hp.clickTarget()).toBe(false);
  });

  it('a turned head (gate false) locks on the same frame', () => {
    open(500, 400, 4);
    faces = [face(false)];
    open(500, 400, 1);
    expect(hp.handsLocked!()).toBe(true);
    expect(hp.target).toBeNull();
  });

  it('an unsettled face (gate null) is not facing either', () => {
    faces = [face(null)];
    tap(500, 400);
    expect(btn.click).not.toHaveBeenCalled();
    expect(hp.handsLocked!()).toBe(true);
  });

  it('not facing: no button-gesture hold progress and no fire (thumbs up = Approve)', () => {
    faces = [];
    thumbsUp(90); // 3 s
    expect(states.every((s) => !s.fired && !s.key && s.progress === 0)).toBe(true);
  });

  it('looking away mid-hold cancels the hold; it does not fire', () => {
    thumbsUp(40); // 1.3 s of the 2 s hold
    expect(states.at(-1)!.progress).toBeGreaterThan(0.3);
    faces = [];
    thumbsUp(60);
    expect(states.some((s) => s.fired)).toBe(false);
    expect(states.at(-1)!.progress).toBe(0);
  });

  it('not facing: peace-and-move never scrolls', () => {
    faces = [];
    peaceMove(0.55, 0.85, 900);
    expect(list.scrollTop).toBe(900);
  });

  it('not facing: no palm highlight', () => {
    open(500, 400, 3);
    expect(palms.at(-1)).not.toBeNull();
    faces = [];
    open(500, 400, 10);
    expect(palms.slice(-10).every((p) => p === null)).toBe(true);
  });

  it('not facing: a held fist never grabs (no board drag, no pan)', () => {
    faces = [];
    fist(250, 600, 30);
    fist(800, 300, 30);
    expect(board).toHaveLength(0);
    expect(pans).toHaveLength(0);
    expect(hp.isGrabActive()).toBe(false);
  });

  it('a running board drag is CANCELLED (not committed) the moment facing is lost', () => {
    open(250, 600, 8);
    fist(250, 600, 14);
    for (let k = 1; k <= 10; k++) fist(250 + k * 10, 600, 1);
    expect(board[0]?.phase).toBe('start');
    expect(board.some((e) => e.phase === 'move')).toBe(true);
    faces = [];
    fist(360, 600, 1);
    expect(board.at(-1)?.phase).toBe('cancel');
    expect(board.some((e) => e.phase === 'end')).toBe(false);
    expect(hp.isGrabActive()).toBe(false);
    const n = board.length;
    for (let k = 1; k <= 10; k++) fist(360 + k * 10, 600, 1); // still looking away: nothing
    open(460, 600, 6); // the hand opens while away: nothing commits
    expect(board).toHaveLength(n);
  });

  it('a running pan stops at once (no more moves) when facing is lost', () => {
    open(800, 200, 8);
    fist(800, 200, 14);
    for (let k = 1; k <= 6; k++) fist(800, 200 + k * 10, 1);
    expect(pans[0]?.phase).toBe('start');
    faces = [];
    fist(800, 270, 1);
    expect(pans.at(-1)?.phase).toBe('end');
    const n = pans.length;
    for (let k = 1; k <= 10; k++) fist(800, 270 + k * 10, 1);
    expect(pans).toHaveLength(n);
  });

  it(`facing again: still locked for ${FACING_RESUME_MS} ms (no tap, no hold), then everything works`, () => {
    open(500, 400, 6);
    faces = [];
    open(500, 400, 10);
    faces = [face(true)];
    // A quick tap right as the head comes back: inside the settle — nothing.
    const back = t;
    open(500, 400, 2); fist(500, 400, 3); open(500, 400, 2);
    expect(btn.click).not.toHaveBeenCalled();
    expect(hp.handsLocked!()).toBe(true);
    // A thumbs-up starting inside the settle makes no progress until it ends.
    const before = states.length;
    thumbsUp(2);
    expect(t - back).toBeLessThan(FACING_RESUME_MS);
    expect(states.slice(before).every((s) => s.progress === 0)).toBe(true);
    open(500, 400, 10); // past the settle
    expect(hp.handsLocked!()).toBe(false);
    tap(500, 400);
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('flicker: facing for less than the settle, then away again, never unlocks', () => {
    faces = [];
    open(500, 400, 4);
    for (let r = 0; r < 5; r++) {
      faces = [face(true)]; open(500, 400, 5); // ≈165 ms
      expect(hp.handsLocked!()).toBe(true);
      faces = []; open(500, 400, 2);
    }
    tap(500, 400);
    expect(btn.click).not.toHaveBeenCalled();
  });

  it('no face tracking at all (sim / tests, no presence frames) leaves the hands on', () => {
    const r2 = createLaptopHandRouter({ pointer: hp, gestures });
    for (let i = 0; i < 8; i++) { t += FRAME; r2.frame([selfie(synthHand(500, 400, false, W, H))], t); }
    for (let i = 0; i < 4; i++) { t += FRAME; r2.frame([selfie(synthFist(500, 400, W, H))], t); }
    for (let i = 0; i < 4; i++) { t += FRAME; r2.frame([selfie(synthHand(500, 400, false, W, H))], t); }
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('taught gestures are not matched while not facing', () => {
    const teach = vi.fn();
    const r3 = createLaptopHandRouter({ pointer: hp, gestures, teach });
    for (let i = 0; i < 5; i++) { t += FRAME; r3.presence({ faces: [face(true)] }, t); r3.frame([syntheticHand('open', 'R')], t); }
    expect(teach).toHaveBeenCalled();
    teach.mockClear();
    for (let i = 0; i < 20; i++) { t += FRAME; r3.presence({ faces: [] }, t); r3.frame([syntheticHand('open', 'R')], t); }
    expect(teach).not.toHaveBeenCalled();
  });
});
