// Pinch thresholds in the SAME units as the live gesture trace's
// `pinchDistance`: thumb–index tip gap divided by wrist→middle-MCP hand size.
//
// A real MediaPipe pinch on Akash's Chrome (ed616aa, 240 frames) never went
// below 0.18 (p1=0.18, p5=0.20, p50=0.50, max=1.26). The earlier 0.045/0.07
// band was the right formula but the wrong scale for a live hand, so pinch
// could not fire. Defaults sit just above that measured close (0.24 / 0.33).
// A rolling per-hand min/open baseline then refines:
//   enter = min + 0.35 * (open - min), clamped.

import { DEFAULT_PINCH_ON, DEFAULT_PINCH_OFF } from './handLogic';

export const PINCH_ON_MIN = 0.16;
export const PINCH_ON_MAX = 0.40;
export const PINCH_OFF_SPAN = 0.06;
export const PINCH_OFF_MAX = 0.55;
/** enter = min + this * (open - min). */
export const PINCH_ENTER_BLEND = 0.35;
/** exit sits further toward open than enter. */
export const PINCH_EXIT_BLEND = 0.55;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function thresholdsFromMinOpen(min: number, open: number): { pinchOn: number; pinchOff: number } {
  const span = Math.max(0, open - min);
  const on = clamp(min + PINCH_ENTER_BLEND * span, PINCH_ON_MIN, PINCH_ON_MAX);
  const off = clamp(Math.max(on + PINCH_OFF_SPAN, min + PINCH_EXIT_BLEND * span), on + PINCH_OFF_SPAN, PINCH_OFF_MAX);
  return { pinchOn: round3(on), pinchOff: round3(off) };
}

function percentile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i]!;
}

export interface PinchBaseline {
  push(ratio: number, t: number): { pinchOn: number; pinchOff: number; ready: boolean; min?: number; open?: number };
  snapshot(): { pinchOn: number; pinchOff: number; ready: boolean };
  reset(): void;
}

/** Rolling per-hand min/open baseline over a few seconds of ratios. */
export function createPinchBaseline(opts?: {
  windowMs?: number;
  minSpan?: number;
  minFrames?: number;
}): PinchBaseline {
  const windowMs = opts?.windowMs ?? 4000;
  const minSpan = opts?.minSpan ?? 0.15;
  const minFrames = opts?.minFrames ?? 45;
  const samples: { t: number; r: number }[] = [];
  let pinchOn = DEFAULT_PINCH_ON;
  let pinchOff = DEFAULT_PINCH_OFF;
  let ready = false;

  return {
    push(ratio, t) {
      if (!Number.isFinite(ratio)) return { pinchOn, pinchOff, ready };
      samples.push({ t, r: ratio });
      while (samples.length && t - samples[0]!.t > windowMs) samples.shift();
      if (samples.length < minFrames) return { pinchOn, pinchOff, ready };
      const rs = samples.map((s) => s.r).sort((a, b) => a - b);
      const min = percentile(rs, 0.05);
      const open = percentile(rs, 0.90);
      if (open - min < minSpan) return { pinchOn, pinchOff, ready, min, open };
      const next = thresholdsFromMinOpen(min, open);
      pinchOn = next.pinchOn;
      pinchOff = next.pinchOff;
      ready = true;
      return { pinchOn, pinchOff, ready, min, open };
    },
    snapshot: () => ({ pinchOn, pinchOff, ready }),
    reset() {
      samples.length = 0;
      pinchOn = DEFAULT_PINCH_ON;
      pinchOff = DEFAULT_PINCH_OFF;
      ready = false;
    },
  };
}

/** 3-second “pinch twice” capture used by first-run setup and Tools. */
export const PINCH_TWICE_MS = 3000;
/** Ratio below which a calibration sample counts as a close. Looser than the
 *  live enter threshold so a first close is counted before thresholds exist. */
export const PINCH_TWICE_CLOSE = 0.40;
export const PINCH_TWICE_OPEN = 0.50;

export interface PinchTwiceSession {
  start(now: number): void;
  push(ratio: number, now: number): { elapsed: number; count: number; done: boolean; ready: boolean };
  result(): { pinchOn: number; pinchOff: number };
  get ratios(): number[];
  get count(): number;
  active(): boolean;
  reset(): void;
}

export function createPinchTwiceSession(): PinchTwiceSession {
  let startAt = 0;
  let running = false;
  let ratios: number[] = [];
  let count = 0;
  let closed = false;

  return {
    start(now) {
      startAt = now;
      running = true;
      ratios = [];
      count = 0;
      closed = false;
    },
    push(ratio, now) {
      if (!running) { running = true; startAt = now; }
      if (Number.isFinite(ratio)) ratios.push(ratio);
      const isClosed = ratio < PINCH_TWICE_CLOSE;
      if (isClosed && !closed) count++;
      if (isClosed) closed = true;
      else if (ratio > PINCH_TWICE_OPEN) closed = false;
      const elapsed = now - startAt;
      const done = (count >= 2 && !isClosed) || elapsed >= PINCH_TWICE_MS;
      return { elapsed, count, done, ready: done && ratios.length >= 8 };
    },
    result() {
      const finite = ratios.filter((r) => Number.isFinite(r)).sort((a, b) => a - b);
      if (finite.length < 8) return { pinchOn: DEFAULT_PINCH_ON, pinchOff: DEFAULT_PINCH_OFF };
      const closed = finite[Math.floor(finite.length * 0.1)]!;
      const open = finite[Math.floor(finite.length * 0.9)]!;
      if (open - closed < 0.12) return { pinchOn: DEFAULT_PINCH_ON, pinchOff: DEFAULT_PINCH_OFF };
      return thresholdsFromMinOpen(closed, open);
    },
    get ratios() { return ratios; },
    get count() { return count; },
    active: () => running,
    reset() { running = false; startAt = 0; ratios = []; count = 0; closed = false; },
  };
}
