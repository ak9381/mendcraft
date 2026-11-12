import { describe, it, expect } from 'vitest';
import {
  classifyGesture,
  fingerStates,
  pinchRatio,
  twoHandSpan,
  createGestureRecognizer,
  type Pt,
} from '../src/input/gestures';

// ─── Landmark fixtures ──────────────────────────────────────────────────────
// Hand pointing "up" (decreasing y). Fingers: extended tips reach far from the
// wrist; curled tips fold back near their MCP joints. Builder sets only the
// joints the classifiers read; the rest are filler.

const WRIST: Pt = { x: 0.5, y: 1.0 };
const FINGER_X: Record<string, number> = { index: 0.45, middle: 0.5, ring: 0.55, pinky: 0.6 };
const MCP: Record<string, number> = { index: 5, middle: 9, ring: 13, pinky: 17 };
const PIP: Record<string, number> = { index: 6, middle: 10, ring: 14, pinky: 18 };
const TIP: Record<string, number> = { index: 8, middle: 12, ring: 16, pinky: 20 };

interface HandSpec {
  index?: boolean; middle?: boolean; ring?: boolean; pinky?: boolean;
  thumb?: 'up' | 'curled' | 'pinch';
  indexTipX?: number; indexTipY?: number;
}

function makeHand(spec: HandSpec): Pt[] {
  const p: Pt[] = Array.from({ length: 21 }, () => ({ ...WRIST }));
  p[0] = { ...WRIST };
  for (const f of ['index', 'middle', 'ring', 'pinky'] as const) {
    const x = FINGER_X[f];
    p[MCP[f]] = { x, y: 0.7 };
    p[PIP[f]] = { x, y: 0.55 };
    p[TIP[f]] = spec[f] ? { x, y: 0.35 } : { x, y: 0.72 };
  }
  if (spec.indexTipX !== undefined) p[TIP.index] = { x: spec.indexTipX, y: spec.indexTipY ?? 0.35 };
  // Thumb joints: mcp(2), ip(3), tip(4).
  p[2] = { x: 0.4, y: 0.8 };
  p[3] = { x: 0.37, y: 0.72 };
  if (spec.thumb === 'up') p[4] = { x: 0.3, y: 0.5 };
  else if (spec.thumb === 'pinch') p[4] = { x: p[TIP.index].x - 0.01, y: p[TIP.index].y + 0.01 };
  else p[4] = { x: 0.45, y: 0.78 }; // curled
  return p;
}

describe('fingerStates', () => {
  it('reads extended vs curled fingers', () => {
    const s = fingerStates(makeHand({ index: true, middle: false, ring: false, pinky: false }));
    expect(s.index).toBe(true);
    expect(s.middle).toBe(false);
    expect(s.pinky).toBe(false);
  });
});

describe('classifyGesture', () => {
  it('open palm: all four fingers extended', () => {
    expect(classifyGesture(makeHand({ index: true, middle: true, ring: true, pinky: true, thumb: 'up' })))
      .toBe('open-palm');
  });

  it('fist: everything curled', () => {
    expect(classifyGesture(makeHand({ thumb: 'curled' }))).toBe('fist');
  });

  it('point: only the index extended, thumb away', () => {
    expect(classifyGesture(makeHand({ index: true, thumb: 'curled' }))).toBe('point');
  });

  it('thumbs up: fingers curled, thumb extended above the wrist', () => {
    expect(classifyGesture(makeHand({ thumb: 'up' }))).toBe('thumbs-up');
  });

  it('pinch: thumb tip meets index tip', () => {
    expect(classifyGesture(makeHand({ index: true, thumb: 'pinch' }))).toBe('pinch');
  });

  it('none: two fingers up, not a known pose', () => {
    expect(classifyGesture(makeHand({ index: true, middle: true, thumb: 'curled' }))).toBe('none');
  });

  it('none: too few landmarks', () => {
    expect(classifyGesture([{ x: 0, y: 0 }])).toBe('none');
  });
});

describe('pinchRatio', () => {
  it('is small when pinching, large when pointing', () => {
    expect(pinchRatio(makeHand({ index: true, thumb: 'pinch' }))).toBeLessThan(0.4);
    expect(pinchRatio(makeHand({ index: true, thumb: 'curled' }))).toBeGreaterThan(0.4);
  });
});

describe('twoHandSpan', () => {
  it('grows as the hands move apart', () => {
    const a = makeHand({ index: true, thumb: 'pinch' });
    const b = makeHand({ index: true, thumb: 'pinch', indexTipX: 0.9 });
    expect(twoHandSpan(a, b)).toBeGreaterThan(0.3);
  });
});

describe('createGestureRecognizer', () => {
  const pinchHand = makeHand({ index: true, thumb: 'pinch' });
  const openHand = makeHand({ index: true, middle: true, ring: true, pinky: true, thumb: 'up' });

  it('fires a single pinch on the rising edge, not every frame', () => {
    const r = createGestureRecognizer();
    expect(r.update({ hands: [openHand], now: 0 }).fired).not.toContain('pinch');
    expect(r.update({ hands: [pinchHand], now: 100 }).fired).toContain('pinch');
    expect(r.update({ hands: [pinchHand], now: 150 }).fired).not.toContain('pinch');
  });

  it('recognises a double pinch within the window', () => {
    const r = createGestureRecognizer();
    r.update({ hands: [pinchHand], now: 0 });          // pinch 1 down
    r.update({ hands: [openHand], now: 50 });           // release
    const res = r.update({ hands: [pinchHand], now: 300 }); // pinch 2 within 450ms
    expect(res.fired).toContain('double-pinch');
    expect(res.gesture).toBe('double-pinch');
  });

  it('does not double-pinch when the second pinch is too late', () => {
    const r = createGestureRecognizer();
    r.update({ hands: [pinchHand], now: 0 });
    r.update({ hands: [openHand], now: 50 });
    const res = r.update({ hands: [pinchHand], now: 900 });
    expect(res.fired).toContain('pinch');
    expect(res.fired).not.toContain('double-pinch');
  });

  it('reports two-hand zoom with a signed delta', () => {
    const r = createGestureRecognizer();
    const near = makeHand({ index: true, thumb: 'pinch', indexTipX: 0.45 });
    const far = makeHand({ index: true, thumb: 'pinch', indexTipX: 0.9 });
    r.update({ hands: [pinchHand, near], now: 0 });
    const res = r.update({ hands: [pinchHand, far], now: 50 });
    expect(res.gesture).toBe('two-hand-zoom');
    expect(res.zoomDelta).toBeGreaterThan(0);
  });

  it('fires a static pose once on entry', () => {
    const r = createGestureRecognizer();
    const fist = makeHand({ thumb: 'curled' });
    expect(r.update({ hands: [fist], now: 0 }).fired).toContain('fist');
    expect(r.update({ hands: [fist], now: 50 }).fired).not.toContain('fist');
  });
});
