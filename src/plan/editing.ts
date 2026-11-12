// Pure editing helpers for plan PART 2 (no DOM): multi-selection sets, the
// marquee rectangle test, fixture rotation math, Revit-style temporary
// dimensions (and their inline-edit reducers), and the 3D wall-segment cutter
// (sill/head aware) shared with the extrude view. All mm / degrees, Y-up.

import {
  pointAlong,
  wallLength,
  type Fixture,
  type Opening,
  type PlanDoc,
  type Point,
  type Wall,
} from './doc';
import { DEFAULTS } from './ops';

// ─── Selection sets ─────────────────────────────────────────────────────────

/** Shift+click: toggle `id` in the selection (order preserved; toggled-on last). */
export function toggleSelection(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const inRect = (p: Point, r: Rect): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** Marquee (window) selection: walls with BOTH endpoints inside, openings and
 *  fixtures whose centre is inside. Rooms are reached via their walls. */
export function rectHits(doc: PlanDoc, r: Rect): string[] {
  const ids: string[] = [];
  for (const w of doc.walls) if (inRect(w.a, r) && inRect(w.b, r)) ids.push(w.id);
  for (const o of doc.openings) {
    const wall = doc.walls.find((w) => w.id === o.wallId);
    if (wall && inRect(pointAlong(wall, o.offset + o.width / 2), r)) ids.push(o.id);
  }
  for (const f of doc.fixtures) if (inRect({ x: f.x, y: f.y }, r)) ids.push(f.id);
  for (const t of doc.texts) if (inRect({ x: t.x, y: t.y }, r)) ids.push(t.id);
  return ids;
}

// ─── Rotation math ──────────────────────────────────────────────────────────

/** Normalize an angle in degrees to [0, 360). */
export function normalizeAngle(deg: number): number {
  const a = deg % 360;
  return a < 0 ? a + 360 : a;
}

/** Snap an angle (degrees) to the nearest `step` increment (handle drag). */
export function snapAngle(deg: number, step = 15): number {
  return normalizeAngle(Math.round(deg / step) * step);
}

/** Rotated rectangle outline of a fixture (4 corners, CCW). */
export function fixturePolygon(f: Fixture): Point[] {
  const rad = (f.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const hw = f.w / 2;
  const hd = f.d / 2;
  return [
    { x: -hw, y: -hd }, { x: hw, y: -hd }, { x: hw, y: hd }, { x: -hw, y: hd },
  ].map((p) => ({ x: f.x + p.x * c - p.y * s, y: f.y + p.x * s + p.y * c }));
}

/** World position of the rotate handle: `reachMm` beyond the fixture's local
 *  +y edge, rotating with it (like Figma/Revit grab handles). */
export function fixtureHandlePoint(f: Fixture, reachMm: number): Point {
  const rad = (f.rotation * Math.PI) / 180;
  const r = f.d / 2 + reachMm;
  return { x: f.x - Math.sin(rad) * r, y: f.y + Math.cos(rad) * r };
}

/** Angle (degrees) a drag point implies for the rotate handle around (cx, cy):
 *  0° when the handle is due +y of the centre, growing CCW. */
export function handleAngle(center: Point, p: Point): number {
  return normalizeAngle((Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI - 90);
}

// ─── Revit-style temporary dimensions ───────────────────────────────────────

export type TempDimKind = 'wall-length' | 'opening-start' | 'opening-end';

/** One temporary dimension: the segment it annotates (world mm) + its value.
 *  `targetId` is the object an edit applies to. */
export interface TempDim {
  kind: TempDimKind;
  targetId: string;
  value: number;
  a: Point;
  b: Point;
}

/** Temporary dims for the selected object: a wall shows its length; a hosted
 *  opening shows the distances from BOTH wall ends to its near/far edges. */
export function tempDims(doc: PlanDoc, id: string | null): TempDim[] {
  if (!id) return [];
  const wall = doc.walls.find((w) => w.id === id);
  if (wall) return [{ kind: 'wall-length', targetId: id, value: wallLength(wall), a: wall.a, b: wall.b }];
  const o = doc.openings.find((x) => x.id === id);
  const host = o && doc.walls.find((w) => w.id === o.wallId);
  if (!o || !host) return [];
  const len = wallLength(host);
  const endDist = Math.max(0, len - o.offset - o.width);
  return [
    { kind: 'opening-start', targetId: id, value: o.offset, a: host.a, b: pointAlong(host, o.offset) },
    { kind: 'opening-end', targetId: id, value: endDist, a: pointAlong(host, o.offset + o.width), b: host.b },
  ];
}

/** Reducer for an inline temp-dim edit: returns the op envelope to apply, or
 *  null when the value is invalid / the object vanished. `value` is mm. */
export function tempDimEditOp(
  doc: PlanDoc,
  dim: { kind: TempDimKind; targetId: string },
  value: number,
): Record<string, unknown> | null {
  if (!Number.isFinite(value) || value < 0) return null;
  if (dim.kind === 'wall-length')
    return { op: 'set_length', target: dim.targetId, length: value };
  const o = doc.openings.find((x) => x.id === dim.targetId);
  const host = o && doc.walls.find((w) => w.id === o.wallId);
  if (!o || !host) return null;
  const len = wallLength(host);
  const offset = dim.kind === 'opening-start' ? value : len - o.width - value;
  return { op: 'move_opening', target: dim.targetId, offset: Math.max(0, offset) };
}

// ─── 3D wall segments (shared with the extrude view) ────────────────────────

export interface WallSegment {
  s: number;
  e: number;
  z0: number;
  z1: number;
}

/** Vertical extent an opening cuts out of its wall: [sill, head] in mm. */
export function openingCut(o: Opening, wallHeight: number): { sill: number; head: number } {
  if (o.kind === 'window') {
    const sill = o.sill ?? DEFAULTS.windowSill;
    return { sill, head: Math.min(wallHeight, sill + (o.height ?? DEFAULTS.windowHeight)) };
  }
  // Doors and plain openings start at the floor.
  return { sill: 0, head: Math.min(wallHeight, o.height ?? DEFAULTS.doorHeight) };
}

/** Solid wall segments along a wall's length, cut by its doors/windows: a
 *  window leaves wall below the sill and above the head; a door leaves a
 *  header above its height (unless it reaches the wall top). */
export function wallSegments(wall: Wall, doc: PlanDoc, defaultHeight: number = DEFAULTS.wallHeight): WallSegment[] {
  const height = wall.height ?? defaultHeight;
  const L = wallLength(wall);
  const openings = doc.openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => ({ ...o, s: Math.max(0, o.offset), e: Math.min(L, o.offset + o.width) }))
    .sort((a, b) => a.s - b.s);
  const segs: WallSegment[] = [];
  let cursor = 0;
  for (const o of openings) {
    if (o.s > cursor) segs.push({ s: cursor, e: o.s, z0: 0, z1: height });
    const { sill, head } = openingCut(o, height);
    if (sill > 0) segs.push({ s: o.s, e: o.e, z0: 0, z1: sill });
    if (head < height) segs.push({ s: o.s, e: o.e, z0: head, z1: height });
    cursor = Math.max(cursor, o.e);
  }
  if (cursor < L) segs.push({ s: cursor, e: L, z0: 0, z1: height });
  return segs;
}
