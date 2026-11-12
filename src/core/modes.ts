// Editor mode registry. The demo may pivot from 3D-print objects to other
// hands-free DESIGN modes (2D floor plans, breadboard circuits, UI design).
// A mode owns everything that is *content-specific*: the starter items, the
// deterministic rule parser, the op validator, the AI prompts + response
// schema, the renderer, and the UI copy (hints, placeholder, help, examples).
//
// The input layer (hands, face, pinch, voice, hybrid AI, App Check) stays
// mode-agnostic: it reads prompts/schema and UI copy from the ACTIVE mode
// rather than hard-coding any one design domain. The existing 3D-print builder
// is registered below as a thin adapter over the current code — no rewrite.

import { validateOp } from './ops';
import { TEMPLATE_NAMES } from './templates';
import { parseCommand, type RuleParse } from './ruleParser';
import type { ViewportHandle } from '../ui/viewport';

/** A quick-start command button, shown on the empty canvas and in onboarding. */
export interface ModeHint {
  /** Short visible label, e.g. "Cup grip". */
  label: string;
  /** The command string sent to the pipeline when chosen, e.g. "cup grip". */
  command: string;
}

/** Mode-specific AI prompts + on-device response schema (plain JSON Schema). */
export interface ModeAi {
  /** System/intent prompt that turns one short command into one op. */
  intentPrompt: string;
  /** Prompt for longer free-form design requests (named-design model). */
  templatePrompt: string;
  /** Prompt for the intent verifier. */
  verifyPrompt: string;
  /** On-device Prompt API `responseConstraint` for the intent/edit-op model. */
  opConstraint: Record<string, unknown>;
  /** On-device Prompt API `responseConstraint` for the verifier model. */
  verifyConstraint: Record<string, unknown>;
}

/** Everything a single hands-free design mode contributes to the shell. */
export interface EditorMode {
  id: string;
  /** Human-facing mode name, e.g. "3D part". */
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
  /** Names of starter items (what used to be hard-coded as "templates"). */
  starterItems: readonly string[];
  /** Deterministic, offline rule-parser fallback for this mode. */
  parse(utterance: string): RuleParse;
  /** Re-validate untrusted ops (AI or rules) before they reach the engine. */
  validateOp: typeof validateOp;
  /** Mode-specific AI prompts + response schema. */
  ai: ModeAi;
  /**
   * Build the renderer for this mode into `container`. Dynamically imported so
   * the heavy three.js graph stays out of the registry's static import graph
   * (keeps unit tests and the AI layer light).
   */
  createRenderer(
    container: HTMLElement,
    onSelect: (partId: string | null) => void,
  ): Promise<ViewportHandle>;
}

// ---------------------------------------------------------------------------
// 3D-print builder mode: AI prompts + on-device response schema.
// Moved here from ai/hybrid.ts so the AI layer is mode-agnostic; hybrid now
// reads these from the active mode. The constraints are the source of truth
// for the on-device Prompt API and must stay in lockstep with the Firebase
// `Schema` objects the cloud path builds in hybrid.initFirebase.

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

/** The existing 3D-print builder, wrapped as the first EditorMode ('part'). */
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
  starterItems: TEMPLATE_NAMES,
  parse: parseCommand,
  validateOp,
  ai: {
    intentPrompt: INTENT_PROMPT,
    templatePrompt: TEMPLATE_PROMPT,
    verifyPrompt: VERIFY_PROMPT,
    opConstraint: OP_CONSTRAINT,
    verifyConstraint: VERIFY_CONSTRAINT,
  },
  async createRenderer(container, onSelect) {
    const { createViewport } = await import('../ui/viewport');
    return createViewport(container, onSelect);
  },
};

// ---------------------------------------------------------------------------
// Placeholder modes. These are registered so the shell can surface the full
// roadmap (and future code can fill them in), but they are 'coming-soon' and
// cannot be activated yet. Their stubs keep the EditorMode contract total
// without adding any 3D/CAD/UI content.

function comingSoonMode(
  id: string,
  label: string,
  description: string,
  roadmapHint: string,
): EditorMode {
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
    starterItems: [],
    parse: () => ({ clarify: noop }),
    validateOp,
    ai: {
      intentPrompt: noop,
      templatePrompt: noop,
      verifyPrompt: noop,
      opConstraint: { type: 'object', properties: {} },
      verifyConstraint: { type: 'object', properties: {} },
    },
    async createRenderer(container) {
      container.innerHTML = `<div class="mode-placeholder">${label}: coming soon.</div>`;
      return {
        render() {},
        pick: () => null,
        screenToPlane: () => null,
        dispose() {},
      } satisfies ViewportHandle;
    },
  };
}

/** CAD-style plan mode (next up). */
export const planMode = comingSoonMode(
  'plan',
  'CAD plan',
  'Hands-free parametric CAD sketches and plans.',
  'CAD plan mode is coming next.',
);

/** UI-design mode (later). */
export const uiMode = comingSoonMode(
  'ui',
  'UI design',
  'Hands-free UI and screen layout design.',
  'UI design mode is coming later.',
);

// ---------------------------------------------------------------------------
// Registry.

const registry = new Map<string, EditorMode>();
let activeId: string;

export function registerMode(mode: EditorMode): void {
  registry.set(mode.id, mode);
  // The first registered READY mode becomes the default active mode.
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

// Register the built-in modes. 'part' is the ready default; the others are on
// the roadmap and shown as coming-soon.
registerMode(partMode);
registerMode(planMode);
registerMode(uiMode);
