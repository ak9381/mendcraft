// PEACE-AND-MOVE SCROLL (design 26 Nov, "we definitely need scroll"): a peace
// sign (index + middle up) that MOVES scrolls what is under the hand. Pure,
// clock-injected; gestureControl applies the deltas to the DOM.
//
// Direction (Akash, 26 Nov: option B): SCROLL-WHEEL style — the hand moves
// DOWN = show what is below (the content moves up), like voice "scroll down".
// One constant (SCROLL_STYLE) flips it to trackpad / natural.
//
// Conflict with the fixed "peace" hold (R peace = chip 2, L peace = Tools):
//  - the first ignoreMs after a peace appears never count (the hand settles);
//  - it starts scrolling only after travel > startScales HAND SCALES (above
//    the hold's own drift limit, so a trembling peace stays a hold), measured
//    on the SMOOTHED point, in one consistent direction, within windowMs;
//  - once scrolling starts, that hand's peace hold is suppressed until the
//    hand shows a different shape (suppressed(side));
//  - two peace hands at once (the two-hand Register hold) never scroll, and
//    clear both latches (clearLatches) so Register — not one hand's Tools —
//    is what a second V means.
// Ends: the shape changes (after a short grace) → release, with the last
// velocity for a short glide; the hand is lost, or blocked (not facing, a fist
// grab, a point capture) → stops at once, no glide.

import type { Pt } from '../input/handLogic';
import { createOneEuroFilter } from '../input/oneEuro';
import type { HandShape, HandSide } from './handShape';

/** 'wheel': hand down = scroll down (show below). 'natural': content follows the hand. */
export const SCROLL_STYLE: 'wheel' | 'natural' = 'wheel';

export interface PeaceScrollConfig {
  /** Travel (smoothed, hand scales, dominant axis) that starts a scroll — above
   *  the hold engine's maxDriftScales (0.6), so drift that keeps a hold alive
   *  never scrolls. */
  startScales: number;
  /** Frames in the first ignoreMs after the peace appears are the hand settling. */
  ignoreMs: number;
  /** The start travel must happen within this long of the peace appearing. */
  windowMs: number;
  /** Net travel ÷ path length along the axis: one consistent direction. */
  minConsistency: number;
  /** Scroll px per px of hand travel. */
  gain: number;
  /** Per-frame hand motion under this (px, after smoothing) scrolls nothing. */
  deadZonePx: number;
  /** A non-peace frame shorter than this keeps the scroll (tracker flicker). */
  graceMs: number;
}

export const PEACE_SCROLL: PeaceScrollConfig = {
  startScales: 0.8,
  ignoreMs: 150,
  windowMs: 900,
  minConsistency: 0.8,
  gain: 1.5,
  deadZonePx: 1.5,
  graceMs: 120,
};

export interface ScrollHand {
  side: HandSide;
  shape: HandShape;
  /** Palm centre on screen (CSS px). */
  point: Pt;
  /** Hand scale on screen (CSS px): wrist → middle knuckle. */
  scalePx: number;
}

export type ScrollEnd = 'release' | 'lost' | 'blocked';

export interface PeaceScrollState {
  phase: 'idle' | 'armed' | 'still' | 'scrolling';
  side: HandSide | null;
  /** Screen point of the scrolling hand (smoothed). */
  point: Pt | null;
  /** Scroll to apply THIS frame, as scrollTop/scrollLeft deltas (+ = show
   *  what is below / to the right), already in SCROLL_STYLE's direction. */
  dx: number;
  dy: number;
  /** True on the frame scrolling starts (resolve the target then). */
  started: boolean;
  /** Set on the frame a scroll ends. */
  ended: ScrollEnd | null;
  /** Release velocity (scroll px/ms) for a glide; 0 unless ended = 'release'. */
  vx: number;
  vy: number;
  /** Smoothed hand travel since scrolling STARTED (px, screen; the start
   *  travel is not counted) — level controls step by it. */
  travel: Pt;
}

export interface PeaceScroll {
  update(hands: readonly ScrollHand[], now: number, blocked: boolean): PeaceScrollState;
  /** This hand's peace HOLD must not run (it scrolled; until its shape changes). */
  suppressed(side: HandSide): boolean;
  /** Forget both latches (two peaces: the two-hand hold decides). */
  clearLatches(): void;
  reset(): void;
  readonly state: PeaceScrollState;
}

const IDLE: PeaceScrollState = { phase: 'idle', side: null, point: null, dx: 0, dy: 0, started: false, ended: null, vx: 0, vy: 0, travel: { x: 0, y: 0 } };
const SIGN = SCROLL_STYLE === 'wheel' ? 1 : -1;

export function createPeaceScroll(cfg: Partial<PeaceScrollConfig> = {}): PeaceScroll {
  const c: PeaceScrollConfig = { ...PEACE_SCROLL, ...cfg };
  const euro = createOneEuroFilter({ minCutoff: 1.5, beta: 0.02, dCutoff: 1 });
  let phase: PeaceScrollState['phase'] = 'idle';
  let side: HandSide | null = null;
  let startAt = 0;
  /** Smoothed point at the end of the settle time (the travel origin). */
  let origin: Pt | null = null;
  /** Path length along each axis since the origin (for consistency). */
  let pathX = 0, pathY = 0;
  let scrollOrigin: Pt = { x: 0, y: 0 };
  let last: Pt | null = null;
  let lastT = 0;
  let missingSince: number | null = null;
  const vel: { vx: number; vy: number; t: number }[] = [];
  const latched: Record<HandSide, boolean> = { L: false, R: false };
  let state: PeaceScrollState = IDLE;

  function toIdle(): void {
    phase = 'idle'; side = null; last = null; origin = null; pathX = 0; pathY = 0; missingSince = null; vel.length = 0; euro.reset();
  }
  function end(kind: ScrollEnd, now: number): PeaceScrollState {
    const wasScrolling = phase === 'scrolling';
    let vx = 0, vy = 0;
    if (kind === 'release' && wasScrolling) {
      // The speed just BEFORE the shape changed (not the grace frames after).
      const ref = missingSince ?? now;
      const recent = vel.filter((v) => v.t <= ref && ref - v.t <= 150);
      if (recent.length) {
        vx = recent.reduce((a, v) => a + v.vx, 0) / recent.length;
        vy = recent.reduce((a, v) => a + v.vy, 0) / recent.length;
      }
    }
    toIdle();
    state = { ...IDLE, ended: wasScrolling ? kind : null, vx, vy };
    return state;
  }

  function update(hands: readonly ScrollHand[], now: number, blocked: boolean): PeaceScrollState {
    // A hand seen in a non-peace shape releases its latch (it "changed shape").
    for (const h of hands) if (h.shape !== 'peace') latched[h.side] = false;
    if (blocked) return phase === 'idle' ? (state = IDLE) : end('blocked', now);

    const peaces = hands.filter((h) => h.shape === 'peace');
    if (phase === 'idle') {
      // Two peace hands = the two-hand hold (Register): never a scroll.
      if (peaces.length !== 1 || latched[peaces[0].side]) return (state = IDLE);
      const h = peaces[0];
      phase = 'armed'; side = h.side; startAt = now; origin = null; pathX = 0; pathY = 0;
      euro.reset();
      last = euro.filter(h.point.x, h.point.y, now);
      lastT = now;
      return (state = { ...IDLE, phase, side, point: last });
    }

    const mine = hands.find((h) => h.side === side);
    if (!mine) return end('lost', now); // hand gone: stop at once, no glide
    if (mine.shape !== 'peace' || peaces.length > 1) {
      if (missingSince === null) missingSince = now;
      if (now - missingSince >= c.graceMs || peaces.length > 1) return end('release', now);
      return (state = { ...state, dx: 0, dy: 0, started: false, ended: null });
    }
    missingSince = null;

    const p = euro.filter(mine.point.x, mine.point.y, now);
    const prev = last!;
    last = p;
    const stepX = p.x - prev.x, stepY = p.y - prev.y;
    if (phase === 'armed') {
      lastT = now;
      if (now - startAt < c.ignoreMs) return (state = { ...IDLE, phase, side, point: p }); // settling
      if (!origin) { origin = { ...p }; return (state = { ...IDLE, phase, side, point: p }); }
      pathX += Math.abs(stepX); pathY += Math.abs(stepY);
      const nx = p.x - origin.x, ny = p.y - origin.y;
      const vertical = Math.abs(ny) >= Math.abs(nx);
      const net = vertical ? Math.abs(ny) : Math.abs(nx);
      const path = vertical ? pathY : pathX;
      const scale = Math.max(1, mine.scalePx);
      if (now - startAt > c.windowMs) {
        phase = 'still'; // held (or drifting): a hold candidate, never a scroll
      } else if (net / scale > c.startScales && net >= c.minConsistency * path) {
        phase = 'scrolling';
        latched[side!] = true;
        scrollOrigin = { ...p };
        return (state = { ...IDLE, phase, side, point: p, started: true });
      }
      return (state = { ...IDLE, phase, side, point: p });
    }
    if (phase === 'still') {
      lastT = now;
      return (state = { ...IDLE, phase, side, point: p });
    }
    // scrolling
    latched[side!] = true;
    let dx = SIGN * stepX * c.gain;
    let dy = SIGN * stepY * c.gain;
    if (Math.abs(stepX) < c.deadZonePx) dx = 0;
    if (Math.abs(stepY) < c.deadZonePx) dy = 0;
    const dt = Math.max(1, now - lastT);
    vel.push({ vx: dx / dt, vy: dy / dt, t: now });
    if (vel.length > 6) vel.shift();
    lastT = now;
    return (state = { ...IDLE, phase, side, point: p, dx, dy, travel: { x: p.x - scrollOrigin.x, y: p.y - scrollOrigin.y } });
  }

  return {
    update,
    suppressed: (s) => latched[s] || (phase === 'scrolling' && side === s),
    clearLatches() { latched.L = false; latched.R = false; },
    reset() { toIdle(); latched.L = false; latched.R = false; state = IDLE; },
    get state() { return state; },
  };
}
