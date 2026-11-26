// The plan's 3D view by hand, through the REAL hand pointer: synthetic
// 21-landmark frames at real hand scale → createHandPointer (fist close /
// hold / release grace, facing gate, hand lost) → the surface lookup
// (armedSurfaceAt, including the rect fallback for a board that is not the
// focused one) → plan/orbitHands.ts → a camera driven by the same pure orbit
// math and easing the three.js view uses (plan/orbit3d.ts).
//
// Founder, live: "I am unable to rotate the 3D plan with my hand." A board
// that is not the focused one has an inert body, which hit-testing skips —
// the fist was decided as a board move. These tests hold that shut.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { armedSurfaceAt, createHandPointer, type HandPointer, type HandSurfaceEdit } from '../../src/canvas/handPointer';
import { createPlan3dHands, PEACE_PX_PER_DOUBLING, type Plan3dHands } from '../../src/plan/orbitHands';
import { dollyOffset, easeTurn, ELEVATION, orbitOffset, type Vec3 } from '../../src/plan/orbit3d';
import { createPlanPeace } from '../../src/canvas/planPeace';
import { fakeFrame, fakeHandDoc } from '../helpers/fakeHandDoc';
import { synthFist, synthHand } from '../helpers/synthHands';

const W = 1000;
const H = 800;
const FRAME = 33;
const BOARD = { left: 100, top: 60, width: 800, height: 700 };
/** The 3D view on screen (inside the board frame). */
const VIEW = { left: 120, top: 120, width: 760, height: 620 };
const inside = (r: typeof VIEW, x: number, y: number) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;

/** A camera like extrude3d's: an offset from the target, hand turns eased
 *  per frame (easeTurn), elevation clamped (ELEVATION), dolly clamped. */
function fakeCamera() {
  let off: Vec3 = { x: 10000, y: -10000, z: 8000 };
  let pending = { yaw: 0, pitch: 0 };
  const cam = {
    stops: 0,
    is3D: () => true,
    orbit3D(dx: number, dy: number) { cam.turn3D(-(2 * Math.PI) * (dx / VIEW.width), Math.PI * (dy / VIEW.height)); },
    turn3D(yaw: number, pitch: number) { pending = { yaw: pending.yaw + yaw, pitch: pending.pitch + pitch }; },
    orbitStop3D() { pending = { yaw: 0, pitch: 0 }; cam.stops++; },
    dolly3D(f: number) { off = dollyOffset(off, f, 500, 200000); },
    /** One animation frame. */
    tick() {
      const { step, rest } = easeTurn(pending);
      pending = rest;
      off = orbitOffset(off, step.yaw, step.pitch, ELEVATION.min, ELEVATION.max);
    },
    pending: () => Math.abs(pending.yaw) + Math.abs(pending.pitch),
    angles() {
      const r = Math.hypot(off.x, off.y, off.z);
      return { yaw: Math.atan2(off.y, off.x), pitch: Math.asin(off.z / r), distance: r };
    },
  };
  return cam;
}

interface Rig {
  hp: HandPointer;
  cam: ReturnType<typeof fakeCamera>;
  hands: Plan3dHands;
  board: { phase: string }[];
  pans: { phase: string }[];
  zooms: { phase: string }[];
  t: number;
  open(x: number, y: number, frames?: number): void;
  fist(x: number, y: number, frames?: number): void;
  fistTo(a: { x: number; y: number }, b: { x: number; y: number }, frames: number): void;
  destroy(): void;
}

/** `focused: false` = the board is not the focused one: its body is inert, so
 *  hit-testing at the 3D view returns the board frame, never the view. */
function rig3d(opts: { focused: boolean }): Rig {
  (globalThis as Record<string, unknown>).innerWidth = W;
  (globalThis as Record<string, unknown>).innerHeight = H;
  const cam = fakeCamera();
  const hands = createPlan3dHands(cam);
  const frame = fakeFrame(BOARD, 'plan');
  const surface = fakeFrame(VIEW, 'plan');
  surface.matches = () => false;
  surface.closest = (sel: string) => (sel === '[data-hand-surface]' ? surface : sel === '.mc-frame' ? frame : null);
  const edit: HandSurfaceEdit = {
    armed: (x, y) => inside(VIEW, x, y),
    drawing: () => true,
    tap: () => {},
    fistStart: (x, y) => hands.fistStart(x, y),
    fistMove: (x, y) => hands.fistMove(x, y),
    fistEnd: () => hands.fistEnd(),
    fistCancel: () => hands.fistCancel(),
    zoom2: (phase, a, b) => hands.zoom2(phase, a, b),
  };
  (surface as unknown as { __mcHandSurface: unknown }).__mcHandSurface = { beginDrag: () => false, drag: () => {}, endDrag: () => {}, tap: () => {}, handEdit: edit };
  const hd = fakeHandDoc([], [frame], []);
  const inner = hd.elementFromPoint.bind(hd);
  const qsa = hd.querySelectorAll.bind(hd);
  Object.assign(hd, {
    elementFromPoint: (x: number, y: number) => (opts.focused && inside(VIEW, x, y) ? surface : inner(x, y)),
    querySelectorAll: (sel: string) => (sel === '[data-hand-surface]' ? [surface] : qsa(sel)),
  });
  const board: { phase: string }[] = [];
  const pans: { phase: string }[] = [];
  const zooms: { phase: string }[] = [];
  const hp = createHandPointer(hd, {
    onBoardMove: (ev) => board.push(ev),
    onWorldPan: (ev) => pans.push(ev),
    onWorldZoom: (ev) => zooms.push(ev),
    focusedFrameId: () => (opts.focused ? 'plan' : null),
    dwellClick: () => false,
  });
  const rig: Rig = {
    hp, cam, hands, board, pans, zooms, t: 0,
    open(x, y, frames = 1) { for (let i = 0; i < frames; i++) { hp.update([synthHand(x, y, false, W, H)], (rig.t += FRAME)); cam.tick(); } },
    fist(x, y, frames = 1) { for (let i = 0; i < frames; i++) { hp.update([synthFist(x, y, W, H)], (rig.t += FRAME)); cam.tick(); } },
    fistTo(a, b, frames) { for (let i = 1; i <= frames; i++) rig.fist(a.x + ((b.x - a.x) * i) / frames, a.y + ((b.y - a.y) * i) / frames); },
    destroy() {
      hp.destroy();
      delete (globalThis as Record<string, unknown>).innerWidth;
      delete (globalThis as Record<string, unknown>).innerHeight;
    },
  };
  return rig;
}

const twoFists = (x1: number, y1: number, x2: number, y2: number) => [synthFist(x1, y1, W, H), synthFist(x2, y2, W, H)];
const twoOpen = (x1: number, y1: number, x2: number, y2: number) => [synthHand(x1, y1, false, W, H), synthHand(x2, y2, false, W, H)];

for (const focused of [true, false]) {
  describe(`plan 3D by hand (${focused ? 'the focused board' : 'a board that is not the focused one'})`, () => {
    let rig: Rig;
    beforeEach(() => { rig = rig3d({ focused }); });
    afterEach(() => rig.destroy());

    it('a held fist moving sideways turns the model, and never moves the board or pans the canvas', () => {
      const a0 = rig.cam.angles();
      rig.open(400, 450, 10);
      rig.fist(400, 450, 14); // closes and passes the hold
      expect(rig.hands.orbiting()).toBe(true);
      rig.fistTo({ x: 400, y: 450 }, { x: 600, y: 450 }, 24);
      rig.fist(600, 450, 12);
      const a1 = rig.cam.angles();
      expect(Math.abs(a1.yaw - a0.yaw)).toBeGreaterThan(0.8); // ~200 px of 760 ≈ 1.6 rad
      expect(Math.abs(a1.pitch - a0.pitch)).toBeLessThan(0.05);
      expect(a1.distance).toBeCloseTo(a0.distance, 3);
      rig.open(600, 450, 10);
      expect(rig.hands.orbiting()).toBe(false);
      expect(rig.board).toHaveLength(0);
      expect(rig.pans).toHaveLength(0);
      expect(rig.zooms).toHaveLength(0);
    });

    it('up / down tilts it, clamped: never under the floor, never over the top', () => {
      rig.open(500, 300, 10);
      rig.fist(500, 300, 14);
      rig.fistTo({ x: 500, y: 300 }, { x: 500, y: 740 }, 30); // far down: tilt up to the top
      rig.fist(500, 740, 40);
      expect(rig.cam.angles().pitch).toBeCloseTo(ELEVATION.max, 3);
      rig.open(500, 740, 10);
      // A second stroke, far up: down to the lowest view, never under the floor.
      rig.open(500, 740, 4);
      rig.fist(500, 740, 14);
      rig.fistTo({ x: 500, y: 740 }, { x: 500, y: 130 }, 30);
      rig.fistTo({ x: 500, y: 130 }, { x: 500, y: 130 }, 1);
      rig.fist(500, 130, 40);
      expect(rig.cam.angles().pitch).toBeCloseTo(ELEVATION.min, 3);
      rig.open(500, 130, 10);
      const p = rig.cam.angles().pitch;
      expect(p).toBeGreaterThanOrEqual(ELEVATION.min - 1e-9);
      expect(p).toBeLessThanOrEqual(ELEVATION.max + 1e-9);
      expect(rig.board).toHaveLength(0);
      expect(rig.pans).toHaveLength(0);
    });

    it('the hand lost mid-turn stops the turn at once (the pending easing is dropped)', () => {
      rig.open(400, 450, 10);
      rig.fist(400, 450, 14);
      rig.fistTo({ x: 400, y: 450 }, { x: 700, y: 450 }, 6); // fast: easing still pending
      expect(rig.cam.pending()).toBeGreaterThan(0);
      rig.hp.lost();
      expect(rig.hands.orbiting()).toBe(false);
      expect(rig.cam.stops).toBe(1);
      expect(rig.cam.pending()).toBe(0);
      const a = rig.cam.angles();
      for (let i = 0; i < 10; i++) rig.cam.tick();
      expect(rig.cam.angles().yaw).toBe(a.yaw);
      expect(rig.board).toHaveLength(0);
    });

    it('looking away mid-turn stops it', () => {
      rig.open(400, 450, 10);
      rig.fist(400, 450, 14);
      rig.fistTo({ x: 400, y: 450 }, { x: 500, y: 450 }, 10);
      expect(rig.hands.orbiting()).toBe(true);
      rig.hp.setFacing(false, rig.t);
      rig.fistTo({ x: 500, y: 450 }, { x: 700, y: 450 }, 30);
      expect(rig.hands.orbiting()).toBe(false);
      expect(rig.cam.stops).toBe(1);
      const a = rig.cam.angles();
      rig.fistTo({ x: 700, y: 450 }, { x: 400, y: 450 }, 20); // still looking away: nothing
      expect(rig.cam.angles().yaw).toBeCloseTo(a.yaw, 9);
      expect(rig.board).toHaveLength(0);
      expect(rig.pans).toHaveLength(0);
    });

    it('two fists on the view move the camera in and out, not the canvas', () => {
      const d0 = rig.cam.angles().distance;
      for (let i = 0; i < 10; i++) rig.hp.update(twoOpen(400, 450, 600, 450), (rig.t += FRAME));
      for (let i = 0; i < 16; i++) rig.hp.update(twoFists(400, 450, 600, 450), (rig.t += FRAME));
      for (let i = 1; i <= 10; i++) rig.hp.update(twoFists(400 - i * 10, 450, 600 + i * 10, 450), (rig.t += FRAME));
      for (let i = 0; i < 6; i++) rig.hp.update(twoFists(300, 450, 700, 450), (rig.t += FRAME));
      const d1 = rig.cam.angles().distance;
      expect(d1).toBeLessThan(d0 * 0.75); // spread apart = closer
      for (let i = 0; i < 10; i++) rig.hp.update(twoOpen(300, 450, 700, 450), (rig.t += FRAME));
      expect(rig.hands.busy()).toBe(false);
      expect(rig.zooms).toHaveLength(0);
      expect(rig.board).toHaveLength(0);
      expect(rig.pans).toHaveLength(0);
    });

    it('the surface is found where the fist closes (armedSurfaceAt), and not off the view', () => {
      rig.open(50, 450, 10); // left of the board: the canvas
      rig.fist(50, 450, 14);
      rig.fistTo({ x: 50, y: 450 }, { x: 80, y: 450 }, 6);
      rig.open(80, 450, 10);
      expect(rig.pans.some((e) => e.phase === 'start')).toBe(true);
      expect(rig.hands.orbiting()).toBe(false);
    });
  });
}

describe('plan 3D: peace and move = closer / farther', () => {
  it('peace moving up moves the camera closer, down farther; a still peace does nothing', () => {
    const cam = fakeCamera();
    const hands = createPlan3dHands(cam);
    const peace = createPlanPeace();
    const target = { resizeBegin: () => hands.peaceBegin(), resizeTravel: (dx: number, dy: number) => hands.peaceTravel(dx, dy), resizeEnd: () => hands.peaceEnd(), resizeCancel: () => hands.peaceCancel() };
    const ctx = { blocked: false, targetAt: () => target };
    let t = 0;
    const feed = (y: number, shape: 'peace' | 'open' = 'peace') => peace.update([{ side: 'R', shape, point: { x: 500, y } }], (t += FRAME), ctx);
    const d0 = cam.angles().distance;
    for (let i = 0; i < 20; i++) feed(500); // held still: never starts
    expect(cam.angles().distance).toBe(d0);
    for (let i = 0; i < 8; i++) feed(500, 'open');
    feed(500);
    for (let i = 1; i <= 8; i++) feed(500 - (PEACE_PX_PER_DOUBLING * i) / 8);
    expect(peace.state.phase).toBe('resizing');
    expect(cam.angles().distance).toBeCloseTo(d0 / 2, 0); // one doubling closer
    for (let i = 1; i <= 8; i++) feed(500 - PEACE_PX_PER_DOUBLING + (2 * PEACE_PX_PER_DOUBLING * i) / 8);
    expect(cam.angles().distance).toBeCloseTo(d0 * 2, 0);
    for (let i = 0; i < 8; i++) feed(740, 'open');
    expect(peace.state.phase).toBe('idle');
  });
});

describe('plan 3D: the pure orbit pieces', () => {
  it('easing reaches the whole turn and then stops', () => {
    let p = { yaw: 1, pitch: -0.4 };
    let yaw = 0, pitch = 0;
    for (let i = 0; i < 60; i++) { const { step, rest } = easeTurn(p); yaw += step.yaw; pitch += step.pitch; p = rest; }
    expect(yaw).toBeCloseTo(1, 6);
    expect(pitch).toBeCloseTo(-0.4, 6);
    expect(p).toEqual({ yaw: 0, pitch: 0 });
  });

  it('armedSurfaceAt finds an inert board\'s 3D view by its rect, and nothing outside it', () => {
    const surface = fakeFrame(VIEW, 'plan');
    const edit = { armed: (x: number, y: number) => inside(VIEW, x, y) } as unknown as HandSurfaceEdit;
    (surface as unknown as { __mcHandSurface: unknown }).__mcHandSurface = { handEdit: edit };
    const frame = fakeFrame(BOARD, 'plan');
    const hd = fakeHandDoc([], [frame], []);
    Object.assign(hd, { querySelectorAll: (sel: string) => (sel === '[data-hand-surface]' ? [surface] : []) });
    expect(armedSurfaceAt(hd, 500, 450)).toBe(edit);
    expect(armedSurfaceAt(hd, 110, 90)).toBeNull(); // the board's own strip
    expect(armedSurfaceAt(hd, 40, 450)).toBeNull(); // the canvas
  });
});
