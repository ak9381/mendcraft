// Artifacts: what a model generated and she approved, kept as DATA apart
// from the code (boards, floor-plan drawings, connector configs, language
// packs, next-step suggestions). Every artifact is checked by the same
// coercer when it is written and again every time it is loaded: storage can
// be edited, so nothing in it is trusted. Nothing in an artifact is ever run.
import { coerceSurfacePlan, type Coerced, type SurfacePlan } from '../canvas/surfacePlan';
import { cleanTitle, type FrameKind } from '../canvas/frames';
import { sanitizePlanDoc } from '../canvas/planDocs';
import { coerceLanguagePack } from '../canvas/languagePack';
import { coerceConnector, type ConnectorSource } from '../devices/connector';

export const ARTIFACT_KINDS = ['board', 'plan', 'connector', 'pack', 'steps'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export const ARTIFACT_BY = ['nano', 'gemini', 'apple', 'person', 'replay'] as const;
export type ArtifactBy = (typeof ARTIFACT_BY)[number];

export interface Artifact {
  /** /^[a-z0-9][a-z0-9-]{0,63}$/, starting with `<kind>-`. */
  id: string;
  kind: ArtifactKind;
  /** Whole number >= 1, +1 on every approved change. */
  v: number;
  /** At most 80 characters, no < or >. */
  title: string;
  data: Record<string, unknown>;
  by: ArtifactBy;
  /** ms since the epoch. */
  at: number;
  /** 'proposed' exists only in the (undeployed) Firestore draft. */
  status: 'approved';
}

/** Same cap as PLAN_DOC_MAX_CHARS. */
export const ARTIFACT_MAX_CHARS = 400_000;
export const ARTIFACT_MAX_COUNT = 200;
export const ARTIFACT_TITLE_MAX = 80;

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FRAME_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const FRAME_KINDS: readonly FrameKind[] = ['room', 'plan', 'note'];
/** A stored connector must have been generated; scaffold and SIM ones are code. */
const STORED_CONNECTOR_SOURCES: readonly ConnectorSource[] = ['cloud', 'on-device'];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const bad = (error: string): { ok: false; error: string } => ({ ok: false, error });

const PART_RE = /^[a-z0-9][a-z0-9-]*$/;
/** One id part, kept as it is when it is already in the id charset, else
 *  hex-encoded (`x` + UTF-8 hex), so two different parts never share an id. */
const encodePart = (s: string): string => (PART_RE.test(s) ? s : `x${[...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('')}`);
const fnv = (s: string, seed: number): string => {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
};

/** `<kind>-<part>` for one part; with more parts every part but the last is
 *  length-prefixed (`plan-2-f2-f2-cad` = frame "f2", board "f2-cad"), so
 *  hyphenated parts can't run together. Nothing is slugged away. An id that
 *  would pass 64 characters becomes `<kind>-h<64-bit hash>` of the full form. */
export function artifactId(kind: ArtifactKind, ...parts: string[]): string {
  const enc = parts.map(encodePart);
  const body = enc.map((p, i) => (i < enc.length - 1 ? `${p.length}-${p}` : p)).join('-');
  const id = `${kind}-${body}`;
  return id.length <= 64 ? id : `${kind}-h${fnv(id, 0x811c9dc5)}${fnv(id, 0x9e3779b1)}`;
}

/** The frame a board or plan artifact id belongs to (null for other kinds or
 *  a hashed id). Reads the length prefix, so hyphenated frame ids work. */
export function frameIdOfArtifactId(id: string): string | null {
  if (id.startsWith('board-')) return id.slice('board-'.length) || null;
  const m = /^plan-(\d+)-/.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  const rest = id.slice(m[0].length);
  return rest.length > n && rest[n] === '-' ? rest.slice(0, n) : null;
}

/** What a board artifact holds: the frame it sits in and its surface plan. */
export interface BoardData {
  frame: { kind: FrameKind; title: string; rect: { x: number; y: number; w: number; h: number }; pinned: boolean };
  plan: SurfacePlan;
}

function coerceBoard(data: Record<string, unknown>): Coerced<BoardData> {
  const f = data.frame;
  if (!isObj(f)) return bad('a board needs its frame');
  if (!FRAME_KINDS.includes(f.kind as FrameKind)) return bad('the frame kind is not known');
  if (typeof f.title !== 'string') return bad('the frame has no title');
  const r = f.rect;
  if (!isObj(r) || !fin(r.x) || !fin(r.y) || !fin(r.w) || !fin(r.h) || r.w <= 0 || r.h <= 0) return bad('the frame rect is not finite');
  if (f.pinned !== undefined && typeof f.pinned !== 'boolean') return bad('pinned is not true or false');
  const plan = coerceSurfacePlan(data.plan);
  if (!plan.ok) return bad(`the board failed its check: ${plan.error}`);
  return {
    ok: true,
    value: {
      frame: { kind: f.kind as FrameKind, title: cleanTitle(f.title), rect: { x: r.x, y: r.y, w: r.w, h: r.h }, pinned: f.pinned === true },
      plan: plan.value,
    },
  };
}

/** What a plan artifact holds: which board's plan tile it is drawn on, and the drawing. */
export interface PlanData { frameId: string; boardId: string; doc: Record<string, unknown> }

function coercePlanData(data: Record<string, unknown>): Coerced<PlanData> {
  if (typeof data.frameId !== 'string' || !FRAME_ID_RE.test(data.frameId)) return bad('the plan names no board');
  if (typeof data.boardId !== 'string' || !data.boardId || data.boardId.length > 80) return bad('the plan names no plan tile');
  const doc = sanitizePlanDoc(data.doc);
  if (!doc) return bad('the drawing failed its check');
  return { ok: true, value: { frameId: data.frameId, boardId: data.boardId, doc } };
}

function coerceConnectorData(data: Record<string, unknown>): Coerced<Record<string, unknown>> {
  const raw = data.connector;
  if (!isObj(raw)) return bad('no connector');
  const source = raw.source as ConnectorSource;
  if (!STORED_CONNECTOR_SOURCES.includes(source)) return bad('a stored connector must be generated (cloud or on-device)');
  const c = coerceConnector(raw, source);
  if (!c) return bad('the connector failed its check');
  // The intent map gets its own check with the connector it names (intentMap.ts).
  if (data.intents !== undefined && !isObj(data.intents)) return bad('the intent map is not an object');
  return { ok: true, value: { connector: c, ...(isObj(data.intents) ? { intents: data.intents } : {}) } };
}

function coerceSteps(data: Record<string, unknown>): Coerced<Record<string, unknown>> {
  // Loose until coerceNextSteps exists: a time and a list.
  if (!fin(data.at) || !Array.isArray(data.steps)) return bad('steps need a time and a list');
  return { ok: true, value: { at: data.at, steps: data.steps } };
}

function coerceData(kind: ArtifactKind, data: Record<string, unknown>): Coerced<Record<string, unknown>> {
  switch (kind) {
    case 'board': { const b = coerceBoard(data); return b.ok ? { ok: true, value: { ...b.value } } : b; }
    case 'plan': { const p = coercePlanData(data); return p.ok ? { ok: true, value: { ...p.value } } : p; }
    case 'connector': return coerceConnectorData(data);
    case 'pack': {
      const p = coerceLanguagePack(data);
      return p.ok ? { ok: true, value: { ...p.value } as Record<string, unknown> } : bad(`the language pack failed its check: ${p.error}`);
    }
    case 'steps': return coerceSteps(data);
  }
}

/** Check the envelope, then the kind's own validator on `data`. The value
 *  returned carries the re-coerced data, never the raw one. */
export function coerceArtifact(raw: unknown): Coerced<Artifact> {
  if (!isObj(raw)) return bad('not an artifact');
  let size: number;
  try { size = JSON.stringify(raw).length; } catch { return bad('not plain data'); }
  if (size > ARTIFACT_MAX_CHARS) return bad(`over ${ARTIFACT_MAX_CHARS} characters`);
  const { id, kind, v, title, data, by, at, status } = raw;
  if (!ARTIFACT_KINDS.includes(kind as ArtifactKind)) return bad('unknown kind');
  const k = kind as ArtifactKind;
  if (typeof id !== 'string' || !ID_RE.test(id) || !id.startsWith(`${k}-`)) return bad('bad id');
  if (!Number.isInteger(v) || (v as number) < 1) return bad('bad version');
  if (typeof title !== 'string' || title.length > ARTIFACT_TITLE_MAX || /[<>]/.test(title)) return bad('bad title');
  if (!ARTIFACT_BY.includes(by as ArtifactBy)) return bad('unknown maker');
  if (!fin(at) || at < 0) return bad('bad time');
  if (status !== 'approved') return bad('not approved');
  if (!isObj(data)) return bad('no data');
  if (k === 'board' && !FRAME_ID_RE.test(id.slice('board-'.length))) return bad('bad board id');
  const d = coerceData(k, data);
  if (!d.ok) return d;
  if (k === 'plan' && id !== artifactId('plan', String(d.value.frameId), String(d.value.boardId))) return bad('the plan id does not match its board');
  return { ok: true, value: { id, kind: k, v: v as number, title, data: d.value, by: by as ArtifactBy, at, status: 'approved' } };
}
