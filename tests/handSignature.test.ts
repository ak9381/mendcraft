// Bone-proportion hand identity: ratios must be scale- and mirror-invariant,
// separate a different person's hand from noise, and respect handedness.
import { describe, expect, it } from 'vitest';
import {
  handSignatureRatios,
  handSignatureDistance,
  matchesHandSignature,
  matchesOwner,
  averageRatios,
  HAND_MATCH_TOLERANCE,
  type HandSignature,
  type OwnerHands,
} from '../src/input/handSignature';
import { HAND_CONNECTIONS, type Pt } from '../src/input/handLogic';
import { openPalmLandmarks } from '../src/canvas/scanRegistration';
import { createHandBinder } from '../src/input/handBinding';
import type { FaceBox } from '../src/input/faceLogic';

// Hand A: the baseline open palm fixture used across the test suite.
const handA: Pt[] = openPalmLandmarks();

// Hand B: same topology as A, but landmarks 5..20 (everything except the
// wrist and thumb) stretched 2.2x from the wrist — thumb bones stay put while
// the rest of the hand grows, so the bone-length *proportions* clearly differ
// from hand A (a "different person"), unlike a uniform whole-hand scale (which
// handSignatureRatios is explicitly invariant to — see the scale-invariance
// test below). A mild 1.35x stretch only moves the 4 thumb-bone ratios and
// gets diluted by the other 17 unchanged bones in the RMS, so it stays inside
// HAND_MATCH_TOLERANCE; 2.2x clears it comfortably.
function stretchedHand(a: readonly Pt[]): Pt[] {
  const wrist = a[0];
  return a.map((p, i) => {
    if (i < 5) return { ...p };
    return {
      x: wrist.x + (p.x - wrist.x) * 2.2,
      y: wrist.y + (p.y - wrist.y) * 2.2,
    };
  });
}
const handB: Pt[] = stretchedHand(handA);

function scaleAbout(points: readonly Pt[], origin: Pt, factor: number): Pt[] {
  return points.map((p) => ({
    x: origin.x + (p.x - origin.x) * factor,
    y: origin.y + (p.y - origin.y) * factor,
  }));
}

function mirrorX(points: readonly Pt[]): Pt[] {
  return points.map((p) => ({ x: 1 - p.x, y: p.y }));
}

describe('handSignatureRatios', () => {
  it('returns one ratio per HAND_CONNECTIONS bone', () => {
    const ratios = handSignatureRatios(handA);
    expect(ratios).toHaveLength(HAND_CONNECTIONS.length);
  });

  it('is scale-invariant: shrinking the whole hand about an arbitrary point leaves ratios unchanged', () => {
    const base = handSignatureRatios(handA);
    const shrunk = scaleAbout(handA, { x: 0.2, y: 0.7 }, 0.5);
    const scaled = handSignatureRatios(shrunk);
    expect(scaled).toHaveLength(base.length);
    scaled.forEach((v, i) => expect(v).toBeCloseTo(base[i], 5));
  });

  it('is mirror-invariant: flipping x -> 1-x leaves ratios unchanged', () => {
    const base = handSignatureRatios(handA);
    const mirrored = handSignatureRatios(mirrorX(handA));
    expect(handSignatureDistance(base, mirrored)).toBeCloseTo(0, 5);
  });
});

describe('matchesHandSignature', () => {
  const owner: HandSignature = { ratios: handSignatureRatios(handA), label: 'Left' };

  it('matches the exact same hand', () => {
    const candidate = { ratios: handSignatureRatios(handA), label: 'Left' };
    expect(matchesHandSignature(candidate, owner)).toBe(true);
  });

  it('still matches with small deterministic per-landmark jitter', () => {
    // Alternate +/- 0.004 on x and y — landmark noise moves single bones a
    // little; the RMS across 21 bones should still sit well inside tolerance.
    const jittered: Pt[] = handA.map((p, i) => {
      const sign = i % 2 === 0 ? 1 : -1;
      return { x: p.x + sign * 0.004, y: p.y - sign * 0.004 };
    });
    const candidate = { ratios: handSignatureRatios(jittered), label: 'Left' };
    expect(handSignatureDistance(candidate.ratios, owner.ratios)).toBeLessThan(HAND_MATCH_TOLERANCE);
    expect(matchesHandSignature(candidate, owner)).toBe(true);
  });

  it('a different person (stretched bone proportions) does not match', () => {
    const candidate = { ratios: handSignatureRatios(handB), label: 'Left' };
    expect(handSignatureDistance(candidate.ratios, owner.ratios)).toBeGreaterThan(HAND_MATCH_TOLERANCE);
    expect(matchesHandSignature(candidate, owner)).toBe(false);
  });

  it('rejects when handedness labels disagree, even with identical ratios', () => {
    const candidate = { ratios: handSignatureRatios(handA), label: 'Right' };
    expect(matchesHandSignature(candidate, owner)).toBe(false);
  });

  it('allows an unknown (undefined) label through on proportions alone', () => {
    const candidate = { ratios: handSignatureRatios(handA), label: undefined };
    expect(matchesHandSignature(candidate, owner)).toBe(true);
  });
});

describe('matchesOwner', () => {
  const left: HandSignature = { ratios: handSignatureRatios(handA), label: 'Left' };
  const right: HandSignature = { ratios: handSignatureRatios(handB), label: 'Right' };
  const owner: OwnerHands = { left, right };

  it('matches against the stored left hand', () => {
    expect(matchesOwner({ ratios: handSignatureRatios(handA), label: 'Left' }, owner)).toBe(true);
  });

  it('matches against the stored right hand', () => {
    expect(matchesOwner({ ratios: handSignatureRatios(handB), label: 'Right' }, owner)).toBe(true);
  });

  it('an empty OwnerHands never matches', () => {
    expect(matchesOwner({ ratios: handSignatureRatios(handA), label: 'Left' }, {})).toBe(false);
  });
});

describe('averageRatios', () => {
  it('computes the element-wise mean', () => {
    expect(averageRatios([[1, 2], [3, 4]])).toEqual([2, 3]);
  });

  it('returns [] for no samples', () => {
    expect(averageRatios([])).toEqual([]);
  });
});

describe('binder prefers the owner over a closer stranger', () => {
  const faceBox: FaceBox = { x: 0.4, y: 0.2, w: 0.2, h: 0.25, cx: 0.5, cy: 0.32 };
  const ownerRatios = handSignatureRatios(handA);
  const strangerPoints = handB; // different proportions
  const ownerPoints = handA;

  it('without setOwnerHands, the closer stranger hand wins', () => {
    const binder = createHandBinder({ maxHands: 1 });
    const accepted = binder.bind(
      [
        { index: 0, wrist: { x: 0.52, y: 0.58 }, label: 'Left', points: strangerPoints }, // closer
        { index: 1, wrist: { x: 0.48, y: 0.6 }, label: 'Left', points: ownerPoints }, // farther
      ],
      faceBox,
    );
    expect(accepted).toEqual([0]); // stranger (closer) wins on raw distance
  });

  it('after setOwnerHands, the owner wins despite being farther (ownerBonus outweighs distance)', () => {
    const binder = createHandBinder({ maxHands: 1 }); // fresh binder: no continuity contamination
    binder.setOwnerHands({ left: { ratios: ownerRatios, label: 'Left' } });
    const accepted = binder.bind(
      [
        { index: 0, wrist: { x: 0.52, y: 0.58 }, label: 'Left', points: strangerPoints }, // closer, not owner
        { index: 1, wrist: { x: 0.48, y: 0.6 }, label: 'Left', points: ownerPoints }, // farther, owner
      ],
      faceBox,
    );
    expect(accepted).toEqual([1]); // owner wins despite being farther
  });
});
