// Node-env fakes for document/window (no jsdom) — same trick
// handPointerPipeline.test.ts and others in this repo use. Proves: low-poly
// is the DEFAULT overlay path (no triangle-free skeleton drawing), and the
// bold skeleton only comes back via opts.lowpoly===false or ?skeletonHands=1.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capHandAroundTip, createHandOverlay, isHandClipped, shapeRelativeToTip, placeShapeAtTip, CAMERA_EDGE_EPS } from '../../src/ui/handOverlay';
import { INDEX_TIP } from '../../src/input/handLogic';
import type { HandFrame } from '../../src/input/handLogic';

function fakeCtx() {
  const calls: string[] = [];
  const ctx: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'canvas') return {};
        return (...args: unknown[]) => { calls.push(String(prop)); return undefined; };
      },
      set() { return true; },
    },
  );
  return { ctx, calls };
}

function fakeDomEl() {
  const classes = new Set<string>();
  return {
    className: '',
    hidden: false,
    width: 0,
    height: 0,
    style: {} as Record<string, string>,
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), toggle: () => {}, contains: (c: string) => classes.has(c) },
    setAttribute: () => {},
    remove: () => {},
  };
}

function handFrame(): HandFrame {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  return {
    slot: 0,
    points,
    pinching: false,
    owner: false,
    pinchPoint: { x: 0.5, y: 0.5 },
    aim: { x: 0.5, y: 0.5 },
    pinchRatio: 1,
    pinchStrength: 0,
    color: '#38bdf8',
  };
}

describe('createHandOverlay default overlay path', () => {
  let container: any;
  let calls: string[];
  let restoreGlobals: () => void;

  beforeEach(() => {
    const { ctx, calls: c } = fakeCtx();
    calls = c;
    const canvasEl = { ...fakeDomEl(), getContext: () => ctx };
    const hadDocument = 'document' in globalThis;
    const hadWindow = 'window' in globalThis;
    const prevDocument = (globalThis as any).document;
    const prevWindow = (globalThis as any).window;
    (globalThis as any).document = { createElement: (tag: string) => (tag === 'canvas' ? canvasEl : fakeDomEl()) };
    (globalThis as any).window = { devicePixelRatio: 1 };
    container = { appendChild: () => {}, getBoundingClientRect: () => ({ width: 800, height: 600 }) };
    restoreGlobals = () => {
      if (hadDocument) (globalThis as any).document = prevDocument; else delete (globalThis as any).document;
      if (hadWindow) (globalThis as any).window = prevWindow; else delete (globalThis as any).window;
      delete (globalThis as any).location;
    };
  });
  afterEach(() => restoreGlobals());

  it('draws the low-poly mesh (no skeleton arcs) with no options at all', () => {
    const overlay = createHandOverlay(container);
    overlay.draw([handFrame()], 1000);
    expect(calls).toContain('fill');
    expect(calls).not.toContain('arc');
  });

  it('falls back to the bold skeleton when opts.lowpoly is explicitly false', () => {
    const overlay = createHandOverlay(container, { lowpoly: false });
    overlay.draw([handFrame()], 1000);
    expect(calls).toContain('arc');
  });

  it('falls back to the bold skeleton behind ?skeletonHands=1', () => {
    (globalThis as any).location = { search: '?skeletonHands=1' };
    const overlay = createHandOverlay(container);
    overlay.draw([handFrame()], 1000);
    expect(calls).toContain('arc');
  });
});

describe('capHandAroundTip', () => {
  it('scales a tall hand down to max height, keeping the index tip fixed', () => {
    const tip = { x: 200, y: 100 };
    const pts = [
      { x: 200, y: 400 }, // wrist, 300px below the tip
      { x: 180, y: 300 },
      { x: 200, y: 100 }, // index tip (landmark 8 must be index 8)
    ];
    while (pts.length < 21) pts.push({ x: 200, y: 250 });
    pts[8] = { ...tip };
    capHandAroundTip(pts, 220, 8);
    const ys = pts.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(220 + 1e-6);
    expect(pts[8].x).toBeCloseTo(200, 5);
    expect(pts[8].y).toBeCloseTo(100, 5);
  });

  it('leaves a short hand alone', () => {
    const pts = Array.from({ length: 21 }, (_, i) => ({ x: 10, y: 10 + i }));
    pts[8] = { x: 10, y: 18 };
    const before = pts.map((p) => ({ ...p }));
    capHandAroundTip(pts, 220, 8);
    expect(pts).toEqual(before);
  });
});


describe('edge-clipped mesh freeze', () => {
  it('flags a hand when any landmark sits near the camera frame edge', () => {
    const ok = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
    expect(isHandClipped(ok)).toBe(false);
    const clipped = ok.map((p) => ({ ...p }));
    clipped[16] = { x: 0.01, y: 0.5 };
    expect(isHandClipped(clipped)).toBe(true);
    expect(CAMERA_EDGE_EPS).toBeGreaterThan(0);
    expect(CAMERA_EDGE_EPS).toBeLessThanOrEqual(0.08);
  });

  it('re-places a frozen shape at a new tip so the mesh translates without distorting', () => {
    const pts = Array.from({ length: 21 }, (_, i) => ({ x: 100 + i, y: 200 + i * 0.5 }));
    const shape = shapeRelativeToTip(pts);
    expect(shape[INDEX_TIP]).toEqual({ x: 0, y: 0 });
    const moved = pts.map(() => ({ x: 0, y: 0 }));
    const tip = { x: 400, y: 300 };
    placeShapeAtTip(shape, tip, moved);
    expect(moved[INDEX_TIP]).toEqual(tip);
    // Relative bone lengths are preserved.
    const d0 = Math.hypot(pts[0].x - pts[INDEX_TIP].x, pts[0].y - pts[INDEX_TIP].y);
    const d1 = Math.hypot(moved[0].x - moved[INDEX_TIP].x, moved[0].y - moved[INDEX_TIP].y);
    expect(d1).toBeCloseTo(d0);
    expect(moved[4].x - moved[INDEX_TIP].x).toBeCloseTo(pts[4].x - pts[INDEX_TIP].x);
  });
});
