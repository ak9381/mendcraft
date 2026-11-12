// Editor mode registry. Mendcraft is a hands-free DESIGN tool with several
// interchangeable modes on ONE shared engine: 2D architecture/CAD plans
// ('plan', the default hero), 3D-printable parts ('part'), and later UI design
// ('ui'). A mode owns everything *content-specific*: starter items, the
// deterministic rule parser, the op validator + coercion of untrusted AI JSON,
// the AI prompts + response schemas, the runtime controller (document + engine
// + export + generate), the renderer, and the UI copy.
//
// The input layer (hands, face, pinch, voice, hybrid AI, App Check) stays
// mode-agnostic: it reads prompts/schema, coercion, and UI copy from the ACTIVE
// mode. Heavy renderers/controllers are loaded with dynamic import() so the
// registry (and the unit tests / AI layer) stay light.
//
// ─── Adding the 'ui' mode later ───────────────────────────────────────────
// Implement a ui/ package mirroring plan/: UiDoc + UiOp + validateUiOp +
// UiEngine + ui/ai.ts + an HTML/CSS exporter + a ui/renderer.ts, then flip the
// uiMode entry below from the coming-soon stub to a real EditorMode with its
// own createController/createRenderer. Nothing in the shared shell changes.

import { validateOp } from './ops';
import { isTemplateName, TEMPLATE_NAMES } from './templates';
import { parseCommand } from './ruleParser';
import type { ModeController, ViewportHandle } from './controller';
// Plan AI + rule parser are pure (no three.js / DOM), so they import statically;
// only the heavy controller/renderer are loaded with dynamic import() below.
import {
  coercePlan,
  PLAN_INTENT_PROMPT,
  PLAN_GENERATE_PROMPT,
  PLAN_VERIFY_PROMPT,
  PLAN_OP_CONSTRAINT,
  PLAN_VERIFY_CONSTRAINT,
  PLAN_GENERATE_CONSTRAINT,
} from '../plan/ai';
import { parsePlanCommand } from '../plan/ruleParser';

/** A quick-start command button, shown on the empty canvas and in onboarding. */
export interface ModeHint {
  /** Short visible label, e.g. "Two-bedroom". */
  label: string;
  /** The command string sent to the pipeline when chosen, e.g. "two bedroom plan". */
  command: string;
}

/** Mode-specific AI prompts + plain-JSON-Schema response constraints. The
 *  constraints are the source of truth: hybrid feeds opConstraint/verifyConstraint
 *  to the on-device Prompt API and converts all three into Firebase `Schema`
 *  objects for the cloud path. */
export interface ModeAi {
  /** System/intent prompt that turns one short command into one op. */
  intentPrompt: string;
  /** Prompt for the cloud "generate a whole design" path. */
  templatePrompt: string;
  /** Prompt for the intent verifier. */
  verifyPrompt: string;
  /** On-device `responseConstraint` for the intent/edit-op model. */
  opConstraint: Record<string, unknown>;
  /** On-device `responseConstraint` for the verifier model. */
  verifyConstraint: Record<string, unknown>;
  /** Cloud response schema for the "generate" model (whole design). */
  generateConstraint: Record<string, unknown>;
}

/** Everything a single hands-free design mode contributes to the shell. */
export interface EditorMode {
  id: string;
  /** Human-facing mode name, e.g. "2D plan". */
  label: string;
  /** 'ready' modes can be activated; 'coming-soon' modes are shown but disabled. */
  status: 'ready' | 'coming-soon';
  /** One-sentence description of what this mode designs. */
  description: string;
  /** One-line hint shown on the empty canvas. */
  hint: string;
  /** Quick-start command buttons (empty canvas + onboarding "try a command"). */
  hints: ModeHint[];
  /** Placeholder for the command input. */
  inputPlaceholder: string;
  /** A single example command for the onboarding "say or type a command" step. */
  exampleCommand: string;
  /** Short help text for the tour / help panel. */
  help: string;
  /** Label for the export button and what it downloads. */
  exportLabel: string;
  /** Names of starter items (what used to be hard-coded as "templates"). */
  starterItems: readonly string[];
  /** Deterministic, offline rule-parser fallback. Returns an op envelope,
   *  {clarify}, or (plan) a {generate} directive. */
  parse(utterance: string): object;
  /** Coerce untrusted AI JSON into a validated result (op/template/clarify) or
   *  null to reject (→ rule parser). AI output is never trusted. */
  coerce(raw: unknown): object | null;
  /** Does this utterance mean "generate a whole design" (cloud path)? */
  isDesignRequest(utterance: string): boolean;
  /** Mode-specific AI prompts + response schema. */
  ai: ModeAi;
  /** Build the runtime controller (document + engine + export + generate). */
  createController(): Promise<ModeController>;
  /** Build the renderer into `container`, bound to `controller`. */
  createRenderer(
    container: HTMLElement,
    controller: ModeController,
    onSelect: (id: string | null) => void,
  ): Promise<ViewportHandle>;
}

// ---------------------------------------------------------------------------
// 3D-print builder mode ('part'): AI prompts, constraints, and coercion.

const SIZE_PROPS = {
  w: { type: 'number' }, d: { type: 'number' }, h: { type: 'number' },
  diameter: { type: 'number' }, height: { type: 'number' },
  topDiameter: { type: 'number' }, tube: { type: 'number' },
} as const;

const VEC_PROPS = {
  x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
} as const;

/** On-device constraint for the intent/edit-op model. `depth` is mm or "through". */
const OP_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: {
    op: { type: 'string' },
    shape: { type: 'string' },
    params: { type: 'object', properties: SIZE_PROPS },
    target: { type: 'string' },
    tool: { type: 'string' },
    targets: { type: 'array', items: { type: 'string' } },
    dx: { type: 'number' }, dy: { type: 'number' }, dz: { type: 'number' },
    axis: { type: 'string' },
    deg: { type: 'number' },
    factor: { type: 'number' },
    deltaMm: { type: 'object', properties: VEC_PROPS },
    diameter: { type: 'number' },
    depth: { anyOf: [{ type: 'number' }, { type: 'string' }] },
    count: { type: 'number' },
    spacing: { type: 'number' },
    radius: { type: 'number' },
    to: { type: 'string' },
    mode: { type: 'string' },
    template: { type: 'string' },
    clarify: { type: 'string' },
  },
};

/** On-device constraint for the verifier model — not the edit-op schema. */
const VERIFY_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: {
    matchesIntent: { type: 'boolean' },
    issue: { type: 'string' },
  },
};

/** Cloud "generate" schema for the part template model. */
const PART_GENERATE_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: {
    template: { type: 'string' },
    params: {
      type: 'object',
      properties: {
        cupDiameterMm: { type: 'number' }, heightMm: { type: 'number' }, wallMm: { type: 'number' },
        angleDeg: { type: 'number' }, phoneThicknessMm: { type: 'number' }, widthMm: { type: 'number' },
        depthMm: { type: 'number' }, rodDiameterMm: { type: 'number' }, diameterMm: { type: 'number' },
      },
    },
  },
};

const INTENT_PROMPT = `You convert one short spoken command for a 3D print builder into ONE JSON object. Units are mm. Use target "selected" unless the user names a part. Axes: x=left/right, y=front/back, z=up. Reply with JSON only, no prose.
Ops (exact shapes):
{"op":"add","shape":"box|cylinder|sphere|cone|torus","params":{box:{w,d,h} cylinder:{diameter,height} sphere:{diameter} cone:{diameter,height,topDiameter?} torus:{diameter,tube}}}
{"op":"move","target","dx","dy","dz"}
{"op":"rotate","target","axis":"x|y|z","deg"}
{"op":"scale","target","factor"} or {"op":"scale","target","deltaMm":{x?,y?,z?}} (taller by 5 => deltaMm z 5)
{"op":"hole","target","diameter","depth":number or "through","axis":"x|y|z"}
{"op":"subtract","target","tool"} {"op":"union","targets":[ids]}
{"op":"align","target","to":"floor","mode":"center"}
{"op":"mirror","target","axis"} {"op":"array","target","count","spacing","axis"}
{"op":"fillet","target","radius"} {"op":"delete","target"} {"op":"select","target"}
{"op":"undo"} {"op":"redo"}
Named designs: {"template":"cupGrip|phoneStand|hook|utensilHolder","params":{}}
If the command is unclear or unsafe, reply {"clarify":"<short question>"}.`;

const TEMPLATE_PROMPT = `You design a 3D-printable helper object. Reply with ONE JSON object only: {"template":"cupGrip|phoneStand|hook|utensilHolder","params":{...}}.
Pick the closest template to the request and set only numeric params you are confident about:
cupGrip: cupDiameterMm, heightMm, wallMm. phoneStand: angleDeg, phoneThicknessMm, widthMm.
hook: depthMm, rodDiameterMm. utensilHolder: diameterMm, heightMm, wallMm. All mm, angles in degrees.`;

const VERIFY_PROMPT = `You check whether an edit to a 3D scene did what the op intended. Reply JSON only: {"matchesIntent":true|false,"issue":null or "<short issue>"}.`;

/** Keep only finite numbers from an untrusted params object. */
function numericParams(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof raw === 'object' && raw !== null) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = typeof v === 'string' ? Number(v) : v;
      if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
    }
  }
  return out;
}

/** Coerce untrusted model JSON into a part op / template / clarify, or null. */
function coercePart(raw: unknown): object | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.clarify === 'string' && obj.clarify.trim()) return { clarify: obj.clarify.trim() };
  if (obj.template !== undefined) {
    if (!isTemplateName(obj.template)) return null;
    return { template: obj.template, params: numericParams(obj.params) };
  }
  const v = validateOp(obj);
  return v.ok ? v.op : null;
}

/** Longer free-form "design me a ..." phrasing routes to the cloud template model. */
function isPartDesignRequest(utterance: string): boolean {
  const t = utterance.trim().toLowerCase();
  if (!t) return false;
  if (/\bdesign\b/.test(t)) return true;
  if (/\b(i need|i want|something to|something for)\b/.test(t)) return true;
  if (/\bfor my\b/.test(t)) return true;
  if (/\b(create|build me|make me)\b/.test(t) && t.split(/\s+/).length >= 5) return true;
  return false;
}

/** The existing 3D-print builder, wrapped as an EditorMode. */
export const partMode: EditorMode = {
  id: 'part',
  label: '3D part',
  status: 'ready',
  description: 'Design 3D-printable assistive objects with voice, pinch, or text.',
  hint: 'Start with a design: say "cup grip", "phone stand", "hook", or "utensil holder".',
  hints: [
    { label: 'Cup grip', command: 'cup grip' },
    { label: 'Phone stand', command: 'phone stand' },
    { label: 'Hook', command: 'hook' },
    { label: 'Utensil holder', command: 'utensil holder' },
  ],
  inputPlaceholder: 'Try: cup grip',
  exampleCommand: 'cup grip',
  help:
    'Say or type a design like "cup grip", or an edit like "add a box", "move left 10", ' +
    '"make it taller by 5", or "hole 6 through". Pinch to select and drag a part.',
  exportLabel: 'Export STL',
  starterItems: TEMPLATE_NAMES,
  parse: parseCommand,
  coerce: coercePart,
  isDesignRequest: isPartDesignRequest,
  ai: {
    intentPrompt: INTENT_PROMPT,
    templatePrompt: TEMPLATE_PROMPT,
    verifyPrompt: VERIFY_PROMPT,
    opConstraint: OP_CONSTRAINT,
    verifyConstraint: VERIFY_CONSTRAINT,
    generateConstraint: PART_GENERATE_CONSTRAINT,
  },
  async createController() {
    const { createPartController } = await import('./partController');
    return createPartController();
  },
  async createRenderer(container, controller, onSelect) {
    const { createPartRenderer } = await import('../ui/viewport');
    return createPartRenderer(container, controller, onSelect);
  },
};

// ---------------------------------------------------------------------------
// 2D architecture / CAD plan mode ('plan') — the default hero. Its AI, parser,
// controller, and renderer live under src/plan.

/** "two bedroom plan", "studio", "design a one-room flat" → cloud generate. */
function isPlanDesignRequest(utterance: string): boolean {
  const t = utterance.trim().toLowerCase();
  if (!t) return false;
  if (/\b(plan|bedroom|studio|apartment|flat|house)\b/.test(t)) return true;
  if (/\bdesign\b/.test(t) && /\b(room|plan|flat|house)\b/.test(t)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Coming-soon stub (UI design). Registered so the shell surfaces the roadmap;
// it cannot be activated, so its controller/renderer are inert.

function comingSoonMode(id: string, label: string, description: string, roadmapHint: string): EditorMode {
  const noop = `The ${label} mode is coming soon.`;
  return {
    id,
    label,
    status: 'coming-soon',
    description,
    hint: roadmapHint,
    hints: [],
    inputPlaceholder: `${label} — coming soon`,
    exampleCommand: '',
    help: `${description} ${noop}`,
    exportLabel: 'Export',
    starterItems: [],
    parse: () => ({ clarify: noop }),
    coerce: () => null,
    isDesignRequest: () => false,
    ai: {
      intentPrompt: noop,
      templatePrompt: noop,
      verifyPrompt: noop,
      opConstraint: { type: 'object', properties: {} },
      verifyConstraint: { type: 'object', properties: {} },
      generateConstraint: { type: 'object', properties: {} },
    },
    async createController() {
      throw new Error(`${label} mode is not ready.`);
    },
    async createRenderer(container) {
      container.innerHTML = `<div class="mode-placeholder">${label}: coming soon.</div>`;
      return { render() {}, pick: () => null, dispose() {} };
    },
  };
}

/** UI-design mode (frames, stacks, text, buttons, HTML/CSS export) — later. */
export const uiMode = comingSoonMode(
  'ui',
  'UI design',
  'Hands-free UI and screen layout design with HTML/CSS export.',
  'UI design mode is coming later.',
);

// ---------------------------------------------------------------------------
// Registry. 'plan' is the default hero; 'part' stays fully available
// (reachable via the mode switch or ?mode=part); 'ui' is coming-soon.

const registry = new Map<string, EditorMode>();
let activeId: string;

export function registerMode(mode: EditorMode): void {
  registry.set(mode.id, mode);
  if (activeId === undefined && mode.status === 'ready') activeId = mode.id;
}

export function getMode(id: string): EditorMode | undefined {
  return registry.get(id);
}

export function listModes(): EditorMode[] {
  return [...registry.values()];
}

export function getActiveMode(): EditorMode {
  const mode = registry.get(activeId);
  if (!mode) throw new Error('No editor mode is registered.');
  return mode;
}

/** Switch the active mode. Only 'ready' modes can be activated. */
export function setActiveMode(id: string): boolean {
  const mode = registry.get(id);
  if (!mode || mode.status !== 'ready') return false;
  activeId = id;
  return true;
}

/** 2D architecture / CAD plan mode — the default hero. */
export const planMode: EditorMode = {
  id: 'plan',
  label: '2D plan',
  status: 'ready',
  description: 'Draft architectural floor plans — walls, doors, windows, dimensions, DXF.',
  hint: 'Start with a plan: say "two bedroom plan", or "room 4 by 3".',
  hints: [
    { label: 'Two-bedroom', command: 'two bedroom plan' },
    { label: 'Studio', command: 'studio' },
    { label: 'Room 4 by 3', command: 'room 4 by 3' },
    { label: 'Add a door', command: 'add a door' },
  ],
  inputPlaceholder: 'Try: two bedroom plan',
  exampleCommand: 'two bedroom plan',
  help:
    'Say or type a plan like "two bedroom plan", or an edit like "room 4 by 3", "add a door", ' +
    '"make this wall 4 meters", "move it 500 left", or "thicker by 50". Click/pinch a wall to ' +
    'select it and drag to move it with snap. Export a DXF for AutoCAD / LibreCAD / QCAD.',
  exportLabel: 'Export DXF',
  starterItems: ['two bedroom plan', 'studio', 'room 4 by 3'],
  parse: parsePlanCommand,
  coerce: coercePlan,
  isDesignRequest: isPlanDesignRequest,
  ai: {
    intentPrompt: PLAN_INTENT_PROMPT,
    templatePrompt: PLAN_GENERATE_PROMPT,
    verifyPrompt: PLAN_VERIFY_PROMPT,
    opConstraint: PLAN_OP_CONSTRAINT,
    verifyConstraint: PLAN_VERIFY_CONSTRAINT,
    generateConstraint: PLAN_GENERATE_CONSTRAINT,
  },
  async createController() {
    const { createPlanController } = await import('../plan/controller');
    return createPlanController();
  },
  async createRenderer(container, controller, onSelect) {
    const { createPlanRenderer } = await import('../plan/renderer');
    return createPlanRenderer(container, controller, onSelect);
  },
};

// Register built-ins. 'plan' is registered first → it becomes the default
// active mode. 'part' stays fully available (mode switch / ?mode=part).
registerMode(planMode);
registerMode(partMode);
registerMode(uiMode);
