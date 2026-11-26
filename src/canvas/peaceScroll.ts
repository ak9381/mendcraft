// PEACE-AND-MOVE SCROLL (design 26 Nov, "we definitely need scroll"): a peace
// sign (index + middle up) that MOVES scrolls what is under the hand — like a
// two-finger trackpad scroll (natural: the content follows the hand). Pure,
// clock-injected; gestureControl applies the deltas to the DOM.
//
// Conflict with the fixed "peace" hold (R peace = chip 2, L peace = Tools):
//  - a peace ARMS when it appears; it starts scrolling only after ≥ startPx
//    of travel within windowMs of appearing — a peace held still never
//    scrolls, so its 2 s hold still fires;
//  - once scrolling starts, that hand's peace hold is suppressed until the
//    hand shows a different shape (suppressed(side));
//  - two peace hands at once (the two-hand Register hold) never scroll.
// Ends: the shape changes (after a short grace) → release, with the last
// velocity for a short glide; the hand is lost, or blocked (not facing, a fist
// grab) → stops at once, no glide.

import type { Pt } from '../input/handLogic';
import { createOneEuroFilter } from '../input/oneEuro';
import type { HandShape, HandSide } from './handShape';

export interface PeaceScrollConfig {
  /** Travel (px, either axis) that starts a scroll… */
  startPx: number;
  /** …within this long of the peace appearing. */
  windowMs: number;
  /** Scroll px per px of hand travel. */
  gain: number;
  /** Per-frame hand motion under this (px, after smoothing) scrolls nothing. */
  deadZonePx: number;
  /** A non-peace frame shorter than this keeps the scroll (tracker flicker). */
  graceMs: number;
}

export const PEACE_SCROLL: PeaceScrollConfig = {
  startPx: 40,
  windowMs: 500,
  gain: 1.5,
  deadZonePx: 1.5,
  graceMs: 120,
};

export interface ScrollHand {
  side: HandSide;
  shape: HandShape;
  /** Palm centre on screen (CSS px). */
  point: Pt;
}

export type ScrollEnd = 'release' | 'lost' | 'blocked';

export interface PeaceScrollState {
  phase: 'idle' | 'armed' | 'still' | 'scrolling';
  side: HandSide | null;
  /** Screen point of the scrolling hand (smoothed). */
  point: Pt | null;
  /** Scroll to apply THIS frame, natural direction (content follows the hand). */
  dx: number;
  dy: number;
  /** True on the frame scrolling starts (resolve the target then). */
  started: boolean;
  /** Set on the frame a scroll ends. */
  ended: ScrollEnd | null;
  /** Release velocity (px/ms, already × gain) for a glide; 0 unless ended = 'release'. */
  vx: number;
  vy: number;
  /** Raw hand travel since the peace appeared (px, unsmoothed, no gain) —
   *  level controls step by it (one step per ~30 px). */
  travel: Pt;
}

export interface PeaceScroll {
  update(hands: readonly ScrollHand[], now: number, blocked: boolean): PeaceScrollState;
  /** This hand's peace HOLD must not run (it scrolled; until its shape changes). */
  suppressed(side: HandSide): boolean;
  reset(): void;
  readonly state: PeaceScrollState;
}

const IDLE: PeaceScrollState = { phase: 'idle', side: null, point: null, dx: 0, dy: 0, started: false, ended: null, vx: 0, vy: 0, travel: { x: 0, y: 0 } };

export function createPeaceScroll(cfg: Partial<PeaceScrollConfig> = {}): PeaceScroll {
  const c: PeaceScrollConfig = { ...PEACE_SCROLL, ...cfg };
  const euro = createOneEuroFilter({ minCutoff: 1.5, beta: 0.02, dCutoff: 1 });
  let phase: PeaceScrollState['phase'] = 'idle';
  let side: HandSide | null = null;
  let startAt = 0;
  let startPt: Pt = { x: 0, y: 0 };
  let last: Pt | null = null;
  let lastT = 0;
  let missingSince: number | null = null;
  const vel: { vx: number; vy: number; t: number }[] = [];
  const latched: Record<HandSide, boolean> = { L: false, R: false };
  let state: PeaceScrollState = IDLE;

  function toIdle(): void {
    phase = 'idle'; side = null; last = null; missingSince = null; vel.length = 0; euro.reset();
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
      phase = 'armed'; side = h.side; startAt = now; startPt = { ...h.point };
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
    if (phase === 'armed') {
      const travel = Math.max(Math.abs(mine.point.x - startPt.x), Math.abs(mine.point.y - startPt.y));
      if (now - startAt > c.windowMs) {
        phase = 'still'; // held still: a hold candidate, never a scroll
      } else if (travel >= c.startPx) {
        phase = 'scrolling';
        latched[side!] = true;
        last = p; lastT = now;
        return (state = { ...IDLE, phase, side, point: p, started: true, travel: { x: mine.point.x - startPt.x, y: mine.point.y - startPt.y } });
      }
      last = p; lastT = now;
      return (state = { ...IDLE, phase, side, point: p });
    }
    if (phase === 'still') {
      last = p; lastT = now;
      return (state = { ...IDLE, phase, side, point: p });
    }
    // scrolling
    latched[side!] = true;
    let dx = (p.x - last!.x) * c.gain;
    let dy = (p.y - last!.y) * c.gain;
    if (Math.abs(dx) < c.deadZonePx * c.gain) dx = 0;
    if (Math.abs(dy) < c.deadZonePx * c.gain) dy = 0;
    const dt = Math.max(1, now - lastT);
    vel.push({ vx: dx / dt, vy: dy / dt, t: now });
    if (vel.length > 6) vel.shift();
    last = p; lastT = now;
    return (state = { ...IDLE, phase, side, point: p, dx, dy, travel: { x: mine.point.x - startPt.x, y: mine.point.y - startPt.y } });
  }

  return {
    update,
    suppressed: (s) => latched[s] || (phase === 'scrolling' && side === s),
    reset() { toIdle(); latched.L = false; latched.R = false; state = IDLE; },
    get state() { return state; },
  };
}
