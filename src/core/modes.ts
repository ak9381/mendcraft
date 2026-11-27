// Editor mode registry. Mendcraft is CAD-only: hands-free 2D architecture /
// CAD floor plans ('plan') with the plan's own 3D view. UI design and the 3D
// part designer were removed on 2026-11-17 (they live on in the
// full-build-2026-11-17 branch). The registry shape stays so a mode owns
// everything content-specific: rule parser, coercion of untrusted AI JSON,
// prompts + schemas, controller, renderer and UI copy.

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
// Accessibility checkers are pure geometry/colour math (no DOM), like the AI
// modules above, so they import statically too.
import { checkPlanAccessibility } from '../plan/accessibility';
import type { A11yIssue } from './a11y';
import type { PlanDoc } from '../plan/doc';

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
   *  null to reject (→ rule parser). AI output is never trusted. The optional
   *  `utterance` lets a mode repair an op the model skeletoned but under-filled
   *  (e.g. named a valid op yet dropped a number) from the same command. */
  coerce(raw: unknown, utterance?: string): object | null;
  /** Does this utterance mean "generate a whole design" (cloud path)? */
  isDesignRequest(utterance: string): boolean;
  /** Deterministic accessibility checks over the mode's document snapshot
   *  (see core/a11y.ts). Absent = the mode has no checker (e.g. 'part'). */
  checkAccessibility?(snapshot: unknown): A11yIssue[];
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
// Registry. CAD-only: 'plan' is the single registered mode.

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
    '"make this wall 4 meters", "move it 500 left", or "thicker by 50". Click or fist-tap a wall to ' +
    'select it and drag to move it with snap. Export a DXF for AutoCAD / LibreCAD / QCAD.',
  exportLabel: 'Export DXF',
  starterItems: ['two bedroom plan', 'studio', 'room 4 by 3'],
  parse: parsePlanCommand,
  coerce: coercePlan,
  isDesignRequest: isPlanDesignRequest,
  checkAccessibility: (snapshot) => checkPlanAccessibility(snapshot as PlanDoc),
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

// Register built-ins. Mendcraft is CAD-only: 'plan' is the one mode.
registerMode(planMode);
