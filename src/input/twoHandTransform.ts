// Pure (DOM-free, MediaPipe-free) two-hand "touch-pinch" transform.
//
// Given the two pinch points where the gesture GRABBED (p0, q0) and where the
// fingers are NOW (p1, q1), this derives a similarity transform (uniform scale,
// translation, optional rotation) that keeps the world points that were under
// the fingers at grab time under the fingers now — i.e. an *anchored* pinch,
// exactly like dragging two fingers on a touch screen.
//
// Kept separate and DOM-free so it unit-tests with simulated pinch pairs. The
// camera / tile consumers apply the transform through camera.ts / editBoard.ts.
//
// Design notes (built for arthritis / low-effort use, see HAND_FEEL): rotation
// is OFF by default (a two-hand zoom on a board should never tilt it); a
// dead-zone/hysteresis latch means a resting tremor produces exactly no change;
// the cumulative scale is clamped; an EMA smooths the output; and if one hand
// briefly drops we KEEP THE LAST STABLE transform (never snap back) for a short
// grace window, then end the gesture still holding that transform.

export interface Vec { x: number; y: number }

/** A 2D similarity: maps X -> scale * Rot(rotation) * X + (tx, ty). */
export interface SimilarityTransform {
  scale: number;
  /** Radians. Always 0 when rotation is disabled. */
  rotation: number;
  tx: number;
  ty: number;
}

export const IDENTITY: SimilarityTransform = { scale: 1, rotation: 0, tx: 0, ty: 0 };

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance between two pinch points. */
export function span(a: Vec, b: Vec): number {
  return dist(a, b);
}

/** Midpoint of two pinch points. */
export function midpoint(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Apply a similarity transform to a point. */
export function applyTransform(t: SimilarityTransform, p: Vec): Vec {
  const c = Math.cos(t.rotation);
  const s = Math.sin(t.rotation);
  return {
    x: t.scale * (c * p.x - s * p.y) + t.tx,
    y: t.scale * (s * p.x + c * p.y) + t.ty,
  };
}

export interface SolveOptions {
  /** Enable rotation (default false — boards/tiles never tilt). */
  rotate?: boolean;
}

/**
 * Solve the similarity transform taking the grab-time pinch points (p0,q0) to
 * the current points (p1,q1).
 *
 * With rotation ON the transform maps p0->p1 and q0->q1 exactly. With rotation
 * OFF (the default) the scale is the span ratio and the translation pins the
 * MIDPOINT (mid0->mid1) — the least-squares anchor for a no-rotation pinch, so
 * the content under the centre of the two fingers stays put while you zoom.
 */
export function solveSimilarity(p0: Vec, q0: Vec, p1: Vec, q1: Vec, opts: SolveOptions = {}): SimilarityTransform {
  const d0 = { x: q0.x - p0.x, y: q0.y - p0.y };
  const len0 = Math.hypot(d0.x, d0.y);
  // Degenerate start (both pinches coincide): no reliable scale — stay identity
  // except follow the midpoint translation.
  if (len0 < 1e-9) {
    const m0 = midpoint(p0, q0);
    const m1 = midpoint(p1, q1);
    return { scale: 1, rotation: 0, tx: m1.x - m0.x, ty: m1.y - m0.y };
  }
  const d1 = { x: q1.x - p1.x, y: q1.y - p1.y };
  const len1 = Math.hypot(d1.x, d1.y);
  const scale = len1 / len0;

  if (opts.rotate) {
    const rotation = Math.atan2(d1.y, d1.x) - Math.atan2(d0.y, d0.x);
    // t = p1 - scale*Rot(rotation)*p0
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    const rx = scale * (c * p0.x - s * p0.y);
    const ry = scale * (s * p0.x + c * p0.y);
    return { scale, rotation, tx: p1.x - rx, ty: p1.y - ry };
  }

  const m0 = midpoint(p0, q0);
  const m1 = midpoint(p1, q1);
  return { scale, rotation: 0, tx: m1.x - scale * m0.x, ty: m1.y - scale * m0.y };
}

/**
 * Decompose the step between two cumulative transforms into an incremental
 * anchored zoom+pan, for renderers that only expose zoom-about-a-point and
 * pan-by-pixels (the CAD plan renderer) rather than an absolute camera. Given
 * the previous and current cumulative transforms and the grab midpoint, returns
 * the per-frame zoom `factor`, the `anchor` to zoom about, and the `pan` to
 * apply after — so the content under the fingers' previous midpoint lands under
 * their current midpoint (anchored tracking without a baseline reset).
 */
export function incrementalZoomPan(
  prev: SimilarityTransform,
  cur: SimilarityTransform,
  grabMid: Vec,
): { factor: number; anchor: Vec; pan: Vec } {
  const factor = prev.scale > 1e-9 ? cur.scale / prev.scale : 1;
  const anchor = applyTransform(prev, grabMid);
  const now = applyTransform(cur, grabMid);
  return { factor, anchor, pan: { x: now.x - anchor.x, y: now.y - anchor.y } };
}

// ---------------------------------------------------------------- controller

export interface TwoHandOptions extends SolveOptions {
  /** Min / max cumulative scale relative to the grab. */
  minScale?: number;
  maxScale?: number;
  /** Dead zone: until the fingers move the span past this fraction OR the
   *  midpoint past transDeadZone units, emit identity (a resting tremor does
   *  nothing). Once broken out the gesture tracks continuously (hysteresis). */
  scaleDeadZone?: number;
  transDeadZone?: number;
  /** EMA smoothing 0..1 toward the raw transform (0 = none, higher = smoother). */
  smoothing?: number;
  /** One hand may vanish for this long and the gesture stays live, holding the
   *  last stable transform. Past it the gesture ends (still holding it). */
  graceMs?: number;
}

const DEFAULTS = {
  rotate: false,
  minScale: 0.1,
  maxScale: 10,
  scaleDeadZone: 0.04,
  transDeadZone: 6,
  smoothing: 0.35,
  graceMs: 150,
};

export interface TwoHandFrame {
  /** Hand A pinch point this frame, or null/undefined if that hand is absent. */
  p?: Vec | null;
  /** Hand B pinch point this frame. */
  q?: Vec | null;
  now: number;
}

export interface TwoHandUpdate {
  active: boolean;
  /** Became active this frame. */
  started: boolean;
  /** Became inactive this frame. */
  ended: boolean;
  /** Cumulative transform from grab to now (smoothed, clamped, dead-zoned). */
  transform: SimilarityTransform;
}

export interface TwoHandGesture {
  update(frame: TwoHandFrame): TwoHandUpdate;
  reset(): void;
  readonly active: boolean;
}

function clampScale(t: SimilarityTransform, min: number, max: number, anchor: Vec): SimilarityTransform {
  if (t.scale >= min && t.scale <= max) return t;
  const clamped = Math.min(max, Math.max(min, t.scale));
  // Re-pin the anchor point so clamping scale doesn't shift it: keep
  // applyTransform(t, anchor) fixed while swapping the scale.
  const a = applyTransform(t, anchor);
  const c = Math.cos(t.rotation);
  const s = Math.sin(t.rotation);
  const rx = clamped * (c * anchor.x - s * anchor.y);
  const ry = clamped * (s * anchor.x + c * anchor.y);
  return { scale: clamped, rotation: t.rotation, tx: a.x - rx, ty: a.y - ry };
}

/**
 * Stateful two-hand gesture. Feed each frame's two pinch points (null when a
 * hand is missing); it tracks the grab origin, applies the dead-zone latch,
 * clamp, smoothing and grace, and returns the cumulative anchored transform.
 */
export function createTwoHandGesture(options: TwoHandOptions = {}): TwoHandGesture {
  const cfg = { ...DEFAULTS, ...options };

  let active = false;
  let p0: Vec | null = null;
  let q0: Vec | null = null;
  let brokeOut = false;
  let emitted: SimilarityTransform = { ...IDENTITY };
  let lastBothAt = -Infinity;

  function begin(p: Vec, q: Vec): void {
    active = true;
    p0 = { ...p };
    q0 = { ...q };
    brokeOut = false;
    emitted = { ...IDENTITY };
  }

  function end(): void {
    active = false;
    p0 = null;
    q0 = null;
    brokeOut = false;
  }

  function update(frame: TwoHandFrame): TwoHandUpdate {
    const { p, q, now } = frame;
    const bothPresent = !!p && !!q;

    if (!active) {
      if (bothPresent) {
        begin(p as Vec, q as Vec);
        lastBothAt = now;
        return { active: true, started: true, ended: false, transform: { ...emitted } };
      }
      return { active: false, started: false, ended: false, transform: { ...emitted } };
    }

    // Active, but a hand is (temporarily) gone.
    if (!bothPresent) {
      if (now - lastBothAt <= cfg.graceMs) {
        // Grace: keep the gesture live, hold the last stable transform.
        return { active: true, started: false, ended: false, transform: { ...emitted } };
      }
      end();
      return { active: false, started: false, ended: true, transform: { ...emitted } };
    }

    lastBothAt = now;
    const raw = solveSimilarity(p0 as Vec, q0 as Vec, p as Vec, q as Vec, { rotate: cfg.rotate });

    // Dead-zone latch: until the gesture first breaks past the span/translation
    // threshold, treat it as "held" (tremor never moves anything).
    if (!brokeOut) {
      const dSpan = Math.abs(raw.scale - 1);
      const m0 = midpoint(p0 as Vec, q0 as Vec);
      const m1 = midpoint(p as Vec, q as Vec);
      const dTrans = Math.hypot(m1.x - m0.x, m1.y - m0.y);
      if (dSpan < cfg.scaleDeadZone && dTrans < cfg.transDeadZone) {
        emitted = { ...IDENTITY };
        return { active: true, started: false, ended: false, transform: { ...emitted } };
      }
      brokeOut = true;
    }

    const anchor = midpoint(p0 as Vec, q0 as Vec);
    const clamped = clampScale(raw, cfg.minScale, cfg.maxScale, anchor);

    // EMA smoothing toward the clamped target.
    const a = cfg.smoothing <= 0 ? 1 : 1 - cfg.smoothing;
    emitted = {
      scale: emitted.scale + (clamped.scale - emitted.scale) * a,
      rotation: emitted.rotation + (clamped.rotation - emitted.rotation) * a,
      tx: emitted.tx + (clamped.tx - emitted.tx) * a,
      ty: emitted.ty + (clamped.ty - emitted.ty) * a,
    };
    return { active: true, started: false, ended: false, transform: { ...emitted } };
  }

  return {
    update,
    reset() { end(); emitted = { ...IDENTITY }; lastBothAt = -Infinity; },
    get active() { return active; },
  };
}
