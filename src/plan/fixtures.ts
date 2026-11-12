// Catalogue of plan COMPONENTS — stairs, columns, and furniture/sanitary
// fixtures — plus their 2D architectural symbols, 3D block heights, DXF layers,
// and wall-snapping math. Everything a "component" is lives here as pure data:
// the engine stores each one as a generic `Fixture` (rotated rect + kind), and
// the renderer, 3D view and DXF exporter all look its behaviour up by kind. No
// DOM, no three.js — unit-tested. All mm / degrees, Y-up.

import { wallDir, wallNormal, type Fixture, type Point, type Wall } from './doc';
import { normalizeAngle } from './editing';
import { projectToWall } from './hosting';

const DEG = 180 / Math.PI;

/** Which real-world family a component belongs to — drives the palette group
 *  and the DXF layer it exports onto. */
export type FixtureGroup = 'structure' | 'furniture' | 'sanitary';

/** DXF layer a component lands on (CAD-standard A- names). */
export type FixtureLayer = 'A-FLOR-STRS' | 'A-COLS' | 'A-FURN' | 'A-FLOR-FIXT';

export interface FixtureSpec {
  kind: string;
  label: string;
  icon: string;
  group: FixtureGroup;
  /** Default width (local x, along a wall when snapped) in mm. */
  w: number;
  /** Default depth (local y, into the room) in mm. */
  d: number;
  /** 3D block height in mm (full-storey for stairs/columns). */
  height: number;
  /** 3D base offset off the floor in mm (wall-mounted items sit higher). */
  base?: number;
  /** Outer footprint drawn in 2D / DXF. Columns are round. */
  outline: 'rect' | 'round';
  /** True when the component naturally backs against a wall (sofa, WC, …). */
  snapsToWall?: boolean;
  layer: FixtureLayer;
}

const LAYER: Record<FixtureGroup, FixtureLayer> = {
  structure: 'A-COLS', // overridden per-kind for stairs
  furniture: 'A-FURN',
  sanitary: 'A-FLOR-FIXT',
};

function spec(s: Omit<FixtureSpec, 'layer'> & { layer?: FixtureLayer }): FixtureSpec {
  return { ...s, layer: s.layer ?? LAYER[s.group] };
}

/** The full component catalogue, keyed by kind. */
export const FIXTURES: Record<string, FixtureSpec> = Object.fromEntries(
  [
    // ── Structure ────────────────────────────────────────────────────────────
    spec({ kind: 'stairs', label: 'Stairs', icon: '▦', group: 'structure', w: 3000, d: 1000, height: 3000, outline: 'rect', layer: 'A-FLOR-STRS' }),
    spec({ kind: 'column-square', label: 'Column', icon: '◼', group: 'structure', w: 400, d: 400, height: 3000, outline: 'rect', layer: 'A-COLS' }),
    spec({ kind: 'column-round', label: 'Round column', icon: '●', group: 'structure', w: 400, d: 400, height: 3000, outline: 'round', layer: 'A-COLS' }),
    // ── Furniture ────────────────────────────────────────────────────────────
    spec({ kind: 'bed-single', label: 'Single bed', icon: '🛏', group: 'furniture', w: 1000, d: 2000, height: 500, outline: 'rect', snapsToWall: true }),
    spec({ kind: 'bed-double', label: 'Double bed', icon: '🛏', group: 'furniture', w: 1500, d: 2000, height: 500, outline: 'rect', snapsToWall: true }),
    spec({ kind: 'sofa', label: 'Sofa', icon: '🛋', group: 'furniture', w: 2000, d: 900, height: 800, outline: 'rect', snapsToWall: true }),
    spec({ kind: 'dining-table', label: 'Dining table', icon: '▭', group: 'furniture', w: 1600, d: 900, height: 750, outline: 'rect' }),
    spec({ kind: 'chair', label: 'Chair', icon: '▢', group: 'furniture', w: 450, d: 450, height: 850, outline: 'rect' }),
    spec({ kind: 'desk', label: 'Desk', icon: '▬', group: 'furniture', w: 1400, d: 700, height: 750, outline: 'rect', snapsToWall: true }),
    spec({ kind: 'kitchen-counter', label: 'Counter', icon: '▭', group: 'furniture', w: 2000, d: 600, height: 900, outline: 'rect', snapsToWall: true }),
    spec({ kind: 'wardrobe', label: 'Wardrobe', icon: '▯', group: 'furniture', w: 1200, d: 600, height: 2000, outline: 'rect', snapsToWall: true }),
    // ── Sanitary ─────────────────────────────────────────────────────────────
    spec({ kind: 'toilet', label: 'Toilet', icon: '🚽', group: 'sanitary', w: 400, d: 700, height: 400, outline: 'rect', snapsToWall: true }),
    spec({ kind: 'sink', label: 'Sink', icon: '◗', group: 'sanitary', w: 600, d: 450, height: 850, outline: 'rect', snapsToWall: true }),
    spec({ kind: 'bathtub', label: 'Bathtub', icon: '▭', group: 'sanitary', w: 1700, d: 750, height: 550, outline: 'rect', snapsToWall: true }),
    spec({ kind: 'shower', label: 'Shower', icon: '▣', group: 'sanitary', w: 900, d: 900, height: 2000, base: 0, outline: 'rect', snapsToWall: true }),
  ].map((s) => [s.kind, s]),
);

/** Lookup with a safe fallback so an unknown kind still renders sensibly. */
export function fixtureSpec(kind: string): FixtureSpec {
  return (
    FIXTURES[kind] ?? {
      kind, label: kind, icon: '▭', group: 'furniture', w: 600, d: 600, height: 500, outline: 'rect', layer: 'A-FURN',
    }
  );
}

/** 3D block height in mm for a component kind. */
export function fixtureHeight(kind: string): number {
  return fixtureSpec(kind).height;
}

/** DXF layer a component kind exports onto. */
export function fixtureLayer(kind: string): FixtureLayer {
  return fixtureSpec(kind).layer;
}

/** Catalogue entries for one palette group, in display order. */
export function fixturesInGroup(group: FixtureGroup): FixtureSpec[] {
  return Object.values(FIXTURES).filter((s) => s.group === group);
}

// ─── 2D symbols ───────────────────────────────────────────────────────────

/** A drawing primitive in LOCAL fixture space (origin = centre, before the
 *  fixture's rotation/translation). Consumed by the renderer (→ SVG) and the
 *  DXF exporter (→ LINE/CIRCLE), so the symbol is authored exactly once. */
export type SymPrim =
  | { t: 'line'; a: Point; b: Point }
  | { t: 'circle'; c: Point; r: number }
  | { t: 'poly'; pts: Point[]; close?: boolean };

/** Number of treads a straight stair run of `lengthMm` reads as (≈ 300 mm
 *  going per step, clamped to a drawable range). */
export function stairStepCount(lengthMm: number): number {
  return Math.max(2, Math.min(40, Math.round(Math.abs(lengthMm) / 300)));
}

/** Interior detail lines of a component in LOCAL space (the outer footprint is
 *  drawn separately from `outline`). Recognisable architectural symbols. */
export function fixtureSymbol(f: Pick<Fixture, 'kind' | 'w' | 'd'>): SymPrim[] {
  const hw = f.w / 2;
  const hd = f.d / 2;
  const out: SymPrim[] = [];
  const line = (ax: number, ay: number, bx: number, by: number) => out.push({ t: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by } });

  switch (f.kind) {
    case 'stairs': {
      const n = stairStepCount(f.w);
      const step = f.w / n;
      for (let i = 1; i < n; i++) {
        const x = -hw + i * step;
        line(x, -hd, x, hd);
      }
      // Direction arrow (up the run, +x), head at the far end.
      line(-hw * 0.8, 0, hw * 0.8, 0);
      line(hw * 0.8, 0, hw * 0.8 - step, hd * 0.4);
      line(hw * 0.8, 0, hw * 0.8 - step, -hd * 0.4);
      return out;
    }
    case 'column-square':
    case 'column-round':
      return out; // the footprint is the whole symbol
    case 'bed-single':
    case 'bed-double': {
      // Pillow band along the head (−y), and a duvet fold line.
      const pillow = -hd + f.d * 0.18;
      line(-hw, pillow, hw, pillow);
      if (f.kind === 'bed-double') line(0, -hd, 0, pillow); // twin pillows
      line(-hw, hd - f.d * 0.1, hw, hd - f.d * 0.1);
      return out;
    }
    case 'sofa': {
      const back = -hd + f.d * 0.28;
      line(-hw, back, hw, back); // back cushion line
      line(-hw + f.w * 0.1, back, -hw + f.w * 0.1, hd); // left arm
      line(hw - f.w * 0.1, back, hw - f.w * 0.1, hd); // right arm
      line(0, back, 0, hd); // seat split
      return out;
    }
    case 'dining-table':
      out.push({ t: 'poly', pts: rectPts(hw * 0.8, hd * 0.8), close: true });
      return out;
    case 'chair':
      line(-hw, -hd + f.d * 0.25, hw, -hd + f.d * 0.25); // backrest
      return out;
    case 'desk':
      line(-hw, hd - f.d * 0.25, hw, hd - f.d * 0.25); // worktop lip
      return out;
    case 'kitchen-counter':
      out.push({ t: 'circle', c: { x: hw * 0.4, y: 0 }, r: Math.min(hd, hw) * 0.4 }); // hob/sink
      line(-hw, 0, hw * 0.1, 0);
      return out;
    case 'wardrobe':
      line(0, -hd, 0, hd); // double doors
      line(-hw, -hd, hw, hd); // hanging-rail indication
      return out;
    case 'toilet':
      out.push({ t: 'circle', c: { x: 0, y: hd * 0.15 }, r: Math.min(hw, hd * 0.6) }); // bowl
      line(-hw, -hd, hw, -hd); // cistern face
      return out;
    case 'sink':
      out.push({ t: 'circle', c: { x: 0, y: 0 }, r: Math.min(hw, hd) * 0.7 }); // basin
      return out;
    case 'bathtub':
      out.push({ t: 'poly', pts: rectPts(hw * 0.86, hd * 0.72), close: true }); // inner tub
      out.push({ t: 'circle', c: { x: -hw * 0.68, y: 0 }, r: Math.min(hw, hd) * 0.12 }); // drain
      return out;
    case 'shower':
      line(-hw, -hd, hw, hd); // drain-to-corner diagonals
      line(-hw, hd, hw, -hd);
      out.push({ t: 'circle', c: { x: 0, y: 0 }, r: Math.min(hw, hd) * 0.12 }); // drain
      return out;
    default:
      return out;
  }
}

function rectPts(hw: number, hd: number): Point[] {
  return [
    { x: -hw, y: -hd }, { x: hw, y: -hd }, { x: hw, y: hd }, { x: -hw, y: hd },
  ];
}

/** Map a LOCAL symbol point to world mm, applying the fixture's rotation +
 *  centre. Shared by the renderer and DXF exporter. */
export function fixtureLocalToWorld(f: Pick<Fixture, 'x' | 'y' | 'rotation'>, p: Point): Point {
  const rad = (f.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: f.x + p.x * c - p.y * s, y: f.y + p.x * s + p.y * c };
}

// ─── Wall snapping ──────────────────────────────────────────────────────────

/**
 * Back a wall-hugging component against the nearest wall within `radius` mm of
 * its centre: orient it parallel to the wall and sit its back edge on the wall
 * face (interior side), returning the new centre + rotation. Null when no wall
 * is close enough (caller then grid-snaps instead).
 */
export function snapFixtureToWall(
  f: Pick<Fixture, 'x' | 'y' | 'd'>,
  walls: Wall[],
  radius: number,
): { x: number; y: number; rotation: number } | null {
  const centre = { x: f.x, y: f.y };
  let best: { wall: Wall; point: Point; dist: number } | null = null;
  for (const w of walls) {
    const proj = projectToWall(centre, w);
    if (proj.dist <= radius && (!best || proj.dist < best.dist)) best = { wall: w, point: proj.point, dist: proj.dist };
  }
  if (!best) return null;
  const { wall, point } = best;
  const dir = wallDir(wall);
  const n = wallNormal(wall);
  const side = (centre.x - point.x) * n.x + (centre.y - point.y) * n.y >= 0 ? 1 : -1;
  const half = wall.thickness / 2;
  const face = { x: point.x + n.x * half * side, y: point.y + n.y * half * side };
  const x = face.x + n.x * side * (f.d / 2);
  const y = face.y + n.y * side * (f.d / 2);
  let rotation = normalizeAngle(Math.atan2(dir.y, dir.x) * DEG);
  if (side < 0) rotation = normalizeAngle(rotation + 180); // keep the back on the wall
  return { x, y, rotation };
}
