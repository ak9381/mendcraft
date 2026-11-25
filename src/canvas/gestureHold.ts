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
export type GestureKey = `${HandSide | '2'}:${FixedShape}`;

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

    const gesturing = seen ? input.hands.filter((h) => isFixed(h.shape)) : [];
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
