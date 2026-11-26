// HOLD ENGINE for the fixed button gestures: a shape fires only after it has
// been HELD for holdMs (2 s) with the same shape on the same hand(s), the
// hand nearly still and the user facing the screen. Pure, clock-injected.
//
//  - progress 0..1 while a hold runs (the bound button fills with it);
//  - a different shape / hand, a lost hand, or a moving hand cancels it (a
//    one- or two-frame flicker inside graceMs does not);
//  - "not facing" (false) cancels at once; unknown (null) is allowed, the
//    same rule as the hand pointer's facing gate;
//  - one fire per hold: after a fire nothing can arm again until no fixed
//    shape has been seen for releaseMs (drop the hand / open it);
//  - a two-hand gesture needs BOTH hands (one L, one R) in the same shape.

import type { Pt } from '../input/handLogic';
import { FIXED_SHAPES, type HandShape, type HandSide } from './handShape';

export type FixedShape = 'thumbsUp' | 'thumbsDown' | 'one' | 'peace' | 'three';
/** 'R:thumbsUp', 'L:peace', '2:three' (both hands). */
/** The one MIXED two-hand gesture: left thumbs UP + right thumbs DOWN. */
export const MIXED_KEY = '2:lUpRDown' as const;
export type GestureKey = `${HandSide | '2'}:${FixedShape}` | typeof MIXED_KEY;

/** The hand shapes a key shows (for icons and names): the mixed key is two. */
export function keyShapes(key: GestureKey): FixedShape[] {
  if (key === MIXED_KEY) return ['thumbsUp', 'thumbsDown'];
  return [key.split(':')[1] as FixedShape];
}
export function keySide(key: GestureKey): HandSide | '2' {
  return key.split(':')[0] as HandSide | '2';
}

export interface GestureHand {
  shape: HandShape;
  hand: HandSide;
  /** Palm centre (any consistent units — camera-normalised is fine). */
  palm: Pt;
  /** Hand scale in the same units (wrist → middle MCP); motion is measured in it. */
  scale: number;
}

export interface HoldInput {
  hands: readonly GestureHand[];
  /** false = explicitly not facing (cancels); null = unknown (allowed). */
  facing: boolean | null;
  now: number;
  /** Something else owns the hands right now (a fist grab, a capture step):
   *  no hold runs. */
  blocked?: boolean;
  /** At completion, a hold may be DEFERRED (it stays full, not fired) — e.g.
   *  L thumbs-up (Save) while the other hand is still forming the mixed
   *  L-up + R-down gesture. */
  defer?: (key: GestureKey) => boolean;
}

export interface HoldState {
  /** The gesture currently being held (null when none). */
  key: GestureKey | null;
  /** 0..1 fill for the light-up; 0 when nothing is held. */
  progress: number;
  /** Set on exactly the frame a hold completes. */
  fired: GestureKey | null;
}

export interface HoldConfig {
  holdMs: number;
  /** A mismatching / missing frame shorter than this keeps the hold. */
  graceMs: number;
  /** Palm drift from where the hold started, in hand scales, that cancels. */
  maxDriftScales: number;
  /** Palm speed (hand scales per second, 3-frame average) that cancels. */
  maxSpeedScales: number;
  /** After a fire: no fixed shape for this long before anything re-arms. */
  releaseMs: number;
}

export const GESTURE_HOLD: HoldConfig = {
  holdMs: 2000,
  graceMs: 160,
  maxDriftScales: 0.6,
  maxSpeedScales: 1.6,
  releaseMs: 300,
};

const isFixed = (s: HandShape): s is FixedShape => (FIXED_SHAPES as readonly string[]).includes(s);

/** The gesture these hands make right now (null: none, or ambiguous). */
export function gestureKeyOf(hands: readonly Pick<GestureHand, 'shape' | 'hand'>[]): GestureKey | null {
  const fixed = hands.filter((h) => isFixed(h.shape));
  if (fixed.length === 0) return null;
  if (fixed.length === 1) return `${fixed[0].hand}:${fixed[0].shape as FixedShape}`;
  const [a, b] = fixed;
  if (fixed.length === 2 && a.shape === b.shape && a.hand !== b.hand) return `2:${a.shape as FixedShape}`;
  // The mixed pair: left thumbs UP + right thumbs DOWN (Hover to click).
  if (fixed.length === 2 && a.hand !== b.hand) {
    const l = a.hand === 'L' ? a : b, r = a.hand === 'L' ? b : a;
    if (l.shape === 'thumbsUp' && r.shape === 'thumbsDown') return MIXED_KEY;
  }
  return null; // two different shapes (or two "right" hands): never guess
}

export interface HoldEngine {
  update(input: HoldInput): HoldState;
  reset(): void;
  readonly state: HoldState;
}

export function createHoldEngine(cfg: Partial<HoldConfig> = {}): HoldEngine {
  const c: HoldConfig = { ...GESTURE_HOLD, ...cfg };
  let key: GestureKey | null = null;
  let startedAt = 0;
  let anchors: Pt[] = [];
  let prev: { palms: Pt[]; t: number } | null = null;
  let speeds: number[] = [];
  let mismatchSince: number | null = null;
  // After a fire: true until no fixed shape has been seen for releaseMs.
  let spent = false;
  let clearSince: number | null = null;
  let state: HoldState = { key: null, progress: 0, fired: null };

  function cancel(): void {
    key = null; anchors = []; prev = null; speeds = []; mismatchSince = null;
  }
  function begin(k: GestureKey, palms: Pt[], now: number): void {
    key = k; startedAt = now; anchors = palms; prev = { palms, t: now }; speeds = []; mismatchSince = null;
  }
  function out(fired: GestureKey | null, now: number): HoldState {
    state = { key, progress: key ? Math.max(0, Math.min(1, (now - startedAt) / c.holdMs)) : 0, fired };
    return state;
  }

  function update(input: HoldInput): HoldState {
    const { now } = input;
    const seen = input.blocked ? null : gestureKeyOf(input.hands);

    if (spent) {
      if (seen) { clearSince = null; cancel(); return out(null, now); }
      if (clearSince === null) clearSince = now;
      if (now - clearSince < c.releaseMs) { cancel(); return out(null, now); }
      spent = false; clearSince = null;
    }
    if (input.facing === false || input.blocked) { cancel(); return out(null, now); }

    // Sorted by side (L, R) so the stillness anchors follow each HAND, not
    // its position in this frame's array (the tracker may swap the order).
    const gesturing = seen ? input.hands.filter((h) => isFixed(h.shape)).sort((a, b) => (a.hand < b.hand ? -1 : a.hand > b.hand ? 1 : 0)) : [];
    const palms = gesturing.map((h) => h.palm);
    const scale = Math.max(1e-6, ...gesturing.map((h) => h.scale));

    if (key && seen !== key) {
      // A flicker (one shape misread, the hand lost for a frame) is forgiven.
      if (mismatchSince === null) mismatchSince = now;
      if (now - mismatchSince < c.graceMs) return out(null, now);
      cancel();
    }
    if (!seen) return out(null, now);
    if (!key) { begin(seen, palms, now); return out(null, now); }
    mismatchSince = null;

    // Stillness: drift from where the hold began, and recent speed.
    const drift = Math.max(...palms.map((p, i) => (anchors[i] ? Math.hypot(p.x - anchors[i].x, p.y - anchors[i].y) : 0))) / scale;
    if (prev && now > prev.t) {
      const step = Math.max(...palms.map((p, i) => (prev!.palms[i] ? Math.hypot(p.x - prev!.palms[i].x, p.y - prev!.palms[i].y) : 0)));
      speeds.push((step / scale) / ((now - prev.t) / 1000));
      if (speeds.length > 3) speeds.shift();
    }
    prev = { palms, t: now };
    const speed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
    if (drift > c.maxDriftScales || speed > c.maxSpeedScales) {
      begin(seen, palms, now); // moving: start again from here
      return out(null, now);
    }

    if (now - startedAt >= c.holdMs) {
      if (input.defer?.(key)) return out(null, now); // full, waiting: the other hand is still forming
      const fired = key;
      cancel();
      spent = true; clearSince = null;
      state = { key: null, progress: 0, fired };
      return state;
    }
    return out(null, now);
  }

  return {
    update,
    reset() { cancel(); spent = false; clearSince = null; state = { key: null, progress: 0, fired: null }; },
    get state() { return state; },
  };
}

// ---------------------------------------------------------------- pair grace

/** How recently the OTHER hand must have been steady before a one-hand key
 *  that is half of a bound two-hand gesture may fire. */
export const PAIR_GRACE_MS = 400;

/**
 * Pair grace: a one-hand hold that is HALF of a bound two-hand gesture waits
 * (stays full, not fired) while the other hand changed shape — appeared,
 * disappeared or moved between shapes — within PAIR_GRACE_MS: it may be
 * forming (or just broke out of) the pair.
 *  - X:shape waits on the other hand whenever `2:shape` is bound
 *    (R thumbs up / Approve vs both thumbs up / More; L thumbs down / Undo
 *    vs both thumbs down…);
 *  - L thumbs up and R thumbs down also wait when the mixed L-up + R-down
 *    is bound.
 */
export interface PairGrace {
  observe(hands: readonly Pick<GestureHand, 'shape' | 'hand'>[], now: number): void;
  defer(key: GestureKey, now: number): boolean;
}

export function createPairGrace(bound: readonly GestureKey[], graceMs = PAIR_GRACE_MS): PairGrace {
  const has = new Set(bound);
  const last: Record<HandSide, { shape: HandShape | null; at: number }> = { L: { shape: null, at: -Infinity }, R: { shape: null, at: -Infinity } };
  return {
    observe(hands, now) {
      for (const side of ['L', 'R'] as const) {
        const cur = hands.find((h) => h.hand === side)?.shape ?? null;
        // Every change counts, the hand appearing or disappearing included.
        if (cur !== last[side].shape) last[side] = { shape: cur, at: now };
      }
    },
    defer(key, now) {
      if (key === MIXED_KEY) return false;
      const side = keySide(key);
      if (side === '2') return false;
      const shape = keyShapes(key)[0];
      const pairs = has.has(`2:${shape}` as GestureKey)
        || (has.has(MIXED_KEY) && ((side === 'L' && shape === 'thumbsUp') || (side === 'R' && shape === 'thumbsDown')));
      if (!pairs) return false;
      const other: HandSide = side === 'L' ? 'R' : 'L';
      return now - last[other].at < graceMs;
    },
  };
}
