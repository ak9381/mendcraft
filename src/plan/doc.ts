// 2D architectural PLAN document model. Pure data + geometry helpers only —
// no DOM, no three.js, no AI. Units are millimetres internally; the UI labels
// lengths in metres. World is Y-up (increasing y is "north"/up on screen).
//
// A plan is a set of walls (centreline a->b + thickness), openings (doors and
// windows that sit on a wall), rooms (named loops of walls, area computed from
// geometry), and linear dimensions linked to a wall (value always re-derived,
// so a dimension can never drift from the wall it measures).
//
// ─── How a future 'ui' mode reuses this shape ─────────────────────────────
// The shell is generic over a *document + typed ops + validate + engine +
// renderer + exporter + AI schema + rule parser* (see core/controller.ts and
// core/modes.ts). A 'ui' mode would define its own UiDoc (frames/stacks/text/
// buttons) and UiOp union exactly like PlanDoc/PlanOp here, a validateUiOp
// mirroring validatePlanOp, a UiEngine like PlanEngine, an HTML/CSS exporter
// like export.ts, and a ui/ai.ts like plan/ai.ts — then register one extra
// EditorMode entry. Nothing in the shared shell is plan-specific.

export interface Point {
  x: number;
  y: number;
}

/** A straight wall segment defined by its centreline a->b, with a thickness. */
export interface Wall {
  id: string;
  a: Point;
  b: Point;
  /** Wall thickness in mm (drawn as a band straddling the centreline). */
  thickness: number;
  /** Wall height in mm for the 3D view (defaults to 2500). */
  height?: number;
}

export type OpeningKind = 'door' | 'window' | 'opening';
/** Which side a door leaf swings towards (purely a drawing hint). */
export type Swing = 'left' | 'right';

/** A door or window sitting on a wall. `offset` is mm from the wall's `a` end to
 *  the opening's near edge; the opening spans [offset, offset + width]. */
export interface Opening {
  id: string;
  kind: OpeningKind;
  wallId: string;
  offset: number;
  width: number;
  /** Doors only; ignored for windows. */
  swing?: Swing;
  /** Windows: sill height above floor in mm (defaults to 900). */
  sill?: number;
  /** Vertical extent in mm: door leaf height / window glazing height. */
  height?: number;
}

/** A free-standing furniture/fixture item (sofa, WC, basin, …): a rotated
 *  rectangle centred on (x, y), `w` × `d` mm, `rotation` degrees CCW. */
export interface Fixture {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  d: number;
  rotation: number;
}

/** A free-standing text annotation placed on the plan (mm position, mm font
 *  height). Edited inline or via the properties panel. */
export interface TextLabel {
  id: string;
  x: number;
  y: number;
  text: string;
  /** Font height in mm (world units), default 300. */
  size: number;
}

/** A named room: an ordered loop of wall ids. Area is derived from geometry. */
export interface Room {
  id: string;
  name: string;
  wallIds: string[];
}

/** A linear dimension: pinned to a wall (value always re-derived from the wall)
 *  OR a free aligned dimension between two fixed points (from Measure). */
export interface Dimension {
  id: string;
  wallId?: string;
  a?: Point;
  b?: Point;
}

/** Measured value of a dimension (wall length or point distance), in mm. */
export function dimLength(dim: Dimension, doc: PlanDoc): number | null {
  if (dim.wallId) {
    const w = doc.walls.find((x) => x.id === dim.wallId);
    return w ? wallLength(w) : null;
  }
  if (dim.a && dim.b) return Math.hypot(dim.b.x - dim.a.x, dim.b.y - dim.a.y);
  return null;
}

export interface PlanDoc {
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  dims: Dimension[];
  fixtures: Fixture[];
  texts: TextLabel[];
  /** Primary selection (last picked), or null. */
  selectedId: string | null;
  /** Full multi-selection; selectedId is always a member (or both empty). */
  selectedIds: string[];
}

export function emptyPlan(): PlanDoc {
  return { walls: [], openings: [], rooms: [], dims: [], fixtures: [], texts: [], selectedId: null, selectedIds: [] };
}

// ─── Geometry helpers (all pure) ──────────────────────────────────────────

export function wallLength(w: Wall): number {
  return Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
}

/** Unit direction a->b; falls back to +x for a degenerate (zero-length) wall. */
export function wallDir(w: Wall): Point {
  const len = wallLength(w);
  if (len < 1e-6) return { x: 1, y: 0 };
  return { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len };
}

/** Left-hand unit normal to the wall (perpendicular, pointing +90° from dir). */
export function wallNormal(w: Wall): Point {
  const d = wallDir(w);
  return { x: -d.y, y: d.x };
}

/** Point at `offset` mm from `a` along the wall centreline. */
export function pointAlong(w: Wall, offset: number): Point {
  const d = wallDir(w);
  return { x: w.a.x + d.x * offset, y: w.a.y + d.y * offset };
}

export function wallMidpoint(w: Wall): Point {
  return { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
}

/** Signed polygon area (shoelace) in mm². */
export function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Ordered polygon of a room, walked from its wall loop. Each wall contributes
 * the endpoint that is NOT shared with the previous wall, so the vertex order
 * follows the loop regardless of each wall's a/b direction. Returns null if the
 * walls do not form a connected chain (e.g. after a delete) — callers then skip
 * area for that room rather than drawing a bogus polygon.
 */
export function roomPolygon(room: Room, doc: PlanDoc): Point[] | null {
  const walls = room.wallIds
    .map((id) => doc.walls.find((w) => w.id === id))
    .filter((w): w is Wall => !!w);
  if (walls.length < 3) return null;

  const same = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) < 1;
  const pts: Point[] = [];
  // Seed with the first wall oriented so its b end meets the next wall.
  const first = walls[0];
  const second = walls[1];
  let cursor: Point;
  if (same(first.b, second.a) || same(first.b, second.b)) {
    pts.push(first.a);
    cursor = first.b;
  } else if (same(first.a, second.a) || same(first.a, second.b)) {
    pts.push(first.b);
    cursor = first.a;
  } else {
    return null;
  }
  for (let i = 1; i < walls.length; i++) {
    const w = walls[i];
    if (same(w.a, cursor)) {
      pts.push(w.a);
      cursor = w.b;
    } else if (same(w.b, cursor)) {
      pts.push(w.b);
      cursor = w.a;
    } else {
      return null;
    }
  }
  return pts;
}

/** Room area in mm² (0 when the loop is open/degenerate). */
export function roomArea(room: Room, doc: PlanDoc): number {
  const poly = roomPolygon(room, doc);
  return poly ? polygonArea(poly) : 0;
}

/** Centroid of a room's polygon, for placing its name/area label. */
export function roomCentroid(room: Room, doc: PlanDoc): Point | null {
  const poly = roomPolygon(room, doc);
  if (!poly) return null;
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

/** Axis-aligned bounds of everything in the plan (null when empty). */
export function planBounds(doc: PlanDoc): { min: Point; max: Point } | null {
  if (doc.walls.length === 0) return null;
  const min: Point = { x: Infinity, y: Infinity };
  const max: Point = { x: -Infinity, y: -Infinity };
  for (const w of doc.walls) {
    for (const p of [w.a, w.b]) {
      min.x = Math.min(min.x, p.x);
      min.y = Math.min(min.y, p.y);
      max.x = Math.max(max.x, p.x);
      max.y = Math.max(max.y, p.y);
    }
  }
  return { min, max };
}

// ─── Labels ───────────────────────────────────────────────────────────────

/** Format a mm length as metres with 2 decimals, e.g. 4000 -> "4.00 m". */
export function mmToMetresLabel(mm: number): string {
  return `${(mm / 1000).toFixed(2)} m`;
}

/** Format a mm² area as m² with 2 decimals, e.g. 12_000_000 -> "12.00 m²". */
export function mm2ToM2Label(mm2: number): string {
  return `${(mm2 / 1_000_000).toFixed(2)} m²`;
}

/** Find any plan object (wall/opening/room/dim/fixture) by id. */
export function findObject(
  doc: PlanDoc,
  id: string,
): { kind: 'wall' | 'opening' | 'room' | 'dim' | 'fixture' | 'text'; obj: Wall | Opening | Room | Dimension | Fixture | TextLabel } | null {
  const w = doc.walls.find((o) => o.id === id);
  if (w) return { kind: 'wall', obj: w };
  const o = doc.openings.find((x) => x.id === id);
  if (o) return { kind: 'opening', obj: o };
  const r = doc.rooms.find((x) => x.id === id);
  if (r) return { kind: 'room', obj: r };
  const d = doc.dims.find((x) => x.id === id);
  if (d) return { kind: 'dim', obj: d };
  const f = doc.fixtures.find((x) => x.id === id);
  if (f) return { kind: 'fixture', obj: f };
  const t = doc.texts.find((x) => x.id === id);
  if (t) return { kind: 'text', obj: t };
  return null;
}
