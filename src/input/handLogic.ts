// Pure (MediaPipe-free, DOM-free) two-hand pinch logic + skeleton geometry.
// Kept separate from hands.ts so it can be unit-tested.

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

export const DEFAULT_PINCH_ON = 0.35;
export const DEFAULT_PINCH_OFF = 0.48;
export const TAP_MOVE_LIMIT = 0.03;

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
  /** All 21 points, mirrored to screen space (0..1). */
  points: Pt[];
  pinching: boolean;
  /** This hand owns the current drag. */
  owner: boolean;
  /** Midpoint of thumb + index tips (screen space). */
  pinchPoint: Pt;
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

    // Hands that disappeared: end their pinch and forget their label.
    slots.forEach((st, i) => {
      if (!present.has(i) && st.seen) {
        release(i);
        st.seen = false;
        st.label = undefined;
      }
    });

    list.forEach((h, idx) => {
      const slot = slotOf[idx];
      const st = slots[slot];
      st.seen = true;
      if (h.label !== undefined) st.label = h.label;
      const lm = h.landmarks;
      const handSize = dist(lm[WRIST], lm[MIDDLE_MCP]) || 1;
      const ratio = dist(lm[THUMB_TIP], lm[INDEX_TIP]) / handSize;
      // Mirror x so the overlay matches a front-facing camera.
      const points = lm.map((p) => ({ x: 1 - p.x, y: p.y }));
      const x = points[INDEX_TIP].x;
      const y = points[INDEX_TIP].y;

      if (!st.pinching && ratio < pinchOn) {
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
        points,
        pinching: st.pinching,
        owner: owner === slot,
        pinchPoint: {
          x: (points[THUMB_TIP].x + points[INDEX_TIP].x) / 2,
          y: (points[THUMB_TIP].y + points[INDEX_TIP].y) / 2,
        },
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
    get owner() { return owner; },
  };
}
