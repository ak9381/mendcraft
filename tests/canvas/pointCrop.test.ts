import { describe, expect, it } from 'vitest';
import {
  base64ByteLength,
  createSteadyHold,
  cropAlongRay,
  cropAroundPoint,
  fitWithin,
  isIndexExtended,
  phoneCropFraction,
  pointerInCrop,
  POINT_CROP_FRACTION,
  rayOutOfFrame,
} from '../../src/canvas/pointCrop';
import { classifyGesture, isFistPose } from '../../src/input/gestures';

/** 21 MediaPipe landmarks, all at `rest`, with index MCP (5) and tip (8) set. */
function hand(mcp: { x: number; y: number }, tip: { x: number; y: number }, rest = { x: 0.5, y: 0.7 }) {
  const lm = Array.from({ length: 21 }, () => ({ ...rest }));
  lm[5] = { ...mcp };
  lm[8] = { ...tip };
  return lm;
}

const W = 640, H = 480;
const SIDE = Math.round(POINT_CROP_FRACTION * W); // 243 on a 640×480 frame

describe('cropAlongRay', () => {
  it('puts a square crop just ahead of the fingertip, along MCP → tip', () => {
    const r = cropAlongRay(hand({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }), W, H);
    expect(r.w).toBe(SIDE);
    expect(r.h).toBe(SIDE);
    // Pointing right: the crop starts at the fingertip and extends to the right.
    expect(r.x).toBeCloseTo(0.6 * W, -1);
    expect(r.y + r.h / 2).toBeCloseTo(0.5 * H, -1);
  });

  it('points up when the finger points up', () => {
    const r = cropAlongRay(hand({ x: 0.5, y: 0.8 }, { x: 0.5, y: 0.7 }), W, H);
    expect(r.y + r.h).toBeCloseTo(0.7 * H, -1);
    expect(r.x + r.w / 2).toBeCloseTo(0.5 * W, -1);
  });

  it('un-mirrors selfie landmarks: the same pose crops on the other side', () => {
    const raw = cropAlongRay(hand({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }), W, H);
    const mirrored = cropAlongRay(hand({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }), W, H, { mirrored: true });
    // Mirrored tip is at x = 0.4, pointing left: the crop ends at the fingertip.
    expect(mirrored.x + mirrored.w).toBeCloseTo(0.4 * W, -1);
    expect(mirrored.x).toBeLessThan(raw.x);
  });

  it('clamps the crop inside the frame', () => {
    const r = cropAlongRay(hand({ x: 0.85, y: 0.1 }, { x: 0.98, y: 0.02 }), W, H);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(W);
    expect(r.y + r.h).toBeLessThanOrEqual(H);
    expect(r.x).toBe(W - SIDE);
    expect(r.y).toBe(0);
  });

  it('never makes the square bigger than the frame', () => {
    const r = cropAlongRay(hand({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }), 1000, 200);
    expect(r.w).toBe(200);
    expect(r.h).toBe(200);
  });

  it('no hand (or a broken one) → the full frame', () => {
    expect(cropAlongRay(null, W, H)).toEqual({ x: 0, y: 0, w: W, h: H });
    expect(cropAlongRay(undefined, W, H)).toEqual({ x: 0, y: 0, w: W, h: H });
    expect(cropAlongRay([{ x: 0.1, y: 0.1 }], W, H)).toEqual({ x: 0, y: 0, w: W, h: H });
    const nan = hand({ x: 0.5, y: 0.5 }, { x: Number.NaN, y: 0.5 });
    expect(cropAlongRay(nan, W, H)).toEqual({ x: 0, y: 0, w: W, h: H });
  });

  it('a fingertip on its knuckle (no direction) centres the crop on the tip', () => {
    const r = cropAlongRay(hand({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }), W, H);
    expect(r.x + r.w / 2).toBeCloseTo(0.5 * W, -1);
    expect(r.y + r.h / 2).toBeCloseTo(0.5 * H, -1);
  });
});

describe('cropAroundPoint (mouse click, hands off)', () => {
  it('centres a square on the point, clamped', () => {
    const r = cropAroundPoint({ x: 0.5, y: 0.5 }, W, H);
    expect(r.w).toBe(SIDE);
    expect(r.x + r.w / 2).toBeCloseTo(320, -1);
    const edge = cropAroundPoint({ x: 0, y: 1 }, W, H);
    expect(edge.x).toBe(0);
    expect(edge.y + edge.h).toBe(H);
  });
  it('no point → full frame', () => {
    expect(cropAroundPoint(null, W, H)).toEqual({ x: 0, y: 0, w: W, h: H });
  });
});

describe('pointerInCrop', () => {
  it('maps a frame point into 0–1 crop coordinates, clamped', () => {
    expect(pointerInCrop({ x: 0.5, y: 0.5 }, { x: 0, y: 0, w: W, h: H }, W, H)).toEqual({ x: 0.5, y: 0.5 });
    const p = pointerInCrop({ x: 0.5, y: 0.5 }, { x: 320, y: 240, w: 100, h: 100 }, W, H);
    expect(p).toEqual({ x: 0, y: 0 });
  });
});

describe('fitWithin', () => {
  it('downscales to ≤ 512 px on the long side, never up', () => {
    expect(fitWithin(1280, 720)).toEqual({ w: 512, h: 288 });
    expect(fitWithin(300, 200)).toEqual({ w: 300, h: 200 });
    expect(fitWithin(600, 900, 512)).toEqual({ w: 341, h: 512 });
  });
});

describe('base64ByteLength', () => {
  it('counts the decoded bytes, not the base64 characters', () => {
    expect(base64ByteLength('aGVsbG8=')).toBe(5);
    expect(base64ByteLength('aGVsbG8h')).toBe(6);
    expect(base64ByteLength('aGk=')).toBe(2);
    expect(base64ByteLength('')).toBe(0);
  });
});

/** A pointing hand (index out, the rest curled), camera space. */
function pointingHand(): { x: number; y: number }[] {
  const cx = 0.5, cy = 0.45;
  const lm = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  lm[0] = { x: cx, y: cy + 0.42 };
  lm[9] = { x: cx, y: cy + 0.22 };
  lm[5] = { x: cx, y: cy + 0.22 };
  lm[8] = { x: cx, y: cy };
  lm[6] = { x: cx, y: cy + 0.12 };
  lm[7] = { x: cx, y: cy + 0.06 };
  const palmY = cy + 0.26;
  lm[10] = { x: cx + 0.05, y: palmY + 0.04 }; lm[11] = { x: cx + 0.05, y: palmY + 0.02 }; lm[12] = { x: cx + 0.05, y: palmY };
  lm[13] = { x: cx + 0.08, y: cy + 0.22 }; lm[14] = { x: cx + 0.08, y: palmY + 0.04 }; lm[15] = { x: cx + 0.08, y: palmY + 0.02 }; lm[16] = { x: cx + 0.08, y: palmY };
  lm[17] = { x: cx + 0.12, y: cy + 0.22 }; lm[18] = { x: cx + 0.12, y: palmY + 0.04 }; lm[19] = { x: cx + 0.12, y: palmY + 0.02 }; lm[20] = { x: cx + 0.12, y: palmY };
  lm[1] = { x: cx - 0.16, y: cy + 0.18 }; lm[2] = { x: cx - 0.16, y: cy + 0.12 }; lm[3] = { x: cx - 0.16, y: cy + 0.06 };
  lm[4] = { x: cx - 0.16, y: cy };
  return lm;
}

describe('isIndexExtended (a hold only counts while pointing)', () => {
  it('a point is extended — and the hand pointer never reads it as a fist', () => {
    const p = pointingHand();
    expect(isIndexExtended(p)).toBe(true);
    expect(classifyGesture(p)).toBe('point');
    expect(isFistPose(p)).toBe(false);
  });
  it('an index curled back toward the palm is not', () => {
    const p = pointingHand();
    p[8] = { x: 0.5, y: 0.45 + 0.20 }; // tip folded below the PIP, near the palm
    expect(isIndexExtended(p)).toBe(false);
    expect(isIndexExtended(null)).toBe(false);
  });
});

describe('createSteadyHold', () => {
  it('fires once after the palm holds still ≥ 600 ms', () => {
    const s = createSteadyHold();
    expect(s.update({ x: 0.5, y: 0.5 }, 0)).toBe(false);
    expect(s.update({ x: 0.505, y: 0.5 }, 300)).toBe(false);
    expect(s.update({ x: 0.5, y: 0.502 }, 599)).toBe(false);
    expect(s.update({ x: 0.5, y: 0.5 }, 600)).toBe(true);
    expect(s.update({ x: 0.5, y: 0.5 }, 700)).toBe(false);
  });
  it('a move resets the clock; losing the hand resets it too', () => {
    const s = createSteadyHold({ holdMs: 600 });
    s.update({ x: 0.5, y: 0.5 }, 0);
    expect(s.update({ x: 0.7, y: 0.5 }, 500)).toBe(false);
    expect(s.update({ x: 0.7, y: 0.5 }, 1000)).toBe(false);
    expect(s.update(null, 1050)).toBe(false);
    expect(s.update({ x: 0.7, y: 0.5 }, 1100)).toBe(false);
    expect(s.update({ x: 0.7, y: 0.5 }, 1700)).toBe(true);
  });
});

describe('iPhone pointing crop (lamp beside the face, 0.5–1 m from the phone)', () => {
  it('is ~42 % of the frame width, 45 % when the 5→8 ray is short', () => {
    const long = hand({ x: 0.4, y: 0.6 }, { x: 0.5, y: 0.5 });
    const short = hand({ x: 0.4, y: 0.6 }, { x: 0.41, y: 0.6 });
    const rLong = cropAlongRay(long, W, H, { fraction: phoneCropFraction(long, W, H) });
    const rShort = cropAlongRay(short, W, H, { fraction: phoneCropFraction(short, W, H) });
    expect(rLong.w).toBe(Math.round(0.42 * W));
    expect(rShort.w).toBe(Math.round(0.45 * W));
    // Portrait (480×640): still a share of the WIDTH.
    const rPortrait = cropAlongRay(long, 480, 640, { fraction: phoneCropFraction(long, 480, 640) });
    expect(rPortrait.w).toBe(Math.round(0.42 * 480));
  });

  it('a lamp ~35 cm beside the face at 0.75 m (≈ a third of the frame) is inside the crop', () => {
    // Face centred at x 0.5; she points with her hand below-left of the lamp
    // which sits at x≈0.83, y≈0.35 (camera space).
    const lm = hand({ x: 0.62, y: 0.55 }, { x: 0.68, y: 0.48 });
    const r = cropAlongRay(lm, W, H, { fraction: phoneCropFraction(lm, W, H) });
    const lamp = { x: 0.83 * W, y: 0.35 * H };
    expect(lamp.x).toBeGreaterThanOrEqual(r.x);
    expect(lamp.x).toBeLessThanOrEqual(r.x + r.w);
    expect(lamp.y).toBeGreaterThanOrEqual(r.y);
    expect(lamp.y).toBeLessThanOrEqual(r.y + r.h);
  });

  it('rayOutOfFrame: pointing off the edge is out; a device at the edge is still in', () => {
    expect(rayOutOfFrame(hand({ x: 0.85, y: 0.5 }, { x: 0.97, y: 0.5 }), W, H)).toBe(true);
    expect(rayOutOfFrame(hand({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }), W, H)).toBe(false);
    expect(rayOutOfFrame(hand({ x: 0.7, y: 0.5 }, { x: 0.75, y: 0.5 }), W, H)).toBe(false);
    expect(rayOutOfFrame(null, W, H)).toBe(true);
  });
});
