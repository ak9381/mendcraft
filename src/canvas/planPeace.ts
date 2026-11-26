// PEACE-AND-MOVE RESIZE for the floor plan (design 26 Nov, plan hands): a
// peace sign (index + middle up) that MOVES over a plan with a wall, room or
// dimension selected changes its size in 10 cm steps — one step per 30 px of
// hand travel. Pure, clock-injected.
//
// Same contract as the peace-and-move scroll / level adjust:
//  - a peace ARMS when it appears; it starts only after ≥ startPx of travel
//    within windowMs — a peace held still never resizes, so its 2 s hold
//    (Rotate, Tools, next-step chip 2) still fires;
//  - once it starts, that hand's peace is CLAIMED (claimed(side)) until the
//    hand shows another shape: the hold engine and the scroll skip it;
//  - two peace hands at once (the two-hand hold) never resize.
// Ends: the shape changes → the new size is kept (one undo step); the hand
// is lost or blocked (not facing, a fist grab) → nothing is applied.

import type { Pt } from '../input/handLogic';
import { mapToScreen } from './handPointer';
import { palmCenter, type ReachBox } from './handFeel';
import { classifyHandShape, type HandShape, type HandSide } from './handShape';

export interface PlanPeaceConfig {
  startPx: number;
  windowMs: number;
  /** A non-peace or missing frame shorter than this keeps the resize. */
  graceMs: number;
  /** Travel dead band (px): jitter at a step boundary never flickers the size. */
  deadBandPx: number;
}

export const PLAN_PEACE: PlanPeaceConfig = { startPx: 40, windowMs: 500, graceMs: 160, deadBandPx: 6 };

export interface PeaceHand {
  side: HandSide;
  shape: HandShape;
  /** Palm centre on screen (CSS px). */
  point: Pt;
}

/** What a peace-and-move drives (plan/handEdit.ts implements it). */
export interface PeaceTarget {
  resizeBegin(): boolean;
  resizeTravel(dxPx: number, dyPx: number): void;
  resizeEnd(): void;
  resizeCancel(): void;
}

export interface PlanPeaceState {
  phase: 'idle' | 'armed' | 'still' | 'resizing';
  side: HandSide | null;
}

export interface PlanPeace {
  update(hands: readonly PeaceHand[], now: number, ctx: { blocked: boolean; targetAt(p: Pt): PeaceTarget | null }): PlanPeaceState;
  /** This hand's peace belongs to a resize: no hold, no scroll. */
  claimed(side: HandSide): boolean;
  /** This hand's peace has armed on a resizable plan element (or is resizing):
   *  the scroll gesture must not take it. A still peace keeps its 2 s hold. */
  taken(side: HandSide): boolean;
  reset(): void;
  readonly state: PlanPeaceState;
}

/** Selfie-space hands (as presence frames deliver them, each array possibly
 *  stamped with `.shape` / `.side` by the frame's one shape read) → the peace
 *  stepper's input: side, shape and the palm on screen. */
export function peaceHandsOf(hands: readonly (readonly Pt[])[], reach?: ReachBox, cameraAspect?: number): PeaceHand[] {
  const out: PeaceHand[] = [];
  for (const h of hands) {
    if (!h || h.length < 21) continue;
    const stamped = h as { shape?: HandShape; side?: HandSide; label?: string };
    let shape = stamped.shape, side = stamped.side;
    if (!shape || !side) {
      const r = classifyHandShape(h, stamped.label, null, { mirrored: true, cameraAspect });
      shape = r.shape; side = r.hand;
    }
    const pc = palmCenter(h);
    out.push({ side, shape, point: mapToScreen({ x: 1 - pc.x, y: pc.y }, innerWidth, innerHeight, true, reach) });
  }
  return out;
}

export function createPlanPeace(cfg: Partial<PlanPeaceConfig> = {}): PlanPeace {
  const c: PlanPeaceConfig = { ...PLAN_PEACE, ...cfg };
  let phase: PlanPeaceState['phase'] = 'idle';
  let side: HandSide | null = null;
  let target: PeaceTarget | null = null;
  let startAt = 0;
  let startPt: Pt = { x: 0, y: 0 };
  let sent: Pt = { x: 0, y: 0 };
  let missingSince: number | null = null;
  const latched: Record<HandSide, boolean> = { L: false, R: false };
  let state: PlanPeaceState = { phase: 'idle', side: null };

  const out = (): PlanPeaceState => (state = { phase, side });
  function idle(): void { phase = 'idle'; side = null; target = null; missingSince = null; }
  function finish(keep: boolean): PlanPeaceState {
    if (phase === 'resizing' && target) { if (keep) target.resizeEnd(); else target.resizeCancel(); }
    idle();
    return out();
  }

  function update(hands: readonly PeaceHand[], now: number, ctx: { blocked: boolean; targetAt(p: Pt): PeaceTarget | null }): PlanPeaceState {
    for (const h of hands) if (h.shape !== 'peace') latched[h.side] = false;
    if (ctx.blocked) return finish(false);
    const peaces = hands.filter((h) => h.shape === 'peace');

    if (phase === 'idle') {
      if (peaces.length !== 1 || latched[peaces[0].side]) return out();
      const h = peaces[0];
      const t = ctx.targetAt(h.point);
      if (!t) return out();
      phase = 'armed'; side = h.side; target = t; startAt = now; startPt = { ...h.point }; sent = { x: 0, y: 0 };
      return out();
    }

    const mine = hands.find((h) => h.side === side);
    if (!mine || mine.shape !== 'peace' || peaces.length > 1) {
      if (phase !== 'resizing') { idle(); return out(); }
      if (missingSince === null) missingSince = now;
      if (peaces.length > 1) return finish(false);
      if (now - missingSince < c.graceMs) return out();
      // The hand changed shape: keep the size. The hand vanished: apply nothing.
      return finish(!!mine);
    }
    missingSince = null;

    const travel = { x: mine.point.x - startPt.x, y: mine.point.y - startPt.y };
    if (phase === 'armed') {
      if (now - startAt > c.windowMs) phase = 'still';
      else if (Math.max(Math.abs(travel.x), Math.abs(travel.y)) >= c.startPx) {
        if (target!.resizeBegin()) { phase = 'resizing'; latched[side!] = true; }
        else phase = 'still';
      }
    }
    if (phase === 'resizing') {
      latched[side!] = true;
      // Dead band per axis, so a palm resting on a step boundary holds still.
      if (Math.abs(travel.x - sent.x) > c.deadBandPx) sent.x = travel.x;
      if (Math.abs(travel.y - sent.y) > c.deadBandPx) sent.y = travel.y;
      target!.resizeTravel(sent.x, sent.y);
    }
    return out();
  }

  return {
    update,
    claimed: (s) => latched[s] || (phase === 'resizing' && side === s),
    taken: (s) => latched[s] || ((phase === 'armed' || phase === 'resizing') && side === s),
    reset() { finish(false); latched.L = false; latched.R = false; },
    get state() { return state; },
  };
}
