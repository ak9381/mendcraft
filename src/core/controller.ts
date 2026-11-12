// The generic contract the shell (main.ts) drives, so the UI stays mode-
// agnostic. Each EditorMode supplies a ModeController (its document + engine +
// export + generate) and a ViewportHandle (its renderer + hit-testing + drag).
// main.ts never imports a concrete document type: it compiles a command, hands
// the result to the controller, asks the renderer to redraw, and lists items
// for the accessible panel.
//
// ─── 'ui' mode plugs in here too ──────────────────────────────────────────
// A future UI-design mode implements the SAME two interfaces: a UiController
// over a UiDoc (frames/stacks/text/buttons) returning StepResults, and a
// ViewportHandle rendering the frame tree with pick/drag, plus an HTML/CSS
// exporter behind export(). No shell change — just one more registerMode(...).

import type { Source } from '../ai/hybrid';

/** One row in the accessible "Parts/Objects" panel (keyboard-selectable). */
export interface ListItem {
  id: string;
  label: string;
  selected: boolean;
}

export interface StepResult {
  ok: boolean;
  error?: string;
  /** Short confirmation spoken on success (e.g. "Wall is now 4.00 m."). */
  message?: string;
  /** Non-fatal hints for the panel (printability / fit). */
  warnings: string[];
  /** The op that was applied, for the intent verifier (absent for templates). */
  op?: unknown;
}

export interface GenerateOutcome {
  source: Source;
  step: StepResult;
  /** Set instead of `step` when the model needs a clarification. */
  clarify?: string;
}

/** Runtime engine+document for one mode. Opaque `snapshot()` is cast by the
 *  mode's own renderer; the shell treats it as unknown. */
export interface ModeController {
  /** Compact JSON scene summary for AI prompts. */
  summary(): string;
  selectedId(): string | null;
  listItems(): ListItem[];
  warnings(): string[];

  /** Apply an AI/rules compile result (op envelope, template, or generate
   *  directive). Re-validates untrusted input before touching the engine. */
  applyResult(result: Record<string, unknown>): StepResult;
  /** Apply a single raw op (undo/redo buttons, pinch drag). Re-validates. */
  applyOp(raw: unknown): StepResult;

  selectId(id: string): boolean;

  /** Does this utterance mean "generate a whole design" (cloud path)? */
  isDesignRequest(utterance: string): boolean;
  /** Cloud/rules "generate a whole design" and apply it atomically. */
  generate(utterance: string): Promise<GenerateOutcome>;

  /** Relative drag of the current selection by mm. Null if the mode has no
   *  mm-based drag (then the renderer's own world-space drag is used). */
  dragSelectedMm(dxMm: number, dyMm: number): StepResult | null;
  /** mm per normalized screen unit for the pinch-drag fallback above. */
  readonly dragRangeMm: number;

  /** Download the current document (STL for part; DXF + JSON for plan). */
  export(): void;

  /** Opaque document snapshot handed to this mode's renderer. */
  snapshot(): unknown;
}

/** A mode's renderer. Optional hooks let a mode add world-space drag, a
 *  secondary 3D view, or wheel/key zoom without the shell knowing the details. */
export interface ViewportHandle {
  /** Redraw from the controller's current snapshot. */
  render(): void;
  /** Zoom-to-fit the current content into the viewport (after generate / load /
   *  window resize). Optional — modes without a fittable 2D view omit it. */
  fit?(): void;
  /** Screen → object id under the given client (CSS px) coordinates. */
  pick(clientX: number, clientY: number): string | null;
  /** Begin a world-space drag of the current selection; true if it grabbed. */
  beginDrag?(clientX: number, clientY: number): boolean;
  /** Continue a world-space drag (with snap); true if handled. */
  drag?(clientX: number, clientY: number): boolean;
  endDrag?(): void;
  /** Toggle a secondary view (plan: extrude walls to 3D). */
  toggle3D?(on: boolean): boolean;
  dispose(): void;
}
