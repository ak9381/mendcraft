// Pure (MediaPipe-free, DOM-free) hand-gesture classifiers over the 21-landmark
// MediaPipe topology, kept here so they can be unit-tested with landmark
// fixtures. handLogic.ts owns the pinch *pointer* (select/drag); this module
// recognises discrete POSES (fist, open palm, point, thumbs up) and the
// temporal/two-hand gestures (double pinch, two-hand pinch zoom) that the
// Gestures settings panel maps to actions.

import { THUMB_TIP, INDEX_TIP, WRIST, PINCH_LIVE, type Pt } from './handLogic';

export type { Pt } from './handLogic';

/** Static single-hand poses the classifier can emit. */
export type StaticGesture = 'pinch' | 'fist' | 'open-palm' | 'point' | 'thumbs-up' | 'scroll' | 'none';
/** Every recognisable gesture, including temporal / two-hand ones. */
export type Gesture = StaticGesture | 'double-pinch' | 'two-hand-zoom';

export const ALL_GESTURES: Gesture[] = [
  'pinch', 'double-pinch', 'fist', 'open-palm', 'point', 'thumbs-up', 'scroll', 'two-hand-zoom', 'none',
];

export const GESTURE_LABELS: Record<Gesture, string> = {
  pinch: 'Pinch',
  'double-pinch': 'Double pinch',
  fist: 'Fist / grab',
  'open-palm': 'Open palm',
  point: 'Point',
  'thumbs-up': 'Thumbs up',
  scroll: 'Scroll (two-finger)',
  'two-hand-zoom': 'Two-hand zoom',
  none: 'None',
};

// Finger [mcp, pip, tip] landmark indices.
const THUMB = [2, 3, 4] as const;
const INDEX = [5, 6, 8] as const;
const MIDDLE = [9, 10, 12] as const;
const RING = [13, 14, 16] as const;
const PINKY = [17, 18, 20] as const;

/** Classification pinch threshold (thumb↔index tip / hand size). MUST match
 *  DEFAULT_PINCH_ON (handLogic.ts) and HAND_FEEL.pinchOn (handFeel.ts) so a
 *  "pinch" means the same thing to the pointer, the keep gesture and the
 *  overlay — a consistency test guards it. */
export const PINCH_CLASSIFY = 0.20;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Hand scale (wrist→middle-finger MCP); 1 as a safe floor so ratios never /0. */
export function handSize(p: Pt[]): number {
  return dist(p[WRIST], p[MIDDLE[0]]) || 1;
}

/** Thumb↔index tip distance as a fraction of hand size. */
export function pinchRatio(p: Pt[]): number {
  return dist(p[THUMB_TIP], p[INDEX_TIP]) / handSize(p);
}

/** A finger is "extended" when its tip sits farther from the wrist than its PIP
 *  joint — orientation-independent, unlike a raw y comparison. */
function extended(p: Pt[], finger: readonly [number, number, number]): boolean {
  const w = p[WRIST];
  return dist(w, p[finger[2]]) > dist(w, p[finger[1]]);
}

const PALM_LMS = [0, 5, 9, 13, 17] as const;
const FINGER_TIPS = [8, 12, 16, 20] as const;
/** Max tip→palm distance, as a fraction of palm size (wrist→middle MCP).
 *  Loosened vs. the old tip-vs-PIP test so a real MediaPipe fist (tips near
 *  the palm, not folded past their PIP toward the wrist) still counts, but
 *  tight enough that a pointing index that only dips (air-tap) stays a point.
 *  A fully extended index is typically ≳ 1.3× palm size away. */
export const FIST_TIP_RATIO = 0.88;
/** Thumb must be at least this far from the palm (and raised) to count as
 *  thumbs-up instead of a fist. */
const THUMB_UP_RATIO = 1.05;

function palmCenter(p: Pt[]): Pt {
  let x = 0, y = 0;
  for (const i of PALM_LMS) { x += p[i].x; y += p[i].y; }
  return { x: x / PALM_LMS.length, y: y / PALM_LMS.length };
}

/** True when the four fingertips sit near the palm, measured in palm-size
 *  ratios — the test that works on real webcam fists, where `extended()`
 *  often still reads true because the tip is slightly past its PIP. */
export function isFistPose(p: Pt[]): boolean {
  if (!p || p.length < 21) return false;
  const size = handSize(p);
  const palm = palmCenter(p);
  const reach = (i: number) => dist(p[i], palm) / size;
  if (!FINGER_TIPS.every((i) => reach(i) <= FIST_TIP_RATIO)) return false;
  // A pinch (index stretched toward a target, other fingers curled) can
  // have every tip under FIST_TIP_RATIO on an angled or close-up hand.
  // Only call it a fist when the index has joined the other fingertips.
  const others = Math.max(reach(12), reach(16), reach(20));
  return reach(8) <= others + 0.15;
}

/** Min index-tip→palm / palm-size for a pose to count as a pinch.
 *  Below this the index is curling in, so a low thumb–index ratio is a
 *  fist-in-progress, not a pinch. A pointing or pinching index is typically
 *  ≳ 1.3× palm size away. */
export const PINCH_INDEX_REACH = 1.10;

export function tipPalmRatio(p: Pt[], tipIdx: number): number {
  if (!p || p.length < 21) return 0;
  return dist(p[tipIdx], palmCenter(p)) / handSize(p);
}

/** True when the hand is curling into a fist from an open or pointing pose:
 *  the other fingertips are already in (or coming in), and the index is no
 *  longer clearly reaching. A deliberate pinch keeps the index stretched
 *  out, so this stays false. */
export function isClosingToFist(p: Pt[]): boolean {
  if (!p || p.length < 21) return false;
  if (isFistPose(p)) return true;
  const size = handSize(p);
  const palm = palmCenter(p);
  const reach = (i: number) => dist(p[i], palm) / size;
  const othersIn = [12, 16, 20].filter((i) => reach(i) <= 0.80).length;
  if (othersIn < 3) return false;
  // Index has come in to join the curled fingers. A pointing or pinching
  // index stays clearly past them (margin 0.18 in classify), so this stays false.
  const othersMax = Math.max(reach(12), reach(16), reach(20));
  return reach(8) <= othersMax + 0.15;
}

/** Fingers that must be stretched for an open palm (thumb is optional —
 *  a real webcam palm often has a relaxed, only slightly-extended thumb). */
const OPEN_PALM_TIPS = [8, 12, 16, 20] as const;
/** Min tip→palm / palm-size for a finger to count as open. Loosened so a
 *  real open hand (not a fully-splayed demo pose) still classifies. */
export const OPEN_PALM_REACH = 0.70;

/** Four fingertips stretched away from the palm — not a pointing hand
 *  (only the index out) and not a fist. Thumb extension is optional. */
export function isOpenPalmPose(p: Pt[]): boolean {
  if (!p || p.length < 21) return false;
  if (isFistPose(p) || isClosingToFist(p)) return false;
  // Thumb + index already together is a pinch, even if the other fingers
  // are splayed — two-hand zoom must not be swallowed as a scroll palm.
  if (pinchRatio(p) < (PINCH_LIVE.on ?? PINCH_CLASSIFY)) return false;
  const s = fingerStates(p);
  const ext = Number(s.index) + Number(s.middle) + Number(s.ring) + Number(s.pinky);
  // A pointing hand (only the index PIP-extended) must not scroll, even when
  // curled fingertips still have a mid tip→palm reach on real MediaPipe.
  if (ext < 3) return false;
  const size = handSize(p);
  const palm = palmCenter(p);
  return OPEN_PALM_TIPS.every((i) => dist(p[i], palm) / size >= OPEN_PALM_REACH);
}

/** Min tip→palm / palm-size for a *relaxed* open finger (low-effort scroll). */
export const RELAXED_PALM_REACH = 0.55;

/** A relaxed open hand: 3+ fingertips loosely extended, thumb ignored.
 *  A pointing index with the others clearly curled is not a palm. */
export function isRelaxedOpenPalm(p: Pt[]): boolean {
  if (!p || p.length < 21) return false;
  if (isFistPose(p) || isClosingToFist(p)) return false;
  if (pinchRatio(p) < (PINCH_LIVE.on ?? PINCH_CLASSIFY)) return false;
  const s = fingerStates(p);
  const ext = Number(s.index) + Number(s.middle) + Number(s.ring) + Number(s.pinky);
  if (ext < 3) return false;
  // A clean three-finger or V pose is not a scroll palm.
  if (s.index && s.middle && s.ring && !s.pinky) return false;
  if (s.index && s.middle && !s.ring && !s.pinky) return false;
  const size = handSize(p);
  const palm = palmCenter(p);
  const rs = OPEN_PALM_TIPS.map((i) => dist(p[i], palm) / size);
  const n = rs.filter((r) => r >= RELAXED_PALM_REACH).length;
  if (n < 3) return false;
  const othersMax = Math.max(rs[1]!, rs[2]!, rs[3]!);
  if (n < 4 && rs[0]! >= othersMax + 0.18) return false;
  return true;
}

export interface FingerStates {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

/** Which fingers are extended. */
export function fingerStates(p: Pt[]): FingerStates {
  return {
    thumb: extended(p, THUMB),
    index: extended(p, INDEX),
    middle: extended(p, MIDDLE),
    ring: extended(p, RING),
    pinky: extended(p, PINKY),
  };
}

/** Index and middle tip→palm / hand size must reach this to count as extended. */
export const SCROLL_FINGER_REACH = 0.70;
/** Ring and pinky tip→palm / hand size stay under this to count as curled. */
export const SCROLL_CURL_MAX = 0.95;
/** Index–middle tip separation / hand size — two distinct fingers, not a point. */
export const SCROLL_INDEX_MIDDLE_SEP = 0.14;
/** Thumb tip must sit this close (min of index MCP, middle MCP, palm) / hand size. */
export const SCROLL_THUMB_TUCK_MAX = 0.55;

/** Closest thumb-tip approach to the palm / index MCP / middle MCP, in hand sizes. */
export function thumbTuckRatio(p: Pt[]): number {
  if (!p || p.length < 21) return Infinity;
  const hs = handSize(p);
  const tip = p[THUMB_TIP];
  return Math.min(
    dist(tip, p[INDEX[0]]) / hs,
    dist(tip, p[MIDDLE[0]]) / hs,
    dist(tip, palmCenter(p)) / hs,
  );
}

/**
 * Thumb is tucked against the palm, on the index side (true for both hands).
 * The anatomical index-vs-pinky test does not depend on a signed x-axis, so
 * it is identical for a Left or Right hand without any mirroring.
 */
export function isThumbTucked(p: Pt[], _handedness?: string | null): boolean {
  if (!p || p.length < 21) return false;
  const tuck = thumbTuckRatio(p);
  if (tuck > SCROLL_THUMB_TUCK_MAX) return false;
  // Anatomical handedness: a tucked thumb lives nearer the index MCP than
  // the pinky MCP on both Left and Right hands.
  const hs = handSize(p);
  if (dist(p[THUMB_TIP], p[INDEX[0]]) > dist(p[THUMB_TIP], p[PINKY[0]]) + 0.08 * hs) return false;
  return true;
}

/**
 * Two-finger SCROLL: index + middle extended, ring + pinky curled, thumb
 * tucked. Middle must actually be out and the tips clearly separated so this
 * never reads as a point (index only) or a pinch (thumb meets index).
 */
export function isTwoFingerScrollPose(p: Pt[], handedness?: string | null): boolean {
  if (!p || p.length < 21) return false;
  if (isFistPose(p)) return false;
  const s = fingerStates(p);
  if (!s.index || !s.middle) return false;
  if (s.ring || s.pinky) return false;
  const indexReach = tipPalmRatio(p, 8);
  const middleReach = tipPalmRatio(p, 12);
  const ringReach = tipPalmRatio(p, 16);
  const pinkyReach = tipPalmRatio(p, 20);
  if (indexReach < SCROLL_FINGER_REACH || middleReach < SCROLL_FINGER_REACH) return false;
  if (ringReach >= SCROLL_CURL_MAX || pinkyReach >= SCROLL_CURL_MAX) return false;
  // Middle almost as extended as the index — a pointing hand with a loose
  // middle finger stays a point.
  if (middleReach < indexReach - 0.25) return false;
  const hs = handSize(p);
  if (dist(p[INDEX_TIP], p[12]) / hs < SCROLL_INDEX_MIDDLE_SEP) return false;
  if (!isThumbTucked(p, handedness)) return false;
  // A live pinch (thumb already on the index tip) is a click, not a scroll.
  if (pinchRatio(p) < (PINCH_LIVE.on ?? PINCH_CLASSIFY)) return false;
  return true;
}

/** Point ↔ fist must be held this long before the stable pose flips. */
export const POINT_FIST_HOLD_MS = 120;

export interface PointFistGate {
  update(pose: StaticGesture, p: Pt[] | null | undefined, t: number, handedness?: string | null): StaticGesture;
  reset(): void;
}

/** Index actually curled into the fist (not just a point that dipped), from
 *  raw landmarks only — reach ratios are distances, so they are already the
 *  same for a Left or Right hand without any mirroring. */
function isIndexCurled(p: Pt[]): boolean {
  const r = tipPalmRatio(p, 8);
  if (fingerStates(p).index && r >= OPEN_PALM_REACH) return false;
  const others = Math.max(tipPalmRatio(p, 12), tipPalmRatio(p, 16), tipPalmRatio(p, 20));
  return r <= FIST_TIP_RATIO && r <= others + 0.08;
}

/**
 * Sticky point/fist gate. A fist is accepted only when the index is actually
 * curled, and point↔fist flips wait `holdMs`. A clearly reaching index
 * leaves a fist immediately so a point can still pinch. When `p` is missing
 * (trace replay with no landmarks), only the time debounce is applied.
 * `handedness` is accepted only so callers can log it on the trace — the
 * math below never branches on it.
 */
export function createPointFistGate(holdMs = POINT_FIST_HOLD_MS): PointFistGate {
  let stable: StaticGesture | null = null;
  let pending: 'point' | 'fist' | null = null;
  let since = -1;

  const relabel = (pose: StaticGesture, p: Pt[] | null | undefined): StaticGesture => {
    if (pose !== 'fist' || !p || p.length < 21) return pose;
    if (isIndexCurled(p)) return 'fist';
    const r = tipPalmRatio(p, 8);
    const others = Math.max(tipPalmRatio(p, 12), tipPalmRatio(p, 16), tipPalmRatio(p, 20));
    if (fingerStates(p).index || r >= OPEN_PALM_REACH || r >= others + 0.18) return 'point';
    return pose;
  };

  const clearlyPointing = (p: Pt[] | null | undefined): boolean => {
    if (!p || p.length < 21) return false;
    const r = tipPalmRatio(p, 8);
    const others = Math.max(tipPalmRatio(p, 12), tipPalmRatio(p, 16), tipPalmRatio(p, 20));
    return (fingerStates(p).index || r >= OPEN_PALM_REACH) && r >= others + 0.18;
  };

  return {
    update(pose, p, t, _handedness) {
      const next = relabel(pose, p);
      if (next !== 'point' && next !== 'fist') {
        stable = next;
        pending = null;
        since = -1;
        return next;
      }
      if (stable !== 'point' && stable !== 'fist') {
        stable = next;
        pending = null;
        since = -1;
        return next;
      }
      if (next === stable) {
        pending = null;
        since = -1;
        return stable;
      }
      // A clearly reaching index may leave a fist immediately (pinch from point).
      if (stable === 'fist' && next === 'point' && clearlyPointing(p)) {
        stable = 'point';
        pending = null;
        since = -1;
        return 'point';
      }
      if (pending !== next) {
        pending = next;
        since = t;
      }
      if (since >= 0 && t - since >= holdMs) {
        stable = next;
        pending = null;
        since = -1;
        return stable;
      }
      return stable;
    },
    reset() { stable = null; pending = null; since = -1; },
  };
}

/**
 * Classify a single hand's static pose from its 21 landmarks (any coordinate
 * convention — only relative distances matter). Pure and deterministic, and
 * identical for a Left or Right hand — no mirroring, no handedness branch.
 * `handedness` is accepted only so callers can log it; it never changes the
 * result.
 */
export function classifyGesture(p: Pt[], handedness?: string | null): StaticGesture {
  if (!p || p.length < 21) return 'none';
  void handedness;
  const s = fingerStates(p);
  const fingers = Number(s.index) + Number(s.middle) + Number(s.ring) + Number(s.pinky);
  const ratio = pinchRatio(p);
  const fistLike = isFistPose(p);
  const thumbPalm = dist(p[THUMB_TIP], palmCenter(p)) / handSize(p);

  // Palm-normalised fist/thumbs-up BEFORE open-palm and pinch: a real
  // MediaPipe fist often still has every tip slightly farther from the wrist
  // than its PIP (so `allOpen` is true) and a low thumb–index ratio (so
  // pinch would win). Tips near the palm are the reliable signal.
  if (fistLike && s.thumb && p[THUMB_TIP].y < p[WRIST].y && thumbPalm >= THUMB_UP_RATIO) return 'thumbs-up';
  if (fistLike) return 'fist';
  // Restore the 4fefac0 pinch rule (thumb–index gap + reaching index).
  // Do NOT require a large index-to-palm ratio — that stole real webcam
  // pinches (and therefore two-hand zoom) after 1f4f2ec. A tighter
  // isClosingToFist still blocks the last frames of a curl-into-fist so
  // those don't fire a pinch click.
  const pinchOn = PINCH_LIVE.on ?? PINCH_CLASSIFY;
  if (ratio < pinchOn && !isClosingToFist(p) && (s.index || tipPalmRatio(p, 8) >= OPEN_PALM_REACH)) return 'pinch';
  // Curled fingers + raised thumb is thumbs-up, even when tip→palm ratios
  // look "open" (the demo thumbs-up pose has a long thumb and mid finger
  // reaches). Must beat the relaxed-palm test.
  if (fingers === 0 && s.thumb && p[THUMB_TIP].y < p[WRIST].y) return 'thumbs-up';
  if (fingers === 0) return 'fist';
  // Two-finger scroll beats point (middle is also out) and open-palm.
  if (isTwoFingerScrollPose(p, handedness)) return 'scroll';
  // Relaxed open hand (3+ loosely extended fingers, thumb optional).
  // Open palm no longer scrolls — that trigger moved to 'scroll'.
  if (isRelaxedOpenPalm(p) || isOpenPalmPose(p)) return 'open-palm';
  // Index clearly out, others not: a point. Real MediaPipe often still
  // reports curled fingers as PIP-extended, so don't require fingers === 1,
  // and don't demand a fully-splayed 0.95 reach — 0.70 plus a margin is enough.
  const indexReach = tipPalmRatio(p, 8);
  const othersMax = Math.max(tipPalmRatio(p, 12), tipPalmRatio(p, 16), tipPalmRatio(p, 20));
  if ((s.index || indexReach >= OPEN_PALM_REACH) && indexReach >= othersMax + 0.18) return 'point';
  if (s.index && fingers === 1) return 'point';
  return 'none';
}

/** Distance between two hands' pinch points (thumb/index tip midpoints). */
export function twoHandSpan(a: Pt[], b: Pt[]): number {
  const mid = (p: Pt[]) => ({
    x: (p[THUMB_TIP].x + p[INDEX_TIP].x) / 2,
    y: (p[THUMB_TIP].y + p[INDEX_TIP].y) / 2,
  });
  return dist(mid(a), mid(b));
}

export interface RecognizerFrame {
  /** One entry per operator hand: its 21 mirrored landmarks. */
  hands: Pt[][];
  /** Monotonic clock (ms) — injected so the recognizer stays testable. */
  now: number;
}

export interface RecognizerResult {
  /** The gesture recognised this frame (the headline for the live preview). */
  gesture: Gesture;
  /** Gestures whose *onset* fired this frame (edge-triggered action triggers). */
  fired: Gesture[];
  /** For two-hand zoom: + spreading apart, − pinching together, 0 otherwise. */
  zoomDelta: number;
}

export const DOUBLE_PINCH_MS = 450;

/**
 * Stateful recogniser layered over the pure classifiers. Tracks pinch edges for
 * double-pinch, and both hands for two-hand zoom. Clock is injected via each
 * frame's `now`, so the whole thing is unit-testable without a camera.
 */
export function createGestureRecognizer() {
  let wasPinching = false;
  let lastPinchUp = -Infinity;
  let lastSpan: number | null = null;
  let lastStatic: StaticGesture = 'none';

  function update({ hands, now }: RecognizerFrame): RecognizerResult {
    const fired: Gesture[] = [];
    let zoomDelta = 0;

    // Two-hand zoom takes precedence when both hands are pinching.
    if (hands.length >= 2) {
      const bothPinch = classifyGesture(hands[0]) === 'pinch' && classifyGesture(hands[1]) === 'pinch';
      if (bothPinch) {
        const span = twoHandSpan(hands[0], hands[1]);
        if (lastSpan !== null) zoomDelta = span - lastSpan;
        lastSpan = span;
        wasPinching = true; // suppress single-hand double-pinch while zooming
        return { gesture: 'two-hand-zoom', fired, zoomDelta };
      }
    }
    lastSpan = null;

    const primary = hands[0] ? classifyGesture(hands[0]) : 'none';
    const pinching = primary === 'pinch';

    // Rising pinch edge: emit pinch, and double-pinch if two came in quickly.
    if (pinching && !wasPinching) {
      if (now - lastPinchUp <= DOUBLE_PINCH_MS) {
        fired.push('double-pinch');
      } else {
        fired.push('pinch');
      }
      lastPinchUp = now;
    } else if (!pinching && primary !== 'none' && primary !== lastStatic) {
      // Static poses fire once, on entry (when the pose changes) — not every frame.
      fired.push(primary);
    }
    wasPinching = pinching;
    lastStatic = pinching ? 'none' : primary;

    const gesture: Gesture = fired.includes('double-pinch') ? 'double-pinch' : primary;
    return { gesture, fired, zoomDelta };
  }

  function reset(): void {
    wasPinching = false;
    lastPinchUp = -Infinity;
    lastSpan = null;
  }

  return { update, reset };
}
