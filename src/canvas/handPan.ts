// One-hand pinch-drag pan for the empty canvas (A1-012). A pinch that stays
// still keeps firing the existing 'keep' (the caller suppresses keep only once
// `panning` is true); a pinch that travels past a drag threshold instead pans
// the camera, and a tremor dead-zone stops sub-threshold jitter from drifting
// the view. Pure: screen points in, screen deltas out, no DOM.
import type { Pt } from '../input/gestures';

export interface HandPan {
  /**
   * Feed the current pinch SCREEN point while a single hand pinches over
   * pannable empty canvas; feed `null` when a pan can't apply (pinch lifted,
   * over a control, two-hand gesture, edit mode). Returns the screen delta to
   * `panBy` this frame, or null while the gesture is still under threshold.
   */
  update(point: Pt | null): { dx: number; dy: number } | null;
  /** True once this pinch crossed the drag threshold — the caller reads it to
   *  suppress the 'keep' a still pinch would otherwise fire. */
  readonly panning: boolean;
  reset(): void;
}

export function createHandPan(opts: { thresholdPx?: number; deadZonePx?: number } = {}): HandPan {
  const threshold = opts.thresholdPx ?? 14;
  const deadZone = opts.deadZonePx ?? 2.5;
  let start: Pt | null = null; // where this pinch first landed
  let last: Pt | null = null; // last point we measured a frame delta from
  let panning = false;

  function reset(): void {
    start = null;
    last = null;
    panning = false;
  }

  return {
    update(point) {
      if (!point) { reset(); return null; }
      if (!start) { start = { ...point }; last = { ...point }; panning = false; return null; }
      if (!panning) {
        if (Math.hypot(point.x - start.x, point.y - start.y) < threshold) { last = { ...point }; return null; }
        panning = true; // threshold crossed this frame — fall through to pan it
      }
      // Panning: report the per-frame delta, with a tremor dead-zone that holds
      // the anchor so jitter neither moves the view nor accumulates drift.
      const dx = point.x - last!.x;
      const dy = point.y - last!.y;
      if (Math.hypot(dx, dy) < deadZone) return { dx: 0, dy: 0 };
      last = { ...point };
      return { dx, dy };
    },
    get panning() { return panning; },
    reset,
  };
}
