// Pure plan hit-testing + magnet aim (no DOM). Used by the SVG renderer for
// mouse clicks and the pinch pointer. Doors/windows are first-class targets
// (the leaf and swing, not just the host wall), fixtures have edge slack, and
// a generous radius snaps the pointer onto the nearest object.

import { fixturePolygon } from './editing';
import {
  pointAlong,
  wallNormal,
  type Opening,
  type PlanDoc,
  type Point,
  type Wall,
} from './doc';

export type HitKind = 'opening' | 'fixture' | 'wall' | 'text' | 'room';

export interface AimHit {
  id: string;
  kind: HitKind;
  /** Distance from the pointer to the object, in mm (0 if inside). */
  dist: number;
  /** Closest point on the object (world mm) — the magnet snap target. */
  point: Point;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function closestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  return dist(p, closestOnSegment(p, a, b));
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function closestOnPolygon(p: Point, poly: Point[]): Point {
  if (poly.length === 0) return p;
  if (pointInPolygon(p, poly)) return p;
  let best = poly[0];
  let bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const q = closestOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
    const d = dist(p, q);
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

/** Opening centreline on the host wall, plus the door leaf and swing sector. */
export function openingGeometry(o: Opening, wall: Wall): {
  start: Point;
  end: Point;
  hinge?: Point;
  leafFar?: Point;
  open?: Point;
} {
  const start = pointAlong(wall, o.offset);
  const end = pointAlong(wall, o.offset + o.width);
  if (o.kind !== 'door') return { start, end };
  const hinge = o.swing === 'right' ? end : start;
  const leafFar = o.swing === 'right' ? start : end;
  const n = wallNormal(wall);
  const open = { x: hinge.x + n.x * o.width, y: hinge.y + n.y * o.width };
  return { start, end, hinge, leafFar, open };
}

function closestOnOpening(p: Point, o: Opening, wall: Wall): Point {
  const g = openingGeometry(o, wall);
  let best = closestOnSegment(p, g.start, g.end);
  let bestD = dist(p, best);
  if (g.hinge && g.open) {
    const leaf = closestOnSegment(p, g.hinge, g.open);
    const dLeaf = dist(p, leaf);
    if (dLeaf < bestD) { best = leaf; bestD = dLeaf; }
    // Inside the swing quarter-disk → snap stays put (already on the door).
    const toP = { x: p.x - g.hinge.x, y: p.y - g.hinge.y };
    const toFar = { x: (g.leafFar ?? g.start).x - g.hinge.x, y: (g.leafFar ?? g.start).y - g.hinge.y };
    const toOpen = { x: g.open.x - g.hinge.x, y: g.open.y - g.hinge.y };
    const reach = Math.hypot(toP.x, toP.y);
    if (reach <= o.width + 1e-6 && toP.x * toFar.x + toP.y * toFar.y >= -1e-6 && toP.x * toOpen.x + toP.y * toOpen.y >= -1e-6) {
      return p;
    }
  }
  return best;
}

/** Kind bias in mm: more specific targets win close races, but a much nearer
 *  wall still beats a distant door (so magnet doesn't steal the wrong object). */
const KIND_BIAS: Record<HitKind, number> = {
  opening: 0,
  fixture: 0,
  text: 40,
  wall: 80,
  room: 800,
};

function pxSlack(scale: number, px: number): number {
  return px / Math.max(scale, 1e-6);
}

function consider(hits: AimHit[], hit: AimHit, slack: number, radiusMm: number): void {
  if (hit.dist <= slack + radiusMm) hits.push(hit);
}

/**
 * Nearest object to world-mm point `p`. `radiusMm` is extra magnet reach on
 * top of each object's built-in slack (0 = tight click). Returns null if
 * nothing is within reach.
 */
export function pickPlan(doc: PlanDoc, p: Point, scale: number, radiusMm = 0): AimHit | null {
  const hits: AimHit[] = [];

  for (const o of doc.openings) {
    const wall = doc.walls.find((w) => w.id === o.wallId);
    if (!wall) continue;
    const point = closestOnOpening(p, o, wall);
    const slack = Math.max(wall.thickness / 2, 160) + pxSlack(scale, 12);
    consider(hits, { id: o.id, kind: 'opening', dist: dist(p, point), point }, slack, radiusMm);
  }

  for (const f of doc.fixtures) {
    const poly = fixturePolygon(f);
    const point = closestOnPolygon(p, poly);
    const slack = 80 + pxSlack(scale, 12);
    consider(hits, { id: f.id, kind: 'fixture', dist: dist(p, point), point }, slack, radiusMm);
  }

  for (const w of doc.walls) {
    const point = closestOnSegment(p, w.a, w.b);
    const slack = Math.max(w.thickness / 2, 120) + pxSlack(scale, 8);
    consider(hits, { id: w.id, kind: 'wall', dist: dist(p, point), point }, slack, radiusMm);
  }

  for (const t of doc.texts) {
    const halfW = Math.max(t.text.length * t.size * 0.32, t.size);
    const halfH = t.size * 0.8;
    const qx = Math.max(t.x - halfW, Math.min(t.x + halfW, p.x));
    const qy = Math.max(t.y - halfH, Math.min(t.y + halfH, p.y));
    const point = { x: qx, y: qy };
    const slack = pxSlack(scale, 8);
    consider(hits, { id: t.id, kind: 'text', dist: dist(p, point), point }, slack, radiusMm);
  }

  for (const room of doc.rooms) {
    const pts: Point[] = [];
    const push = (q: Point) => {
      if (!pts.some((r) => Math.hypot(r.x - q.x, r.y - q.y) < 1)) pts.push(q);
    };
    for (const id of room.wallIds) {
      const w = doc.walls.find((x) => x.id === id);
      if (w) { push(w.a); push(w.b); }
    }
    if (pts.length < 3) continue;
    if (!pointInPolygon(p, pts)) continue;
    consider(hits, { id: room.id, kind: 'room', dist: 0, point: p }, 0, radiusMm);
  }

  if (hits.length === 0) return null;
  hits.sort((a, b) => (a.dist + KIND_BIAS[a.kind]) - (b.dist + KIND_BIAS[b.kind]));
  return hits[0];
}

/** Default magnet radius in CSS pixels (scaled by the interaction profile). */
export const DEFAULT_AIM_RADIUS_PX = 56;
