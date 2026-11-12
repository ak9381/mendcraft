// Pure wall-hosting math for doors/windows/openings: project a cursor point
// onto a wall, find the nearest wall, and clamp a hosted opening inside its
// wall. No DOM — unit-tested and shared by the door/window tools, the select
// tool's slide-along-wall drag, and the properties panel.

import type { Point, Wall } from './doc';

export interface WallProjection {
  /** Distance along the wall from `a` (clamped to [0, length]). */
  t: number;
  /** Perpendicular distance from the point to the segment. */
  dist: number;
  /** The projected point on the centreline. */
  point: Point;
}

export function projectToWall(p: Point, wall: Wall): WallProjection {
  const dx = wall.b.x - wall.a.x;
  const dy = wall.b.y - wall.a.y;
  const len2 = dx * dx + dy * dy;
  const len = Math.sqrt(len2);
  if (len2 < 1e-6) return { t: 0, dist: Math.hypot(p.x - wall.a.x, p.y - wall.a.y), point: { ...wall.a } };
  let t = ((p.x - wall.a.x) * dx + (p.y - wall.a.y) * dy) / len;
  t = Math.max(0, Math.min(len, t));
  const q = { x: wall.a.x + (dx / len) * t, y: wall.a.y + (dy / len) * t };
  return { t, dist: Math.hypot(p.x - q.x, p.y - q.y), point: q };
}

export interface WallHit extends WallProjection {
  wall: Wall;
}

/** Nearest wall within `maxDist` mm of `p` (ties → smaller distance wins). */
export function nearestWall(p: Point, walls: Wall[], maxDist: number): WallHit | null {
  let best: WallHit | null = null;
  for (const w of walls) {
    const proj = projectToWall(p, w);
    if (proj.dist <= maxDist && (!best || proj.dist < best.dist)) best = { ...proj, wall: w };
  }
  return best;
}

/** Near-edge offset for an opening of `width` centred on `center`, clamped so
 *  the opening stays fully inside the wall. Degenerate walls clamp to 0. */
export function clampOpeningOffset(center: number, width: number, wallLen: number): number {
  const max = Math.max(0, wallLen - width);
  return Math.max(0, Math.min(center - width / 2, max));
}
