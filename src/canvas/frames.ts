// Frames (boards) on the infinite canvas and the persisted canvas document.
import { coerceDrawings, type Drawings } from './planDocs';
import { MAX_Z, MIN_Z, type Camera, type Rect } from './camera';
import { coerceSurfacePlan, type SurfacePlan } from './surfacePlan';
import { coerceLanguagePack, type LanguagePack } from './languagePack';

export type FrameKind = 'room' | 'plan' | 'note';
export interface Frame {
  id: string; kind: FrameKind; title: string; rect: Rect; pinned: boolean;
  /** A phone: this board was received from the laptop (only these are ever
   *  treated as copies of one another — never her own boards). */
  from?: 'laptop';
  /** The laptop: this board was sent (moved) to that phone and is hidden
   *  here until it is brought back. */
  away?: 'ios' | 'android';
}
export interface CanvasDoc {
  version: number; camera: Camera; focusId: string | null; frames: Frame[]; surfaces: Record<string, SurfacePlan>;
  /** Active non-English UI pack (validated), persisted so it works offline. */
  lang?: string; pack?: LanguagePack;
  /** What was drawn on floor-plan boards: frame id → plan board id → plan
   *  document. Beside `surfaces`, never inside them (see planDocs.ts). */
  drawings?: Drawings;
}

export const CANVAS_DOC_VERSION = 1;
export const FRAME_SIZE = { w: 1000, h: 680 } as const;
export const FRAME_GAP = 160;
export const MAX_FRAMES = 40;
const KINDS: readonly FrameKind[] = ['room', 'plan', 'note'];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function cleanTitle(t: unknown): string {
  const s = String(t ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s || 'Untitled';
}

const copy = (f: Frame): Frame => ({ ...f, rect: { ...f.rect } });

/** `reserved`: frame ids already used by stored boards that are not on the
 *  canvas (kept as they are). New boards never take one of them, and are
 *  numbered past the highest — so a new board can't collide with one. */
export function createFrameRegistry(initial: readonly Frame[] = [], reserved: Iterable<string> = []) {
  const frames: Frame[] = initial.map(copy);
  const taken = new Set(reserved);
  const num = (id: string): number => Number(/^f(\d+)$/.exec(id)?.[1] ?? 0);
  let seq = Math.max(frames.reduce((m, f) => Math.max(m, num(f.id)), 0), ...[...taken].map(num), 0);
  const find = (id: string) => frames.find((f) => f.id === id);
  return {
    list: () => frames.map(copy),
    get: (id: string) => { const f = find(id); return f ? copy(f) : undefined; },
    add(kind: FrameKind, title: string): Frame {
      if (frames.length >= MAX_FRAMES) throw new Error('Canvas is full');
      const right = frames.length ? Math.max(...frames.map((f) => f.rect.x + f.rect.w)) + FRAME_GAP : 0;
      let id = `f${++seq}`;
      while (taken.has(id) || find(id)) id = `f${++seq}`;
      const f: Frame = { id, kind, title: cleanTitle(title), rect: { x: right, y: 0, ...FRAME_SIZE }, pinned: false };
      frames.push(f);
      return copy(f);
    },
    rename(id: string, title: string) { const f = find(id); if (f) f.title = cleanTitle(title); },
    /** Two-fist board move: set a board's world-space position directly. */
    setRect(id: string, rect: Rect) { const f = find(id); if (f) f.rect = { ...rect }; },
    setPinned(id: string, on: boolean) { const f = find(id); if (f) f.pinned = on; },
    setKind(id: string, kind: FrameKind) { const f = find(id); if (f) f.kind = kind; },
    /** A phone: mark a board as received from the laptop. */
    markFromLaptop(id: string) { const f = find(id); if (f) f.from = 'laptop'; },
    /** The laptop: the board is on that phone now (null: back here). */
    markAway(id: string, p: 'ios' | 'android' | null) { const f = find(id); if (!f) return; if (p) f.away = p; else delete f.away; },
    remove(id: string) { const i = frames.findIndex((f) => f.id === id); if (i < 0) return false; frames.splice(i, 1); return true; },
    /** Put a closed board back as it was (Undo of "Close board"). */
    restore(f: Frame) { if (find(f.id) || frames.length >= MAX_FRAMES) return false; frames.push(copy(f)); return true; },
  };
}
export type FrameRegistry = ReturnType<typeof createFrameRegistry>;

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validate a stored document. Anything that would lose or misplace her
 *  boards (a bad frame, a board whose plan can't be read, another version)
 *  returns doc: null — the caller then keeps the raw text safe
 *  (canvasStore.ts) and never half-loads it. Harmless slips are repaired
 *  instead of refusing the whole doc, and each repair is named in
 *  `repaired` (the caller keeps the raw text aside before saving over it):
 *  a camera out of range is reset, a focus id with no frame is cleared,
 *  a plan for a board that is gone (or an empty one) is left out. */
export function parseCanvasDocReport(raw: unknown): { doc: CanvasDoc | null; repaired: string[] } {
  const no = { doc: null, repaired: [] };
  if (!raw || typeof raw !== 'object') return no;
  const d = raw as Record<string, unknown>;
  if (d.version !== CANVAS_DOC_VERSION) return no;
  if (!Array.isArray(d.frames) || d.frames.length > MAX_FRAMES) return no;
  const repaired: string[] = [];
  const frames: Frame[] = [];
  const seen = new Set<string>();
  for (const f of d.frames as Record<string, unknown>[]) {
    const r = f?.rect as Record<string, unknown> | undefined;
    if (typeof f?.id !== 'string' || !ID_RE.test(f.id) || seen.has(f.id)) return no;
    if (!KINDS.includes(f.kind as FrameKind)) return no;
    if (!r || !fin(r.x) || !fin(r.y) || !fin(r.w) || !fin(r.h) || r.w <= 0 || r.h <= 0) return no;
    if (typeof f.title !== 'string') repaired.push(`board ${f.id}: title`);
    if (f.pinned !== undefined && typeof f.pinned !== 'boolean') repaired.push(`board ${f.id}: pinned`);
    seen.add(f.id);
    frames.push({
      id: f.id, kind: f.kind as FrameKind, title: cleanTitle(f.title), rect: { x: r.x, y: r.y, w: r.w, h: r.h }, pinned: f.pinned === true,
      ...(f.from === 'laptop' ? { from: 'laptop' as const } : {}),
      ...(f.away === 'ios' || f.away === 'android' ? { away: f.away } : {}),
    });
  }
  const c = d.camera as Record<string, unknown> | undefined;
  const camOk = !!c && fin(c.x) && fin(c.y) && fin(c.z);
  const camera: Camera = camOk ? { x: c!.x as number, y: c!.y as number, z: Math.min(MAX_Z, Math.max(MIN_Z, c!.z as number)) } : { x: 0, y: 0, z: 1 };
  if (!camOk || camera.z !== c!.z) repaired.push('camera');
  const focusId = typeof d.focusId === 'string' && seen.has(d.focusId) ? d.focusId : null;
  if (d.focusId != null && focusId === null) repaired.push('focus');
  const surfaces: Record<string, SurfacePlan> = {};
  if (d.surfaces !== undefined && d.surfaces !== null) {
    if (typeof d.surfaces !== 'object' || Array.isArray(d.surfaces)) return no;
    for (const [id, plan] of Object.entries(d.surfaces as Record<string, unknown>)) {
      if (!seen.has(id)) { repaired.push(`plan for missing board ${id.slice(0, 40)}`); continue; } // its board is gone: nothing could show it
      const tiles = (plan as { tiles?: unknown } | null)?.tiles;
      if (Array.isArray(tiles) && !tiles.length) { repaired.push(`empty plan on ${id}`); continue; } // nothing to lose
      const p = coerceSurfacePlan(plan);
      if (!p.ok) return no;
      surfaces[id] = p.value;
    }
  }
  // A persisted language pack is validated the same way as a fresh AI reply. An
  // invalid pack is dropped (back to English) but never discards her boards.
  let lang: string | undefined;
  let pack: LanguagePack | undefined;
  if (d.pack !== undefined) {
    const p = coerceLanguagePack(d.pack, { stored: true });
    if (p.ok) { pack = p.value; lang = p.value.lang; } else repaired.push('language pack');
  }
  const drawings = coerceDrawings(d.drawings, seen);
  return {
    doc: {
      version: CANVAS_DOC_VERSION, camera, focusId, frames, surfaces, lang, pack,
      ...(Object.keys(drawings).length ? { drawings } : {}),
    },
    repaired,
  };
}

/** parseCanvasDocReport without the list of repairs. */
export function parseCanvasDoc(raw: unknown): CanvasDoc | null {
  return parseCanvasDocReport(raw).doc;
}
