// UNWIRED OPT-IN DETECTOR — nothing in the app imports this module today; it
// is kept (with its tests) for a later Project-Gameface-style click. See the
// TODO(wiring) note below before relying on it.
//
// FACE CLICK (opt-in, after Google's Project Gameface): open the mouth
// (`jawOpen`) or raise the inner brows (`browInnerUp`) and hold it briefly to
// click whatever the hand cursor targets — a click that never moves the hand.
//
// Pure detector only. Hysteresis: a score ≥ onScore held ≥ holdMs fires once;
// it re-arms only after every watched score drops below offScore. Off by
// default: enabled when localStorage `mc.faceClick` === '1'.
//
// TODO(wiring): the presence tracker's FaceLandmarker does not request
// blendshapes today (no `outputFaceBlendshapes`), so nothing feeds this yet.
// Once it does, call `detector.update(face.blendshapes, now)` per face frame
// and, when it returns true, `handPointer.clickTarget()`.

export interface FaceClickConfig {
  onScore: number;
  offScore: number;
  holdMs: number;
  /** Blendshape names that count as the click gesture. */
  shapes: readonly string[];
}

export const FACE_CLICK: FaceClickConfig = {
  onScore: 0.6,
  offScore: 0.4,
  holdMs: 250,
  shapes: ['jawOpen', 'browInnerUp'],
};

export const FACE_CLICK_KEY = 'mc.faceClick';

/** Blendshape scores by name (MediaPipe `categoryName` → `score`). */
export type BlendshapeScores = Readonly<Record<string, number | undefined>>;

export interface FaceClickDetector {
  /** Feed one face frame; true exactly on the frame the click fires. */
  update(scores: BlendshapeScores | null | undefined, now: number): boolean;
  reset(): void;
}

export function createFaceClick(cfg: FaceClickConfig = FACE_CLICK): FaceClickDetector {
  let since: number | null = null;
  let armed = true;
  return {
    update(scores, now) {
      const top = scores ? Math.max(0, ...cfg.shapes.map((k) => scores[k] ?? 0)) : 0;
      if (!armed) {
        if (top < cfg.offScore) armed = true;
        since = null;
        return false;
      }
      if (top < cfg.onScore) { since = null; return false; }
      if (since === null) since = now;
      if (now - since >= cfg.holdMs) {
        armed = false;
        since = null;
        return true;
      }
      return false;
    },
    reset() { since = null; armed = true; },
  };
}

/** Opt-in flag (off by default; storage errors read as off). */
export function faceClickEnabled(storage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  try { return storage?.getItem(FACE_CLICK_KEY) === '1'; } catch { return false; }
}
