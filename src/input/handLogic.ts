// Pure (MediaPipe-free, DOM-free) two-hand pinch logic + skeleton geometry.
// Kept separate from hands.ts so it can be unit-tested.

import { isFistPose, isClosingToFist } from './gestures';

export const THUMB_TIP = 4;
export const INDEX_TIP = 8;
export const WRIST = 0;
export const MIDDLE_MCP = 9;

/** The 21-landmark MediaPipe hand topology (same as HandLandmarker.HAND_CONNECTIONS). */
export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20], // pinky + palm
];

/** Per-hand colours: [idle, pinching]. Hand 0 = cyan, hand 1 = magenta. */
export const HAND_COLORS: ReadonlyArray<{ idle: string; pinch: string }> = [
  { idle: '#38bdf8', pinch: '#facc15' },
  { idle: '#e879f9', pinch: '#4ade80' },
];

// Values are thumb–index gap ÷ wrist–middle-MCP (hand size), so they stay
// stable as the hand moves toward or away from the camera. These MUST match
// HAND_FEEL.pinchOn/pinchOff (src/canvas/handFeel.ts) and PINCH_CLASSIFY
// (gestures.ts) — one pinch definition across pointer, keep and overlay; a
// consistency test guards it. The old 0.50/0.64 was loose enough that a
// half-closed pointing hand read as a pinch (the "hover triggers things"
// bug); 0.38/0.52 is back near the original M1 feel (0.35/0.48), deliberate
// but still forgiving of an incomplete close. Calibration and the
// interaction profile may tighten or loosen these per user.
// Units: thumb–index tip / wrist→middle-MCP, same as trace `pinchDistance`.
// Real MediaPipe closes around 0.18–0.20, not 0.045 (synthetic almost-touch).
export const DEFAULT_PINCH_ON = 0.24;
export const DEFAULT_PINCH_OFF = 0.33;

/** Runtime pinch band (defaults, then first-run/Tools or a rolling baseline). */
export const PINCH_LIVE = { on: DEFAULT_PINCH_ON, off: DEFAULT_PINCH_OFF };

export function setLivePinchThresholds(on: number, off: number): void {
  if (!(on > 0) || !Number.isFinite(on) || !Number.isFinite(off) || off <= on) return;
  PINCH_LIVE.on = on;
  PINCH_LIVE.off = off;
}

export function resetLivePinchThresholds(): void {
  PINCH_LIVE.on = DEFAULT_PINCH_ON;
  PINCH_LIVE.off = DEFAULT_PINCH_OFF;
}
/** Movement (in mirrored screen units) that disqualifies a pinch from being a tap. */
export const TAP_MOVE_LIMIT = 0.045;

export type HandEvent =
  | { type: 'pinch-tap'; x: number; y: number; hand?: number }
  | { type: 'pinch-start'; x: number; y: number; hand?: number }
  | { type: 'pinch-move'; x: number; y: number; dx: number; dy: number; hand?: number }
  | { type: 'pinch-end'; hand?: number }
  | { type: 'lost' }
  | { type: 'tracking'; x: number; y: number; hand?: number };

export interface Pt { x: number; y: number }

export interface HandInput {
  landmarks: Pt[];
  /** MediaPipe handedness label ("Left"/"Right"); used to keep identity stable. */
  label?: string;
}

export interface HandFrame {
  /** Stable slot 0 or 1 -> colour. */
  slot: number;
  /** MediaPipe handedness label ("Left"/"Right"), when known — the owner
   *  registration flow uses it for "show your right hand". */
  label?: string;
  /** All 21 points, mirrored to screen space (0..1). */
  points: Pt[];
  pinching: boolean;
  /** This hand owns the current drag. */
  owner: boolean;
  /** Midpoint of thumb + index tips (screen space). */
  pinchPoint: Pt;
  /** Aim point used for the cursor and pick (index→midpoint blend). */
  aim: Pt;
  /** Thumb–index gap ÷ hand size. */
  pinchRatio: number;
  /** 0 = open, 1 = fully closed past the on-threshold. */
  pinchStrength: number;
  color: string;
}

interface SlotState {
  pinching: boolean;
  tapCandidate: boolean;
  lastX: number;
  lastY: number;
  label?: string;
  seen: boolean;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Thumb-tip ↔ index-tip gap normalised by wrist ↔ middle-MCP (hand size). */
export function pinchGapRatio(lm: readonly Pt[]): number {
  if (lm.length <= MIDDLE_MCP) return Infinity;
  const handSize = dist(lm[WRIST], lm[MIDDLE_MCP]) || 1;
  return dist(lm[THUMB_TIP], lm[INDEX_TIP]) / handSize;
}

/**
 * How close a pinch is to registering: 0 while clearly open, rising as the
 * fingers close, ~0.8 at the on-threshold, 1 when shut. Used by the HUD meter
 * and to blend the cursor from the index tip toward the pinch midpoint.
 */
export function pinchStrength(ratio: number, pinchOn: number, pinchOff = pinchOn + 0.14): number {
  if (!(pinchOn > 0) || !Number.isFinite(ratio)) return 0;
  if (ratio >= pinchOff) return 0;
  // Firmly closed (well past the on-threshold) reads as 1; the on-threshold
  // itself sits at 0.85 so the HUD fills before the pinch actually fires.
  const firm = pinchOn * 0.4;
  if (ratio <= firm) return 1;
  if (ratio > pinchOn) return 0.85 * (pinchOff - ratio) / Math.max(pinchOff - pinchOn, 1e-6);
  return 0.85 + 0.15 * (pinchOn - ratio) / Math.max(pinchOn - firm, 1e-6);
}

/**
 * Cursor / pick point for a hand. While the hand is open this sits on the
 * index tip (natural pointing). As the pinch closes it eases toward the
 * thumb–index midpoint, which is stable as the tips move together and matches
 * the ring drawn on the skeleton overlay.
 */
export function aimPoint(points: readonly Pt[], pinchOn: number, pinchOff?: number): Pt {
  const index = points[INDEX_TIP];
  const thumb = points[THUMB_TIP];
  if (!index && !thumb) return { x: 0.5, y: 0.5 };
  if (!index) return thumb;
  if (!thumb) return index;
  const t = pinchStrength(pinchGapRatio(points), pinchOn, pinchOff);
  return {
    x: index.x + ((thumb.x + index.x) / 2 - index.x) * t,
    y: index.y + ((thumb.y + index.y) / 2 - index.y) * t,
  };
}

/**
 * Feed one frame of up to two hands; emits select/drag events. Only one hand
 * may own a pinch (the first to pinch); the other hand's pinches are drawn but
 * ignored until the owner releases, so two hands never fight over a drag.
 */
export function createHandsProcessor(onEvent: (e: HandEvent) => void) {
  let pinchOn = DEFAULT_PINCH_ON;
  let pinchOff = DEFAULT_PINCH_OFF;
  let owner: number | null = null;
  let anyVisible = false;
  const slots: SlotState[] = [0, 1].map(() => ({
    pinching: false, tapCandidate: true, lastX: 0, lastY: 0, seen: false,
  }));

  function assignSlots(hands: HandInput[]): number[] {
    // Prefer the slot that last held this handedness label; else first free.
    const used = new Set<number>();
    const out: number[] = [];
    hands.forEach((h) => {
      let s = slots.findIndex((st, i) => !used.has(i) && h.label !== undefined && st.label === h.label);
      if (s < 0) s = slots.findIndex((st, i) => !used.has(i) && st.label === undefined);
      if (s < 0) s = slots.findIndex((_, i) => !used.has(i));
      used.add(s);
      out.push(s);
    });
    return out;
  }

  function release(slot: number, x?: number, y?: number): void {
    const st = slots[slot];
    if (!st.pinching) return;
    st.pinching = false;
    if (owner === slot) {
      if (st.tapCandidate && x !== undefined && y !== undefined) onEvent({ type: 'pinch-tap', x, y, hand: slot });
      onEvent({ type: 'pinch-end', hand: slot });
      owner = null;
    }
  }

  function process(hands: HandInput[]): HandFrame[] {
    const list = hands.slice(0, 2);
    const slotOf = assignSlots(list);
    const frames: HandFrame[] = [];
    const present = new Set(slotOf);

    // Hands that disappeared: end their pinch, but KEEP their handedness label
    // so a hand returning after a tracking dip (even when both hands drop out
    // together and MediaPipe re-reports them in a different array order) re-binds
    // to its original colour slot by label rather than by array position.
    slots.forEach((st, i) => {
      if (!present.has(i) && st.seen) {
        release(i);
        st.seen = false;
      }
    });

    list.forEach((h, idx) => {
      const slot = slotOf[idx];
      const st = slots[slot];
      st.seen = true;
      if (h.label !== undefined) st.label = h.label;
      const lm = h.landmarks;
      const ratio = pinchGapRatio(lm);
      const strength = pinchStrength(ratio, pinchOn, pinchOff);
      // Mirror x so the overlay matches a front-facing camera.
      const points = lm.map((p) => ({ x: 1 - p.x, y: p.y }));
      const aim = aimPoint(points, pinchOn, pinchOff);
      const x = aim.x;
      const y = aim.y;

      if (!st.pinching && ratio < pinchOn && !isFistPose(lm) && !isClosingToFist(lm)) {
        st.pinching = true;
        st.tapCandidate = true;
        st.lastX = x;
        st.lastY = y;
        if (owner === null) {
          owner = slot;
          onEvent({ type: 'pinch-start', x, y, hand: slot });
        }
      } else if (st.pinching && ratio > pinchOff) {
        release(slot, x, y);
      } else if (st.pinching) {
        const dx = x - st.lastX;
        const dy = y - st.lastY;
        if (Math.hypot(dx, dy) > TAP_MOVE_LIMIT) st.tapCandidate = false;
        st.lastX = x;
        st.lastY = y;
        if (owner === slot) onEvent({ type: 'pinch-move', x, y, dx, dy, hand: slot });
      } else if (owner === null || owner === slot) {
        onEvent({ type: 'tracking', x, y, hand: slot });
      }

      const colors = HAND_COLORS[slot];
      frames.push({
        slot,
        label: st.label,
        points,
        pinching: st.pinching,
        owner: owner === slot,
        pinchPoint: {
          x: (points[THUMB_TIP].x + points[INDEX_TIP].x) / 2,
          y: (points[THUMB_TIP].y + points[INDEX_TIP].y) / 2,
        },
        aim,
        pinchRatio: ratio,
        pinchStrength: strength,
        color: st.pinching ? colors.pinch : colors.idle,
      });
    });

    const visible = list.length > 0;
    if (!visible && anyVisible) onEvent({ type: 'lost' });
    anyVisible = visible;
    return frames;
  }

  return {
    process,
    setPinchThreshold(on: number, off: number) { pinchOn = on; pinchOff = off; },
    get pinchOn() { return pinchOn; },
    get pinchOff() { return pinchOff; },
    get owner() { return owner; },
  };
}
