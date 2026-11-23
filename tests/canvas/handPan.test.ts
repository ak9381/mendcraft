import { describe, it, expect } from 'vitest';
import { createHandPan } from '../../src/canvas/handPan';

describe('handPan — one-hand pinch-drag pan on empty canvas (A1-012)', () => {
  it('a still pinch never pans (stays below the drag threshold → keep survives)', () => {
    const pan = createHandPan({ thresholdPx: 14 });
    expect(pan.update({ x: 100, y: 100 })).toBeNull(); // first frame: anchor
    // tiny tremor, well under the 14px threshold
    expect(pan.update({ x: 101, y: 99 })).toBeNull();
    expect(pan.update({ x: 100, y: 101 })).toBeNull();
    expect(pan.panning).toBe(false);
  });

  it('a drag past the threshold starts panning and returns the frame delta', () => {
    const pan = createHandPan({ thresholdPx: 14, deadZonePx: 2 });
    pan.update({ x: 100, y: 100 });
    expect(pan.update({ x: 110, y: 100 })).toBeNull(); // 10px: under threshold
    expect(pan.panning).toBe(false);
    const d = pan.update({ x: 120, y: 100 }); // crossed 14px
    expect(pan.panning).toBe(true);
    // once engaged, it reports the delta from the previous reported point
    expect(d).not.toBeNull();
    expect(d!.dx).toBeCloseTo(10, 5);
    expect(d!.dy).toBeCloseTo(0, 5);
  });

  it('tremor dead-zone: sub-threshold per-frame jitter while panning yields no delta and does not drift', () => {
    const pan = createHandPan({ thresholdPx: 10, deadZonePx: 3 });
    pan.update({ x: 0, y: 0 });
    pan.update({ x: 12, y: 0 }); // engage pan
    expect(pan.panning).toBe(true);
    // 1px jitter < 3px dead-zone → ignored, anchor unchanged
    expect(pan.update({ x: 13, y: 0 })).toEqual({ dx: 0, dy: 0 });
    // a real move is still measured from the un-drifted anchor (12), so +5
    expect(pan.update({ x: 17, y: 0 })!.dx).toBeCloseTo(5, 5);
  });

  it('releasing the pinch (null) resets panning so the next pinch starts fresh', () => {
    const pan = createHandPan({ thresholdPx: 10 });
    pan.update({ x: 0, y: 0 });
    pan.update({ x: 20, y: 0 });
    expect(pan.panning).toBe(true);
    pan.update(null);
    expect(pan.panning).toBe(false);
    // new pinch at a far point must not jump — it re-anchors
    expect(pan.update({ x: 500, y: 500 })).toBeNull();
    expect(pan.panning).toBe(false);
  });
});
