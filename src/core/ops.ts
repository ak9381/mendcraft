// Op vocabulary + hand-written runtime validator.
// Every op that reaches the engine — whether from the rule parser, on-device
// Nano, or cloud Gemini — must pass validateOp() first. AI output is never trusted.

export type Axis = 'x' | 'y' | 'z';
export type Shape = 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Part id, or the symbolic refs 'selected' / 'last' (resolved by the engine). */
export type TargetRef = string;

export interface BoxParams {
  w: number;
  d: number;
  h: number;
}
export interface CylinderParams {
  diameter: number;
  height: number;
}
export interface SphereParams {
  diameter: number;
}
export interface ConeParams {
  diameter: number;
  height: number;
  topDiameter?: number;
}
export interface TorusParams {
  /** Ring centreline diameter in mm. */
  diameter: number;
  /** Tube diameter in mm. */
  tube: number;
}

export type ShapeParams =
  | BoxParams
  | CylinderParams
  | SphereParams
  | ConeParams
  | TorusParams;

export interface AddOp {
  op: 'add';
  shape: Shape;
  params: ShapeParams;
  position?: Vec3;
  name?: string;
}
export interface MoveOp {
  op: 'move';
  target: TargetRef;
  dx: number;
  dy: number;
  dz: number;
}
export interface RotateOp {
  op: 'rotate';
  target: TargetRef;
  axis: Axis;
  deg: number;
}
export interface ScaleOp {
  op: 'scale';
  target: TargetRef;
  /** Uniform factor. */
  factor?: number;
  /** Per-axis factors (missing axes = 1). */
  factors?: Partial<Vec3>;
  /** Absolute growth in mm per axis ("taller by 5"); engine converts to factors. */
  deltaMm?: Partial<Vec3>;
}
export interface HoleOp {
  op: 'hole';
  target: TargetRef;
  diameter: number;
  depth: number | 'through';
  axis: Axis;
  offset?: Vec3;
}
export interface SubtractOp {
  op: 'subtract';
  target: TargetRef;
  tool: TargetRef;
}
export interface UnionOp {
  op: 'union';
  targets: TargetRef[];
}
export type AlignMode = 'center' | 'top' | 'left' | 'right' | 'front' | 'back';
export interface AlignOp {
  op: 'align';
  target: TargetRef;
  to: 'floor' | string;
  mode: AlignMode;
}
export interface MirrorOp {
  op: 'mirror';
  target: TargetRef;
  axis: Axis;
}
export interface ArrayOp {
  op: 'array';
  target: TargetRef;
  /** Total copies including the original. */
  count: number;
  spacing: number;
  axis: Axis;
}
export interface FilletOp {
  op: 'fillet';
  target: TargetRef;
  radius: number;
}
export interface DeleteOp {
  op: 'delete';
  target: TargetRef;
}
export interface SelectOp {
  op: 'select';
  target: TargetRef;
}
export interface UndoOp {
  op: 'undo';
}
export interface RedoOp {
  op: 'redo';
}

export type Op =
  | AddOp
  | MoveOp
  | RotateOp
  | ScaleOp
  | HoleOp
  | SubtractOp
  | UnionOp
  | AlignOp
  | MirrorOp
  | ArrayOp
  | FilletOp
  | DeleteOp
  | SelectOp
  | UndoOp
  | RedoOp;

export type OpName = Op['op'];

export const OP_NAMES: readonly OpName[] = [
  'add',
  'move',
  'rotate',
  'scale',
  'hole',
  'subtract',
  'union',
  'align',
  'mirror',
  'array',
  'fillet',
  'delete',
  'select',
  'undo',
  'redo',
] as const;

export const SHAPES: readonly Shape[] = ['box', 'cylinder', 'sphere', 'cone', 'torus'] as const;
export const AXES: readonly Axis[] = ['x', 'y', 'z'] as const;
export const ALIGN_MODES: readonly AlignMode[] = ['center', 'top', 'left', 'right', 'front', 'back'] as const;

// Sane mm ranges for a 220x220x250 print bed workflow.
export const LIMITS = {
  size: { min: 0.5, max: 300 },
  position: { min: -500, max: 500 },
  offset: { min: -150, max: 150 },
  deg: { min: -360, max: 360 },
  factor: { min: 0.05, max: 20 },
  delta: { min: -250, max: 250 },
  count: { min: 2, max: 20 },
  spacing: { min: 0.1, max: 300 },
  filletRadius: { min: 0.2, max: 30 },
} as const;

export type ValidationResult = { ok: true; op: Op } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Coerce to a finite number clamped into [lo, hi]; undefined if not numeric. */
function num(v: unknown, lo: number, hi: number): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return clamp(n, lo, hi);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function axis(v: unknown): Axis | undefined {
  return v === 'x' || v === 'y' || v === 'z' ? v : undefined;
}

function vec3(v: unknown, lo: number, hi: number): Vec3 | undefined {
  if (!isObj(v)) return undefined;
  const x = num(v.x, lo, hi) ?? 0;
  const y = num(v.y, lo, hi) ?? 0;
  const z = num(v.z, lo, hi) ?? 0;
  return { x, y, z };
}

function partialVec3(v: unknown, lo: number, hi: number): Partial<Vec3> | undefined {
  if (!isObj(v)) return undefined;
  const out: Partial<Vec3> = {};
  for (const a of AXES) {
    if (v[a] !== undefined) {
      const n = num(v[a], lo, hi);
      if (n === undefined) return undefined;
      out[a] = n;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

const fail = (error: string): ValidationResult => ({ ok: false, error });

function validateShapeParams(shape: Shape, raw: unknown): ShapeParams | string {
  const p = isObj(raw) ? raw : {};
  const { min, max } = LIMITS.size;
  const sz = (v: unknown) => num(v, min, max);
  switch (shape) {
    case 'box': {
      const w = sz(p.w);
      const d = sz(p.d);
      const h = sz(p.h);
      if (w === undefined || d === undefined || h === undefined)
        return 'box needs numeric w, d, h (mm)';
      return { w, d, h };
    }
    case 'cylinder': {
      const diameter = sz(p.diameter);
      const height = sz(p.height);
      if (diameter === undefined || height === undefined)
        return 'cylinder needs numeric diameter and height (mm)';
      return { diameter, height };
    }
    case 'sphere': {
      const diameter = sz(p.diameter);
      if (diameter === undefined) return 'sphere needs numeric diameter (mm)';
      return { diameter };
    }
    case 'cone': {
      const diameter = sz(p.diameter);
      const height = sz(p.height);
      if (diameter === undefined || height === undefined)
        return 'cone needs numeric diameter and height (mm)';
      const topDiameter = p.topDiameter === undefined ? undefined : sz(p.topDiameter);
      return topDiameter === undefined ? { diameter, height } : { diameter, height, topDiameter };
    }
    case 'torus': {
      const diameter = sz(p.diameter);
      const tube = sz(p.tube);
      if (diameter === undefined || tube === undefined)
        return 'torus needs numeric diameter and tube (mm)';
      return { diameter, tube };
    }
  }
}

/**
 * Validate (and clamp) an untrusted value into a well-formed Op.
 * Numbers out of range are clamped, not rejected; wrong types/missing fields reject.
 */
export function validateOp(raw: unknown): ValidationResult {
  if (!isObj(raw)) return fail('op must be an object');
  const name = raw.op;
  if (typeof name !== 'string' || !(OP_NAMES as readonly string[]).includes(name))
    return fail(`unknown op "${String(name)}"`);

  const target = () => str(raw.target);

  switch (name as OpName) {
    case 'add': {
      const shape = raw.shape;
      if (typeof shape !== 'string' || !(SHAPES as readonly string[]).includes(shape))
        return fail(`unknown shape "${String(raw.shape)}"`);
      const params = validateShapeParams(shape as Shape, raw.params);
      if (typeof params === 'string') return fail(params);
      const op: AddOp = { op: 'add', shape: shape as Shape, params };
      const pos = raw.position === undefined ? undefined : vec3(raw.position, LIMITS.position.min, LIMITS.position.max);
      if (pos) op.position = pos;
      const nm = str(raw.name);
      if (nm) op.name = nm;
      return { ok: true, op };
    }
    case 'move': {
      const t = target();
      if (!t) return fail('move needs a target');
      const { min, max } = LIMITS.position;
      const dx = num(raw.dx, min, max) ?? 0;
      const dy = num(raw.dy, min, max) ?? 0;
      const dz = num(raw.dz, min, max) ?? 0;
      if (raw.dx === undefined && raw.dy === undefined && raw.dz === undefined)
        return fail('move needs at least one of dx, dy, dz');
      return { ok: true, op: { op: 'move', target: t, dx, dy, dz } };
    }
    case 'rotate': {
      const t = target();
      const a = axis(raw.axis);
      const deg = num(raw.deg, LIMITS.deg.min, LIMITS.deg.max);
      if (!t) return fail('rotate needs a target');
      if (!a) return fail('rotate needs axis x|y|z');
      if (deg === undefined) return fail('rotate needs numeric deg');
      return { ok: true, op: { op: 'rotate', target: t, axis: a, deg } };
    }
    case 'scale': {
      const t = target();
      if (!t) return fail('scale needs a target');
      const factor = raw.factor === undefined ? undefined : num(raw.factor, LIMITS.factor.min, LIMITS.factor.max);
      const factors = raw.factors === undefined ? undefined : partialVec3(raw.factors, LIMITS.factor.min, LIMITS.factor.max);
      const deltaMm = raw.deltaMm === undefined ? undefined : partialVec3(raw.deltaMm, LIMITS.delta.min, LIMITS.delta.max);
      if (factor === undefined && !factors && !deltaMm)
        return fail('scale needs factor, factors, or deltaMm');
      const op: ScaleOp = { op: 'scale', target: t };
      if (factor !== undefined) op.factor = factor;
      if (factors) op.factors = factors;
      if (deltaMm) op.deltaMm = deltaMm;
      return { ok: true, op };
    }
    case 'hole': {
      const t = target();
      if (!t) return fail('hole needs a target');
      const diameter = num(raw.diameter, LIMITS.size.min, LIMITS.size.max);
      if (diameter === undefined) return fail('hole needs numeric diameter (mm)');
      let depth: number | 'through';
      if (raw.depth === 'through' || raw.depth === undefined) depth = 'through';
      else {
        const d = num(raw.depth, LIMITS.size.min, LIMITS.size.max);
        if (d === undefined) return fail('hole depth must be a number (mm) or "through"');
        depth = d;
      }
      const a = axis(raw.axis) ?? 'z';
      const op: HoleOp = { op: 'hole', target: t, diameter, depth, axis: a };
      const off = raw.offset === undefined ? undefined : vec3(raw.offset, LIMITS.offset.min, LIMITS.offset.max);
      if (off) op.offset = off;
      return { ok: true, op };
    }
    case 'subtract': {
      const t = target();
      const tool = str(raw.tool);
      if (!t || !tool) return fail('subtract needs target and tool');
      return { ok: true, op: { op: 'subtract', target: t, tool } };
    }
    case 'union': {
      const ts = Array.isArray(raw.targets) ? raw.targets.map(str).filter((s): s is string => !!s) : [];
      if (ts.length < 2) return fail('union needs at least 2 targets');
      return { ok: true, op: { op: 'union', targets: ts } };
    }
    case 'align': {
      const t = target();
      const to = str(raw.to);
      if (!t) return fail('align needs a target');
      if (!to) return fail('align needs "to" (floor or a part id)');
      const mode =
        typeof raw.mode === 'string' && (ALIGN_MODES as readonly string[]).includes(raw.mode)
          ? (raw.mode as AlignMode)
          : 'center';
      return { ok: true, op: { op: 'align', target: t, to, mode } };
    }
    case 'mirror': {
      const t = target();
      const a = axis(raw.axis);
      if (!t) return fail('mirror needs a target');
      if (!a) return fail('mirror needs axis x|y|z');
      return { ok: true, op: { op: 'mirror', target: t, axis: a } };
    }
    case 'array': {
      const t = target();
      if (!t) return fail('array needs a target');
      const countRaw = num(raw.count, LIMITS.count.min, LIMITS.count.max);
      const spacing = num(raw.spacing, LIMITS.spacing.min, LIMITS.spacing.max);
      if (countRaw === undefined) return fail('array needs numeric count');
      if (spacing === undefined) return fail('array needs numeric spacing (mm)');
      const a = axis(raw.axis) ?? 'x';
      return { ok: true, op: { op: 'array', target: t, count: Math.round(countRaw), spacing, axis: a } };
    }
    case 'fillet': {
      const t = target();
      const radius = num(raw.radius, LIMITS.filletRadius.min, LIMITS.filletRadius.max);
      if (!t) return fail('fillet needs a target');
      if (radius === undefined) return fail('fillet needs numeric radius (mm)');
      return { ok: true, op: { op: 'fillet', target: t, radius } };
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

export interface TargetContext {
  selectedId: string | null;
  lastId: string | null;
  ids: readonly string[];
}

/**
 * Resolve 'selected' / 'last' / explicit id to a concrete part id.
 * 'selected' falls back to the last part so voice commands work before any pinch.
 */
export function resolveTarget(ref: TargetRef, ctx: TargetContext): string | undefined {
  if (ref === 'selected') {
    const id = ctx.selectedId ?? ctx.lastId;
    return id && ctx.ids.includes(id) ? id : undefined;
  }
  if (ref === 'last') {
    return ctx.lastId && ctx.ids.includes(ctx.lastId) ? ctx.lastId : undefined;
  }
  return ctx.ids.includes(ref) ? ref : undefined;
}
