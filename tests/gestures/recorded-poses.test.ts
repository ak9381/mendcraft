// Recorded-style 16:9 MediaPipe 0–1 landmark frames (laptop webcam, not the
// compact click-pipeline synth). Regression lock for the 1f4f2ec pinch/zoom
// break: a reaching pinch must classify as pinch (never fist), two such
// hands must start two-hand zoom, a fist stays a fist, a point stays a point.
import { describe, it, expect } from 'vitest';
import {
  classifyGesture,
  isFistPose,
  isOpenPalmPose,
  isClosingToFist,
  pinchRatio,
  createGestureRecognizer,
  type Pt,
} from '../../src/input/gestures';

function blank(): Pt[] {
  return Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.62 }));
}

/** Pointing hand: index reaches ~1.3× palm size, other fingers curled. */
export function recordedPoint(ox = 0): Pt[] {
  const p = blank();
  const x = 0.42 + ox;
  p[0] = { x, y: 0.80 }; // wrist
  p[9] = { x, y: 0.60 }; // middle MCP — palm size 0.20
  p[5] = { x, y: 0.60 };
  p[6] = { x, y: 0.50 }; // index PIP (tip is farther from wrist → extended)
  p[7] = { x, y: 0.40 };
  p[8] = { x, y: 0.30 }; // index tip
  // Middle / ring / pinky curled: tip closer to the wrist than its PIP
  // so extended() is false (a real pointing hand, not allOpen).
  p[10] = { x: x + 0.03, y: 0.50 }; p[12] = { x: x + 0.03, y: 0.70 };
  p[13] = { x: x + 0.05, y: 0.61 }; p[14] = { x: x + 0.05, y: 0.50 }; p[16] = { x: x + 0.05, y: 0.70 };
  p[17] = { x: x + 0.08, y: 0.62 }; p[18] = { x: x + 0.08, y: 0.52 }; p[20] = { x: x + 0.08, y: 0.72 };
  p[1] = { x: x - 0.06, y: 0.70 }; p[2] = { x: x - 0.08, y: 0.66 }; p[3] = { x: x - 0.09, y: 0.58 };
  p[4] = { x: x - 0.10, y: 0.50 }; // thumb away — not a pinch
  return p;
}

/** Same reach as recordedPoint, but the thumb sits on the index tip. */
export function recordedPinch(ox = 0): Pt[] {
  const p = recordedPoint(ox);
  p[4] = { x: p[8].x - 0.002, y: p[8].y + 0.002 };
  p[3] = { x: p[8].x - 0.01, y: p[8].y + 0.04 };
  return p;
}

/** All five fingertips stretched away from the palm, thumb not pinching. */
export function recordedOpen(ox = 0): Pt[] {
  const p = recordedPoint(ox);
  const x = 0.42 + ox;
  p[12] = { x: x + 0.04, y: 0.30 };
  p[10] = { x: x + 0.04, y: 0.48 };
  p[16] = { x: x + 0.08, y: 0.32 };
  p[14] = { x: x + 0.08, y: 0.50 };
  p[20] = { x: x + 0.12, y: 0.34 };
  p[18] = { x: x + 0.12, y: 0.52 };
  p[4] = { x: x - 0.16, y: 0.42 };
  p[3] = { x: x - 0.12, y: 0.50 };
  return p;
}

/** Laptop-webcam fist: tips near the palm, index not an outlier. */
export function recordedFist(ox = 0): Pt[] {
  const p = blank();
  const s = ox;
  p[0] = { x: 0.50 + s, y: 0.72 };
  p[1] = { x: 0.44 + s, y: 0.66 }; p[2] = { x: 0.41 + s, y: 0.61 }; p[3] = { x: 0.44 + s, y: 0.56 };
  p[4] = { x: 0.49 + s, y: 0.55 };
  p[5] = { x: 0.46 + s, y: 0.56 }; p[6] = { x: 0.47 + s, y: 0.58 }; p[7] = { x: 0.49 + s, y: 0.56 };
  p[8] = { x: 0.51 + s, y: 0.55 };
  p[9] = { x: 0.50 + s, y: 0.55 }; p[10] = { x: 0.50 + s, y: 0.57 }; p[11] = { x: 0.51 + s, y: 0.56 };
  p[12] = { x: 0.52 + s, y: 0.55 };
  p[13] = { x: 0.54 + s, y: 0.56 }; p[14] = { x: 0.54 + s, y: 0.58 }; p[15] = { x: 0.53 + s, y: 0.56 };
  p[16] = { x: 0.52 + s, y: 0.55 };
  p[17] = { x: 0.57 + s, y: 0.58 }; p[18] = { x: 0.57 + s, y: 0.59 }; p[19] = { x: 0.55 + s, y: 0.57 };
  p[20] = { x: 0.54 + s, y: 0.56 };
  return p;
}

describe('recorded 16:9 landmark poses (pinch / zoom / fist / point / palm)', () => {
  it('a reaching pinch classifies as pinch, never a fist', () => {
    const p = recordedPinch();
    expect(pinchRatio(p)).toBeLessThan(0.20);
    expect(isFistPose(p)).toBe(false);
    expect(isClosingToFist(p)).toBe(false);
    expect(classifyGesture(p)).toBe('pinch');
  });

  it('a pointing hand with a curled thumb is a point, not a fist or palm', () => {
    const p = recordedPoint();
    expect(classifyGesture(p)).toBe('point');
    expect(isFistPose(p)).toBe(false);
    expect(isOpenPalmPose(p)).toBe(false);
  });

  it('a real-ish fist classifies as fist, not pinch or open-palm', () => {
    const p = recordedFist();
    expect(isFistPose(p)).toBe(true);
    expect(isOpenPalmPose(p)).toBe(false);
    expect(classifyGesture(p)).toBe('fist');
  });

  it('an open palm (all five fingers reaching) is open-palm, not a point or fist', () => {
    const p = recordedOpen();
    expect(isOpenPalmPose(p)).toBe(true);
    expect(isFistPose(p)).toBe(false);
    expect(classifyGesture(p)).toBe('open-palm');
  });

  it('two recorded pinches produce two-hand-zoom', () => {
    const a = recordedPinch(0);
    const b = recordedPinch(0.28);
    expect(classifyGesture(a)).toBe('pinch');
    expect(classifyGesture(b)).toBe('pinch');
    const rec = createGestureRecognizer();
    rec.update({ hands: [a, b], now: 0 });
    const spread = rec.update({
      hands: [a, recordedPinch(0.40)],
      now: 33,
    });
    expect(spread.gesture).toBe('two-hand-zoom');
    expect(spread.zoomDelta).toBeGreaterThan(0);
  });
});
