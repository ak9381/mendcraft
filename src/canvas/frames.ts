// Frames (boards) on the infinite canvas and the persisted canvas document.
import { MAX_Z, MIN_Z, type Camera, type Rect } from './camera';
import { coerceSurfacePlan, type SurfacePlan } from './surfacePlan';
import { coerceLanguagePack, type LanguagePack } from './languagePack';

export type FrameKind = 'room' | 'plan' | 'note';
export interface Frame { id: string; kind: FrameKind; title: string; rect: Rect; pinned: boolean }
export interface CanvasDoc {
  version: number; camera: Camera; focusId: string | null; frames: Frame[]; surfaces: Record<string, SurfacePlan>;
  /** Active non-English UI pack (validated), persisted so it works offline. */
  lang?: string; pack?: LanguagePack;
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

export function createFrameRegistry(initial: readonly Frame[] = []) {
  const frames: Frame[] = initial.map(copy);
  let seq = frames.reduce((m, f) => Math.max(m, Number(/^f(\d+)$/.exec(f.id)?.[1] ?? 0)), 0);
  const find = (id: string) => frames.find((f) => f.id === id);
  return {
    list: () => frames.map(copy),
    get: (id: string) => { const f = find(id); return f ? copy(f) : undefined; },
    add(kind: FrameKind, title: string): Frame {
      if (frames.length >= MAX_FRAMES) throw new Error('Canvas is full');
      const right = frames.length ? Math.max(...frames.map((f) => f.rect.x + f.rect.w)) + FRAME_GAP : 0;
      const f: Frame = { id: `f${++seq}`, kind, title: cleanTitle(title), rect: { x: right, y: 0, ...FRAME_SIZE }, pinned: false };
      frames.push(f);
      return copy(f);
    },
    rename(id: string, title: string) { const f = find(id); if (f) f.title = cleanTitle(title); },
    setPinned(id: string, on: boolean) { const f = find(id); if (f) f.pinned = on; },
    setKind(id: string, kind: FrameKind) { const f = find(id); if (f) f.kind = kind; },
    remove(id: string) { const i = frames.findIndex((f) => f.id === id); if (i < 0) return false; frames.splice(i, 1); return true; },
  };
}
export type FrameRegistry = ReturnType<typeof createFrameRegistry>;

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validate a stored document; anything off returns null (start fresh, never half-load). */
export function parseCanvasDoc(raw: unknown): CanvasDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (d.version !== CANVAS_DOC_VERSION) return null;
  const c = d.camera as Record<string, unknown> | undefined;
  if (!c || !fin(c.x) || !fin(c.y) || !fin(c.z) || c.z < MIN_Z || c.z > MAX_Z) return null;
  if (!Array.isArray(d.frames) || d.frames.length > MAX_FRAMES) return null;
  const frames: Frame[] = [];
  const seen = new Set<string>();
  for (const f of d.frames as Record<string, unknown>[]) {
    const r = f?.rect as Record<string, unknown> | undefined;
    if (typeof f?.id !== 'string' || !ID_RE.test(f.id) || seen.has(f.id)) return null;
    if (!KINDS.includes(f.kind as FrameKind) || typeof f.title !== 'string') return null;
    if (!r || !fin(r.x) || !fin(r.y) || !fin(r.w) || !fin(r.h) || r.w <= 0 || r.h <= 0) return null;
    if (f.pinned !== undefined && typeof f.pinned !== 'boolean') return null;
    seen.add(f.id);
    frames.push({ id: f.id, kind: f.kind as FrameKind, title: cleanTitle(f.title), rect: { x: r.x, y: r.y, w: r.w, h: r.h }, pinned: f.pinned === true });
  }
  const focusId = d.focusId ?? null;
  if (focusId !== null && (typeof focusId !== 'string' || !seen.has(focusId))) return null;
  const surfaces: Record<string, SurfacePlan> = {};
  if (d.surfaces !== undefined) {
    if (!d.surfaces || typeof d.surfaces !== 'object' || Array.isArray(d.surfaces)) return null;
    for (const [id, plan] of Object.entries(d.surfaces as Record<string, unknown>)) {
      if (!seen.has(id)) return null;
      const p = coerceSurfacePlan(plan);
      if (!p.ok) return null;
      surfaces[id] = p.value;
    }
  }
  // A persisted language pack is validated the same way as a fresh AI reply. An
  // invalid pack is dropped (back to English) but never discards her boards.
  let lang: string | undefined;
  let pack: LanguagePack | undefined;
  if (d.pack !== undefined) {
    const p = coerceLanguagePack(d.pack);
    if (p.ok) { pack = p.value; lang = p.value.lang; }
  }
  return { version: CANVAS_DOC_VERSION, camera: { x: c.x, y: c.y, z: c.z }, focusId, frames, surfaces, lang, pack };
}
