// HAND FEEL: every tunable that decides how camera hands translate into
// pointer motion and clicks, in one place, as pure state machines — so the
// "too sensitive" class of bug (hover activating things, pinch dragging the
// cursor off a button, panels flickering open) is unit-testable without a
// camera.
//
// Technique notes (concepts borrowed, no code): GestureHud / gesture-mouse-
// control (1-Euro on the pinch distance as well as the position, hysteresis on
// every gesture, cursor freeze on pinch, central camera-to-screen mapping,
// anti-background-hand filter), slastra/pointer (a gesture latches only after
// N stable frames), hand-tracking-with-controls (palm-centre anchor from
// landmarks 0/5/9/13/17, click lands at the pre-pinch position). The original
// Mendcraft M1 tracker (409c27b) also pinched at 0.35/0.48 — deliberate, not
// hair-trigger — which is why these thresholds are tighter than the 0.50/0.64
// the presence processor drifted to.

import type { Pt } from '../input/handLogic';

/** Wrist + the four finger MCPs — the rigid part of the hand. */
const PALM_LANDMARKS = [0, 5, 9, 13, 17] as const;
const INDEX_MCP_FEEL_ANCHOR = 5;

export interface HandFeelConfig {
  /** Central sub-rectangle of the camera frame that maps to the full screen,
   *  so the top toolbar and edges are reachable without leaving the frame. */
  reach: { x0: number; x1: number; y0: number; y1: number };
  /** One-Euro params for the cursor anchor (screen-space position). */
  cursorFilter: { minCutoff: number; beta: number; dCutoff: number };
  /** One-Euro-style smoothing on the pinch ratio itself (1D). */
  pinchFilter: { minCutoff: number; beta: number; dCutoff: number };
  /** Micro-jitter dead zone (px): moves smaller than this don't move the cursor. */
  deadZonePx: number;
  /** Scale-normalised thumb↔index engage threshold (gap ÷ hand size). */
  pinchOn: number;
  /** Release threshold — looser than engage so the edge never chatters. */
  pinchOff: number;
  /** Consecutive frames below pinchOn before a pinch engages. */
  engageFrames: number;
  /** Consecutive frames above pinchOff before a pinch releases. */
  releaseFrames: number;
  /** After a click (pinch release), no new pinch can engage for this long. */
  refractoryMs: number;
  /** The click targets the cursor position from this long BEFORE the pinch
   *  began, so closing the fingers can't drag the point off a small button. */
  freezeLookbackMs: number;
  /** A hovered control stays the target until the pointer has been outside
   *  it (by stickyMarginPx) for at least this long. */
  stickyMs: number;
  stickyMarginPx: number;
  /** Hands smaller than this (wrist→middle-MCP, camera units) are someone in
   *  the background — ignored entirely. */
  minHandScale: number;
  /** An open palm must be HELD this long to toggle the tools panel… */
  palmHoldMs: number;
  /** …and can't toggle it again for this long after. */
  palmRefractoryMs: number;
  /** Consecutive pinch-pose frames before "keep" fires on empty canvas. */
  keepFrames: number;
}

export const HAND_FEEL: HandFeelConfig = {
  reach: { x0: 0.12, x1: 0.88, y0: 0.12, y1: 0.88 },
  cursorFilter: { minCutoff: 0.9, beta: 5, dCutoff: 1 },
  pinchFilter: { minCutoff: 2.5, beta: 8, dCutoff: 1 },
  deadZonePx: 2.5,
  pinchOn: 0.38,
  pinchOff: 0.52,
  engageFrames: 3,
  releaseFrames: 2,
  refractoryMs: 500,
  freezeLookbackMs: 100,
  stickyMs: 120,
  stickyMarginPx: 14,
  minHandScale: 0.07,
  palmHoldMs: 600,
  palmRefractoryMs: 1500,
  keepFrames: 3,
};

// ---------------------------------------------------------------- anchor

/** Palm centre: mean of wrist + the four finger MCPs (landmarks 0,5,9,13,17).
 *  Stable while the fingers move — unlike the fingertip, which jumps the
 *  moment you pinch. */
export function palmCenter(lm: readonly Pt[]): Pt {
  let x = 0, y = 0;
  for (const i of PALM_LANDMARKS) { x += lm[i].x; y += lm[i].y; }
  return { x: x / PALM_LANDMARKS.length, y: y / PALM_LANDMARKS.length };
}

/** Cursor anchor: index-MCP / palm-centre blend. Pointing still feels like
 *  pointing (the index knuckle leads), but closing the fingers to pinch moves
 *  the anchor almost nothing. */
export function cursorAnchor(lm: readonly Pt[]): Pt {
  const mcp = lm[INDEX_MCP_FEEL_ANCHOR];
  const palm = palmCenter(lm);
  return { x: (mcp.x + palm.x) / 2, y: (mcp.y + palm.y) / 2 };
}

/** Hand scale = wrist→middle-MCP distance (same measure the pinch ratio is
 *  normalised by). Below cfg.minHandScale the hand is in the background. */
export function handScale(lm: readonly Pt[]): number {
  return Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y);
}

/** Pick the hand that should drive the cursor: the LARGEST hand on screen,
 *  ignoring background-small hands entirely. */
export function pickPrimaryHand<T extends readonly Pt[]>(
  hands: readonly T[],
  minScale = HAND_FEEL.minHandScale,
): T | null {
  let best: T | null = null;
  let bestScale = 0;
  for (const h of hands) {
    if (!h || h.length < 21) continue;
    const s = handScale(h);
    if (s < minScale) continue;
    if (s > bestScale) { best = h; bestScale = s; }
  }
  return best;
}

// ---------------------------------------------------------------- dead zone

export interface DeadZone {
  apply(p: Pt): Pt;
  reset(): void;
}

export function createDeadZone(px = HAND_FEEL.deadZonePx): DeadZone {
  let last: Pt | null = null;
  return {
    apply(p) {
      if (last === null || Math.hypot(p.x - last.x, p.y - last.y) >= px) {
        last = { x: p.x, y: p.y };
      }
      return last;
    },
    reset() { last = null; },
  };
}

// ---------------------------------------------------------------- pinch FSM

export interface PinchFrame {
  pinched: boolean;
  justDown: boolean;
  justUp: boolean;
}

export interface PinchMachine {
  update(ratio: number, now: number): PinchFrame;
  readonly pinched: boolean;
  reset(): void;
}

/**
 * Debounced pinch with hysteresis + refractory: engages only after
 * engageFrames consecutive frames below pinchOn (a 1–2 frame tracking dip can
 * never click), releases after releaseFrames above pinchOff, and refuses to
 * re-engage for refractoryMs after a release (one pinch = one click).
 */
export function createPinchMachine(cfg: HandFeelConfig = HAND_FEEL): PinchMachine {
  let pinched = false;
  let below = 0;
  let above = 0;
  let lastClickAt = -Infinity;

  return {
    update(ratio, now) {
      let justDown = false;
      let justUp = false;
      if (!pinched) {
        below = ratio < cfg.pinchOn ? below + 1 : 0;
        if (below >= cfg.engageFrames && now - lastClickAt >= cfg.refractoryMs) {
          pinched = true; justDown = true; below = 0; above = 0;
        }
      } else {
        above = ratio > cfg.pinchOff ? above + 1 : 0;
        if (above >= cfg.releaseFrames) {
          pinched = false; justUp = true; above = 0; below = 0; lastClickAt = now;
        }
      }
      return { pinched, justDown, justUp };
    },
    get pinched() { return pinched; },
    reset() { pinched = false; below = 0; above = 0; lastClickAt = -Infinity; },
  };
}

// ---------------------------------------------------------------- history

export interface PositionHistory {
  push(p: Pt, now: number): void;
  /** Position at (or just before) the given time; oldest kept if too far back. */
  at(time: number): Pt | null;
  reset(): void;
}

/** Short ring buffer of cursor positions so a pinch can aim at where the hand
 *  was BEFORE the fingers started closing. */
export function createPositionHistory(keepMs = 400): PositionHistory {
  const buf: { p: Pt; t: number }[] = [];
  return {
    push(p, now) {
      buf.push({ p: { x: p.x, y: p.y }, t: now });
      while (buf.length > 1 && now - buf[0].t > keepMs) buf.shift();
    },
    at(time) {
      if (buf.length === 0) return null;
      let best = buf[0].p;
      for (const e of buf) {
        if (e.t <= time) best = e.p; else break;
      }
      return best;
    },
    reset() { buf.length = 0; },
  };
}

// ---------------------------------------------------------------- sticky target

export interface RectLike { left: number; top: number; width: number; height: number }

export interface StickyTarget<T> {
  /** Feed the freshly resolved candidate; returns the target to actually use. */
  update(candidate: T | null, pointer: Pt, now: number): T | null;
  readonly current: T | null;
  reset(): void;
}

/**
 * Target hysteresis: once a control is the target it stays the target until
 * the pointer has been outside its rect (plus a margin) for stickyMs — so the
 * highlight can't flicker between neighbours on a jittery hold.
 */
export function createStickyTarget<T>(
  rectOf: (t: T) => RectLike | null,
  cfg: Pick<HandFeelConfig, 'stickyMs' | 'stickyMarginPx'> = HAND_FEEL,
): StickyTarget<T> {
  let current: T | null = null;
  let outsideSince: number | null = null;

  function distToRect(p: Pt, r: RectLike): number {
    const dx = Math.max(r.left - p.x, 0, p.x - (r.left + r.width));
    const dy = Math.max(r.top - p.y, 0, p.y - (r.top + r.height));
    return Math.hypot(dx, dy);
  }

  return {
    update(candidate, pointer, now) {
      if (current === null || candidate === current) {
        current = candidate;
        outsideSince = null;
        return current;
      }
      const r = rectOf(current);
      if (r && distToRect(pointer, r) <= cfg.stickyMarginPx) {
        outsideSince = null;
        return current; // still (nearly) on it: keep it
      }
      if (outsideSince === null) { outsideSince = now; return current; }
      if (now - outsideSince >= cfg.stickyMs) { current = candidate; outsideSince = null; }
      return current;
    },
    get current() { return current; },
    reset() { current = null; outsideSince = null; },
  };
}

// ---------------------------------------------------------------- hold gesture

export interface HoldGesture {
  /** Feed whether the pose is active this frame; true exactly when it fires. */
  update(active: boolean, now: number): boolean;
  reset(): void;
}

/** A pose (open palm) must be HELD continuously for holdMs to fire once, then
 *  cannot fire again for refractoryMs — a wave past the camera does nothing. */
export function createHoldGesture(
  holdMs = HAND_FEEL.palmHoldMs,
  refractoryMs = HAND_FEEL.palmRefractoryMs,
): HoldGesture {
  let since: number | null = null;
  let firedAt = -Infinity;
  return {
    update(active, now) {
      if (!active) { since = null; return false; }
      if (since === null) since = now;
      if (now - since >= holdMs && now - firedAt >= refractoryMs) {
        firedAt = now;
        since = null; // require a fresh hold for the next fire
        return true;
      }
      return false;
    },
    reset() { since = null; firedAt = -Infinity; },
  };
}

/** Minimum gap between Tools-panel toggles so one pinch or click cannot
 *  flicker the panel open and shut (chip click + palm, or pinch chatter). */
export const TOOLS_TOGGLE_GAP_MS = 450;

export interface ToggleLatch {
  /** True when this call should run the toggle; false if it's too soon. */
  allow(now?: number): boolean;
  reset(): void;
}

export function createToggleLatch(gapMs = TOOLS_TOGGLE_GAP_MS): ToggleLatch {
  let last = -Infinity;
  return {
    allow(now) {
      const t = now ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (t - last < gapMs) return false;
      last = t;
      return true;
    },
    reset() { last = -Infinity; },
  };
}

// ---------------------------------------------------------------- 1D euro

export interface Scalar1Euro {
  filter(v: number, nowMs: number): number;
  reset(): void;
}

/** One-Euro for a scalar (the pinch ratio): smooths single-frame spikes
 *  without lagging a deliberate close. */
export function createScalarEuro(
  params: { minCutoff: number; beta: number; dCutoff: number } = HAND_FEEL.pinchFilter,
): Scalar1Euro {
  let prev: number | null = null;
  let dPrev = 0;
  let lastT: number | null = null;

  const alpha = (cutoff: number, dt: number): number => {
    const tau = 1 / (2 * Math.PI * Math.max(1e-6, cutoff));
    return 1 / (1 + tau / Math.max(1e-6, dt));
  };

  return {
    filter(v, nowMs) {
      let dt = lastT === null ? 1 / 60 : (nowMs - lastT) / 1000;
      if (dt <= 0 || dt > 0.5) dt = 1 / 60;
      lastT = nowMs;
      if (prev === null) { prev = v; return v; }
      const dx = (v - prev) / dt;
      dPrev = dPrev + alpha(params.dCutoff, dt) * (dx - dPrev);
      const cutoff = params.minCutoff + params.beta * Math.abs(dPrev);
      prev = prev + alpha(cutoff, dt) * (v - prev);
      return prev;
    },
    reset() { prev = null; dPrev = 0; lastT = null; },
  };
}
