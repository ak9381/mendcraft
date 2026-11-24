import { describe, expect, it } from 'vitest';
import {
  base64ByteLength,
  createSteadyHold,
  cropAlongRay,
  cropAroundPoint,
  fitWithin,
  pointerInCrop,
  POINT_CROP_FRACTION,
} from '../../src/canvas/pointCrop';

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
