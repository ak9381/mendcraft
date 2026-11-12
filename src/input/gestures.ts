// Pure (MediaPipe-free, DOM-free) hand-gesture classifiers over the 21-landmark
// MediaPipe topology, kept here so they can be unit-tested with landmark
// fixtures. handLogic.ts owns the pinch *pointer* (select/drag); this module
// recognises discrete POSES (fist, open palm, point, thumbs up) and the
// temporal/two-hand gestures (double pinch, two-hand pinch zoom) that the
// Gestures settings panel maps to actions.

import { THUMB_TIP, INDEX_TIP, WRIST, type Pt } from './handLogic';

export type { Pt } from './handLogic';

/** Static single-hand poses the classifier can emit. */
export type StaticGesture = 'pinch' | 'fist' | 'open-palm' | 'point' | 'thumbs-up' | 'none';
/** Every recognisable gesture, including temporal / two-hand ones. */
export type Gesture = StaticGesture | 'double-pinch' | 'two-hand-zoom';

export const ALL_GESTURES: Gesture[] = [
  'pinch', 'double-pinch', 'fist', 'open-palm', 'point', 'thumbs-up', 'two-hand-zoom', 'none',
];

export const GESTURE_LABELS: Record<Gesture, string> = {
  pinch: 'Pinch',
  'double-pinch': 'Double pinch',
  fist: 'Fist / grab',
  'open-palm': 'Open palm',
  point: 'Point',
  'thumbs-up': 'Thumbs up',
  'two-hand-zoom': 'Two-hand zoom',
  none: 'None',
};

// Finger [mcp, pip, tip] landmark indices.
const THUMB = [2, 3, 4] as const;
const INDEX = [5, 6, 8] as const;
const MIDDLE = [9, 10, 12] as const;
const RING = [13, 14, 16] as const;
const PINKY = [17, 18, 20] as const;

/** Classification pinch threshold (thumb↔index tip / hand size). Slightly more
 *  forgiving than the pointer's on-threshold so a held pinch pose reads stably. */
export const PINCH_CLASSIFY = 0.4;

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

/**
 * Classify a single hand's static pose from its 21 landmarks (any coordinate
 * convention — only relative distances matter). Pure and deterministic.
 */
export function classifyGesture(p: Pt[]): StaticGesture {
  if (!p || p.length < 21) return 'none';
  const s = fingerStates(p);
  const fingers = Number(s.index) + Number(s.middle) + Number(s.ring) + Number(s.pinky);
  const allOpen = s.index && s.middle && s.ring && s.pinky;
  const ratio = pinchRatio(p);

  // Open palm wins before pinch: splayed fingers shouldn't read as a pinch.
  if (allOpen) return 'open-palm';
  // Thumb + index tips together *while the index reaches out* → pinch. The index
  // check separates a pinch from a fist (where a curled index tip also sits near
  // the thumb).
  if (ratio < PINCH_CLASSIFY && s.index) return 'pinch';
  // Only the index extended → pointing.
  if (s.index && fingers === 1) return 'point';
  // Fingers curled, thumb out and raised above the wrist → thumbs up.
  if (fingers === 0 && s.thumb && p[THUMB_TIP].y < p[WRIST].y) return 'thumbs-up';
  // Everything curled → fist / grab.
  if (fingers === 0) return 'fist';
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
