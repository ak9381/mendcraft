// Pure (DOM-free) planner for two-hand CAD edits: each hand grabs one anchor
// (a wall endpoint, a room corner, or a fixture corner) and the anchors track
// the fingers. Given the two grab-time world points and the current world
// points it emits plan ops; main.ts only maps pinch landmarks → world via the
// renderer and applies what this returns. Unit-tested with simulated points.
//
// Covers B-117/B-118 (two-hand wall stretch), B-121 (two-hand room resize),
// B-066 (two-hand fixture resize), B-088 (two-hand multi-select).

import { roomPolygon, type PlanDoc, type Point, type Wall } from './doc';
import { fixturePolygon } from './editing';
import { snapValueToGrid } from './snap';
import type { PlanOp } from './ops';

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export interface EndRef { wallId: string; end: 'a' | 'b' }

/** A captured two-hand grab: each hand owns a wall endpoint (walls directly, or
 *  a room corner mapped to its owning wall endpoint). Hand p ↔ a, hand q ↔ b. */
export interface TwoHandStretch {
  kind: 'wall' | 'room';
  a: EndRef;
  b: EndRef;
}

/** A captured two-hand fixture resize: both hands grab opposite-ish corners of
 *  one fixture; width/depth track the fingers, anchored at the fixture centre. */
export interface TwoHandFixture {
  kind: 'fixture';
  id: string;
}

function wallEndNear(wall: Wall, p: Point, radiusMm: number): 'a' | 'b' | null {
  const da = dist(wall.a, p);
  const db = dist(wall.b, p);
  if (da <= radiusMm && da <= db) return 'a';
  if (db <= radiusMm) return 'b';
  return null;
}

/** The room corner nearest `p` (within radius), mapped to a wall endpoint that
 *  sits on that corner — the handle move_end then cascades the neighbour wall. */
function roomEndNear(doc: PlanDoc, room: { wallIds: string[]; id: string; name: string }, p: Point, radiusMm: number): EndRef | null {
  const poly = roomPolygon({ id: room.id, name: room.name, wallIds: room.wallIds }, doc);
  if (!poly) return null;
  let best: { v: Point; d: number } | null = null;
  for (const v of poly) {
    const d = dist(v, p);
    if (d <= radiusMm && (!best || d < best.d)) best = { v, d };
  }
  if (!best) return null;
  for (const wid of room.wallIds) {
    const w = doc.walls.find((x) => x.id === wid);
    if (!w) continue;
    if (dist(w.a, best.v) < 1) return { wallId: wid, end: 'a' };
    if (dist(w.b, best.v) < 1) return { wallId: wid, end: 'b' };
  }
  return null;
}

const endPoint = (doc: PlanDoc, ref: EndRef): Point | null => {
  const w = doc.walls.find((x) => x.id === ref.wallId);
  return w ? w[ref.end] : null;
};

/**
 * Detect what two pinches (grab-time world points `p`, `q`) grabbed for a
 * two-hand stretch, given the current single selection:
 *  - a selected wall whose two endpoints are grabbed one-per-hand, or
 *  - a selected room with two DISTINCT corners grabbed one-per-hand.
 * Returns null (→ main.ts falls back to two-hand zoom/pan) otherwise.
 */
export function detectTwoHandStretch(
  doc: PlanDoc,
  selectionIds: readonly string[],
  p: Point,
  q: Point,
  radiusMm: number,
): TwoHandStretch | null {
  if (selectionIds.length !== 1) return null;
  const id = selectionIds[0];

  const wall = doc.walls.find((w) => w.id === id);
  if (wall) {
    const ep = wallEndNear(wall, p, radiusMm);
    const eq = wallEndNear(wall, q, radiusMm);
    if (ep && eq && ep !== eq) return { kind: 'wall', a: { wallId: id, end: ep }, b: { wallId: id, end: eq } };
    return null;
  }

  const room = doc.rooms.find((r) => r.id === id);
  if (room) {
    const a = roomEndNear(doc, room, p, radiusMm);
    const b = roomEndNear(doc, room, q, radiusMm);
    if (!a || !b) return null;
    const va = endPoint(doc, a);
    const vb = endPoint(doc, b);
    if (va && vb && dist(va, vb) < 1) return null; // both hands on the same corner
    return { kind: 'room', a, b };
  }

  return null;
}

/** Per-frame ops for a stretch: move each grabbed endpoint to its hand's
 *  current world point (grid-snapped). move_end cascades coincident neighbours,
 *  so a wall grows from both ends and a room corner moves as a unit. */
export function twoHandStretchOps(grab: TwoHandStretch, pWorld: Point, qWorld: Point): PlanOp[] {
  const snap = (pt: Point): Point => ({ x: snapValueToGrid(pt.x), y: snapValueToGrid(pt.y) });
  const a = snap(pWorld);
  const b = snap(qWorld);
  return [
    { op: 'move_end', target: grab.a.wallId, end: grab.a.end, x: a.x, y: a.y },
    { op: 'move_end', target: grab.b.wallId, end: grab.b.end, x: b.x, y: b.y },
  ];
}

/** Detect a two-hand fixture resize: both pinches land on the selected
 *  fixture's footprint corners (one per hand, distinct corners). */
export function detectTwoHandFixture(
  doc: PlanDoc,
  selectionIds: readonly string[],
  p: Point,
  q: Point,
  radiusMm: number,
): TwoHandFixture | null {
  if (selectionIds.length !== 1) return null;
  const f = doc.fixtures.find((x) => x.id === selectionIds[0]);
  if (!f) return null;
  const corners = fixturePolygon(f);
  const nearIdx = (pt: Point): number => {
    let best = -1;
    let bestD = radiusMm;
    corners.forEach((c, i) => { const d = dist(c, pt); if (d <= bestD) { bestD = d; best = i; } });
    return best;
  };
  const ip = nearIdx(p);
  const iq = nearIdx(q);
  if (ip < 0 || iq < 0 || ip === iq) return null;
  return { kind: 'fixture', id: f.id };
}

/** Per-frame op for a two-hand fixture resize: w/d are the span of the two
 *  fingers in the fixture's own (un-rotated) frame, anchored at the centre. */
export function twoHandFixtureOp(doc: PlanDoc, grab: TwoHandFixture, pWorld: Point, qWorld: Point, limit: { min: number; max: number }): PlanOp | null {
  const f = doc.fixtures.find((x) => x.id === grab.id);
  if (!f) return null;
  const rad = (f.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const local = (pt: Point): Point => {
    const dx = pt.x - f.x;
    const dy = pt.y - f.y;
    return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
  };
  const lp = local(pWorld);
  const lq = local(qWorld);
  const clamp = (v: number): number => Math.max(limit.min, Math.min(limit.max, snapValueToGrid(Math.abs(v))));
  const w = clamp(lp.x - lq.x);
  const d = clamp(lp.y - lq.y);
  return { op: 'set_size', target: f.id, w, d };
}

/** Two-hand multi-select (B-088): the ids under each hand's pinch, deduped, as
 *  a select_set op. Either hand picking nothing just contributes nothing; null
 *  when neither hand is on an object (nothing to select). */
export function twoHandMultiSelect(idP: string | null, idQ: string | null): PlanOp | null {
  const ids = [...new Set([idP, idQ].filter((x): x is string => !!x))];
  if (ids.length === 0) return null;
  return { op: 'select_set', ids };
}
