// The CAD tool set: every canvas action as a TYPED tool that Nano (on device)
// and Gemini (cloud) can call from her words, and that her own buttons and
// gestures map onto too. A tool call is untrusted input: args are checked here,
// then turned into either a plan op ENVELOPE (re-validated by validatePlanOp in
// the controller) or an app action (view, 3D, walk, checks). Edits made by an
// AI never apply directly — they go to the change log as pending proposals.

import { isLayerId, LAYERS } from './layers';
import { REGION_IDS } from './guidelines';

export type ToolKind = 'edit' | 'view' | 'info';

export interface CadTool {
  name: string;
  kind: ToolKind;
  /** Plain words for the change log and the prompt. */
  description: string;
  /** Plain-JSON-Schema properties of the args. */
  params: Record<string, Record<string, unknown>>;
  /** Required arg names. */
  required?: string[];
}

const N = { type: 'number' };
const S = { type: 'string' };
const B = { type: 'boolean' };

export const CAD_TOOLS: readonly CadTool[] = [
  // ── Drawing edits (→ plan ops) ──
  { name: 'add_wall', kind: 'edit', description: 'Draw a wall from (ax,ay) to (bx,by), mm.', params: { ax: N, ay: N, bx: N, by: N, thickness: N }, required: ['ax', 'ay', 'bx', 'by'] },
  { name: 'add_room', kind: 'edit', description: 'Draw a rectangular room at (x,y) of w by h mm, with a name.', params: { x: N, y: N, w: N, h: N, name: S }, required: ['w', 'h'] },
  { name: 'add_door', kind: 'edit', description: 'Put a door on a wall (target = wall id or "selected").', params: { target: S, width: N, swing: S } },
  { name: 'add_window', kind: 'edit', description: 'Put a window on a wall.', params: { target: S, width: N } },
  { name: 'add_fixture', kind: 'edit', description: 'Place furniture or fittings (sofa, bed-double, wc, basin, column-square...) at (x,y).', params: { kind: S, x: N, y: N, w: N, d: N, rotation: N }, required: ['kind', 'x', 'y'] },
  { name: 'add_dim', kind: 'edit', description: 'Add a dimension to a wall.', params: { target: S } },
  { name: 'add_text', kind: 'edit', description: 'Write a note on the plan at (x,y).', params: { x: N, y: N, text: S, size: N }, required: ['text'] },
  { name: 'move', kind: 'edit', description: 'Move an item by dx, dy mm.', params: { target: S, dx: N, dy: N } },
  { name: 'set_length', kind: 'edit', description: 'Set a wall length in mm.', params: { target: S, length: N }, required: ['length'] },
  { name: 'set_thickness', kind: 'edit', description: 'Set a wall thickness in mm.', params: { target: S, thickness: N }, required: ['thickness'] },
  { name: 'set_width', kind: 'edit', description: 'Set a door or window width in mm.', params: { target: S, width: N }, required: ['width'] },
  { name: 'set_size', kind: 'edit', description: 'Resize furniture or stairs: w (length) and/or d (depth) mm.', params: { target: S, w: N, d: N } },
  { name: 'set_height', kind: 'edit', description: 'Set a wall, door or window height in mm.', params: { target: S, height: N }, required: ['height'] },
  { name: 'rotate', kind: 'edit', description: 'Rotate furniture or a door by degrees.', params: { target: S, angle: N }, required: ['angle'] },
  { name: 'rename', kind: 'edit', description: 'Rename a room.', params: { target: S, name: S }, required: ['name'] },
  { name: 'delete', kind: 'edit', description: 'Delete an item.', params: { target: S } },
  { name: 'add_stair', kind: 'edit', description: 'Design and place a straight staircase for a floor-to-floor height (mm), with its legend.', params: { floorHeight: N, width: N, dir: S } },
  { name: 'fix_guideline', kind: 'edit', description: 'Apply the suggested fix for one guideline finding (issue id).', params: { issueId: S }, required: ['issueId'] },
  { name: 'undo', kind: 'edit', description: 'Undo the last change.', params: {} },
  { name: 'redo', kind: 'edit', description: 'Redo.', params: {} },
  // ── View (never a drawing change) ──
  { name: 'select', kind: 'view', description: 'Select an item by id or room name.', params: { target: S }, required: ['target'] },
  { name: 'zoom', kind: 'view', description: 'Zoom: "in", "out" or "fit".', params: { to: S }, required: ['to'] },
  { name: 'show_layer', kind: 'view', description: `Show or hide a layer (${LAYERS.join(', ')}).`, params: { layer: S, visible: B }, required: ['layer'] },
  { name: 'view_3d', kind: 'view', description: 'Turn the 3D view on or off.', params: { on: B } },
  { name: 'walkthrough', kind: 'view', description: 'Start or stop a first-person walk through the plan in 3D (optionally starting in a room).', params: { on: B, room: S } },
  { name: 'walk_step', kind: 'view', description: 'During a walk: forward, back, left, right, turn_left, turn_right.', params: { step: S }, required: ['step'] },
  { name: 'set_materials', kind: 'view', description: 'Dress the 3D view with materials and light for a style (e.g. "warm", "bright", "evening", or any words).', params: { style: S } },
  // ── Checks and questions (read-only) ──
  { name: 'guideline_check', kind: 'info', description: `Check the plan against design guidelines (region: ${REGION_IDS.join(', ')}).`, params: { region: S } },
  { name: 'measure', kind: 'info', description: 'Answer a question about the drawing\'s own numbers (wall thickness, room size, door width...).', params: { question: S }, required: ['question'] },
  { name: 'ask_gemini', kind: 'info', description: 'A hard question that needs research beyond the drawing. Offline it is saved to the site checklist.', params: { question: S }, required: ['question'] },
];

export const TOOL_NAMES = CAD_TOOLS.map((t) => t.name);
const BY_NAME = new Map(CAD_TOOLS.map((t) => [t.name, t]));

export function cadTool(name: string): CadTool | undefined {
  return BY_NAME.get(name);
}

/** Union of every tool's args, for one flat structured-output schema. */
function allArgProps(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const t of CAD_TOOLS) Object.assign(out, t.params);
  return out;
}

/** Nano picks ONE tool: {tool, args, confidence}. */
export const CAD_TOOL_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: {
    tool: { type: 'string' },
    args: { type: 'object', properties: allArgProps() },
    confidence: { type: 'number' },
  },
  required: ['tool'],
};

/** Gemini may chain several calls and says why: {calls:[...], reply, why}. */
export const CAD_PLAN_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: {
    calls: { type: 'array', items: { type: 'object', properties: { tool: { type: 'string' }, args: { type: 'object', properties: allArgProps() } } } },
    reply: { type: 'string' },
    why: { type: 'string' },
  },
  required: ['calls'],
};

/** The catalogue as compact prompt text. */
export function toolCatalogText(): string {
  return CAD_TOOLS.map((t) => {
    const args = Object.keys(t.params).map((k) => `${k}${t.required?.includes(k) ? '' : '?'}`).join(', ');
    return `- ${t.name}(${args}): ${t.description}`;
  }).join('\n');
}

export function cadToolPrompt(summary: string): string {
  return `You control a CAD floor-plan editor for a user who speaks short commands. Units are mm; x is right, y is up. Pick tools from this list:\n${toolCatalogText()}\n"convert/turn/make/show 2D to 3D", "render", "materials", "finishes" or "lighting" → set_materials (args.style = her exact words). Only "3D view" / "back to plan" with no materials request → view_3d.\nUse target "selected" when she says this/that/it. Current plan: ${summary}`;
}

export interface ToolCall { tool: string; args: Record<string, unknown> }

export type ToolAction =
  | { kind: 'op'; op: Record<string, unknown>; tool: CadTool }
  | { kind: 'app'; action: string; args: Record<string, unknown>; tool: CadTool }
  | { kind: 'error'; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const numOk = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Untrusted {tool,args} → a checked call, or null. Unknown args are dropped. */
export function coerceToolCall(raw: unknown): ToolCall | null {
  if (!isObj(raw) || typeof raw.tool !== 'string') return null;
  const tool = cadTool(raw.tool.trim());
  if (!tool) return null;
  const inArgs = isObj(raw.args) ? raw.args : {};
  const args: Record<string, unknown> = {};
  for (const [k, schema] of Object.entries(tool.params)) {
    const v = inArgs[k];
    if (v === undefined || v === null) continue;
    if (schema.type === 'number') {
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
      if (numOk(n)) args[k] = n;
    } else if (schema.type === 'boolean') {
      if (typeof v === 'boolean') args[k] = v;
      else if (v === 'true' || v === 'false') args[k] = v === 'true';
    } else if (typeof v === 'string' && v.trim()) {
      args[k] = v.trim().slice(0, 300);
    }
  }
  for (const r of tool.required ?? []) if (args[r] === undefined) return null;
  return { tool: tool.name, args };
}

/** Pass-through plan ops: tool name = op name, args = op fields. */
const DIRECT_OPS = new Set([
  'add_wall', 'add_room', 'add_door', 'add_window', 'add_fixture', 'add_dim', 'add_text', 'move',
  'set_length', 'set_thickness', 'set_width', 'set_size', 'set_height', 'rotate', 'rename', 'delete',
  'undo', 'redo', 'select',
]);

/** Checked call → what to do. Plan op fields are re-validated downstream. */
export function toolToAction(call: ToolCall): ToolAction {
  const tool = cadTool(call.tool);
  if (!tool) return { kind: 'error', error: `Unknown tool "${call.tool}".` };
  const a = call.args;
  if (DIRECT_OPS.has(tool.name)) {
    const op: Record<string, unknown> = { op: tool.name, ...a };
    const needsTarget = ['add_door', 'add_window', 'add_dim', 'move', 'set_length', 'set_thickness', 'set_width', 'set_size', 'set_height', 'rotate', 'rename', 'delete'];
    if (needsTarget.includes(tool.name) && op.target === undefined) op.target = 'selected';
    if (tool.name === 'move') op.nums = { dx: a.dx ?? 0, dy: a.dy ?? 0 };
    if (tool.name === 'add_room') { op.x ??= 0; op.y ??= 0; }
    if (tool.name === 'add_fixture') { op.w ??= 600; op.d ??= 600; op.rotation ??= 0; }
    if (tool.name === 'add_text') { op.x ??= 0; op.y ??= 0; op.size ??= 300; }
    return { kind: 'op', op, tool };
  }
  if (tool.name === 'show_layer' && !isLayerId(a.layer)) return { kind: 'error', error: `Unknown layer "${String(a.layer)}".` };
  if (tool.name === 'zoom' && !['in', 'out', 'fit'].includes(String(a.to))) return { kind: 'error', error: 'Zoom must be in, out or fit.' };
  if (tool.name === 'walk_step' && !['forward', 'back', 'left', 'right', 'turn_left', 'turn_right'].includes(String(a.step))) {
    return { kind: 'error', error: 'Unknown walk step.' };
  }
  return { kind: 'app', action: tool.name, args: a, tool };
}

/** Is this tool a drawing change (→ change log)? */
export function isEditTool(name: string): boolean {
  return cadTool(name)?.kind === 'edit';
}

/** Short human title for the change log. */
export function describeCall(call: ToolCall): string {
  const a = call.args;
  const tgt = typeof a.target === 'string' && a.target !== 'selected' ? ` ${a.target}` : '';
  switch (call.tool) {
    case 'add_wall': return 'Draw a wall';
    case 'add_room': return `Draw a room${a.name ? ` (${String(a.name)})` : ''}`;
    case 'add_door': return `Add a door${tgt}`;
    case 'add_window': return `Add a window${tgt}`;
    case 'add_fixture': return `Place ${String(a.kind ?? 'an item')}`;
    case 'add_dim': return 'Add a dimension';
    case 'add_text': return 'Add a note';
    case 'move': return `Move${tgt || ' the selection'}`;
    case 'set_length': return `Set wall length to ${a.length} mm`;
    case 'set_thickness': return `Set wall thickness to ${a.thickness} mm`;
    case 'set_width': return `Set width to ${a.width} mm`;
    case 'set_size': return `Resize${tgt}`;
    case 'set_height': return `Set height to ${a.height} mm`;
    case 'rotate': return `Rotate ${a.angle}°`;
    case 'rename': return `Rename to ${String(a.name)}`;
    case 'delete': return `Delete${tgt || ' the selection'}`;
    case 'add_stair': return 'Add a staircase';
    case 'fix_guideline': return 'Fix a guideline finding';
    case 'set_materials': return a.style ? `Dress the 3D view (${String(a.style).slice(0, 80)})` : 'Dress the 3D view';
    default: return call.tool.replace(/_/g, ' ');
  }
}
