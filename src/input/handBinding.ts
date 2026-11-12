// Pure (MediaPipe-free, DOM-free) binding of detected hands to the registered
// operator's face: a hand counts only if its wrist sits within a body-scale
// radius below/beside the face box, on a handedness-plausible side, with
// temporal continuity preferred. At most two hands are accepted. Tested in
// isolation so the gates are verifiable without a camera.

import type { Pt } from './handLogic';
import type { FaceBox } from './faceLogic';

export interface HandCandidate {
  /** Original index into the landmarker output (what we feed back downstream). */
  index: number;
  /** Wrist landmark in raw image coords (0..1), same space as face boxes. */
  wrist: Pt;
  /** MediaPipe handedness label, "Left" | "Right" (optional). */
  label?: string;
}

export interface BindOptions {
  /** Body reach radius = max(boxW, boxH) * radiusScale. */
  radiusScale?: number;
  /** Reject wrists more than aboveAllowance*boxH above the face top. */
  aboveAllowance?: number;
  /** Side check tolerance, in boxW; a wrist within this of centre is never rejected for side. */
  sideMargin?: number;
  /** Max accepted hands fed downstream. */
  maxHands?: number;
  /** A candidate within this distance (image fraction) of a previously accepted wrist gets a continuity bonus. */
  continuityRadius?: number;
  /** Score reduction applied to continuous hands when ranking. */
  continuityBonus?: number;
  /**
   * Coordinate convention for the handedness side check. MediaPipe labels
   * handedness as if the image were mirrored (selfie). With raw (unmirrored)
   * coords (default) a "Right" hand appears on image-left; set mirrored=true if
   * you pass already-mirrored coords.
   */
  mirrored?: boolean;
}

export interface BindDecision {
  ok: boolean;
  reason?: 'far' | 'above' | 'side';
  /** Distance from face centre (for ranking). */
  dist: number;
}

const DEFAULTS = {
  radiusScale: 4,
  aboveAllowance: 1.2,
  sideMargin: 1.5,
  maxHands: 2,
  continuityRadius: 0.12,
  continuityBonus: 0.25,
  mirrored: false,
};

/** Expected horizontal sign (+1 right of centre, -1 left) for a handedness label. */
function expectedSign(label: string | undefined, mirrored: boolean): number {
  if (label !== 'Left' && label !== 'Right') return 0;
  // Raw coords: person's "Right" hand is on image-left (negative). Mirrored flips it.
  const rawSign = label === 'Right' ? -1 : 1;
  return mirrored ? -rawSign : rawSign;
}

/** Pure gate: does this wrist plausibly belong to the given face box? */
export function handFitsFace(c: HandCandidate, box: FaceBox, opts: BindOptions = {}): BindDecision {
  const radiusScale = opts.radiusScale ?? DEFAULTS.radiusScale;
  const aboveAllowance = opts.aboveAllowance ?? DEFAULTS.aboveAllowance;
  const sideMargin = opts.sideMargin ?? DEFAULTS.sideMargin;
  const mirrored = opts.mirrored ?? DEFAULTS.mirrored;

  const dx = c.wrist.x - box.cx;
  const d = Math.hypot(dx, c.wrist.y - box.cy);
  const bodyRadius = Math.max(box.w, box.h) * radiusScale;

  if (d > bodyRadius) return { ok: false, reason: 'far', dist: d };
  if (c.wrist.y < box.y - box.h * aboveAllowance) return { ok: false, reason: 'above', dist: d };

  const sign = expectedSign(c.label, mirrored);
  if (sign !== 0 && Math.abs(dx) > box.w * sideMargin) {
    const actual = Math.sign(dx);
    if (actual !== 0 && actual !== sign) return { ok: false, reason: 'side', dist: d };
  }
  return { ok: true, dist: d };
}

export interface HandBinder {
  /** Returns the accepted original indices (≤ maxHands), nearest-first. */
  bind(hands: HandCandidate[], box: FaceBox): number[];
  reset(): void;
}

/**
 * Stateful binder: filters hands through handFitsFace, then ranks survivors by
 * distance to the face (closer first), giving a continuity bonus to wrists near
 * previously accepted ones so a steady pair of hands stays selected.
 */
export function createHandBinder(opts: BindOptions = {}): HandBinder {
  const maxHands = opts.maxHands ?? DEFAULTS.maxHands;
  const continuityRadius = opts.continuityRadius ?? DEFAULTS.continuityRadius;
  const continuityBonus = opts.continuityBonus ?? DEFAULTS.continuityBonus;
  let prevWrists: Pt[] = [];

  function bind(hands: HandCandidate[], box: FaceBox): number[] {
    const scored = hands
      .map((h) => ({ h, fit: handFitsFace(h, box, opts) }))
      .filter((s) => s.fit.ok)
      .map((s) => {
        const cont = prevWrists.some(
          (w) => Math.hypot(w.x - s.h.wrist.x, w.y - s.h.wrist.y) < continuityRadius,
        );
        return { index: s.h.index, wrist: s.h.wrist, score: s.fit.dist - (cont ? continuityBonus : 0) };
      })
      .sort((a, b) => a.score - b.score);

    const accepted = scored.slice(0, maxHands);
    prevWrists = accepted.map((a) => a.wrist);
    return accepted.map((a) => a.index);
  }

  return {
    bind,
    reset() { prevWrists = []; },
  };
}
