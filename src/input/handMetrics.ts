// HAND-ADAPTIVE INPUT METRICS (pure, DOM-free, camera-free).
//
// From the hand landmarks that MediaPipe already produces on-device, derive a
// handful of NUMBERS that describe how this person pinches: how hard they have
// to squeeze (effort), how shaky they are (tremor), how long a pinch takes, and
// whether they are tiring over the session (fatigue). Only numbers ever leave
// this module — never a frame of video, never a landmark dump. These numbers
// feed the on-device profile picker (input/handProfile + ai/hybrid.adaptHandProfile).
//
// This file is deliberately split from hands.ts/presence.ts so the maths is unit
// tested without a webcam. The sampler is fed one frame at a time (the operator's
// primary hand) and answers snapshot() with the aggregate metrics.

import {
  THUMB_TIP, INDEX_TIP, WRIST, MIDDLE_MCP, DEFAULT_PINCH_ON, DEFAULT_PINCH_OFF, type Pt,
} from './handLogic';

/** The numbers the profile picker sees. All unitless or ms; no coordinates. */
export interface HandMetrics {
  /** 0..1 strain to register a pinch: 1 = fingers barely close, 0 = snaps shut. */
  pinchEffort: number;
  /** Mean jerk (2nd difference) of the index tip in screen fraction; shakiness. */
  tremor: number;
  /** Mean time from fingers starting to close to the pinch registering, ms. */
  pinchMs: number;
  /** 0..1 session trend: pinches getting slower / harder over time. */
  fatigue: number;
  /** Completed pinches sampled (confidence in the numbers above). */
  pinches: number;
  /** Frames fed so far. */
  frames: number;
  /** Wall-clock span of the session so far, ms. */
  sessionMs: number;
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const mean = (xs: readonly number[]): number =>
  xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : 0;

/**
 * Thumb-tip ↔ index-tip gap normalised by hand size (wrist ↔ middle-finger MCP),
 * the exact ratio handLogic uses to decide a pinch — recomputed here so metrics
 * never depend on the live processor's private state. Scale-invariant: the same
 * for a hand near or far from the camera.
 */
export function pinchRatio(points: readonly Pt[]): number {
  if (points.length <= MIDDLE_MCP) return Infinity;
  const handSize = dist(points[WRIST], points[MIDDLE_MCP]) || 1;
  return dist(points[THUMB_TIP], points[INDEX_TIP]) / handSize;
}

/**
 * Effort to complete a pinch, 0..1. A decisive pinch closes well past the
 * on-threshold (minRatio → 0, effort → 0); a strained one that barely crosses
 * sits near the threshold (effort → 1). effort = minRatio / pinchOn, clamped.
 */
export function pinchEffort(minRatio: number, pinchOn: number): number {
  if (!(pinchOn > 0)) return 0;
  return clamp01(minRatio / pinchOn);
}

/**
 * Mean magnitude of the 2nd difference (jerk) of a position series — a
 * high-frequency shake measure that ignores smooth, intentional motion (a steady
 * drag has near-zero 2nd difference). Needs ≥3 points, else 0.
 */
export function meanJerk(positions: readonly Pt[]): number {
  if (positions.length < 3) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 2; i < positions.length; i++) {
    const a = positions[i - 2], b = positions[i - 1], c = positions[i];
    sum += Math.hypot(c.x - 2 * b.x + a.x, c.y - 2 * b.y + a.y);
    count++;
  }
  return count ? sum / count : 0;
}

/**
 * Session-trend 0..1: how much a per-pinch series (durations or efforts) rose
 * from the first third to the last third, as a clamped fraction of the early
 * baseline. Needs ≥4 samples (else 0 — too little to call fatigue).
 */
export function fatigueTrend(series: readonly number[]): number {
  if (series.length < 4) return 0;
  const k = Math.max(1, Math.floor(series.length / 3));
  const early = mean(series.slice(0, k));
  const late = mean(series.slice(series.length - k));
  if (early <= 0) return late > 0 ? 1 : 0;
  return clamp01((late - early) / early);
}

/** One sampled frame: the operator hand's 21 points plus a ms timestamp. */
export interface MetricsFrame {
  t: number;
  points: readonly Pt[];
}

export interface HandMetricsSamplerOptions {
  pinchOn?: number;
  pinchOff?: number;
  /** Cap on the index-tip ring used for the running tremor estimate. */
  maxTremorSamples?: number;
  /** Completed pinches needed before the numbers are worth adapting on. */
  minPinches?: number;
}

export interface HandMetricsSampler {
  push(frame: MetricsFrame): void;
  snapshot(): HandMetrics;
  /** Enough signal (pinches + span) to pick a profile? */
  ready(): boolean;
  reset(): void;
}

interface PinchRecord { ms: number; effort: number }

/**
 * Stateful accumulator. Feed it the operator's primary hand each frame; it
 * tracks pinch attempts (approach → complete → release) to time each pinch and
 * find its deepest squeeze, and keeps a running tremor estimate from the index
 * tip. Pure: no DOM, no camera, no network — just arithmetic over landmarks.
 */
export function createHandMetricsSampler(opts: HandMetricsSamplerOptions = {}): HandMetricsSampler {
  const pinchOn = opts.pinchOn ?? DEFAULT_PINCH_ON;
  const pinchOff = opts.pinchOff ?? DEFAULT_PINCH_OFF;
  const maxTremor = opts.maxTremorSamples ?? 240;
  const minPinches = opts.minPinches ?? 5;

  let firstT: number | null = null;
  let lastT = 0;
  let frames = 0;

  // Running tremor: mean jerk over a sliding window of index-tip positions.
  const tip: Pt[] = [];
  let jerkSum = 0;
  let jerkCount = 0;

  const records: PinchRecord[] = [];

  // Pinch attempt state machine.
  let inAttempt = false;
  let approachT = 0;
  let completeT: number | null = null;
  let minRatio = Infinity;

  function push(frame: MetricsFrame): void {
    const { points, t } = frame;
    if (points.length <= MIDDLE_MCP) return;
    if (firstT === null) firstT = t;
    lastT = t;
    frames++;

    // Tremor from the index tip (the pointer the user actually aims).
    tip.push(points[INDEX_TIP]);
    if (tip.length >= 3) {
      const n = tip.length;
      const a = tip[n - 3], b = tip[n - 2], c = tip[n - 1];
      jerkSum += Math.hypot(c.x - 2 * b.x + a.x, c.y - 2 * b.y + a.y);
      jerkCount++;
    }
    if (tip.length > maxTremor) tip.shift();

    const ratio = pinchRatio(points);
    if (!inAttempt) {
      if (ratio < pinchOff) {
        inAttempt = true;
        approachT = t;
        completeT = null;
        minRatio = ratio;
      }
      return;
    }
    // In an attempt: track the deepest squeeze and the first time it registers.
    minRatio = Math.min(minRatio, ratio);
    if (completeT === null && ratio < pinchOn) completeT = t;
    if (ratio > pinchOff) {
      // Fingers opened again: a completed attempt becomes one pinch record
      // (timed from approach to first completion, effort from the deepest squeeze).
      if (completeT !== null) {
        records.push({ ms: Math.max(0, completeT - approachT), effort: pinchEffort(minRatio, pinchOn) });
      }
      inAttempt = false;
      completeT = null;
      minRatio = Infinity;
    }
  }

  function snapshot(): HandMetrics {
    return {
      pinchEffort: mean(records.map((r) => r.effort)),
      tremor: jerkCount ? jerkSum / jerkCount : 0,
      pinchMs: mean(records.map((r) => r.ms)),
      // Fatigue rises if pinches get slower OR harder across the session.
      fatigue: Math.max(
        fatigueTrend(records.map((r) => r.ms)),
        fatigueTrend(records.map((r) => r.effort)),
      ),
      pinches: records.length,
      frames,
      sessionMs: firstT === null ? 0 : Math.max(0, lastT - firstT),
    };
  }

  function ready(): boolean {
    return records.length >= minPinches;
  }

  function reset(): void {
    firstT = null;
    lastT = 0;
    frames = 0;
    tip.length = 0;
    jerkSum = 0;
    jerkCount = 0;
    records.length = 0;
    inAttempt = false;
    completeT = null;
    minRatio = Infinity;
  }

  return { push, snapshot, ready, reset };
}
