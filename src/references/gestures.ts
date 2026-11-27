// Gesture driver for the reference grid: hover snap, pinch or dwell to select,
// pinch-drag to place, open palm to close. Pure — takes synthetic landmarks.

import { DEFAULT_PINCH_ON, DEFAULT_PINCH_OFF, pinchGapRatio, type Pt } from '../input/handLogic';
import { snapHover } from './grid';
import type { GridBox } from './types';

// Re-export a local type import fix - I used a bad import. Will fix below if needed.

export type RefGestureEvent =
  | { type: 'hover'; id: string | null }
  | { type: 'select'; id: string }
  | { type: 'dwell-select'; id: string }
  | { type: 'drag-start'; id: string }
  | { type: 'drag-place'; id: string; x: number; y: number }
  | { type: 'confirm' }
  | { type: 'close' };

export interface RefGestureState {
  hoveredId: string | null;
  selectedId: string | null;
  pinching: boolean;
  pinchAt: { x: number; y: number } | null;
  moved: number;
  /** Pointer id the dwell clock is sitting on. */
  dwellId: string | null;
  dwellFrom: number;
  palmFrom: number | null;
  /** A web-search or place is waiting for an explicit pinch. */
  pendingConfirm: boolean;
}

export function emptyRefGestureState(): RefGestureState {
  return {
    hoveredId: null,
    selectedId: null,
    pinching: false,
    pinchAt: null,
    moved: 0,
    dwellId: null,
    dwellFrom: 0,
    palmFrom: null,
    pendingConfirm: false,
  };
}

export const DWELL_MS = 900;
export const PALM_HOLD_MS = 400;
export const TAP_MOVE_PX = 28;

const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20, wrist: 0, middleMcp: 9 };

export function isPinching(landmarks: readonly Pt[], on = DEFAULT_PINCH_ON): boolean {
  if (landmarks.length < 21) return false;
  return pinchGapRatio(landmarks) <= on;
}

export function stillPinching(landmarks: readonly Pt[], off = DEFAULT_PINCH_OFF): boolean {
  if (landmarks.length < 21) return false;
  return pinchGapRatio(landmarks) <= off;
}

/** All four fingers extended and the thumb not meeting the index — an open palm. */
export function isOpenPalm(landmarks: readonly Pt[]): boolean {
  if (landmarks.length < 21 || isPinching(landmarks)) return false;
  const w = landmarks[TIP.wrist];
  const mcp = landmarks[TIP.middleMcp];
  const hand = Math.hypot(w.x - mcp.x, w.y - mcp.y) || 0.2;
  const extended = [TIP.index, TIP.middle, TIP.ring, TIP.pinky].every((i) => {
    const tip = landmarks[i];
    return Math.hypot(tip.x - w.x, tip.y - w.y) > hand * 1.4;
  });
  return extended;
}

export function pinchPoint(landmarks: readonly Pt[]): { x: number; y: number } {
  const a = landmarks[TIP.thumb] ?? landmarks[TIP.index];
  const b = landmarks[TIP.index] ?? a;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export interface RefGestureInput {
  /** 21 landmarks in the same space as `pointer` (CSS pixels of the canvas). */
  landmarks: readonly Pt[] | null;
  pointer: { x: number; y: number };
  now: number;
  boxes: readonly GridBox[];
  snapRadius?: number;
}

/**
 * Advance the grid gesture state by one frame. `pointer` and landmark
 * coordinates are in canvas/container pixels.
 */
export function stepRefGestures(
  state: RefGestureState,
  input: RefGestureInput,
): { state: RefGestureState; events: RefGestureEvent[] } {
  const events: RefGestureEvent[] = [];
  const next: RefGestureState = { ...state, pinchAt: state.pinchAt ? { ...state.pinchAt } : null };
  const hover = snapHover(input.pointer.x, input.pointer.y, input.boxes, input.snapRadius ?? 36);
  if (hover !== state.hoveredId) {
    next.hoveredId = hover;
    events.push({ type: 'hover', id: hover });
  }

  const lm = input.landmarks;
  const palm = lm && isOpenPalm(lm);
  if (palm) {
    if (next.palmFrom === null) next.palmFrom = input.now;
    else if (input.now - next.palmFrom >= PALM_HOLD_MS) {
      events.push({ type: 'close' });
      next.palmFrom = input.now + 10_000; // do not re-fire until the palm drops
      return { state: next, events };
    }
  } else {
    next.palmFrom = null;
  }

  const down = lm ? (state.pinching ? stillPinching(lm) : isPinching(lm)) : false;
  if (down && !state.pinching) {
    next.pinching = true;
    next.pinchAt = { x: input.pointer.x, y: input.pointer.y };
    next.moved = 0;
    if (next.pendingConfirm) {
      events.push({ type: 'confirm' });
      next.pendingConfirm = false;
    }
  } else if (down && state.pinching && next.pinchAt) {
    const dx = input.pointer.x - next.pinchAt.x;
    const dy = input.pointer.y - next.pinchAt.y;
    next.moved = Math.hypot(dx, dy);
    if (next.moved > TAP_MOVE_PX) {
      const id = state.selectedId ?? state.hoveredId;
      if (id && !events.some((e) => e.type === 'drag-start')) {
        events.push({ type: 'drag-start', id });
      }
    }
  } else if (!down && state.pinching) {
    const id = state.selectedId ?? state.hoveredId ?? hover;
    if (next.moved > TAP_MOVE_PX && id) {
      events.push({ type: 'drag-place', id, x: input.pointer.x, y: input.pointer.y });
    } else if (id) {
      // First pinch selects; a second pinch on the already-selected card confirms.
      if (state.selectedId && state.selectedId === id) events.push({ type: 'confirm' });
      else events.push({ type: 'select', id });
      next.selectedId = id;
    }
    next.pinching = false;
    next.pinchAt = null;
    next.moved = 0;
  }

  // Dwell: hover the same card still for DWELL_MS → select (no pinch needed).
  if (!next.pinching && hover) {
    if (next.dwellId !== hover) {
      next.dwellId = hover;
      next.dwellFrom = input.now;
    } else if (input.now - next.dwellFrom >= DWELL_MS && state.selectedId !== hover) {
      events.push({ type: 'dwell-select', id: hover });
      next.selectedId = hover;
      next.dwellFrom = input.now + 10_000;
    }
  } else if (!hover) {
    next.dwellId = null;
  }

  return { state: next, events };
}
