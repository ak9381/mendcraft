// The canvas document, split for storage and joined back at boot.
//   layout (localStorage `mc.canvas.v1`): camera, focus, frames, language code
//   artifacts (the ArtifactStore): one `board` per board with content, one
//     `plan` per floor-plan drawing, one `pack` per language pack
// Joining checks the result with parseCanvasDoc: a document that fails opens
// an empty canvas, never a half-loaded one. Pure: no storage, no DOM.
import { CANVAS_DOC_VERSION, FRAME_GAP, MAX_FRAMES, parseCanvasDoc, type CanvasDoc, type Frame } from './frames';
import type { Camera } from './camera';
import type { SurfacePlan } from './surfacePlan';
import type { LanguagePack } from './languagePack';
import { artifactId, ARTIFACT_TITLE_MAX, frameIdOfArtifactId, type Artifact, type ArtifactBy, type BoardData, type PlanData } from '../artifacts/artifact';

export const LAYOUT_KEY = 'mc.canvas.v1';

/** Said at boot when stored artifacts failed their check. */
export const droppedSayLine = (n: number): string => `${n} stored item${n === 1 ? '' : 's'} failed ${n === 1 ? 'its' : 'their'} check and ${n === 1 ? 'was' : 'were'} not loaded.`;
/** The engine-terminal line for one dropped artifact. */
export const droppedLogLine = (d: { id: string; why: string }): string => `not loaded: ${d.id} — ${d.why}`;

export interface CanvasLayout { version: number; camera: Camera; focusId: string | null; frames: Frame[]; lang?: string }

const LANG_RE = /^[a-z]{2,3}$/;

/** A stored layout, checked like a canvas document with no content. */
export function coerceLayout(raw: unknown): CanvasLayout | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const d = parseCanvasDoc({ version: r.version, camera: r.camera, focusId: r.focusId, frames: r.frames });
  if (!d) return null;
  const lang = typeof r.lang === 'string' && LANG_RE.test(r.lang) ? r.lang : undefined;
  return { version: d.version, camera: d.camera, focusId: d.focusId, frames: d.frames, ...(lang ? { lang } : {}) };
}

const boardFrameId = (a: Artifact): string => a.id.slice('board-'.length);

export const tooManyBoardsWhy = `more than ${MAX_FRAMES} boards; this one was not opened`;
/** Said at boot when boards past MAX_FRAMES were left closed. */
export const tooManyBoardsLine = (n: number): string => `${n} stored board${n === 1 ? ' was' : 's were'} not opened (the canvas holds ${MAX_FRAMES}). ${n === 1 ? 'It is' : 'They are'} still stored.`;

/** Layout + (already checked) artifacts → a canvas document, or null when
 *  there is nothing to open or the joined document fails parseCanvasDoc.
 *  Boards past MAX_FRAMES are not opened; each is reported to `onDrop`
 *  (the oldest are the ones left closed). They stay in the store. */
export function joinCanvasDoc(layout: CanvasLayout | null, artifacts: Artifact[], onDrop?: (d: { id: string; why: string }) => void): CanvasDoc | null {
  const boards = artifacts.filter((a) => a.kind === 'board');
  if (!layout && !boards.length) return null;
  const frames: Frame[] = (layout?.frames ?? []).map((f) => ({ ...f, rect: { ...f.rect } }));
  const surfaces: Record<string, SurfacePlan> = {};
  // Over the cap, the NEWEST boards are the ones opened; those that open are
  // then laid out oldest first, so appended boards keep the order they were made in.
  const known = new Set(frames.map((f) => f.id));
  let room = MAX_FRAMES - frames.length;
  const opened = new Set<string>();
  for (const a of [...boards].sort((x, y) => y.at - x.at)) {
    if (known.has(boardFrameId(a))) { opened.add(a.id); continue; }
    if (room > 0) { room--; opened.add(a.id); } else onDrop?.({ id: a.id, why: tooManyBoardsWhy });
  }
  for (const a of [...boards].sort((x, y) => x.at - y.at)) {
    if (!opened.has(a.id)) continue;
    const id = boardFrameId(a);
    const data = a.data as unknown as BoardData;
    const inLayout = frames.find((f) => f.id === id);
    if (inLayout) { inLayout.kind = data.frame.kind; inLayout.title = data.frame.title; }
    else {
      const right = frames.length ? Math.max(...frames.map((f) => f.rect.x + f.rect.w)) + FRAME_GAP : 0;
      frames.push({ id, kind: data.frame.kind, title: data.frame.title, rect: { ...data.frame.rect, x: right, y: 0 }, pinned: data.frame.pinned });
    }
    surfaces[id] = data.plan;
  }
  const ids = new Set(frames.map((f) => f.id));
  const drawings: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const a of artifacts) {
    if (a.kind !== 'plan') continue;
    const p = a.data as unknown as PlanData;
    if (!ids.has(p.frameId)) continue;
    (drawings[p.frameId] ??= {})[p.boardId] = p.doc;
  }
  const lang = layout?.lang;
  const pack = lang ? artifacts.find((a) => a.kind === 'pack' && a.id === artifactId('pack', lang))?.data : undefined;
  const focusId = layout?.focusId && ids.has(layout.focusId) ? layout.focusId : null;
  return parseCanvasDoc({
    version: CANVAS_DOC_VERSION,
    camera: layout?.camera ?? { x: 0, y: 0, z: 1 },
    focusId, frames, surfaces,
    ...(pack ? { pack } : {}),
    ...(Object.keys(drawings).length ? { drawings } : {}),
  });
}

/** Stored artifacts the joined document does not show: boards not opened
 *  (over the cap, or every one when the join failed — `doc` null) and the
 *  drawings of those boards. A save must never remove or overwrite these. */
export function unjoinedIds(doc: CanvasDoc | null, artifacts: readonly Artifact[]): Set<string> {
  const shown = new Set(doc ? Object.keys(doc.surfaces) : []);
  const out = new Set<string>();
  for (const a of artifacts) {
    if (a.kind !== 'board' && a.kind !== 'plan') continue;
    const frameId = a.kind === 'plan' ? String((a.data as { frameId?: unknown }).frameId ?? '') : frameIdOfArtifactId(a.id);
    if (!doc || !frameId || !shown.has(frameId)) out.add(a.id);
  }
  return out;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const titleOf = (s: string): string => s.replace(/[<>]/g, '').slice(0, ARTIFACT_TITLE_MAX) || 'Untitled';

/** A canvas document → its layout, the artifacts to write (new, or whose
 *  data changed: v + 1, by and at from now), and the ids to remove (boards
 *  and drawings no longer on the canvas). A stored pack is never removed
 *  here: switching back to English keeps the pack she approved. Ids in
 *  `keep` (see unjoinedIds) are never removed or overwritten. */
export function splitCanvasDoc(doc: CanvasDoc, prev: Artifact[], by: (id: string) => ArtifactBy, now: number, keep: ReadonlySet<string> = new Set()): { layout: CanvasLayout; put: Artifact[]; remove: string[] } {
  const layout: CanvasLayout = {
    version: doc.version, camera: { ...doc.camera }, focusId: doc.focusId,
    frames: doc.frames.map((f) => ({ ...f, rect: { ...f.rect } })),
    ...(doc.pack?.lang ? { lang: doc.pack.lang } : {}),
  };
  const before = new Map(prev.map((a) => [a.id, a]));
  const next: Array<Pick<Artifact, 'id' | 'kind' | 'title' | 'data'>> = [];
  for (const f of doc.frames) {
    const plan = doc.surfaces[f.id];
    if (!plan) continue;
    const data: BoardData = { frame: { kind: f.kind, title: f.title, rect: { ...f.rect }, pinned: f.pinned }, plan };
    next.push({ id: artifactId('board', f.id), kind: 'board', title: titleOf(f.title), data: data as unknown as Record<string, unknown> });
  }
  for (const [frameId, boards] of Object.entries(doc.drawings ?? {})) {
    for (const [boardId, drawing] of Object.entries(boards)) {
      const data: PlanData = { frameId, boardId, doc: drawing };
      next.push({ id: artifactId('plan', frameId, boardId), kind: 'plan', title: titleOf(doc.frames.find((f) => f.id === frameId)?.title ?? 'Floor plan'), data: data as unknown as Record<string, unknown> });
    }
  }
  if (doc.pack) {
    const pack: LanguagePack = doc.pack;
    next.push({ id: artifactId('pack', pack.lang), kind: 'pack', title: titleOf(`Language: ${pack.lang}`), data: pack as unknown as Record<string, unknown> });
  }
  const put: Artifact[] = [];
  for (const n of next) {
    if (keep.has(n.id)) continue;
    const old = before.get(n.id);
    if (old && same(old.data, n.data) && old.title === n.title) continue;
    put.push({ ...n, v: old ? old.v + 1 : 1, by: by(n.id), at: now, status: 'approved' });
  }
  const live = new Set(next.map((n) => n.id));
  const remove = prev.filter((a) => (a.kind === 'board' || a.kind === 'plan') && !live.has(a.id) && !keep.has(a.id)).map((a) => a.id);
  return { layout, put, remove };
}
