// Screen arrangement + cross-device edge intent — PURE geometry, no DOM. Akash
// puts the Nothing phone to the LEFT of the laptop and the iPhone to the RIGHT;
// this module decides which viewport edge means which phone, how strong the edge
// glow is as a tile nears it, and (with a small dwell/tremor guard) when a drag
// has actually committed to a transfer. The phone side mirrors it: a tile
// dragged off a phone's INNER edge returns to the laptop (or, pushed further, to
// the other phone).

export type Side = 'left' | 'right';
export type PhonePlatform = 'android' | 'ios';

/** Which phone (if any) sits on each side of the laptop. Either side may be
 *  empty; the same phone is never on both sides. */
export interface ScreenLayout {
  left: PhonePlatform | null;
  right: PhonePlatform | null;
}

export const EMPTY_LAYOUT: ScreenLayout = { left: null, right: null };

/** Default suggestion when a slot is empty: Android→left, iPhone→right. Only
 *  fills a side that is currently empty, so a manual swap is never overwritten. */
export function defaultLayout(
  present: { android?: boolean; ios?: boolean },
  base: ScreenLayout = EMPTY_LAYOUT,
): ScreenLayout {
  const out: ScreenLayout = { left: base.left, right: base.right };
  const has = (p: PhonePlatform): boolean => out.left === p || out.right === p;
  if (present.android && !has('android')) {
    if (out.left === null) out.left = 'android';
    else if (out.right === null) out.right = 'android';
  }
  if (present.ios && !has('ios')) {
    if (out.right === null) out.right = 'ios';
    else if (out.left === null) out.left = 'ios';
  }
  return out;
}

/** Put a platform on a side, clearing it from the opposite side (one phone, one
 *  place). Passing null clears that side only. */
export function assignSide(
  layout: ScreenLayout,
  side: Side,
  platform: PhonePlatform | null,
): ScreenLayout {
  const other: Side = side === 'left' ? 'right' : 'left';
  const out: ScreenLayout = { left: layout.left, right: layout.right };
  out[side] = platform;
  if (platform && out[other] === platform) out[other] = null;
  return out;
}

/** Defensive coerce of an untrusted layout off the wire. */
export function coerceLayout(raw: unknown): ScreenLayout {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_LAYOUT };
  const o = raw as Record<string, unknown>;
  const one = (v: unknown): PhonePlatform | null => (v === 'android' || v === 'ios' ? v : null);
  const left = one(o.left);
  let right = one(o.right);
  if (left && right === left) right = null; // same phone can't be on both sides
  return { left, right };
}

export function sideFor(layout: ScreenLayout, platform: PhonePlatform): Side | null {
  if (layout.left === platform) return 'left';
  if (layout.right === platform) return 'right';
  return null;
}

// ---- laptop-side edge intent ------------------------------------------------

export interface EdgeTuning {
  /** Pointer-engage slop reused from editBoard (~6px): below this, no glow. */
  slopPx?: number;
  /** Width of the glow/dwell zone measured inward from the viewport edge. */
  zonePx?: number;
  /** How far PAST the viewport edge counts as a deliberate push (instant commit). */
  commitPastPx?: number;
}

const DEFAULTS: Required<EdgeTuning> = { slopPx: 6, zonePx: 56, commitPastPx: 24 };

export interface EdgeIntent {
  /** The edge the pointer is near, but only if a phone is paired on that side. */
  side: Side | null;
  /** The phone platform on that side (null when `side` is null). */
  target: PhonePlatform | null;
  /** True while inside the glow/dwell zone of a paired edge. */
  inZone: boolean;
  /** 0 outside the zone → 1 at/over the viewport edge. */
  glow: number;
  /** True once the pointer is CLEARLY past the edge (deliberate push). */
  pastThreshold: boolean;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Where a laptop-viewport pointer sits relative to a paired phone's edge.
 * `side` is only set when a phone is actually on that side — no glow toward an
 * empty edge. Glow ramps across the zone; `pastThreshold` fires only well past
 * the edge so a tremor that grazes the boundary never looks committed.
 */
export function edgeIntent(
  clientX: number,
  viewportWidth: number,
  layout: ScreenLayout,
  tuning: EdgeTuning = {},
): EdgeIntent {
  const { zonePx, commitPastPx } = { ...DEFAULTS, ...tuning };
  const none: EdgeIntent = { side: null, target: null, inZone: false, glow: 0, pastThreshold: false };
  if (!(viewportWidth > 0)) return none;

  // Distance inward from each edge (negative once past the edge).
  const fromLeft = clientX;
  const fromRight = viewportWidth - clientX;

  const consider = (side: Side, dist: number): EdgeIntent | null => {
    const target = layout[side];
    if (!target) return null; // no phone there → no pull
    if (dist > zonePx) return null; // not near this edge yet
    const glow = clamp01((zonePx - dist) / zonePx);
    const pastThreshold = dist < -commitPastPx;
    return { side, target, inZone: dist <= zonePx, glow, pastThreshold };
  };

  // Pick the nearer edge; ties (narrow viewport) prefer whichever is closer.
  const left = consider('left', fromLeft);
  const right = consider('right', fromRight);
  if (left && right) return fromLeft <= fromRight ? left : right;
  return left ?? right ?? none;
}

// ---- dwell / tremor guard ---------------------------------------------------

/** Rolling state for the dwell guard — carry it across pointer-move samples. */
export interface DwellState {
  side: Side | null;
  enteredAt: number | null;
}

export const INITIAL_DWELL: DwellState = { side: null, enteredAt: null };

export interface DwellResult {
  state: DwellState;
  /** True on the sample where the transfer should commit (edge-triggered once). */
  commit: boolean;
}

/**
 * Debounce a committed transfer so a brief jitter past the edge does nothing.
 * Commits when the pointer either (a) stays in the SAME paired edge zone for
 * `dwellMs`, or (b) is pushed clearly past that edge. Leaving the zone (even for
 * one tremor sample) resets the dwell clock, so a shake across the boundary
 * never accumulates enough time to fire.
 */
export function evaluateDwell(
  prev: DwellState,
  intent: EdgeIntent,
  now: number,
  dwellMs = 220,
): DwellResult {
  if (!intent.inZone || !intent.side) {
    return { state: { side: null, enteredAt: null }, commit: false };
  }
  // Re-entered a different edge, or entered fresh: restart the clock.
  const continuing = prev.side === intent.side && prev.enteredAt !== null;
  const enteredAt = continuing ? prev.enteredAt! : now;
  const state: DwellState = { side: intent.side, enteredAt };

  if (intent.pastThreshold) return { state, commit: true };
  if (now - enteredAt >= dwellMs) return { state, commit: true };
  return { state, commit: false };
}

// ---- phone-side exit intent -------------------------------------------------

export interface PhoneExitInput {
  clientX: number;
  viewportWidth: number;
  /** Which side THIS phone is on — its inner edge faces the laptop. */
  side: Side;
  /** Is the other phone also paired? Enables the "push further" hop. */
  hasOtherPhone: boolean;
  tuning?: EdgeTuning;
}

export interface PhoneExit {
  /** 'laptop' back to the hub; 'other' hops to the far phone; null = staying. */
  target: 'laptop' | 'other' | null;
  inZone: boolean;
  glow: number;
  /** Deliberate push past the inner edge (deep enough to commit). */
  pastThreshold: boolean;
}

/**
 * On a phone, the INNER edge faces the laptop: phone-on-LEFT → inner is its
 * RIGHT edge; phone-on-RIGHT → inner is its LEFT edge. Dragging a tile off the
 * inner edge returns it to the laptop; pushing further past the edge (when the
 * other phone is paired) hops it across to that phone instead.
 */
export function phoneExitIntent(input: PhoneExitInput): PhoneExit {
  const { zonePx, commitPastPx } = { ...DEFAULTS, ...(input.tuning ?? {}) };
  const none: PhoneExit = { target: null, inZone: false, glow: 0, pastThreshold: false };
  if (!(input.viewportWidth > 0)) return none;

  // Inner edge: phone on the left reaches toward its right edge, and vice versa.
  const innerIsRight = input.side === 'left';
  const dist = innerIsRight ? input.viewportWidth - input.clientX : input.clientX;
  if (dist > zonePx) return none;

  const glow = clamp01((zonePx - dist) / zonePx);
  const pastThreshold = dist < -commitPastPx;
  // A deep push past the inner edge means "keep going to the other phone" when
  // one is paired; otherwise any inner-edge exit heads back to the laptop.
  const deepPast = dist < -commitPastPx * 2;
  const target: PhoneExit['target'] = input.hasOtherPhone && deepPast ? 'other' : 'laptop';
  return { target, inZone: dist <= zonePx, glow, pastThreshold };
}
