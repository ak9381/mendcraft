// Recipe recorder — a pure state machine fed by the shared op log. While the
// "Teach" toggle is on, every applied op lands here as a draft step; "save this
// as <name>" turns the draft into a validated Recipe (positions relativized to
// the recording anchor, concrete targets → 'selected'). Also detects when the
// same short op sequence was just done twice, so the shell can OFFER "save as a
// recipe?" — it never auto-saves.

import { RECIPE_LIMITS, validateRecipe, type Recipe, type RecipeStep } from './model';
import { anchorOf, relativizeSteps } from './replay';

/** Ops that are navigation/bookkeeping, not part of a task worth replaying. */
const SKIP_OPS = new Set(['select', 'select_set', 'undo', 'redo']);

/** Consecutive relative moves of the same target collapse into one summed step. */
const DELTA_MOVE_OPS = new Set(['move', 'move_many']);
/** Consecutive absolute tweaks of the same target keep only the LAST value. */
const REPLACE_OPS = new Set([
  'move_end', 'move_opening', 'set_length', 'set_width', 'set_thickness', 'set_sill',
  'set_height', 'set_size', 'set_text', 'set_font', 'offset', 'scale', 'rotate',
]);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function sameTarget(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (typeof a.target === 'string' || typeof b.target === 'string') return a.target === b.target;
  if (Array.isArray(a.ids) && Array.isArray(b.ids)) return JSON.stringify(a.ids) === JSON.stringify(b.ids);
  return false;
}

export interface SaveMeta {
  id: string;
  name: string;
  aliases?: string[];
  language: string;
  mode: string;
  taughtBy: string;
  now: number;
}

export type SaveResult = { ok: true; recipe: Recipe } | { ok: false; error: string };

/** Build a validated designer recipe from raw recorded steps (shared by the
 *  Teach recorder and the "save that repeat as a recipe" offer). */
export function makeDesignerRecipe(rawSteps: RecipeStep[], meta: SaveMeta): SaveResult {
  if (rawSteps.length === 0) return { ok: false, error: 'nothing recorded yet' };
  const anchor = anchorOf(rawSteps);
  const candidate: Recipe = {
    id: meta.id,
    name: meta.name,
    aliases: meta.aliases ?? [],
    language: meta.language,
    device: 'designer',
    mode: meta.mode,
    taughtBy: meta.taughtBy,
    steps: relativizeSteps(rawSteps, anchor),
    anchor,
    createdAt: meta.now,
    updatedAt: meta.now,
  };
  const v = validateRecipe(candidate);
  return v.ok ? { ok: true, recipe: v.recipe } : { ok: false, error: v.error };
}

export interface RecipeRecorder {
  active(): boolean;
  count(): number;
  /** True when steps were dropped because the draft hit the step cap. */
  overflowed(): boolean;
  start(): void;
  cancel(): void;
  /** Feed one APPLIED op (post-validation). Ignored while inactive. */
  note(op: unknown): void;
  save(meta: SaveMeta): SaveResult;
}

export function createRecipeRecorder(): RecipeRecorder {
  let recording = false;
  let steps: RecipeStep[] = [];
  let overflow = false;

  return {
    active: () => recording,
    count: () => steps.length,
    overflowed: () => overflow,
    start() {
      recording = true;
      steps = [];
      overflow = false;
    },
    cancel() {
      recording = false;
      steps = [];
      overflow = false;
    },
    note(op: unknown) {
      if (!recording || !isObj(op) || typeof op.op !== 'string') return;
      if (SKIP_OPS.has(op.op)) return;
      const last = steps[steps.length - 1]?.op;
      if (last && last.op === op.op && sameTarget(last, op)) {
        if (DELTA_MOVE_OPS.has(op.op)) {
          const sum = (k: string) => (Number(last[k]) || 0) + (Number(op[k]) || 0);
          steps[steps.length - 1] = { op: { ...op, dx: sum('dx'), dy: sum('dy'), ...(op.dz !== undefined || last.dz !== undefined ? { dz: sum('dz') } : {}) } };
          return;
        }
        if (REPLACE_OPS.has(op.op)) {
          steps[steps.length - 1] = { op: { ...op } };
          return;
        }
      }
      if (steps.length >= RECIPE_LIMITS.stepCount) {
        overflow = true;
        return;
      }
      steps.push({ op: { ...op } });
    },
    save(meta: SaveMeta): SaveResult {
      const result = makeDesignerRecipe(steps, meta);
      if (result.ok) {
        recording = false;
        steps = [];
        overflow = false;
      }
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Repeat detection ("auto-suggest"): the same short op sequence done twice in a
// row. The shell keeps a rolling window of applied-op signatures and asks after
// every op; a hit means "offer to save", never "save".

/** Signature for repeat comparison: op name + parameters, minus the ids that
 *  naturally differ between repetitions (target/ids/name). */
export function opSignature(op: Record<string, unknown>): string {
  const entries = Object.entries(op)
    .filter(([k]) => k !== 'target' && k !== 'ids' && k !== 'name')
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  return entries.join('|');
}

/**
 * Does the tail of `signatures` contain the same sequence twice back-to-back?
 * Returns the sequence length (longest match wins, lengths maxLen…minLen) or
 * null. A length-1 "repeat" is ignored below minLen (a doubled single op is
 * usually just nudging).
 */
export function detectRepeat(
  signatures: readonly string[],
  opts: { minLen?: number; maxLen?: number } = {},
): number | null {
  const minLen = opts.minLen ?? 2;
  const maxLen = opts.maxLen ?? 5;
  for (let len = maxLen; len >= minLen; len--) {
    if (signatures.length < len * 2) continue;
    let match = true;
    for (let i = 0; i < len; i++) {
      const a = signatures[signatures.length - 1 - i];
      const b = signatures[signatures.length - 1 - i - len];
      if (a !== b || !a) { match = false; break; }
    }
    if (match) return len;
  }
  return null;
}
