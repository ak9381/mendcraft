// UI op vocabulary + hand-written runtime validator. Every op reaching UiEngine
// — from the rule parser, on-device Nano, or cloud Gemini — passes validateUiOp
// first. Untrusted model output is never applied raw: numbers are read from
// `nums` (or the top level, which small models sometimes use), clamped to sane
// px ranges; colours normalised; bad types reject with a short reason.
//
// Envelope: { op, target?, parent?, nodeType?, nums{...}, text?, ... }

import type { Align, FontWeight, FramePreset, InputType, Justify, StackDir, TextRole, UiNodeType } from './doc';
import { toColor } from './colors';

export type UiOpName =
  | 'add_frame'
  | 'add_node'
  | 'set_text'
  | 'set_size'
  | 'set_fill'
  | 'set_style'
  | 'set_layout'
  | 'move'
  | 'delete'
  | 'select';

export const UI_OP_NAMES: readonly UiOpName[] = [
  'add_frame', 'add_node', 'set_text', 'set_size', 'set_fill', 'set_style',
  'set_layout', 'move', 'delete', 'select',
] as const;

export interface AddFrameOp { op: 'add_frame'; preset: FramePreset }
export interface AddNodeOp {
  op: 'add_node';
  nodeType: Exclude<UiNodeType, never>;
  parent?: string;
  index?: number;
  text?: string;
  role?: TextRole;
  label?: string;
  placeholder?: string;
  inputType?: InputType;
  fill?: string;
}
export interface SetTextOp { op: 'set_text'; target: string; text: string }
export interface SetSizeOp { op: 'set_size'; target: string; w?: number; h?: number }
export interface SetFillOp { op: 'set_fill'; target: string; fill: string }
export interface SetStyleOp {
  op: 'set_style';
  target: string;
  size?: number;
  weight?: FontWeight;
  radius?: number;
  color?: string;
}
export interface SetLayoutOp {
  op: 'set_layout';
  target: string;
  direction?: StackDir;
  gap?: number;
  padding?: number;
  align?: Align;
  justify?: Justify;
}
/** Reorder within the parent stack (delta up/down) or move into another stack. */
export interface MoveOp { op: 'move'; target: string; parent?: string; index?: number; delta?: number }
export interface DeleteOp { op: 'delete'; target: string }
export interface SelectOp { op: 'select'; target: string }

export type UiOp =
  | AddFrameOp | AddNodeOp | SetTextOp | SetSizeOp | SetFillOp
  | SetStyleOp | SetLayoutOp | MoveOp | DeleteOp | SelectOp;

export const UI_LIMITS = {
  size: { min: 4, max: 4000 },
  fontSize: { min: 8, max: 160 },
  radius: { min: 0, max: 200 },
  gap: { min: 0, max: 200 },
  padding: { min: 0, max: 400 },
  height: { min: 8, max: 2000 },
} as const;

export const UI_DEFAULTS = {
  buttonHeight: 44,
  buttonRadius: 8,
  buttonFill: '#2563eb',
  buttonText: '#ffffff',
  inputHeight: 44,
  headingSize: 30,
  headingWeight: 700 as FontWeight,
  bodySize: 16,
  bodyWeight: 400 as FontWeight,
  textColor: '#0f172a',
  imageW: 320,
  imageH: 180,
  rectW: 160,
  rectH: 80,
  rectFill: '#e2e8f0',
  gap: 16,
  padding: 24,
} as const;

export type UiValidation = { ok: true; op: UiOp } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const fail = (error: string): UiValidation => ({ ok: false, error });

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}
function rawNum(raw: Record<string, unknown>, key: string): unknown {
  const nums = isObj(raw.nums) ? raw.nums : undefined;
  if (nums && nums[key] !== undefined) return nums[key];
  return raw[key];
}
function toNum(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

const NODE_TYPES: readonly UiNodeType[] = ['stack', 'text', 'button', 'input', 'image', 'rect'];
const ALIGNS: readonly Align[] = ['start', 'center', 'end', 'stretch'];
const JUSTIFIES: readonly Justify[] = ['start', 'center', 'end', 'between'];
const INPUT_TYPES: readonly InputType[] = ['text', 'email', 'password'];

function weightOf(v: unknown): FontWeight | undefined {
  const n = toNum(v);
  if (n === undefined) {
    const s = str(v)?.toLowerCase();
    if (s === 'bold') return 700;
    if (s === 'semibold' || s === 'medium') return 600;
    if (s === 'normal' || s === 'regular') return 400;
    return undefined;
  }
  if (n >= 700) return 700;
  if (n >= 600) return 600;
  if (n >= 500) return 500;
  return 400;
}

/** Validate (and clamp) an untrusted envelope into a well-formed UiOp. */
export function validateUiOp(raw: unknown): UiValidation {
  if (!isObj(raw)) return fail('op must be an object');
  const name = raw.op;
  if (typeof name !== 'string' || !(UI_OP_NAMES as readonly string[]).includes(name))
    return fail(`unknown op "${String(name)}"`);
  const num = (key: string, lo: number, hi: number): number | undefined => {
    const n = toNum(rawNum(raw, key));
    return n === undefined ? undefined : clamp(n, lo, hi);
  };
  const target = () => str(raw.target);

  switch (name as UiOpName) {
    case 'add_frame': {
      const p = str(raw.preset)?.toLowerCase();
      const preset: FramePreset = p === 'mobile' || p === 'phone' ? 'mobile' : 'desktop';
      return { ok: true, op: { op: 'add_frame', preset } };
    }
    case 'add_node': {
      const t = str(raw.nodeType)?.toLowerCase() as UiNodeType | undefined;
      if (!t || !NODE_TYPES.includes(t)) return fail('add_node needs a valid nodeType');
      const op: AddNodeOp = { op: 'add_node', nodeType: t };
      const parent = str(raw.parent);
      if (parent) op.parent = parent;
      const idx = num('index', 0, 999);
      if (idx !== undefined) op.index = Math.round(idx);
      const text = str(raw.text);
      if (text) op.text = text;
      const role = str(raw.role)?.toLowerCase();
      if (role === 'heading' || role === 'body') op.role = role;
      const label = str(raw.label);
      if (label) op.label = label;
      const placeholder = str(raw.placeholder);
      if (placeholder) op.placeholder = placeholder;
      const it = str(raw.inputType)?.toLowerCase() as InputType | undefined;
      if (it && INPUT_TYPES.includes(it)) op.inputType = it;
      const fill = toColor(raw.fill);
      if (fill) op.fill = fill;
      return { ok: true, op };
    }
    case 'set_text': {
      const t = target();
      if (!t) return fail('set_text needs a target');
      const text = typeof raw.text === 'string' ? raw.text : str(raw.value);
      if (text === undefined) return fail('set_text needs text');
      return { ok: true, op: { op: 'set_text', target: t, text } };
    }
    case 'set_size': {
      const t = target();
      if (!t) return fail('set_size needs a target');
      const w = num('w', UI_LIMITS.size.min, UI_LIMITS.size.max);
      const h = num('h', UI_LIMITS.size.min, UI_LIMITS.size.max);
      if (w === undefined && h === undefined) return fail('set_size needs w or h');
      const op: SetSizeOp = { op: 'set_size', target: t };
      if (w !== undefined) op.w = w;
      if (h !== undefined) op.h = h;
      return { ok: true, op };
    }
    case 'set_fill': {
      const t = target();
      if (!t) return fail('set_fill needs a target');
      const fill = toColor(raw.fill) ?? toColor(raw.color) ?? toColor(raw.value);
      if (!fill) return fail('set_fill needs a colour');
      return { ok: true, op: { op: 'set_fill', target: t, fill } };
    }
    case 'set_style': {
      const t = target();
      if (!t) return fail('set_style needs a target');
      const op: SetStyleOp = { op: 'set_style', target: t };
      const size = num('size', UI_LIMITS.fontSize.min, UI_LIMITS.fontSize.max);
      if (size !== undefined) op.size = size;
      const weight = weightOf(rawNum(raw, 'weight'));
      if (weight !== undefined) op.weight = weight;
      const radius = num('radius', UI_LIMITS.radius.min, UI_LIMITS.radius.max);
      if (radius !== undefined) op.radius = radius;
      const color = toColor(raw.color) ?? toColor(raw.textColor);
      if (color) op.color = color;
      if (op.size === undefined && op.weight === undefined && op.radius === undefined && op.color === undefined)
        return fail('set_style needs size, weight, radius, or color');
      return { ok: true, op };
    }
    case 'set_layout': {
      const t = target();
      if (!t) return fail('set_layout needs a target');
      const op: SetLayoutOp = { op: 'set_layout', target: t };
      const dir = str(raw.direction)?.toLowerCase();
      if (dir === 'row' || dir === 'column') op.direction = dir;
      const gap = num('gap', UI_LIMITS.gap.min, UI_LIMITS.gap.max);
      if (gap !== undefined) op.gap = gap;
      const padding = num('padding', UI_LIMITS.padding.min, UI_LIMITS.padding.max);
      if (padding !== undefined) op.padding = padding;
      const align = str(raw.align)?.toLowerCase() as Align | undefined;
      if (align && ALIGNS.includes(align)) op.align = align;
      const justify = str(raw.justify)?.toLowerCase() as Justify | undefined;
      if (justify && JUSTIFIES.includes(justify)) op.justify = justify;
      if (op.direction === undefined && op.gap === undefined && op.padding === undefined &&
        op.align === undefined && op.justify === undefined)
        return fail('set_layout needs a property to change');
      return { ok: true, op };
    }
    case 'move': {
      const t = target();
      if (!t) return fail('move needs a target');
      const op: MoveOp = { op: 'move', target: t };
      const parent = str(raw.parent);
      if (parent) op.parent = parent;
      const idx = num('index', 0, 999);
      if (idx !== undefined) op.index = Math.round(idx);
      const delta = toNum(rawNum(raw, 'delta'));
      if (delta !== undefined) op.delta = Math.sign(delta) * Math.min(99, Math.abs(Math.round(delta)));
      if (op.parent === undefined && op.index === undefined && op.delta === undefined)
        return fail('move needs delta, index, or parent');
      return { ok: true, op };
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
  }
}
