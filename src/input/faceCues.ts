// OPTIONAL FACE CUES (pure, DOM-free, camera-free).
//
// For days her hands are sore, setup can turn on two face cues that CONFIRM a
// pending action (they never start one): a held smile, or raised eyebrows.
// Both are geometry ratios on the FaceLandmarker mesh the presence tracker
// already computes on-device, compared to her own neutral baseline captured in
// setup. A cue must be held (default 600 ms) to fire, and fires once per hold.

import { FACE, type Pt3 } from './faceLogic';

/** Extra mesh indices: upper eyelids and brow middles. */
export const BROW = { LEFT: 105, RIGHT: 334 } as const;
export const LID = { LEFT: 159, RIGHT: 386 } as const;

const d = (a: Pt3, b: Pt3) => Math.hypot(a.x - b.x, a.y - b.y);

export interface FaceRatios {
  /** Mouth width / face width. Rises with a smile. */
  smile: number;
  /** Mean brow→lid gap / face height. Rises with raised eyebrows. */
  brow: number;
}

export function faceRatios(lm: readonly Pt3[]): FaceRatios | null {
  if (!lm || lm.length < 400) return null;
  const faceW = d(lm[FACE.LEFT_CHEEK], lm[FACE.RIGHT_CHEEK]);
  const faceH = d(lm[FACE.FOREHEAD], lm[FACE.CHIN]);
  if (!(faceW > 1e-6) || !(faceH > 1e-6)) return null;
  const smile = d(lm[FACE.MOUTH_LEFT], lm[FACE.MOUTH_RIGHT]) / faceW;
  const brow = (d(lm[BROW.LEFT], lm[LID.LEFT]) + d(lm[BROW.RIGHT], lm[LID.RIGHT])) / 2 / faceH;
  return { smile, brow };
}

export type FaceCue = 'smile' | 'eyebrows';

export interface FaceCueOptions {
  /** Relative rise over baseline that counts (smile +12%, brow +15%). */
  smileRise?: number;
  browRise?: number;
  holdMs?: number;
}

/**
 * Stateful detector. `setBaseline` stores her neutral ratios (mean of a few
 * frames). `update` returns a cue on the frame its hold completes, once.
 */
export function createFaceCueDetector(opts: FaceCueOptions = {}) {
  const smileRise = opts.smileRise ?? 0.12;
  const browRise = opts.browRise ?? 0.15;
  const holdMs = opts.holdMs ?? 600;
  let baseline: FaceRatios | null = null;
  let since: Record<FaceCue, number | null> = { smile: null, eyebrows: null };
  let fired: Record<FaceCue, boolean> = { smile: false, eyebrows: false };

  function setBaseline(samples: readonly FaceRatios[]): boolean {
    if (samples.length === 0) return false;
    baseline = {
      smile: samples.reduce((s, r) => s + r.smile, 0) / samples.length,
      brow: samples.reduce((s, r) => s + r.brow, 0) / samples.length,
    };
    return true;
  }

  function step(cue: FaceCue, active: boolean, now: number): boolean {
    if (!active) { since[cue] = null; fired[cue] = false; return false; }
    if (since[cue] === null) since[cue] = now;
    if (!fired[cue] && now - (since[cue] as number) >= holdMs) { fired[cue] = true; return true; }
    return false;
  }

  function update(r: FaceRatios | null, now: number): FaceCue | null {
    if (!baseline || !r) { since = { smile: null, eyebrows: null }; fired = { smile: false, eyebrows: false }; return null; }
    const s = step('smile', r.smile >= baseline.smile * (1 + smileRise), now);
    const b = step('eyebrows', r.brow >= baseline.brow * (1 + browRise), now);
    return s ? 'smile' : b ? 'eyebrows' : null;
  }

  return { setBaseline, update, hasBaseline: () => baseline !== null, baseline: () => baseline };
}
