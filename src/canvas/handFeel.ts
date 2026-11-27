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
  /** Active box: the central sub-rectangle of the camera frame (where the
   *  PALM CENTRE travels) that maps to the full screen, so every edge of the
   *  UI is reachable without the hand leaving the camera. The palm sits
   *  lower in the frame than a fingertip would, hence the box sits lower. */
  reach: { x0: number; x1: number; y0: number; y1: number };
  /** One-Euro params for the cursor, applied AFTER mapping to the screen
   *  (so minCutoff is Hz and beta is per screen-px/s). */
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
  /** A pinch must also stay closed this long (ms) before pinch-down. */
  engageMs: number;
  /** Consecutive frames above pinchOff before a pinch releases. */
  releaseFrames: number;
  /** After a click (pinch release), no new pinch can engage for this long. */
  refractoryMs: number;
  /** The click targets the cursor position from this long BEFORE the pinch
   *  began, so closing the fingers can't drag the point off a small button. */
  freezeLookbackMs: number;
  /** createStickyTarget (generic time-based hysteresis). The live hand
   *  pointer uses the magnet lock (magnetCapturePx / magnetReleasePx)
   *  instead — the two never run together. */
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
  /** Dwell-click: once a control (or a board's title) has captured the
   *  cursor, it clicks after this long locked on it — the only way to click
   *  in the live pipeline. Jitter inside the lock never restarts it. */
  dwellMs: number;
  /** Magnet: the cursor captures the nearest control within this many px of
   *  its rect (when it is not directly over one)… */
  magnetCapturePx: number;
  /** …and a captured (locked) control is only released once the cursor is
   *  more than this far from its rect, or lands directly on another control. */
  magnetReleasePx: number;
  /** After a dwell click, no new dwell can start for this long — and the
   *  cursor must leave the clicked control before it can re-arm. */
  clickCooldownMs: number;
  /** Dwell only accrues while the cursor is within this many px of the
   *  locked target's rect (it pauses, not resets, further out) — so easing
   *  away toward a neighbour never finishes the one being left. */
  dwellAccruePx: number;
  /** FIST TAP = click: a fist that closes and re-opens within this long
   *  (and moves less than fistMovePx) clicks the target under the palm. A
   *  fist closed longer than this — or moved further (unfiltered palm, px)
   *  — becomes a grab. */
  fistTapMs: number;
  fistMovePx: number;
  /** No second fist tap within this long of a tap click. */
  tapCooldownMs: number;
  /** A tap's fist must stay closed at least this long (ms from the first
   *  fist frame to the first open frame) — a 1–2 frame relaxed-hand
   *  flicker is never a click. */
  tapMinClosedMs: number;
  /** A tap only arms if the hand was not closed (geometrically) for this
   *  long right before it closed (tapAfterHoldOpenMs after a HELD fist —
   *  re-opening from a grab and closing again quickly is not a click)… */
  tapMinOpenBeforeMs: number;
  tapAfterHoldOpenMs: number;
  /** …the palm's average speed over the last 3 frames (px/ms, unfiltered)
   *  was below this as it closed, and the target had been locked at least
   *  tapMinLockMs. */
  tapMaxPalmSpeed: number;
  tapMinLockMs: number;
  /** Finger curl ratio (tip→wrist ÷ PIP→wrist; scale-free): below
   *  curlOn a finger is curled, above extendOn it is extended, in between
   *  it is neither — so a loose hand sits in the hysteresis band. */
  curlOn: number;
  extendOn: number;
  /** The index ALONE past this ratio counts as open (a point); a lone
   *  middle/ring/pinky never does — that is usually tracker noise. */
  indexOpenOn: number;
  /** 3D PIP bend (degrees, angle between MCP→PIP and PIP→TIP) used when
   *  landmarks carry z: above curlDeg = curled, below extendDeg = extended.
   *  Robust to fingers pointing at the camera, where the 2D ratio collapses. */
  curlDeg: number;
  extendDeg: number;
  /** Camera frame height ÷ width, to un-squash normalised y for 3D angles. */
  cameraAspect: number;
  /** While grabbing, a half-relaxed ('between') hand held this long counts
   *  as open — the board drops instead of sticking to a loosened hand. */
  grabLooseOpenMs: number;
  /** Consecutive geometric-closed frames before a hand counts as closed (no time wait). */
  fistCloseFrames: number;
  /** Consecutive non-fist frames before a (non-grabbing) fist counts as open. */
  fistOpenFrames: number;
  /** While a grab runs, the fist only opens after this long AND
   *  releaseGraceFrames consecutive non-fist frames — a loose fist flickering
   *  to 'none'/'pinch' for a frame or two never drops the board. */
  releaseGraceMs: number;
  releaseGraceFrames: number;
}

// ---- frame counts are times (review sim-2 §6) ----
// The camera loop now runs once per NEW camera picture (input/frameGate.ts).
// The *Frames thresholds above were tuned when every display frame ran a
// detection, so they meant "this many 60 Hz frames". Counted in distinct
// pictures they doubled the wait at 30 fps (a pinch took ~100 ms, not ~50).
// The ENGAGE thresholds (pinch engageFrames, fistCloseFrames) are now read as
// that much TIME — (N − 1) × 1000/60 ms of the state being held — with half a
// camera frame of slack, since a state can only be seen when a picture
// arrives: the engage latency is the old feel at 30, 60 and 120 Hz. The
// release / open counts stay counts of distinct pictures: they are the
// debounce against a bad detection, and one picture counted twice never was.

/** The hold a frame-count threshold stands for: N frames at 60 Hz. */
export const framesToMs = (frames: number): number => Math.max(0, frames - 1) * (1000 / 60);

/** Has a state seen since `since` been held `ms` by `now`? Half a camera
 *  frame (`periodMs`) of slack: the next picture would be later still. */
export function heldFor(since: number, now: number, ms: number, periodMs: number): boolean {
  return since >= 0 && now - since >= ms - periodMs / 2;
}

/** The camera's frame interval, measured from the pictures themselves
 *  (smoothed, 4–50 ms; 30 fps until two pictures have been seen). */
export interface FramePeriod { tick(now: number): number; readonly ms: number; reset(): void }
export function createFramePeriod(initialMs = 1000 / 30): FramePeriod {
  let ms = initialMs;
  let last = Number.NaN;
  return {
    tick(now) {
      if (Number.isFinite(last) && now > last) ms = ms * 0.7 + Math.min(50, Math.max(4, now - last)) * 0.3;
      last = now;
      return ms;
    },
    get ms() { return ms; },
    reset() { last = Number.NaN; },
  };
}

export const HAND_FEEL: HandFeelConfig = {
  reach: { x0: 0.2, x1: 0.8, y0: 0.3, y1: 0.85 },
  cursorFilter: { minCutoff: 1.0, beta: 0.01, dCutoff: 1.0 },
  pinchFilter: { minCutoff: 2.5, beta: 8, dCutoff: 1 },
  deadZonePx: 3,
  pinchOn: 0.20,
  pinchOff: 0.30,
  engageFrames: 3,
  engageMs: 80,
  releaseFrames: 2,
  refractoryMs: 500,
  freezeLookbackMs: 100,
  stickyMs: 120,
  stickyMarginPx: 14,
  minHandScale: 0.07,
  palmHoldMs: 600,
  palmRefractoryMs: 1500,
  keepFrames: 3,
  dwellMs: 800,
  magnetCapturePx: 40,
  magnetReleasePx: 60,
  clickCooldownMs: 600,
  dwellAccruePx: 20,
  fistTapMs: 300,
  fistMovePx: 20,
  tapCooldownMs: 400,
  fistCloseFrames: 2,
  fistOpenFrames: 3,
  tapMinClosedMs: 60,
  tapMinOpenBeforeMs: 150,
  tapAfterHoldOpenMs: 250,
  tapMaxPalmSpeed: 0.8,
  tapMinLockMs: 100,
  curlOn: 1.0,
  extendOn: 1.15,
  indexOpenOn: 1.25,
  curlDeg: 90,
  extendDeg: 35,
  cameraAspect: 9 / 16,
  grabLooseOpenMs: 400,
  releaseGraceMs: 120,
  releaseGraceFrames: 3,
};

// ---------------------------------------------------------------- phone profile

/** Reach box shape (normalised camera units), as in HandFeelConfig.reach. */
export type ReachBox = HandFeelConfig['reach'];

/**
 * PHONE HAND FEEL: the phone shell (iPhone / Android app, portrait) drives
 * the same pointer pipeline from the FRONT camera. Everything not listed
 * here is the laptop HAND_FEEL (tap, grab, curl, filters).
 *
 * Geometry it is tuned for: the phone held or propped 30–40 cm from the
 * user, in portrait. A front camera's frame in portrait spans roughly
 * 60–65° across the short side and 75–80° along the long side, so at
 * ~35 cm the frame covers about 42 cm (x) × 55 cm (y) of space in front of
 * the user. The face sits in the upper half of that frame and the hands
 * come up in front of the chest, so the box sits lower than the laptop's.
 *
 *  - At that distance a palm (wrist → knuckles ≈ 10 cm) is ~0.18 of the
 *    frame's height, so the wrist sits ~0.15 below the palm centre. The
 *    camera-edge guard (CAMERA_EDGE_EPS 0.06) treats a wrist past 0.94 as
 *    clipped, so the palm centre must stay above ~0.79.
 *  - reachPortrait x 0.22–0.78 → ~23 cm of hand travel across 390 px
 *    (~17 px/cm); y 0.28–0.78 → ~27 cm along 844 px (~31 px/cm). The
 *    screen is 2.2× taller than wide; the hand travels a little further
 *    vertically than across — a compromise between equal px/cm and an arm
 *    at full stretch. The bottom (0.78) keeps the wrist inside the frame;
 *    the top (0.28) is about chin height, so the bottom pills and mic are
 *    reached with the hand in front of the chest.
 *  - reachLandscape: a webview that delivers a landscape frame while the
 *    phone is upright (some Android cameras): the frame is ~55 × 42 cm, the
 *    palm a larger share of its height — narrower x (0.30–0.70 ≈ 22 cm),
 *    y 0.22–0.72 so the wrist still stays inside.
 *  - magnetCapturePx 48: phone controls are physically small and the
 *    cursor moves more px per cm than on a laptop, so the magnet reaches
 *    further (release keeps the laptop's +20 px hysteresis → 68).
 *  - Tracking rate: ~30 fps (activeIntervalMs 33, never above the camera's
 *    own 30 fps) while a hand was seen in the last idleAfterMs; 10 fps
 *    (idleIntervalMs 100) once no hand has been seen for 2 s — still quick
 *    enough to notice a raised hand within ~100 ms.
 *  - Dwell (hover-to-click) stays opt-in, as on the laptop: the fist tap is
 *    the click.
 *
 * Starting numbers from geometry, not from the real phones — verify on an
 * iPhone 16 Pro Max and a Nothing Phone 3a.
 */
export const PHONE_HAND_FEEL = {
  reachPortrait: { x0: 0.22, x1: 0.78, y0: 0.28, y1: 0.78 } as ReachBox,
  reachLandscape: { x0: 0.3, x1: 0.7, y0: 0.22, y1: 0.72 } as ReachBox,
  magnetCapturePx: 48,
  magnetReleasePx: 68,
  activeIntervalMs: 33,
  idleIntervalMs: 100,
  idleAfterMs: 2000,
  /** Front-camera frames arrive un-mirrored; the selfie view is mirrored. */
  mirror: true,
} as const;

/** The phone reach box for the camera frame's aspect (height ÷ width): a
 *  portrait frame uses reachPortrait, a landscape one (< 1) reachLandscape.
 *  Unknown aspect assumes portrait — the phone shell is portrait. */
export function phoneReach(aspect: number | null | undefined): ReachBox {
  if (typeof aspect === 'number' && aspect > 0 && aspect < 1) return PHONE_HAND_FEEL.reachLandscape;
  return PHONE_HAND_FEEL.reachPortrait;
}

/** Phone tracking interval (ms): the full rate while a hand was seen within
 *  idleAfterMs, the idle rate otherwise (and always with no hand use). */
export function phoneTrackIntervalMs(now: number, lastHandAt: number, handsWanted = true): number {
  if (!handsWanted) return PHONE_HAND_FEEL.idleIntervalMs;
  return now - lastHandAt <= PHONE_HAND_FEEL.idleAfterMs ? PHONE_HAND_FEEL.activeIntervalMs : PHONE_HAND_FEEL.idleIntervalMs;
}

// ---------------------------------------------------------------- curl

/** [MCP, PIP, TIP] for index, middle, ring, pinky. The thumb is ignored: a
 *  natural quick fist often leaves it out (thumbs-up / pinch labels). */
const FINGER_JOINTS = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]] as const;

type Pt3 = Pt & { z?: number };

/** Per finger: 'curled' | 'extended' | 'mid', plus whether it is STRONGLY
 *  extended (used for a lone index). 3D PIP bend when z is present (2D
 *  ratio as fallback). */
export function fingerStates(
  lm: readonly Pt3[],
  cfg: Pick<HandFeelConfig, 'curlOn' | 'extendOn' | 'indexOpenOn' | 'curlDeg' | 'extendDeg' | 'cameraAspect'> = HAND_FEEL,
): { state: 'curled' | 'extended' | 'mid'; strong: boolean }[] {
  const w = lm[0];
  const has3d = FINGER_JOINTS.every(([m, p, t]) => typeof lm[m].z === 'number' && typeof lm[p].z === 'number' && typeof lm[t].z === 'number')
    && FINGER_JOINTS.some(([m, p, t]) => lm[m].z !== 0 || lm[p].z !== 0 || lm[t].z !== 0);
  const k = cfg.cameraAspect;
  return FINGER_JOINTS.map(([mcp, pip, tip]) => {
    if (has3d) {
      const a = { x: lm[pip].x - lm[mcp].x, y: (lm[pip].y - lm[mcp].y) * k, z: (lm[pip].z ?? 0) - (lm[mcp].z ?? 0) };
      const b = { x: lm[tip].x - lm[pip].x, y: (lm[tip].y - lm[pip].y) * k, z: (lm[tip].z ?? 0) - (lm[pip].z ?? 0) };
      const na = Math.hypot(a.x, a.y, a.z), nb = Math.hypot(b.x, b.y, b.z);
      const cos = na && nb ? (a.x * b.x + a.y * b.y + a.z * b.z) / (na * nb) : 1;
      const deg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      const state = deg > cfg.curlDeg ? 'curled' : deg < cfg.extendDeg ? 'extended' : 'mid';
      return { state, strong: state === 'extended' };
    }
    const d = (p: Pt) => Math.hypot(p.x - w.x, p.y - w.y);
    const r = d(lm[tip]) / Math.max(1e-6, d(lm[pip]));
    const state = r < cfg.curlOn ? 'curled' : r > cfg.extendOn ? 'extended' : 'mid';
    return { state, strong: r > cfg.indexOpenOn };
  });
}

/** Geometric hand state from finger curl alone (no classifier label):
 *  'closed' = all four fingers curled; 'open' = two or more fingers
 *  extended, or the INDEX alone strongly extended (a point) — a lone
 *  middle/ring/pinky never opens a fist (tracker noise); 'between' =
 *  neither (a loose, half-curled hand) — callers keep their previous state. */
export function curlState(lm: readonly Pt3[], cfg: Parameters<typeof fingerStates>[1] = HAND_FEEL): 'closed' | 'open' | 'between' {
  if (!lm || lm.length < 21) return 'between';
  const f = fingerStates(lm, cfg);
  const curled = f.filter((x) => x.state === 'curled').length;
  const extended = f.filter((x) => x.state === 'extended').length;
  if (curled === 4) return 'closed';
  if (extended >= 2 || (f[0].state === 'extended' && f[0].strong)) return 'open';
  return 'between';
}

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

/** Up to `max` foreground hands, largest first, ignoring background-small ones. */
export function pickForegroundHands<T extends readonly Pt[]>(
  hands: readonly T[],
  max = 2,
  minScale = HAND_FEEL.minHandScale,
): T[] {
  const scored: { h: T; s: number }[] = [];
  for (const h of hands) {
    if (!h || h.length < 21) continue;
    const s = handScale(h);
    if (s < minScale) continue;
    scored.push({ h, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, Math.max(0, max)).map((x) => x.h);
}

/** Stable slot assignment for two cursors. Hands stay on the slot whose
 *  previous index-tip (landmark 8) they are nearest; leftover hands fill
 *  empty slots (smaller tip-x first). Never swaps two tracked hands. */
export function assignHandSlots<T extends readonly Pt[]>(
  hands: readonly T[],
  prevTips: readonly (Pt | null)[],
): (T | null)[] {
  const slots: (T | null)[] = prevTips.map(() => null);
  const usedHands = new Set<number>();
  const usedSlots = new Set<number>();
  const tip = (h: T): Pt => h[8] ?? h[0] ?? { x: 0, y: 0 };
  const pairs: { hi: number; si: number; d: number }[] = [];
  for (let hi = 0; hi < hands.length; hi++) {
    const t0 = tip(hands[hi]);
    for (let si = 0; si < prevTips.length; si++) {
      const p = prevTips[si];
      if (!p) continue;
      pairs.push({ hi, si, d: Math.hypot(t0.x - p.x, t0.y - p.y) });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  for (const p of pairs) {
    if (usedHands.has(p.hi) || usedSlots.has(p.si)) continue;
    slots[p.si] = hands[p.hi];
    usedHands.add(p.hi);
    usedSlots.add(p.si);
  }
  const leftover = hands
    .map((h, hi) => ({ h, hi }))
    .filter((x) => !usedHands.has(x.hi))
    .sort((a, b) => tip(a.h).x - tip(b.h).x);
  for (const item of leftover) {
    const si = slots.findIndex((_, i) => !usedSlots.has(i));
    if (si < 0) break;
    slots[si] = item.h;
    usedSlots.add(si);
  }
  return slots;
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
  update(ratio: number, now: number, on?: number, off?: number): PinchFrame;
  readonly pinched: boolean;
  reset(): void;
}

/**
 * Debounced pinch with hysteresis + refractory: engages only after
 * engageFrames consecutive closed frames AND at least engageMs of continuous
 * close (a 1–2 frame tracking dip can never click), releases after
 * releaseFrames above pinchOff, and refuses to re-engage for refractoryMs
 * after a release (one pinch = one click). A gap longer than engageMs
 * between closed frames restarts the hold.
 */
export function createPinchMachine(cfg: HandFeelConfig = HAND_FEEL): PinchMachine {
  let pinched = false;
  let below = 0;
  let above = 0;
  let belowSince = -1;
  let lastBelowAt = -Infinity;
  let lastClickAt = -Infinity;
  const engageMs = cfg.engageMs ?? 80;
  const gapMs = engageMs;
  // engageFrames is a time (framesToMs, see heldFor above). releaseFrames
  // stays a count of pictures: it is the debounce against one bad detection.
  const engageHold = Math.max(engageMs, framesToMs(cfg.engageFrames));
  const period = createFramePeriod();

  return {
    update(ratio, now, on = cfg.pinchOn, off = cfg.pinchOff) {
      let justDown = false;
      let justUp = false;
      const p = period.tick(now);
      if (!pinched) {
        if (ratio < on) {
          if (belowSince < 0 || now - lastBelowAt > gapMs) {
            below = 0;
            belowSince = now;
          }
          below += 1;
          lastBelowAt = now;
        } else {
          below = 0;
          belowSince = -1;
        }
        // A hold of ~engageMs (at least two pictures: one never decides).
        if (
          below >= 2
          && heldFor(belowSince, now, engageHold, p)
          && now - lastClickAt >= cfg.refractoryMs
        ) {
          pinched = true; justDown = true; below = 0; belowSince = -1; above = 0;
        }
      } else {
        above = ratio > off ? above + 1 : 0;
        if (above >= cfg.releaseFrames) {
          pinched = false; justUp = true; above = 0; below = 0; belowSince = -1; lastClickAt = now;
        }
      }
      return { pinched, justDown, justUp };
    },
    get pinched() { return pinched; },
    reset() { pinched = false; below = 0; above = 0; belowSince = -1; lastBelowAt = -Infinity; lastClickAt = -Infinity; period.reset(); },
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
