// Relative replay for designer recipes. At SAVE time positions are shifted so
// the recording's anchor (first placed point) becomes (0,0) and concrete target
// ids become 'selected'; at REPLAY time positions are shifted to the new anchor
// (or back to the recipe's original spot when no anchor is given). The replayed
// ops run through the ordinary op log — modes with a 'batch' op get ONE undo
// group — and every op is re-validated by the mode's validator on apply.

import type { Recipe, RecipePoint, RecipeStep } from './model';

/** Symbolic target refs the engines resolve themselves — never rewritten. */
const SYMBOLIC_TARGETS = new Set(['selected', 'last', 'floor']);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isPt = (v: unknown): v is RecipePoint =>
  isObj(v) && typeof v.x === 'number' && Number.isFinite(v.x)
  && typeof v.y === 'number' && Number.isFinite(v.y);

/** Ops whose top-level x/y are an absolute position (plan + ui + part add). */
const XY_OPS = new Set(['add_room', 'add_fixture', 'add_text', 'move_end', 'add_node']);

/** First absolute point an op places, or null if it has none. */
export function opAnchor(op: Record<string, unknown>): RecipePoint | null {
  if (XY_OPS.has(String(op.op)) && typeof op.x === 'number' && typeof op.y === 'number'
    && Number.isFinite(op.x) && Number.isFinite(op.y)) {
    return { x: op.x, y: op.y };
  }
  if (isPt(op.a)) return { x: op.a.x, y: op.a.y };
  if (isPt(op.position)) return { x: op.position.x, y: op.position.y };
  return null;
}

/** The recording's anchor: the first placed point across the steps, else (0,0). */
export function anchorOf(steps: RecipeStep[]): RecipePoint {
  for (const s of steps) {
    const a = opAnchor(s.op);
    if (a) return a;
  }
  return { x: 0, y: 0 };
}

/** Shift every absolute position in an op by (dx, dy); deltas (dx/dy/offset)
 *  and sizes are untouched. Recurses into batch sub-ops. Returns a copy. */
export function shiftOp(op: Record<string, unknown>, dx: number, dy: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...op };
  if (XY_OPS.has(String(op.op)) && typeof op.x === 'number' && typeof op.y === 'number') {
    out.x = op.x + dx;
    out.y = op.y + dy;
  }
  for (const key of ['a', 'b'] as const) {
    const p = op[key];
    if (isPt(p)) out[key] = { x: p.x + dx, y: p.y + dy };
  }
  if (isPt(op.position)) {
    const p = op.position as RecipePoint & { z?: number };
    out.position = { ...p, x: p.x + dx, y: p.y + dy };
  }
  if (String(op.op) === 'batch' && Array.isArray(op.ops)) {
    out.ops = op.ops.map((sub) => (isObj(sub) ? shiftOp(sub, dx, dy) : sub));
  }
  return out;
}

/**
 * Make recorded steps replay-anywhere: shift positions so `anchor` becomes
 * (0,0) and rewrite concrete target ids to 'selected' (created items self-
 * select, so step N acts on what step N-1 just made). move_many/select_set id
 * lists are kept as-is — the engine skips ids that no longer exist.
 */
export function relativizeSteps(steps: RecipeStep[], anchor: RecipePoint): RecipeStep[] {
  return steps.map(({ op }) => {
    const shifted = shiftOp(op, -anchor.x, -anchor.y);
    if (typeof shifted.target === 'string' && !SYMBOLIC_TARGETS.has(shifted.target)) {
      shifted.target = 'selected';
    }
    return { op: shifted };
  });
}

/** Rebase relative steps onto a new anchor (world mm / px). */
export function rebaseSteps(steps: RecipeStep[], anchor: RecipePoint): Record<string, unknown>[] {
  return steps.map(({ op }) => shiftOp(op, anchor.x, anchor.y));
}

/**
 * The ops to apply for one replay. With no explicit anchor the recipe replays
 * at its original recorded spot (recipe.anchor); pass the cursor/selection
 * anchor to replay it elsewhere.
 */
export function buildReplayOps(recipe: Recipe, anchor?: RecipePoint | null): Record<string, unknown>[] {
  const at = anchor ?? recipe.anchor ?? { x: 0, y: 0 };
  return rebaseSteps(recipe.steps, at);
}

/** Wrap replay ops as ONE undoable step for modes with a 'batch' op (plan/ui). */
export function buildReplayBatch(ops: Record<string, unknown>[]): Record<string, unknown> {
  return ops.length === 1 ? ops[0] : { op: 'batch', ops };
}
