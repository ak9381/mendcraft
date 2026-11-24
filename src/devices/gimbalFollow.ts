// Custom (hands) aiming for a DockKit stand such as the Insta360 Flow 2 Pro.
// Pure aiming math lives here so tests do not need the iOS shell. It only
// moves the stand when hand frames (CAMERA space, not selfie-mirrored) reach
// onFrame — on the canvas that is gimbalCanvas's 'hands' mode. Following her
// face is DockKit's own system tracking ('face' mode), not this file.

import { INDEX_TIP, MIDDLE_MCP, WRIST, type Pt } from '../input/handLogic';
import { classifyGesture } from '../input/gestures';
import { aimAngles, DEFAULT_FOV } from './native';

export type FollowMode = 'hands' | 'point' | 'hold';
export type NudgeDir = 'left' | 'right' | 'up' | 'down';

/** Minimum time between two hands-follow moves. */
export const FOLLOW_INTERVAL_MS = 700;

/** One 8° nudge — enough to reframe, small enough not to whip the stand. */
export const NUDGE_RAD = (8 * Math.PI) / 180;

export function handMidpoint(points: readonly Pt[]): Pt | null {
  if (points.length < 21) return null;
  const wrist = points[WRIST];
  const mid = points[MIDDLE_MCP];
  if (!wrist || !mid) return null;
  return { x: (wrist.x + mid.x) / 2, y: (wrist.y + mid.y) / 2 };
}

/** Centroid of every visible hand's midpoint. Null when no complete hand. */
export function handsCentroid(hands: readonly { points: readonly Pt[] }[]): Pt | null {
  const mids: Pt[] = [];
  for (const hand of hands) {
    const mid = handMidpoint(hand.points);
    if (mid) mids.push(mid);
  }
  if (!mids.length) return null;
  return {
    x: mids.reduce((s, p) => s + p.x, 0) / mids.length,
    y: mids.reduce((s, p) => s + p.y, 0) / mids.length,
  };
}

/** Index-finger tip of the first pointing hand, if any. */
export function pointingTip(hands: readonly { points: readonly Pt[] }[]): Pt | null {
  for (const hand of hands) {
    if (hand.points.length < 21) continue;
    if (classifyGesture(hand.points as Pt[]) !== 'point') continue;
    const tip = hand.points[INDEX_TIP];
    if (tip) return { x: tip.x, y: tip.y };
  }
  return null;
}

export function boxAround(pt: Pt, size = 0.04): { x: number; y: number; w: number; h: number } {
  const s = size / 2;
  return { x: pt.x - s, y: pt.y - s, w: size, h: size };
}

export function nudgeAngles(dir: NudgeDir, step = NUDGE_RAD): { yaw: number; pitch: number } {
  if (dir === 'left') return { yaw: -step, pitch: 0 };
  if (dir === 'right') return { yaw: step, pitch: 0 };
  if (dir === 'up') return { yaw: 0, pitch: step };
  return { yaw: 0, pitch: -step };
}

export interface GimbalFollow {
  mode(): FollowMode;
  setMode(mode: FollowMode): void;
  /** Drive one camera frame. No-ops in hold, or when a move is already in flight. */
  onFrame(hands: readonly { points: readonly Pt[] }[], now: number): void;
  nudge(dir: NudgeDir): Promise<boolean>;
}

export function createGimbalFollow(opts: {
  aim: (box: { x: number; y: number; w: number; h: number }) => Promise<boolean>;
  nudge?: (yaw: number, pitch: number) => Promise<boolean>;
  intervalMs?: number;
  fov?: { h: number; v: number };
}): GimbalFollow {
  // ≥ 700 ms between moves by default: native aim() resolves only after the
  // move completes, and the `inflight` flag below keeps moves from stacking.
  const interval = opts.intervalMs ?? FOLLOW_INTERVAL_MS;
  const fov = opts.fov ?? DEFAULT_FOV;
  let mode: FollowMode = 'hands';
  let lastAimAt = 0;
  let inflight = false;

  function targetOf(hands: readonly { points: readonly Pt[] }[]): Pt | null {
    if (mode === 'hold') return null;
    if (mode === 'point') return pointingTip(hands);
    return handsCentroid(hands);
  }

  async function moveTo(pt: Pt): Promise<void> {
    const box = boxAround(pt);
    const { yaw, pitch } = aimAngles(box, fov);
    if (yaw === 0 && pitch === 0) return;
    inflight = true;
    try { await opts.aim(box); } catch { /* gimbal is optional */ } finally { inflight = false; }
  }

  return {
    mode: () => mode,
    setMode(next) { mode = next; },
    onFrame(hands, now) {
      if (inflight || mode === 'hold') return;
      if (now - lastAimAt < interval) return;
      const target = targetOf(hands);
      if (!target) return;
      const { yaw, pitch } = aimAngles(boxAround(target), fov);
      if (yaw === 0 && pitch === 0) return;
      lastAimAt = now;
      void moveTo(target);
    },
    async nudge(dir) {
      const { yaw, pitch } = nudgeAngles(dir);
      if (opts.nudge) {
        try { return await opts.nudge(yaw, pitch); } catch { return false; }
      }
      return false;
    },
  };
}
