// SAVED PLAN DRAWINGS. A floor-plan tile is `{ type: 'plan', boardId,
// template }`; what the user then draws on it is stored on that same tile as
// `doc` and so rides the board's existing persistence (the canvas document in
// storage, the history's before / after surfaces, Close + Undo).
//
// The drawing never travels through the A2UI message (it is not a component
// prop): the canvas hands it to the plan board through this small registry,
// keyed by board frame + plan board id, and the board reads it when it mounts.

/** A drawing larger than this is not kept (storage quota; a hand-drawn plan
 *  is a few kB). */
export const PLAN_DOC_MAX_CHARS = 400_000;

const docs = new Map<string, unknown>();
const key = (frameId: string, boardId: string): string => `${frameId}:${boardId}`;

/** Looks like a plan document, and small enough to store. */
export function isStorablePlanDoc(doc: unknown): doc is Record<string, unknown> {
  if (!doc || typeof doc !== 'object') return false;
  const d = doc as Record<string, unknown>;
  if (!Array.isArray(d.walls) || !Array.isArray(d.openings)) return false;
  try { return JSON.stringify(doc).length <= PLAN_DOC_MAX_CHARS; } catch { return false; }
}

/** The drawing without its selection (a selection is not part of the plan). */
export function storablePlanDoc(doc: unknown): Record<string, unknown> | null {
  if (!isStorablePlanDoc(doc)) return null;
  return { ...(JSON.parse(JSON.stringify(doc)) as Record<string, unknown>), selectedId: null, selectedIds: [] };
}

export function setSavedPlanDoc(frameId: string, boardId: string, doc: unknown | null): void {
  if (doc && isStorablePlanDoc(doc)) docs.set(key(frameId, boardId), doc);
  else docs.delete(key(frameId, boardId));
}

export function savedPlanDoc(frameId: string, boardId: string): unknown | null {
  return docs.get(key(frameId, boardId)) ?? null;
}
