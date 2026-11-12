// UI-mode AI: the on-device intent prompt + compact responseConstraint, the
// cloud "generate a whole screen" prompt + document constraint, the verifier,
// and the coercion/expansion that turns untrusted model JSON (or rules output)
// into a validated UiOp or a whole Frame. Nothing here talks to Firebase;
// hybrid.ts converts these plain JSON-Schema constraints into Firebase `Schema`
// objects and re-validates everything via validateUiOp.

import type { Clarify } from '../../core/ruleParser';
import {
  FRAME_PRESETS,
  type ButtonNode,
  type Frame,
  type FramePreset,
  type ImageNode,
  type InputNode,
  type RectNode,
  type StackNode,
  type TextNode,
  type UiNode,
} from './doc';
import { UI_DEFAULTS, validateUiOp, type UiOp } from './ops';
import { toColor } from './colors';

/** Max nodes a single cloud "generate" may expand to (hard cap, in code). */
export const MAX_GENERATE_NODES = 40;

const NUM = { type: 'number' } as const;
const STR = { type: 'string' } as const;

/** Compact on-device constraint for one UI edit op. Kept small (Nano context). */
export const UI_OP_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: {
    op: STR,
    target: STR,
    parent: STR,
    nodeType: STR,
    preset: STR,
    text: STR,
    role: STR,
    label: STR,
    placeholder: STR,
    inputType: STR,
    fill: STR,
    color: STR,
    direction: STR,
    align: STR,
    justify: STR,
    nums: {
      type: 'object',
      properties: { w: NUM, h: NUM, size: NUM, weight: NUM, radius: NUM, gap: NUM, padding: NUM, delta: NUM, index: NUM },
    },
    clarify: STR,
  },
};

/** One compact node the cloud generator may emit (one level of nesting). */
const NODE_SCHEMA = {
  type: 'object',
  required: ['type'],
  properties: {
    type: STR, text: STR, role: STR, label: STR, placeholder: STR,
    inputType: STR, fill: STR, color: STR, direction: STR, align: STR, justify: STR,
    size: NUM, weight: NUM, radius: NUM, w: NUM, h: NUM, gap: NUM, padding: NUM,
    children: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type'],
        properties: {
          type: STR, text: STR, role: STR, label: STR, placeholder: STR,
          inputType: STR, fill: STR, color: STR, size: NUM, weight: NUM, radius: NUM, w: NUM, h: NUM,
        },
      },
    },
  },
} as const;

/** Cloud constraint for a whole generated screen: a DOCUMENT, not raw ops. */
export const UI_GENERATE_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  required: ['nodes'],
  properties: {
    preset: STR,
    background: STR,
    align: STR,
    justify: STR,
    gap: NUM,
    padding: NUM,
    nodes: { type: 'array', items: NODE_SCHEMA },
    clarify: STR,
  },
};

export const UI_VERIFY_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: { matchesIntent: { type: 'boolean' }, issue: STR },
};

export const UI_INTENT_PROMPT = `You convert one short spoken command for a UI/screen layout editor into ONE JSON op. Sizes are pixels. Use target "selected" unless the user names a node (id or a thing like "the button", "email field", "heading"). Reply with JSON only, no prose.
Ops (exact shapes):
{"op":"add_frame","preset":"desktop|mobile"}
{"op":"add_node","nodeType":"text|button|input|image|rect|stack","role":"heading|body"?,"text"?,"label"?,"placeholder"?,"inputType":"text|email|password"?}
{"op":"set_text","target","text"}
{"op":"set_size","target","nums":{"w"?,"h"?}}
{"op":"set_fill","target","fill":"blue|#0ea5e9|..."}
{"op":"set_style","target","nums":{"size"?,"weight"?,"radius"?},"color"?}
{"op":"set_layout","target","direction":"row|column"?,"nums":{"gap"?,"padding"?},"align":"start|center|end|stretch"?,"justify":"start|center|end|between"?}
{"op":"move","target","nums":{"delta"}}   (delta -1 = up, +1 = down)
{"op":"delete","target"} {"op":"select","target"}
Examples:
"make the button blue" -> {"op":"set_fill","target":"button","fill":"blue"}
"make it 48 pixels tall" -> {"op":"set_size","target":"selected","nums":{"h":48}}
"add a password field" -> {"op":"add_node","nodeType":"input","inputType":"password","label":"Password"}
"add a button called Sign up" -> {"op":"add_node","nodeType":"button","label":"Sign up"}
"bigger heading" -> {"op":"set_style","target":"heading","nums":{"size":40}}
"center it" -> {"op":"set_layout","target":"selected","align":"center","justify":"center"}
If unclear, reply {"clarify":"<short question>"}.`;

export const UI_GENERATE_PROMPT = `You design ONE whole, believable UI screen as a JSON DOCUMENT (NOT ops). Reply JSON only, no prose:
{"preset":"desktop|mobile","padding":32,"gap":16,"align":"stretch","nodes":[{"type":"text","role":"heading","text":"Welcome back"},{"type":"input","inputType":"email","label":"Email"},{"type":"input","inputType":"password","label":"Password"},{"type":"button","label":"Sign in","fill":"blue"}]}
Rules: "nodes" is REQUIRED and non-empty, laid out top-to-bottom in a column. Node "type" is one of text|button|input|image|rect|stack. A text node has role heading|body and "text". A button has "label" and optional "fill". An input has inputType text|email|password and a "label". A stack has "direction" row|column and "children":[...] (use a row of stacks for pricing cards). Keep it to at most ${MAX_GENERATE_NODES} nodes. Pick "preset":"mobile" for phone screens, else "desktop". If unclear, reply {"clarify":"<short question>"}.`;

export const UI_VERIFY_PROMPT = `You check whether a UI edit did what the op intended. Reply JSON only: {"matchesIntent":true|false,"issue":null or "<short issue>"}.`;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Repair a model op that named a valid op but under-filled it, using the
 *  deterministic parse of the SAME utterance (model fields win). */
function repairUiOp(raw: Record<string, unknown>, utterance: string, parse: (u: string) => unknown): Record<string, unknown> | null {
  if (typeof raw.op !== 'string') return null;
  const ruled = parse(utterance);
  if (!isObj(ruled) || ruled.op !== raw.op) return null;
  return { ...ruled, ...raw };
}

/** Coerce untrusted JSON into a validated single UI op, a clarify, or null. */
export function coerceUi(
  raw: unknown,
  utterance?: string,
  parse?: (u: string) => unknown,
): UiOp | Clarify | null {
  if (!isObj(raw)) return null;
  if (typeof raw.clarify === 'string' && raw.clarify.trim()) return { clarify: raw.clarify.trim() };
  let v = validateUiOp(raw);
  if (!v.ok && utterance && parse) {
    const repaired = repairUiOp(raw, utterance, parse);
    if (repaired) v = validateUiOp(repaired);
  }
  if (!v.ok) {
    if (typeof raw.op === 'string') console.warn(`[mendcraft] ui op "${raw.op}" rejected: ${v.error}`, raw);
    return null;
  }
  return v.op;
}

// ── Whole-screen document → Frame expansion ───────────────────────────────

let expandCounter = 0;
function freshId(used: Set<string>, base: string): string {
  const slug = (base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)) || 'node';
  if (!used.has(slug)) { used.add(slug); return slug; }
  for (let i = 2; i < 1000; i++) {
    const c = `${slug}-${i}`;
    if (!used.has(c)) { used.add(c); return c; }
  }
  const c = `${slug}-${++expandCounter}`;
  used.add(c);
  return c;
}

function buildNode(raw: unknown, used: Set<string>, budget: { n: number }): UiNode | null {
  if (!isObj(raw) || budget.n <= 0) return null;
  budget.n--;
  const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
  const num = (k: string): number | undefined => {
    const v = raw[k];
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
  };
  switch (type) {
    case 'text': {
      const role = raw.role === 'heading' ? 'heading' : 'body';
      const text = typeof raw.text === 'string' && raw.text.trim() ? raw.text.trim() : role === 'heading' ? 'Heading' : 'Text';
      const node: TextNode = {
        id: freshId(used, `${role === 'heading' ? 'heading' : 'text'}-${text}`),
        type: 'text', role, text,
        size: num('size') ?? (role === 'heading' ? UI_DEFAULTS.headingSize : UI_DEFAULTS.bodySize),
        weight: (role === 'heading' ? UI_DEFAULTS.headingWeight : UI_DEFAULTS.bodyWeight),
        color: toColor(raw.color) ?? UI_DEFAULTS.textColor,
      };
      return node;
    }
    case 'button': {
      const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : 'Button';
      const node: ButtonNode = {
        id: freshId(used, `btn-${label}`), type: 'button', label,
        fill: toColor(raw.fill) ?? UI_DEFAULTS.buttonFill, textColor: toColor(raw.color) ?? UI_DEFAULTS.buttonText,
        radius: num('radius') ?? UI_DEFAULTS.buttonRadius, height: num('h') ?? UI_DEFAULTS.buttonHeight,
      };
      return node;
    }
    case 'input': {
      const it = raw.inputType === 'email' || raw.inputType === 'password' ? raw.inputType : 'text';
      const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : it === 'email' ? 'Email' : it === 'password' ? 'Password' : 'Field';
      const node: InputNode = {
        id: freshId(used, `input-${label}`), type: 'input', label,
        placeholder: typeof raw.placeholder === 'string' ? raw.placeholder : label,
        inputType: it, height: num('h') ?? UI_DEFAULTS.inputHeight,
      };
      return node;
    }
    case 'image': {
      const node: ImageNode = { id: freshId(used, 'image'), type: 'image', w: num('w') ?? UI_DEFAULTS.imageW, h: num('h') ?? UI_DEFAULTS.imageH, radius: num('radius') ?? 8 };
      return node;
    }
    case 'rect': {
      const node: RectNode = { id: freshId(used, 'rect'), type: 'rect', fill: toColor(raw.fill) ?? UI_DEFAULTS.rectFill, w: num('w') ?? UI_DEFAULTS.rectW, h: num('h') ?? UI_DEFAULTS.rectH, radius: num('radius') ?? 8 };
      return node;
    }
    case 'stack': {
      const kids: UiNode[] = [];
      if (Array.isArray(raw.children)) {
        for (const c of raw.children) {
          const built = buildNode(c, used, budget);
          if (built) kids.push(built);
        }
      }
      const node: StackNode = {
        id: freshId(used, 'stack'),
        type: 'stack',
        direction: raw.direction === 'row' ? 'row' : 'column',
        gap: num('gap') ?? UI_DEFAULTS.gap,
        padding: num('padding') ?? (raw.fill ? 24 : 0),
        align: (raw.align === 'center' || raw.align === 'end' || raw.align === 'start' || raw.align === 'stretch') ? raw.align : 'stretch',
        justify: (raw.justify === 'center' || raw.justify === 'end' || raw.justify === 'between' || raw.justify === 'start') ? raw.justify : 'start',
        children: kids,
        ...(toColor(raw.fill) ? { fill: toColor(raw.fill), radius: num('radius') ?? 12 } : {}),
        ...(num('width') !== undefined ? { width: num('width') } : {}),
      };
      return node;
    }
    default:
      return null;
  }
}

/** Expand a whole-screen document into a validated Frame (or null). */
export function expandUiDocument(raw: Record<string, unknown>): Frame | null {
  const presetRaw = typeof raw.preset === 'string' ? raw.preset.toLowerCase() : 'desktop';
  const preset: FramePreset = presetRaw === 'mobile' || presetRaw === 'phone' ? 'mobile' : 'desktop';
  const { w, h, label } = FRAME_PRESETS[preset];
  const used = new Set<string>();
  const budget = { n: MAX_GENERATE_NODES };
  const num = (k: string): number | undefined => {
    const v = raw[k];
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
  };
  const children: UiNode[] = [];
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  for (const nd of nodes) {
    const built = buildNode(nd, used, budget);
    if (built) children.push(built);
  }
  if (!children.length) return null;
  const rootId = freshId(used, `${preset}-root`);
  const root: StackNode = {
    id: rootId, type: 'stack', direction: 'column',
    gap: num('gap') ?? UI_DEFAULTS.gap,
    padding: num('padding') ?? 32,
    align: (raw.align === 'center' || raw.align === 'end' || raw.align === 'start' || raw.align === 'stretch') ? raw.align : 'stretch',
    justify: (raw.justify === 'center' || raw.justify === 'end' || raw.justify === 'between') ? raw.justify : 'start',
    children,
  };
  const frameId = freshId(used, `frame-${preset}`);
  return { id: frameId, type: 'frame', name: label, preset, w, h, background: toColor(raw.background) ?? '#ffffff', root };
}

/** Coerce an untrusted whole-screen response into a Frame, a clarify, or null. */
export function coerceUiGenerate(raw: unknown): { frame: Frame } | Clarify | null {
  if (!isObj(raw)) return null;
  if (typeof raw.clarify === 'string' && raw.clarify.trim()) return { clarify: raw.clarify.trim() };
  if (Array.isArray(raw.nodes)) {
    const frame = expandUiDocument(raw);
    return frame ? { frame } : null;
  }
  return null;
}

/** "login screen", "landing page", "pricing section", "design a dashboard" → cloud. */
export function isUiDesignRequest(utterance: string): boolean {
  const t = utterance.trim().toLowerCase();
  if (!t) return false;
  if (/\b(login|sign in|signin|signup|sign up|landing|hero|pricing|screen|page|dashboard|form|checkout|profile|settings|onboarding)\b/.test(t)) return true;
  if (/\bdesign\b/.test(t) && /\b(screen|page|ui|app|site|layout)\b/.test(t)) return true;
  return false;
}
