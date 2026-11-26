// Pure (MediaPipe-free, DOM-free) hand identity by PROPORTIONS: the lengths
// of the 21 skeleton bones normalised by hand size (wrist→middle-MCP), which
// stay constant as the hand moves, rotates in-plane, mirrors, or changes
// distance to the camera — but differ from person to person. Used by the
// registration scan to capture the owner's left/right hands, and by
// handBinding.ts to prefer the owner's hands over a bystander's.

import { HAND_CONNECTIONS, MIDDLE_MCP, WRIST, type Pt } from './handLogic';

export interface HandSignature {
  /** One entry per skeleton bone (HAND_CONNECTIONS order), ÷ hand size. */
  ratios: number[];
  /** MediaPipe handedness label the hand was captured with ("Left"/"Right"). */
  label: string;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Bone-length ratio vector for one 21-landmark hand. Mirror-invariant. */
export function handSignatureRatios(lm: readonly Pt[]): number[] {
  if (lm.length < 21) return [];
  const size = dist(lm[WRIST], lm[MIDDLE_MCP]) || 1e-6;
  return HAND_CONNECTIONS.map(([a, b]) => dist(lm[a], lm[b]) / size);
}

/** RMS distance between two ratio vectors (∞ when either is empty). */
export function handSignatureDistance(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return Infinity;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum / n);
}

/** Landmark noise moves single bones a little; a different person's hand
 *  moves the whole vector. RMS across 21 bones separates the two well. */
export const HAND_MATCH_TOLERANCE = 0.12;

/**
 * Does a candidate hand match a captured owner hand? Handedness must agree
 * (when the candidate has a label), and the bone proportions must sit within
 * the tolerance.
 */
export function matchesHandSignature(
  candidate: { ratios: readonly number[]; label?: string },
  owner: HandSignature,
  tolerance = HAND_MATCH_TOLERANCE,
): boolean {
  if (candidate.label !== undefined && candidate.label !== owner.label) return false;
  return handSignatureDistance(candidate.ratios, owner.ratios) <= tolerance;
}

/** The owner's two captured hands (either may be absent mid-capture). */
export interface OwnerHands {
  left?: HandSignature;
  right?: HandSignature;
}

/** True when the candidate matches either of the owner's captured hands. */
export function matchesOwner(
  candidate: { ratios: readonly number[]; label?: string },
  owner: OwnerHands,
  tolerance = HAND_MATCH_TOLERANCE,
): boolean {
  return (
    (!!owner.left && matchesHandSignature(candidate, owner.left, tolerance)) ||
    (!!owner.right && matchesHandSignature(candidate, owner.right, tolerance))
  );
}

/** Element-wise mean of several ratio vectors (the scan's hold window). */
export function averageRatios(samples: readonly (readonly number[])[]): number[] {
  if (samples.length === 0) return [];
  const n = samples[0].length;
  const out = new Array<number>(n).fill(0);
  for (const s of samples) for (let i = 0; i < n; i++) out[i] += s[i] ?? 0;
  return out.map((v) => v / samples.length);
}
