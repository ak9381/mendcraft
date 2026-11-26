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

/** Smoothed hands follow (gimbalCanvas 'hands' mode): the target is an
 *  exponential average of the hands' centroid, it must be seen on
 *  HANDS_CONFIRM_FRAMES frames in a row (a one-frame false hand never moves
 *  the stand), moves inside HANDS_DEADBAND_RAD are skipped, and each move
 *  covers HANDS_GAIN of the error so the stand eases in without overshoot.
 *  After a move the average restarts (the picture moved with the stand) and
 *  frames are ignored for HANDS_SETTLE_MS. No hand → nothing moves. */
export const HANDS_SMOOTHING = 0.5;
export const HANDS_CONFIRM_FRAMES = 2;
export const HANDS_DEADBAND_RAD = (4 * Math.PI) / 180;
export const HANDS_GAIN = 0.7;
export const HANDS_SETTLE_MS = 250;
/** A gap this long without a hand restarts the average. */
export const HANDS_LOST_MS = 600;
/** Never travel further than this per axis since entering hands mode. */
export const HANDS_MAX_TRAVEL_RAD = (45 * Math.PI) / 180;
/** After a move on an axis, the error on the SAME side grew by more than
 *  max(HANDS_GROW_RAD, half that move): a stand turning the wrong way grows
 *  it by the whole move. HANDS_GROW_STOP such moves stop that axis (until
 *  hands mode is entered again) and the diagnostic says "sign?". */
export const HANDS_GROW_RAD = (1 * Math.PI) / 180;
export const HANDS_GROW_STOP = 1;

export interface FollowDiag {
  /** Net travel since entering hands mode (radians). */
  travel: { yaw: number; pitch: number };
  /** Axes stopped because the error grew after moves (sign looks inverted). */
  signSuspect: { yaw: boolean; pitch: boolean };
}

export interface SmoothFollow {
  /** Relative move in radians (yaw + right, pitch + up). */
  move: (yaw: number, pitch: number) => Promise<boolean>;
}

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
  /** Smoothed hands follow: travel and sign diagnostics. */
  diag(): FollowDiag;
}

export function createGimbalFollow(opts: {
  aim: (box: { x: number; y: number; w: number; h: number }) => Promise<boolean>;
  nudge?: (yaw: number, pitch: number) => Promise<boolean>;
  intervalMs?: number;
  fov?: { h: number; v: number };
  /** Smoothed hands follow (see HANDS_*): moves go here instead of aim(). */
  smooth?: SmoothFollow;
}): GimbalFollow {
  // ≥ 700 ms between moves by default: native aim() resolves only after the
  // move completes, and the `inflight` flag below keeps moves from stacking.
  const interval = opts.intervalMs ?? FOLLOW_INTERVAL_MS;
  const fov = opts.fov ?? DEFAULT_FOV;
  let mode: FollowMode = 'hands';
  let lastAimAt = 0;
  let inflight = false;
  /** Smoothed target (hands mode with opts.smooth). */
  let ema: Pt | null = null;
  let seen = 0;
  let lastSeenAt = -Infinity;
  let settleUntil = -Infinity;
  /** A move just ended: the next frame starts the settle wait (frame clock). */
  let justMoved = false;
  type Axis = 'yaw' | 'pitch';
  const fresh = () => ({ travel: 0, lastErr: null as number | null, lastStep: 0, grows: 0, stopped: false });
  let axes: Record<Axis, ReturnType<typeof fresh>> = { yaw: fresh(), pitch: fresh() };

  /** One axis' step: dead zone, sign check, gain, travel bound. */
  function axisStep(a: Axis, err: number): number {
    const st = axes[a];
    if (Math.abs(err) < HANDS_DEADBAND_RAD) { st.lastErr = null; st.grows = 0; return 0; }
    if (st.lastErr !== null) {
      // Moved toward the hand last time, yet the hand is further out on the
      // same side: the stand may be turning the wrong way.
      const grew = Math.sign(err) === Math.sign(st.lastErr)
        && Math.abs(err) > Math.abs(st.lastErr) + Math.max(HANDS_GROW_RAD, Math.abs(st.lastStep) / 2);
      st.grows = grew ? st.grows + 1 : 0;
      if (st.grows >= HANDS_GROW_STOP) st.stopped = true;
    }
    if (st.stopped) return 0;
    let step = err * HANDS_GAIN;
    const lo = -HANDS_MAX_TRAVEL_RAD - st.travel;
    const hi = HANDS_MAX_TRAVEL_RAD - st.travel;
    step = Math.max(lo, Math.min(hi, step));
    if (Math.abs(step) < 1e-6) { st.lastErr = null; return 0; }
    st.lastErr = err;
    st.lastStep = step;
    return step;
  }

  function smoothFrame(hands: readonly { points: readonly Pt[] }[], now: number, smooth: SmoothFollow): void {
    const raw = handsCentroid(hands);
    if (!raw) return;
    if (now - lastSeenAt > HANDS_LOST_MS) { ema = null; seen = 0; }
    lastSeenAt = now;
    if (justMoved) { justMoved = false; settleUntil = now + HANDS_SETTLE_MS; }
    if (now < settleUntil) return;
    ema = ema ? { x: ema.x + HANDS_SMOOTHING * (raw.x - ema.x), y: ema.y + HANDS_SMOOTHING * (raw.y - ema.y) } : raw;
    seen++;
    if (inflight || seen < HANDS_CONFIRM_FRAMES || now - lastAimAt < interval) return;
    const { yaw, pitch } = aimAngles(boxAround(ema), fov);
    const y = axisStep('yaw', yaw);
    const p = axisStep('pitch', pitch);
    if (y === 0 && p === 0) return;
    lastAimAt = now;
    inflight = true;
    void smooth.move(y, p).then((ok) => {
      if (ok) { axes.yaw.travel += y; axes.pitch.travel += p; }
      // A failed move proves nothing about the sign.
      else { axes.yaw.lastErr = null; axes.pitch.lastErr = null; }
    }, () => { axes.yaw.lastErr = null; axes.pitch.lastErr = null; }).finally(() => {
      inflight = false;
      // The picture moved with the stand: start the average again.
      ema = null; seen = 0; justMoved = true;
    });
  }

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
    setMode(next) {
      // Entering hands mode starts a fresh travel budget and sign check.
      if (next === 'hands' && mode !== 'hands') axes = { yaw: fresh(), pitch: fresh() };
      mode = next; ema = null; seen = 0;
    },
    diag: () => ({
      travel: { yaw: axes.yaw.travel, pitch: axes.pitch.travel },
      signSuspect: { yaw: axes.yaw.stopped, pitch: axes.pitch.stopped },
    }),
    onFrame(hands, now) {
      if (mode === 'hands' && opts.smooth) { smoothFrame(hands, now, opts.smooth); return; }
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
