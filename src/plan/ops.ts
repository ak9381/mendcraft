// PLAN op vocabulary + hand-written runtime validator.
// Every op that reaches PlanEngine — from the rule parser, on-device Nano, or
// cloud Gemini — must pass validatePlanOp() first. AI output is never trusted:
// numbers are unit-converted to mm and clamped to sane ranges; wrong
// types/missing fields reject with a short reason.
//
// Ops share the Nano-sized envelope { op, target?, nums{...}, unit?, ... }:
//   { "op": "set_length", "target": "wall-2", "nums": { "length": 4 }, "unit": "m" }
// Validation flattens `nums` (and also tolerates the same fields placed at the
// top level, which small models sometimes do) and converts by `unit`.

import type { Point, Swing } from './doc';

export type PlanOpName =
  | 'add_room'
  | 'add_wall'
  | 'add_door'
  | 'add_window'
  | 'add_opening'
  | 'add_dim'
  | 'set_length'
  | 'move'
  | 'offset'
  | 'set_thickness'
  | 'rename'
  | 'delete'
  | 'select'
  | 'set_swing'
  | 'move_opening'
  | 'set_width'
  | 'move_end'
  | 'undo'
  | 'redo';

export const PLAN_OP_NAMES: readonly PlanOpName[] = [
  'add_room', 'add_wall', 'add_door', 'add_window', 'add_opening', 'add_dim', 'set_length',
  'move', 'offset', 'set_thickness', 'rename', 'delete', 'select',
  'set_swing', 'move_opening', 'set_width', 'move_end', 'undo', 'redo',
] as const;

export interface AddRoomOp {
  op: 'add_room';
  x: number;
  y: number;
  w: number;
  h: number;
  name?: string;
}
export interface AddWallOp {
  op: 'add_wall';
  a: Point;
  b: Point;
  thickness: number;
}
export interface AddDoorOp {
  op: 'add_door';
  target: string;
  offset?: number;
  width: number;
  swing: Swing;
}
export interface AddWindowOp {
  op: 'add_window';
  target: string;
  offset?: number;
  width: number;
}
/** A plain wall cut (no leaf/arc, no glazing) — e.g. an open passage. */
export interface AddOpeningOp {
  op: 'add_opening';
  target: string;
  offset?: number;
  width: number;
}
/** Flip (no swing given) or set a door's swing side. */
export interface SetSwingOp {
  op: 'set_swing';
  target: string;
  swing?: Swing;
}
/** Slide a hosted opening along its wall to a new near-edge offset (clamped). */
export interface MoveOpeningOp {
  op: 'move_opening';
  target: string;
  offset: number;
}
/** Resize a hosted opening's width (clamped inside its wall). */
export interface SetWidthOp {
  op: 'set_width';
  target: string;
  width: number;
}
/** Move one endpoint of a wall (dragging its handle); coincident endpoints of
 *  connected walls follow, as with `move`. */
export interface MoveEndOp {
  op: 'move_end';
  target: string;
  end: 'a' | 'b';
  x: number;
  y: number;
}
export interface AddDimOp {
  op: 'add_dim';
  target: string;
}
export interface SetLengthOp {
  op: 'set_length';
  target: string;
  length: number;
}
export interface MoveWallOp {
  op: 'move';
  target: string;
  dx: number;
  dy: number;
}
export interface OffsetWallOp {
  op: 'offset';
  target: string;
  dist: number;
}
export interface SetThicknessOp {
  op: 'set_thickness';
  target: string;
  /** Absolute thickness in mm, OR a relative delta ("thicker by 50"). */
  thickness?: number;
  delta?: number;
}
export interface RenameOp {
  op: 'rename';
  target: string;
  name: string;
}
export interface DeleteOp {
  op: 'delete';
  target: string;
}
export interface SelectOp {
  op: 'select';
  target: string;
}
export interface UndoOp {
  op: 'undo';
}
export interface RedoOp {
  op: 'redo';
}

export type PlanOp =
  | AddRoomOp
  | AddWallOp
  | AddDoorOp
  | AddWindowOp
  | AddOpeningOp
  | AddDimOp
  | SetSwingOp
  | MoveOpeningOp
  | SetWidthOp
  | MoveEndOp
  | SetLengthOp
  | MoveWallOp
  | OffsetWallOp
  | SetThicknessOp
  | RenameOp
  | DeleteOp
  | SelectOp
  | UndoOp
  | RedoOp;

// Sane mm ranges for architectural plans (a room-to-building scale).
export const PLAN_LIMITS = {
  coord: { min: -100_000, max: 100_000 },
  size: { min: 100, max: 50_000 },
  wallLen: { min: 100, max: 50_000 },
  thickness: { min: 50, max: 1_000 },
  openingWidth: { min: 300, max: 20_000 },
  move: { min: -100_000, max: 100_000 },
  offset: { min: -50_000, max: 50_000 },
} as const;

export const DEFAULTS = {
  thickness: 100,
  doorWidth: 900,
  windowWidth: 1200,
  doorSwing: 'left' as Swing,
} as const;

export type PlanValidation = { ok: true; op: PlanOp } | { ok: false; error: string };

const UNIT_TO_MM: Record<string, number> = { mm: 1, cm: 10, m: 1000 };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const fail = (error: string): PlanValidation => ({ ok: false, error });

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** Read a numeric field from `nums` first, then the top level (model slop). */
function rawNum(raw: Record<string, unknown>, key: string): unknown {
  const nums = isObj(raw.nums) ? raw.nums : undefined;
  if (nums && nums[key] !== undefined) return nums[key];
  return raw[key];
}

/** Coerce to finite number; undefined if not numeric. */
function toNum(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/**
 * Validate (and clamp) an untrusted envelope into a well-formed PlanOp.
 * Spatial numbers are converted to mm by the envelope `unit` and clamped;
 * out-of-range values clamp rather than reject, matching the part validator.
 */
export function validatePlanOp(raw: unknown): PlanValidation {
  if (!isObj(raw)) return fail('op must be an object');
  const name = raw.op;
  if (typeof name !== 'string' || !(PLAN_OP_NAMES as readonly string[]).includes(name))
    return fail(`unknown op "${String(name)}"`);

  const unit = typeof raw.unit === 'string' ? UNIT_TO_MM[raw.unit] ?? 1 : 1;
  /** Read field → number in mm, clamped; undefined if missing/non-numeric. */
  const mm = (key: string, lo: number, hi: number): number | undefined => {
    const n = toNum(rawNum(raw, key));
    return n === undefined ? undefined : clamp(n * unit, lo, hi);
  };
  const target = () => str(raw.target);

  switch (name as PlanOpName) {
    case 'add_room': {
      const { coord, size } = PLAN_LIMITS;
      const x = mm('x', coord.min, coord.max);
      const y = mm('y', coord.min, coord.max);
      const w = mm('w', size.min, size.max);
      const h = mm('h', size.min, size.max);
      if (x === undefined || y === undefined || w === undefined || h === undefined)
        return fail('add_room needs numeric x, y, w, h');
      const op: AddRoomOp = { op: 'add_room', x, y, w, h };
      const nm = str(raw.name);
      if (nm) op.name = nm;
      return { ok: true, op };
    }
    case 'add_wall': {
      const { coord } = PLAN_LIMITS;
      // Accept x1/y1/x2/y2 (preferred) or ax/ay/bx/by.
      const ax = mm('x1', coord.min, coord.max) ?? mm('ax', coord.min, coord.max);
      const ay = mm('y1', coord.min, coord.max) ?? mm('ay', coord.min, coord.max);
      const bx = mm('x2', coord.min, coord.max) ?? mm('bx', coord.min, coord.max);
      const by = mm('y2', coord.min, coord.max) ?? mm('by', coord.min, coord.max);
      if (ax === undefined || ay === undefined || bx === undefined || by === undefined)
        return fail('add_wall needs numeric x1, y1, x2, y2');
      const len = Math.hypot(bx - ax, by - ay);
      if (len < PLAN_LIMITS.wallLen.min) return fail('add_wall is too short');
      const thickness = mm('thickness', PLAN_LIMITS.thickness.min, PLAN_LIMITS.thickness.max) ?? DEFAULTS.thickness;
      return { ok: true, op: { op: 'add_wall', a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness } };
    }
    case 'add_door':
    case 'add_window':
    case 'add_opening': {
      const t = target();
      if (!t) return fail(`${name} needs a target wall`);
      const def = name === 'add_window' ? DEFAULTS.windowWidth : DEFAULTS.doorWidth;
      const width = mm('width', PLAN_LIMITS.openingWidth.min, PLAN_LIMITS.openingWidth.max) ?? def;
      const offset = mm('offset', PLAN_LIMITS.coord.min, PLAN_LIMITS.coord.max);
      if (name === 'add_door') {
        const swing: Swing = raw.swing === 'right' ? 'right' : DEFAULTS.doorSwing;
        const op: AddDoorOp = { op: 'add_door', target: t, width, swing };
        if (offset !== undefined) op.offset = offset;
        return { ok: true, op };
      }
      const op: AddWindowOp | AddOpeningOp = {
        op: name === 'add_window' ? 'add_window' : 'add_opening',
        target: t,
        width,
      };
      if (offset !== undefined) op.offset = offset;
      return { ok: true, op };
    }
    case 'set_swing': {
      const t = target();
      if (!t) return fail('set_swing needs a target door');
      const op: SetSwingOp = { op: 'set_swing', target: t };
      if (raw.swing === 'left' || raw.swing === 'right') op.swing = raw.swing;
      return { ok: true, op };
    }
    case 'move_opening': {
      const t = target();
      if (!t) return fail('move_opening needs a target opening');
      const offset = mm('offset', 0, PLAN_LIMITS.coord.max);
      if (offset === undefined) return fail('move_opening needs a numeric offset');
      return { ok: true, op: { op: 'move_opening', target: t, offset } };
    }
    case 'set_width': {
      const t = target();
      if (!t) return fail('set_width needs a target opening');
      const width = mm('width', PLAN_LIMITS.openingWidth.min, PLAN_LIMITS.openingWidth.max);
      if (width === undefined) return fail('set_width needs a numeric width');
      return { ok: true, op: { op: 'set_width', target: t, width } };
    }
    case 'move_end': {
      const t = target();
      if (!t) return fail('move_end needs a target wall');
      const end = raw.end === 'a' || raw.end === 'b' ? raw.end : undefined;
      if (!end) return fail("move_end needs end 'a' or 'b'");
      const { coord } = PLAN_LIMITS;
      const x = mm('x', coord.min, coord.max);
      const y = mm('y', coord.min, coord.max);
      if (x === undefined || y === undefined) return fail('move_end needs numeric x, y');
      return { ok: true, op: { op: 'move_end', target: t, end, x, y } };
    }
    case 'add_dim': {
      const t = target();
      if (!t) return fail('add_dim needs a target wall');
      return { ok: true, op: { op: 'add_dim', target: t } };
    }
    case 'set_length': {
      const t = target();
      if (!t) return fail('set_length needs a target wall');
      const length = mm('length', PLAN_LIMITS.wallLen.min, PLAN_LIMITS.wallLen.max);
      if (length === undefined) return fail('set_length needs a numeric length');
      return { ok: true, op: { op: 'set_length', target: t, length } };
    }
    case 'move': {
      const t = target();
      if (!t) return fail('move needs a target');
      const dx = mm('dx', PLAN_LIMITS.move.min, PLAN_LIMITS.move.max) ?? 0;
      const dy = mm('dy', PLAN_LIMITS.move.min, PLAN_LIMITS.move.max) ?? 0;
      if (rawNum(raw, 'dx') === undefined && rawNum(raw, 'dy') === undefined)
        return fail('move needs dx or dy');
      return { ok: true, op: { op: 'move', target: t, dx, dy } };
    }
    case 'offset': {
      const t = target();
      if (!t) return fail('offset needs a target wall');
      const dist = mm('dist', PLAN_LIMITS.offset.min, PLAN_LIMITS.offset.max);
      if (dist === undefined) return fail('offset needs a numeric distance');
      return { ok: true, op: { op: 'offset', target: t, dist } };
    }
    case 'set_thickness': {
      const t = target();
      if (!t) return fail('set_thickness needs a target wall');
      // Absolute thickness, or a relative delta ("thicker by 50"). The delta is
      // clamped to the swing of the thickness range (engine re-clamps the sum).
      const thickness = mm('thickness', PLAN_LIMITS.thickness.min, PLAN_LIMITS.thickness.max);
      const span = PLAN_LIMITS.thickness.max - PLAN_LIMITS.thickness.min;
      const delta = mm('delta', -span, span);
      if (thickness === undefined && delta === undefined)
        return fail('set_thickness needs a thickness or a delta');
      const op: SetThicknessOp = { op: 'set_thickness', target: t };
      if (thickness !== undefined) op.thickness = thickness;
      if (delta !== undefined) op.delta = delta;
      return { ok: true, op };
    }
    case 'rename': {
      const t = target();
      const nm = str(raw.name);
      if (!t) return fail('rename needs a target');
      if (!nm) return fail('rename needs a name');
      return { ok: true, op: { op: 'rename', target: t, name: nm } };
    }
    case 'delete': {
      const t = target();
      if (!t) return fail('delete needs a target');
      return { ok: true, op: { op: 'delete', target: t } };
    }
    case 'select': {
      const t = target();
      if (!t) return fail('select needs a target');
      return { ok: true, op: { op: 'select', target: t } };
    }
    case 'undo':
      return { ok: true, op: { op: 'undo' } };
    case 'redo':
      return { ok: true, op: { op: 'redo' } };
  }
}
