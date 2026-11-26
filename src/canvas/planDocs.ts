// SAVED PLAN DRAWINGS. What the user draws on a floor-plan board is kept in
// the canvas document under `drawings` (frame id → plan board id → plan doc),
// NEXT TO the boards' surface plans — never inside them. A surface plan is
// what goes into model prompts, morph edits, board transfers and the relay,
// so nothing drawn (room names, labels, sizes) can reach the cloud through
// those, and a prompt never grows with the drawing. A model or a relayed
// board can also never supply a drawing: surface plans have no field for one.
// A board sent to one of her own phones carries its drawing BESIDE the
// surface plan in the relay snapshot (`boardDrawings`, re-sanitized on the
// phone; see coerceBoardDrawings below), never inside it.
//
// The drawing never travels through the A2UI message either: the canvas
// hands it to the plan board through this registry when the board mounts.

/** A drawing larger than this is not kept (storage quota; a hand-drawn plan
 *  is a few kB). */
export const PLAN_DOC_MAX_CHARS = 400_000;
const MAX_ITEMS = 2000;

export type Drawings = Record<string, Record<string, Record<string, unknown>>>;

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max = 80): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const pt = (v: unknown): v is { x: number; y: number } => !!v && typeof v === 'object' && fin((v as { x?: unknown }).x) && fin((v as { y?: unknown }).y);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.slice(0, MAX_ITEMS).filter((x) => x && typeof x === 'object') : []);

/** A plan document with every element checked field by field: anything
 *  malformed is dropped, ids are unique, openings and room loops only refer
 *  to walls that exist, the selection is cleared. null = not a plan at all,
 *  or too large to store. Never trusts its input (storage can be edited). */
export function sanitizePlanDoc(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.walls) || !Array.isArray(d.openings)) return null;
  const ids = new Set<string>();
  const fresh = (id: unknown): id is string => str(id, 40) && !ids.has(id) && !!ids.add(id);
  const walls = list(d.walls).filter((w) => pt(w.a) && pt(w.b) && fin(w.thickness) && w.thickness > 0 && (w.height === undefined || fin(w.height)) && fresh(w.id))
    .map((w) => ({ id: w.id, a: { x: (w.a as { x: number }).x, y: (w.a as { y: number }).y }, b: { x: (w.b as { x: number }).x, y: (w.b as { y: number }).y }, thickness: w.thickness, ...(w.height !== undefined ? { height: w.height } : {}) }));
  const wallIds = new Set(walls.map((w) => w.id as string));
  const openings = list(d.openings).filter((o) => (o.kind === 'door' || o.kind === 'window' || o.kind === 'opening') && typeof o.wallId === 'string' && wallIds.has(o.wallId)
    && fin(o.offset) && fin(o.width) && o.width > 0 && (o.sill === undefined || fin(o.sill)) && (o.height === undefined || fin(o.height)) && fresh(o.id))
    .map((o) => ({ id: o.id, kind: o.kind, wallId: o.wallId, offset: o.offset, width: o.width,
      ...(o.swing === 'left' || o.swing === 'right' ? { swing: o.swing } : {}), ...(o.sill !== undefined ? { sill: o.sill } : {}), ...(o.height !== undefined ? { height: o.height } : {}) }));
  const rooms = list(d.rooms).filter((r) => typeof r.name === 'string' && r.name.length <= 80 && Array.isArray(r.wallIds) && fresh(r.id))
    .map((r) => ({ id: r.id, name: r.name, wallIds: (r.wallIds as unknown[]).filter((w): w is string => typeof w === 'string' && wallIds.has(w)) }));
  const dims = list(d.dims).filter((m) => ((typeof m.wallId === 'string' && wallIds.has(m.wallId)) || (pt(m.a) && pt(m.b))) && fresh(m.id))
    .map((m) => (typeof m.wallId === 'string' && wallIds.has(m.wallId) ? { id: m.id, wallId: m.wallId } : { id: m.id, a: { x: (m.a as { x: number }).x, y: (m.a as { y: number }).y }, b: { x: (m.b as { x: number }).x, y: (m.b as { y: number }).y } }));
  const fixtures = list(d.fixtures).filter((f) => str(f.kind, 40) && /^[a-z0-9-]+$/.test(f.kind) && fin(f.x) && fin(f.y) && fin(f.w) && fin(f.d) && f.w > 0 && f.d > 0 && fin(f.rotation)
    && (f.steps === undefined || fin(f.steps)) && (f.rise === undefined || fin(f.rise)) && fresh(f.id))
    .map((f) => ({ id: f.id, kind: f.kind, x: f.x, y: f.y, w: f.w, d: f.d, rotation: f.rotation, ...(f.steps !== undefined ? { steps: f.steps } : {}), ...(f.rise !== undefined ? { rise: f.rise } : {}) }));
  const texts = list(d.texts).filter((t) => fin(t.x) && fin(t.y) && typeof t.text === 'string' && t.text.length <= 200 && fin(t.size) && t.size > 0 && fresh(t.id))
    .map((t) => ({ id: t.id, x: t.x, y: t.y, text: t.text, size: t.size }));
  const out = { walls, openings, rooms, dims, fixtures, texts, selectedId: null, selectedIds: [] };
  try { return JSON.stringify(out).length <= PLAN_DOC_MAX_CHARS ? out : null; } catch { return null; }
}

/** The `drawings` part of a stored canvas document: only for boards that
 *  exist, every drawing sanitized; anything off is dropped (never the boards). */
export function coerceDrawings(raw: unknown, frameIds: ReadonlySet<string>): Drawings {
  const out: Drawings = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [frameId, boards] of Object.entries(raw as Record<string, unknown>)) {
    if (!frameIds.has(frameId) || !boards || typeof boards !== 'object' || Array.isArray(boards)) continue;
    for (const [boardId, doc] of Object.entries(boards as Record<string, unknown>).slice(0, 8)) {
      const clean = /^[a-z0-9][a-z0-9-]{0,39}$/.test(boardId) ? sanitizePlanDoc(doc) : null;
      if (clean) (out[frameId] ??= {})[boardId] = clean;
    }
  }
  return out;
}

/** A board is about to render with these plan tiles: hand each its drawing.
 *  Nothing is ever DELETED here — an AI rebuild or a morph may drop or rename
 *  the plan tile and then be undone or rolled back (Undo, the self-check
 *  rollback, a failed render after Approve); the drawing must still be there
 *  when the tile comes back. Orphans are only left out when the canvas
 *  document is written (storedDrawings). */
export function feedDrawings(drawings: Drawings, frameId: string, planBoardIds: Iterable<string>): void {
  for (const boardId of planBoardIds) setSavedPlanDoc(frameId, boardId, drawings[frameId]?.[boardId] ?? null);
}

/** What goes into the stored canvas document: only drawings whose plan tile
 *  is on a board right now (`live`: frame id → its plan board ids). The
 *  in-memory map is not touched, so this session's Undo still has them. */
export function storedDrawings(drawings: Drawings, live: Record<string, readonly string[]>): Drawings {
  const out: Drawings = {};
  for (const [frameId, ids] of Object.entries(live)) {
    for (const boardId of ids) {
      const doc = drawings[frameId]?.[boardId];
      if (doc) (out[frameId] ??= {})[boardId] = doc;
    }
  }
  return out;
}

const docs = new Map<string, Record<string, unknown>>();
const key = (frameId: string, boardId: string): string => `${frameId}:${boardId}`;

export function setSavedPlanDoc(frameId: string, boardId: string, doc: Record<string, unknown> | null): void {
  if (doc) docs.set(key(frameId, boardId), doc);
  else docs.delete(key(frameId, boardId));
}

export function savedPlanDoc(frameId: string, boardId: string): Record<string, unknown> | null {
  return docs.get(key(frameId, boardId)) ?? null;
}

// ---- drawings that ride with a board sent to a phone ------------------------
// A board sent to a phone (the relay `state` snapshot) carries its plan
// drawings BESIDE the surface plan (`boardDrawings`), never inside it, so the
// surface plan stays what models and morph edits see. The phone renders the
// drawing the laptop has now, not the template. Both ends run this: the
// laptop before publishing, the phone (via coerceSnapshot) on arrival.

/** Total size cap for a snapshot's drawings: well under a Firestore document
 *  (1 MiB) with the rest of the snapshot; a hand-drawn plan is a few kB. */
export const BOARD_DRAWINGS_MAX_CHARS = 200_000;
const BOARD_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Every plan tile's board id on a board (they may sit inside containers). */
export function planBoardIds(plan: { tiles?: unknown } | null | undefined): string[] {
  const out: string[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (depth > 12 || out.length >= 8) return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, depth + 1)); return; }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (o.type === 'plan') { if (typeof o.boardId === 'string' && !out.includes(o.boardId)) out.push(o.boardId); return; }
    for (const k of Object.keys(o)) walk(o[k], depth + 1);
  };
  walk(plan?.tiles, 0);
  return out;
}

/** The drawings for `plan`'s plan tiles out of untrusted `raw` (board id →
 *  plan doc): each sanitized, only ids the board really has, the selection
 *  left out, all of them together within BOARD_DRAWINGS_MAX_CHARS (a drawing
 *  that does not fit is dropped and counted — the phone then shows that
 *  board's template, never a half drawing). */
export function coerceBoardDrawings(raw: unknown, plan: { tiles?: unknown } | null | undefined): { drawings: Record<string, Record<string, unknown>>; dropped: number } {
  const drawings: Record<string, Record<string, unknown>> = {};
  let dropped = 0;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !plan) return { drawings, dropped };
  let size = 0;
  for (const id of planBoardIds(plan)) {
    if (!BOARD_ID_RE.test(id) || !Object.prototype.hasOwnProperty.call(raw, id)) continue;
    const clean = sanitizePlanDoc((raw as Record<string, unknown>)[id]);
    if (!clean) { dropped++; continue; }
    const { selectedId: _s, selectedIds: _ss, ...doc } = clean;
    const n = JSON.stringify(doc).length;
    if (size + n > BOARD_DRAWINGS_MAX_CHARS) { dropped++; continue; }
    size += n;
    drawings[id] = doc;
  }
  return { drawings, dropped };
}
