// FIRST-RUN CALIBRATION (pure, DOM-free, camera-free).
//
// The setup wizard asks her to do three short things with the camera on:
//   1. "Reach": move her hand gently to the corners she can reach comfortably.
//   2. "Pinch": pinch a few times as firmly as is comfortable today.
//   3. "Hold still": hold a pointing hand still for ~2 s.
// From the landmark frames of those steps this module derives a Calibration:
// her comfortable reach box (so a small movement covers the whole screen), pinch
// thresholds that sit inside what her fingers can close, and a tremor number
// that sets smoothing and dwell. Only these numbers are kept, and only in this
// browser's localStorage; no frame or landmark ever leaves the device.

import { DEFAULT_PINCH_ON, DEFAULT_PINCH_OFF, INDEX_TIP, type Pt } from '../input/handLogic';
import { thresholdsFromMinOpen } from '../input/pinchBaseline';
import { pinchRatio, meanJerk } from '../input/handMetrics';

export interface ReachBox { x0: number; y0: number; x1: number; y1: number }

export interface Calibration {
  /** Comfortable reach in mirrored screen space (0..1). */
  reach: ReachBox;
  pinchOn: number;
  pinchOff: number;
  /** Mean jerk of a held index tip (screen fraction). Steady ≈ 0.002. */
  tremor: number;
  /** Pointer smoothing 0..1 derived from tremor. */
  smoothing: number;
  /** Dwell time for dwell-click, ms (longer when shakier). */
  dwellMs: number;
}

export const FULL_REACH: ReachBox = { x0: 0, y0: 0, x1: 1, y1: 1 };

export const DEFAULT_CALIBRATION: Calibration = {
  reach: { ...FULL_REACH },
  pinchOn: DEFAULT_PINCH_ON,
  pinchOff: DEFAULT_PINCH_OFF,
  tremor: 0,
  smoothing: 0.35,
  dwellMs: 700,
};

/** Smallest reach box we accept per axis — below this the remap would amplify
 *  tremor too much, so we pad around the centre. */
export const MIN_REACH_SPAN = 0.25;
/** Margin added around the measured reach so the edges are easy to hit. */
export const REACH_MARGIN = 0.03;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function padAxis(lo: number, hi: number): [number, number] {
  lo -= REACH_MARGIN;
  hi += REACH_MARGIN;
  if (hi - lo < MIN_REACH_SPAN) {
    const c = (lo + hi) / 2;
    lo = c - MIN_REACH_SPAN / 2;
    hi = c + MIN_REACH_SPAN / 2;
  }
  // Shift back inside 0..1 without shrinking.
  if (lo < 0) { hi -= lo; lo = 0; }
  if (hi > 1) { lo -= hi - 1; hi = 1; }
  return [clamp(lo, 0, 1), clamp(hi, 0, 1)];
}

/** Reach box from index-tip positions sampled during the "reach" step. Uses
 *  the 5th..95th percentile so one wild frame doesn't stretch it. */
export function reachFromPoints(points: readonly Pt[]): ReachBox {
  if (points.length < 5) return { ...FULL_REACH };
  const xs = points.map((p) => p.x).sort((a, b) => a - b);
  const ys = points.map((p) => p.y).sort((a, b) => a - b);
  const q = (arr: number[], f: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(f * (arr.length - 1))))];
  const [x0, x1] = padAxis(q(xs, 0.05), q(xs, 0.95));
  const [y0, y1] = padAxis(q(ys, 0.05), q(ys, 0.95));
  return { x0, y0, x1, y1 };
}

/** Map a raw mirrored hand point into 0..1 screen space through her reach box. */
export function remapToReach(p: Pt, reach: ReachBox): Pt {
  const w = reach.x1 - reach.x0 || 1;
  const h = reach.y1 - reach.y0 || 1;
  return { x: clamp((p.x - reach.x0) / w, 0, 1), y: clamp((p.y - reach.y0) / h, 0, 1) };
}

/** True when the box is (close to) the whole frame — no remap needed. */
export function isFullReach(r: ReachBox): boolean {
  return r.x0 <= 0.01 && r.y0 <= 0.01 && r.x1 >= 0.99 && r.y1 >= 0.99;
}

/**
 * Pinch thresholds from the pinch step. `ratios` are per-frame pinch ratios.
 * Her firmest comfortable close is the 10th percentile, her open hand the
 * 90th. enter = min + 0.35*(open-min) in the same units as the live trace.
 */
export function pinchFromRatios(ratios: readonly number[]): { pinchOn: number; pinchOff: number } {
  const finite = ratios.filter((r) => Number.isFinite(r)).sort((a, b) => a - b);
  if (finite.length < 10) return { pinchOn: DEFAULT_PINCH_ON, pinchOff: DEFAULT_PINCH_OFF };
  const closed = finite[Math.floor(finite.length * 0.1)];
  const open = finite[Math.floor(finite.length * 0.9)];
  if (open - closed < 0.12) return { pinchOn: DEFAULT_PINCH_ON, pinchOff: DEFAULT_PINCH_OFF };
  return thresholdsFromMinOpen(closed, open);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Smoothing + dwell from the hold-still tremor. */
export function tremorSettings(tremor: number): { smoothing: number; dwellMs: number } {
  const t = clamp((tremor - 0.002) / (0.014 - 0.002), 0, 1);
  return { smoothing: round3(0.2 + t * 0.5), dwellMs: Math.round(600 + t * 500) };
}

export interface CalibrationSamples {
  reach: readonly (readonly Pt[])[];
  pinch: readonly (readonly Pt[])[];
  still: readonly (readonly Pt[])[];
}

/** Build a Calibration from the three steps' hand frames (21 points each). */
export function computeCalibration(s: CalibrationSamples): Calibration {
  const reach = reachFromPoints(s.reach.filter((p) => p.length > INDEX_TIP).map((p) => p[INDEX_TIP]));
  const { pinchOn, pinchOff } = pinchFromRatios(s.pinch.map((p) => pinchRatio(p)));
  const tremor = Math.round(meanJerk(s.still.filter((p) => p.length > INDEX_TIP).map((p) => p[INDEX_TIP])) * 1e5) / 1e5;
  return { reach, pinchOn, pinchOff, tremor, ...tremorSettings(tremor) };
}

/** Validate untrusted stored JSON back into a Calibration (or null). */
export function coerceCalibration(raw: unknown): Calibration | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : null);
  const reach = r.reach as Record<string, unknown> | undefined;
  const x0 = num(reach?.x0, 0, 1), y0 = num(reach?.y0, 0, 1), x1 = num(reach?.x1, 0, 1), y1 = num(reach?.y1, 0, 1);
  // Live tight band is 0.045 / 0.07; still accept older looser calibrations.
  const pinchOn = num(r.pinchOn, 0.02, 0.8), pinchOff = num(r.pinchOff, 0.03, 0.9);
  const tremor = num(r.tremor, 0, 1), smoothing = num(r.smoothing, 0, 0.95), dwellMs = num(r.dwellMs, 300, 2500);
  if ([x0, y0, x1, y1, pinchOn, pinchOff, tremor, smoothing, dwellMs].some((v) => v === null)) return null;
  if (x1! - x0! < MIN_REACH_SPAN - 1e-6 || y1! - y0! < MIN_REACH_SPAN - 1e-6) return null;
  if (pinchOff! <= pinchOn!) return null;
  return { reach: { x0: x0!, y0: y0!, x1: x1!, y1: y1! }, pinchOn: pinchOn!, pinchOff: pinchOff!, tremor: tremor!, smoothing: smoothing!, dwellMs: dwellMs! };
}
