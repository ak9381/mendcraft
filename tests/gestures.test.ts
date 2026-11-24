import { describe, it, expect } from 'vitest';
import {
  classifyGesture,
  fingerStates,
  isFistPose,
  isClosingToFist,
  isOpenPalmPose,
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
  else if (spec.thumb === 'pinch') p[4] = { x: p[TIP.index].x - 0.002, y: p[TIP.index].y + 0.002 };
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

  it('fist: real-ish MediaPipe landmarks (tips near the palm, not folded past the PIP)', () => {
    // Laptop-webcam style fist: palm facing roughly inward, fingertips
    // curled to the palm. Several tips still sit slightly farther from the
    // wrist than their PIP (so the old extended() test reads them as open)
    // and the thumb sits close to the index (so pinch used to win).
    const p: Pt[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6 }));
    p[0] = { x: 0.50, y: 0.72 }; // wrist
    p[1] = { x: 0.44, y: 0.66 }; p[2] = { x: 0.41, y: 0.61 }; p[3] = { x: 0.44, y: 0.56 };
    p[4] = { x: 0.49, y: 0.55 }; // thumb tip tucked over the fingers
    p[5] = { x: 0.46, y: 0.56 }; p[6] = { x: 0.47, y: 0.58 }; p[7] = { x: 0.49, y: 0.56 };
    p[8] = { x: 0.51, y: 0.55 }; // index tip near palm, still slightly past its PIP
    p[9] = { x: 0.50, y: 0.55 }; p[10] = { x: 0.50, y: 0.57 }; p[11] = { x: 0.51, y: 0.56 };
    p[12] = { x: 0.52, y: 0.55 };
    p[13] = { x: 0.54, y: 0.56 }; p[14] = { x: 0.54, y: 0.58 }; p[15] = { x: 0.53, y: 0.56 };
    p[16] = { x: 0.52, y: 0.55 };
    p[17] = { x: 0.57, y: 0.58 }; p[18] = { x: 0.57, y: 0.59 }; p[19] = { x: 0.55, y: 0.57 };
    p[20] = { x: 0.54, y: 0.56 };
    expect(isFistPose(p)).toBe(true);
    expect(fingerStates(p).index).toBe(true); // the old test would call this "extended"
    expect(pinchRatio(p)).toBeLessThan(0.38); // would have been classified as pinch
    expect(classifyGesture(p)).toBe('fist');
  });

  it('pinch is not swallowed: an extended index meeting the thumb is still a pinch', () => {
    expect(classifyGesture(makeHand({ index: true, thumb: 'pinch' }))).toBe('pinch');
    expect(isFistPose(makeHand({ index: true, thumb: 'pinch' }))).toBe(false);
  });

  it('closing to a fist is not a pinch: a curling index near the palm, even with a close thumb, is a fist path', () => {
    // Point-like hand whose index has started curling in (tip near the palm)
    // while the thumb sits close — the live "I tried to fist and it pinched" case.
    const p = makeHand({ thumb: 'curled' });
    // pull the index tip in toward the palm but leave it slightly past its PIP
    // so the old extended() test would still call it a reaching index.
    p[6] = { x: 0.45, y: 0.62 };
    p[8] = { x: 0.48, y: 0.66 }; // index has come in to join the curled tips
    p[4] = { x: 0.47, y: 0.66 }; // thumb almost on the index tip
    expect(isClosingToFist(p) || isFistPose(p)).toBe(true);
    expect(classifyGesture(p)).not.toBe('pinch');
  });

  it('open palm vs point vs fist: only all five reaching fingers are a palm', () => {
    const palm = makeHand({ index: true, middle: true, ring: true, pinky: true, thumb: 'up' });
    expect(classifyGesture(palm)).toBe('open-palm');
    expect(isOpenPalmPose(palm) || classifyGesture(palm) === 'open-palm').toBe(true);
    const point = makeHand({ index: true, thumb: 'curled' });
    expect(classifyGesture(point)).toBe('point');
    expect(isOpenPalmPose(point)).toBe(false);
    const fist = makeHand({ thumb: 'curled' });
    expect(classifyGesture(fist)).toBe('fist');
    expect(isOpenPalmPose(fist)).toBe(false);
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

describe('live-style poses (moderate MediaPipe reaches)', () => {
  // palm ≈ (0.5, 0.76), hand size wrist→MCP9 = 0.25. Place tips along -y.
  function handAt(reaches: { index: number; middle: number; ring: number; pinky: number; thumb?: number }): Pt[] {
    const p: Pt[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8 }));
    p[0] = { x: 0.5, y: 0.95 };
    p[5] = { x: 0.45, y: 0.72 };
    p[6] = { x: 0.45, y: 0.65 };
    p[9] = { x: 0.50, y: 0.70 };
    p[10] = { x: 0.50, y: 0.64 };
    p[13] = { x: 0.55, y: 0.72 };
    p[14] = { x: 0.55, y: 0.65 };
    p[17] = { x: 0.60, y: 0.74 };
    p[18] = { x: 0.60, y: 0.68 };
    const palm = { x: (p[0].x + p[5].x + p[9].x + p[13].x + p[17].x) / 5, y: (p[0].y + p[5].y + p[9].y + p[13].y + p[17].y) / 5 };
    const size = Math.hypot(p[0].x - p[9].x, p[0].y - p[9].y);
    const tip = (i: number, reach: number, x: number) => { p[i] = { x, y: palm.y - reach * size }; };
    tip(8, reaches.index, 0.45);
    tip(12, reaches.middle, 0.50);
    tip(16, reaches.ring, 0.55);
    tip(20, reaches.pinky, 0.60);
    tip(4, reaches.thumb ?? 0.8, 0.32);
    return p;
  }

  it('recognises a pointing hand even when curled fingers still have mid reach', () => {
    // The kind of frame that used to fall through to 'none' at OPEN_PALM_REACH 0.95.
    expect(classifyGesture(handAt({ index: 0.95, middle: 0.55, ring: 0.52, pinky: 0.50 }))).toBe('point');
  });

  it('recognises a naturally open palm (not a fully splayed demo pose)', () => {
    expect(classifyGesture(handAt({ index: 0.95, middle: 0.92, ring: 0.90, pinky: 0.88, thumb: 0.85 }))).toBe('open-palm');
  });

  it('recognises a loose fist', () => {
    expect(classifyGesture(handAt({ index: 0.45, middle: 0.42, ring: 0.40, pinky: 0.38, thumb: 0.40 }))).toBe('fist');
  });

  it('treats a relaxed hand with loosely extended fingers as an open palm', () => {
    expect(classifyGesture(handAt({ index: 0.90, middle: 0.85, ring: 0.80, pinky: 0.62, thumb: 0.50 }))).toBe('open-palm');
  });
});
