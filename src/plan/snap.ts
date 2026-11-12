// Pure snapping helpers for the plan editor: grid snap, endpoint/midpoint
// snap, and an ortho (horizontal/vertical) constraint. No DOM — these operate
// on world-space mm points so they can be unit-tested and reused by both the
// renderer (pinch/mouse drag) and the engine.

import type { Point, Wall } from './doc';
import { wallMidpoint } from './doc';

/** Default grid spacing in mm (100 mm = 10 cm). */
export const GRID_MM = 100;

export function snapValueToGrid(v: number, grid = GRID_MM): number {
  return Math.round(v / grid) * grid;
}

export function snapToGrid(p: Point, grid = GRID_MM): Point {
  return { x: snapValueToGrid(p.x, grid), y: snapValueToGrid(p.y, grid) };
}

/**
 * Snap `p` to the nearest wall endpoint or midpoint within `radius` mm.
 * Returns the snapped point and what it snapped to, or null if nothing is in
 * range. `excludeWallId` skips a wall (e.g. the one being dragged).
 */
export function snapToObjects(
  p: Point,
  walls: Wall[],
  radius: number,
  excludeWallId?: string,
): { point: Point; kind: 'endpoint' | 'midpoint'; wallId: string } | null {
  let best: { point: Point; kind: 'endpoint' | 'midpoint'; wallId: string; d: number } | null = null;
  const consider = (q: Point, kind: 'endpoint' | 'midpoint', wallId: string) => {
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d <= radius && (!best || d < best.d)) best = { point: { ...q }, kind, wallId, d };
  };
  for (const w of walls) {
    if (w.id === excludeWallId) continue;
    consider(w.a, 'endpoint', w.id);
    consider(w.b, 'endpoint', w.id);
    consider(wallMidpoint(w), 'midpoint', w.id);
  }
  if (!best) return null;
  const b = best as { point: Point; kind: 'endpoint' | 'midpoint'; wallId: string; d: number };
  return { point: b.point, kind: b.kind, wallId: b.wallId };
}

/**
 * Combined snap used while dragging: object snap wins when in range, otherwise
 * fall back to grid snap. `objectRadius` is the capture distance for endpoints.
 */
export function snapPoint(
  p: Point,
  walls: Wall[],
  objectRadius = GRID_MM,
  grid = GRID_MM,
  excludeWallId?: string,
): { point: Point; snapped: 'endpoint' | 'midpoint' | 'grid' } {
  const obj = snapToObjects(p, walls, objectRadius, excludeWallId);
  if (obj) return { point: obj.point, snapped: obj.kind };
  return { point: snapToGrid(p, grid), snapped: 'grid' };
}

/**
 * Ortho constraint: given a fixed anchor and a moving point, snap the moving
 * point onto the horizontal or vertical line through the anchor (whichever the
 * current direction is closer to). Used when placing/stretching a wall.
 */
export function orthoConstrain(anchor: Point, moving: Point): Point {
  const dx = Math.abs(moving.x - anchor.x);
  const dy = Math.abs(moving.y - anchor.y);
  return dx >= dy
    ? { x: moving.x, y: anchor.y } // horizontal
    : { x: anchor.x, y: moving.y }; // vertical
}

/** Nearest axis-aligned unit direction to `d` (for "ortho" length edits). */
export function nearestOrthoDir(d: Point): Point {
  return Math.abs(d.x) >= Math.abs(d.y)
    ? { x: Math.sign(d.x) || 1, y: 0 }
    : { x: 0, y: Math.sign(d.y) || 1 };
}
