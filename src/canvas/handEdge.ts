// Edge safety for the live hand pointer and mesh. When a hand nears or
// leaves the camera / screen edge, MediaPipe landmarks distort and poses
// flap (fist / pinch / scroll misfires). We freeze the last stable pose,
// hold the cursor on the 24px clamp, suppress clicks around the event,
// and ease the cursor back in so re-entry does not jump.

import { HAND_FEEL } from './handFeel';

/** Cursor and mesh stay this far inside the screen edge (CSS px). */
export const SCREEN_MARGIN_PX = 24;

export type EdgePose = string;

export const CAMERA_EDGE_EPS = 0.06;
export const EDGE_CLICK_COOLDOWN_MS = 300;
export const EDGE_EASE_MS = 200;

type P = { x: number; y: number };

/** True when any landmark sits on or near the camera frame edge (0/1). */
export function isHandClipped(
  points: readonly { x: number; y: number }[],
  eps = CAMERA_EDGE_EPS,
): boolean {
  for (const p of points) {
    if (p.x <= eps || p.x >= 1 - eps || p.y <= eps || p.y >= 1 - eps) return true;
  }
  return false;
}

function mapUnclamped(tip: { x: number; y: number }, w: number, h: number, mirror: boolean): P {
  const box = HAND_FEEL.reach;
  const nx = mirror ? 1 - tip.x : tip.x;
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  return {
    x: clamp01((nx - box.x0) / (box.x1 - box.x0)) * w,
    y: clamp01((tip.y - box.y0) / (box.y1 - box.y0)) * h,
  };
}

/** True when the (unclamped) mapped tip sits on or past the screen margin. */
export function isAtScreenEdge(
  tip: { x: number; y: number },
  w: number,
  h: number,
  mirror = true,
  margin = SCREEN_MARGIN_PX,
): boolean {
  if (!(w > 0 && h > 0)) return false;
  const p = mapUnclamped(tip, w, h, mirror);
  return p.x <= margin || p.x >= w - margin || p.y <= margin || p.y >= h - margin;
}

/** Camera-edge clip or a tip that has reached the screen clamp. */
export function isEdgeFrame(
  points: readonly { x: number; y: number }[],
  tip: { x: number; y: number } | undefined,
  w: number,
  h: number,
  mirror = true,
): boolean {
  if (isHandClipped(points)) return true;
  if (tip) return isAtScreenEdge(tip, w, h, mirror);
  return false;
}

/** Smoothstep ease from `from` to `to` over `ms` starting at `t0`. */
export function easeBack(from: P, to: P, t0: number, t: number, ms = EDGE_EASE_MS): { p: P; done: boolean } {
  const k = ms <= 0 ? 1 : Math.max(0, Math.min(1, (t - t0) / ms));
  const s = k * k * (3 - 2 * k);
  return {
    p: { x: from.x + (to.x - from.x) * s, y: from.y + (to.y - from.y) * s },
    done: k >= 1,
  };
}

export interface EdgeGuard {
  /** Record this frame's clipped/inside state, raw pose, and screen point. */
  observe(clipped: boolean, pose: EdgePose, screen: P, t: number): void;
  /** Frozen last-stable pose while at the edge; otherwise the raw pose. */
  pose(raw: EdgePose): EdgePose;
  readonly atEdge: boolean;
  /** True while at the edge, or within the cooldown of entering/leaving it. */
  blockClicks(t: number): boolean;
  /** Hold at the clamp while clipped; ease back on re-entry (no jump). */
  applyCursor(live: P, t: number): P;
  /** A full hand-loss counts as leaving the edge. */
  markLeave(t: number, screen?: P | null): void;
  reset(): void;
}

export function createEdgeGuard(): EdgeGuard {
  let atEdge = false;
  let lastEvent = -Infinity;
  let frozenPose: EdgePose = 'none';
  let held: P | null = null;
  let reenterAt = 0;
  let easingFrom: P | null = null;

  return {
    observe(clipped, pose, screen, t) {
      if (clipped && !atEdge) {
        atEdge = true;
        lastEvent = t;
        held = { ...screen };
        easingFrom = null;
      } else if (!clipped && atEdge) {
        atEdge = false;
        lastEvent = t;
        reenterAt = t;
        easingFrom = held ? { ...held } : null;
      } else if (clipped && held) {
        // Stay pinned — do not follow distorted edge landmarks.
      }
      if (!clipped && pose && pose !== 'none') frozenPose = pose;
    },
    pose(raw) {
      return atEdge && frozenPose !== 'none' ? frozenPose : raw;
    },
    get atEdge() { return atEdge; },
    blockClicks(t) {
      if (atEdge) return true;
      return lastEvent > -Infinity && t - lastEvent < EDGE_CLICK_COOLDOWN_MS;
    },
    applyCursor(live, t) {
      if (atEdge && held) return { ...held };
      if (easingFrom) {
        const r = easeBack(easingFrom, live, reenterAt, t);
        if (r.done) easingFrom = null;
        return r.p;
      }
      return live;
    },
    markLeave(t, screen) {
      if (screen && Number.isFinite(screen.x) && screen.x >= 0) held = { ...screen };
      if (!atEdge) lastEvent = t;
      atEdge = false;
      easingFrom = null;
    },
    reset() {
      atEdge = false;
      lastEvent = -Infinity;
      frozenPose = 'none';
      held = null;
      reenterAt = 0;
      easingFrom = null;
    },
  };
}

