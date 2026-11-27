// CONTROL-ROOM SNAPSHOT — the small, privacy-safe state the laptop publishes to
// the optional /control dashboard. It is PURE (no DOM, no Firebase, no
// model): buildControlSnapshot() clamps, redacts, and omits so that whatever
// leaves the laptop is honest and bounded.
//
// Privacy contract (enforced here, tested in controlSnapshot.test.ts):
//   • Camera frames, face/hand landmarks and voice AUDIO never reach this module
//     and never appear in a snapshot. redact() (core/ledger) is a defensive
//     backstop: any media/landmark string that slips in becomes a visible tag.
//   • The AI request feed carries SOURCE + REASON for every event, but the raw
//     utterance only for CLOUD events (which already left the device). Private
//     on-device/rules events are counted and labelled — never their text.
//   • Cloud ledger calls are reused verbatim (core/ledger already redacted them).
//   • Everything is capped; what gets dropped is reported in `omitted`, so a
//     truncated feed never reads as "that was everything".

import { REASON_TEXT, badgeLabel, type RouteReason } from '../ai/router';
import type { Source } from '../ai/hybrid';
import { redact, type CloudCall, type LedgerCounts } from '../core/ledger';
import type { JobKind, JobStatus, QueuedJob } from '../offline/queue';
import { coerceLayout, type ScreenLayout } from '../canvas/screenLayout';
import { coerceSurfacePlan, type SurfacePlan } from '../canvas/surfacePlan';
import { coerceBoardDrawings } from '../canvas/planDocs';

export const SNAPSHOT_VERSION = 1 as const;

// Caps — generous enough for the demo, small enough to stay well under a
// Firestore document, and enforced so the dashboard can never be flooded.
export const AI_FEED_MAX = 12;
export const LEDGER_CALLS_MAX = 12;
export const QUEUE_MAX = 20;
export const PRIMITIVES_MAX = 120;
export const RECIPES_MAX = 24;
const UTTERANCE_MAX = 80;
const CAPTION_MAX = 140;
const SUMMARY_MAX = 120;
const LABEL_MAX = 80;
/** Redacted cloud payload preview — the full byte count is kept separately in
 *  `bytes` (what actually left the device); this only bounds the shown text. */
const SENT_MAX = 600;

const REASON_KEYS = Object.keys(REASON_TEXT) as RouteReason[];

/** The whole snapshot rides in ONE Firestore document (1 MiB, at most 20 000
 *  fields, counting every map key and array element). Board drawings share
 *  this budget: the largest is shed first until the snapshot fits. */
export const SNAPSHOT_MAX_BYTES = 900_000;
export const SNAPSHOT_MAX_FIELDS = 15_000;

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
function utf8Bytes(json: string): number {
  return encoder ? encoder.encode(json).length : json.length * 3;
}
/** Fields as Firestore counts them, conservatively: every map key and every
 *  array element, nested. */
export function snapshotFieldCount(v: unknown): number {
  if (Array.isArray(v)) return v.reduce<number>((n, x) => n + 1 + snapshotFieldCount(x), 0);
  if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).reduce<number>((n, x) => n + 1 + snapshotFieldCount(x), 0);
  return 0;
}
/** Does a snapshot fit one relay message (UTF-8 bytes + fields)? */
export function snapshotFits(snap: unknown): boolean {
  return utf8Bytes(JSON.stringify(snap)) <= SNAPSHOT_MAX_BYTES && snapshotFieldCount(snap) <= SNAPSHOT_MAX_FIELDS;
}

/** Clamp a cloud ledger call's preview text so even an adversarial host can't
 *  flood the snapshot; `bytes` stays as recorded (the honest size that left). */
function clampCall(c: CloudCall): CloudCall {
  const { text } = redact(c.sent ?? '');
  const sent = text.length > SENT_MAX ? `${text.slice(0, SENT_MAX - 1)}…` : text;
  return { ...c, sent };
}

export type DeviceId = 'laptop' | 'phone' | 'other';
/** Lamp on/off/unknown — never a fake "connected" claim (unknown = no bridge). */
export type ApplianceState = 'on' | 'off' | 'unknown';

/** Appliance states published to the dashboard. `lamp`/`music` are the honest
 *  on/off/unknown; the optional *Detail/Title strings add a short human label
 *  ("On · 80% · 2700K", the now-playing track) when the laptop knows it. */
export interface ApplianceSnapshot {
  lamp: ApplianceState;
  music: ApplianceState;
  lampDetail?: string;
  musicTitle?: string;
}

/** One line in the live AI request feed. */
export interface AiFeedEntry {
  source: Source;
  reason: RouteReason;
  /** "Cloud · big job" etc. — via badgeLabel, so the dashboard stays honest. */
  badge: string;
  /** The command text — ONLY for cloud events; omitted for private ones. */
  utterance?: string;
  ms?: number;
}

export interface CaptionLine {
  heard: string;
  translation: string | null;
  langCode: string;
  langLabel: string;
}

/** A compact 2D primitive for the read-only wireframe preview (mm/px units). */
export type ScenePrimitive =
  | { t: 'seg'; x1: number; y1: number; x2: number; y2: number }
  | { t: 'box'; x: number; y: number; w: number; h: number };

export interface SceneSnapshot {
  mode: string;
  summary: string;
  primitives: ScenePrimitive[];
  /** Op-log revision, so the dashboard can show that the scene advanced. */
  rev: number;
}

export interface QueueEntry {
  id: string;
  kind: JobKind;
  mode: string;
  label: string;
  status: JobStatus;
  seq: number;
}

/** One shared-recipe card for the /control dashboard: what it does, which device
 *  runs it, who taught it. No steps/ops leave — just the summary line. */
export interface RecipeCard {
  id: string;
  name: string;
  device: string;
  taughtBy: string;
  /** One human line ("7 steps · adds room…" or "Opens mail.example.com"). */
  summary: string;
  steps: number;
}

/** One change-log entry for the /control dashboard: who changed what, why, and its review
 *  state. No geometry or snapshots leave — just the human line. */
export interface ChangeCard {
  id: string;
  who: 'her' | 'nano' | 'gemini' | 'rules';
  title: string;
  why: string;
  status: 'pending' | 'applied' | 'rejected' | 'reverted';
}

/** One site-checklist question for the /control dashboard. */
export interface ChecklistCard {
  id: string;
  question: string;
  status: 'open' | 'answered' | 'emailed' | 'done';
  offline: boolean;
  answer?: string;
}

export const CHANGES_MAX = 12;
export const CHECKLIST_MAX = 12;

/** A committed cross-device tile move, carried in the snapshot so BOTH phones
 *  (not just the sender) learn about it and animate the tile entering from the
 *  matching edge. The tile's content rides in `board`; this is just the marker.
 *  `rev` lets a target apply the enter-animation exactly once. */
export interface TransferMarker {
  componentId: string;
  to: 'laptop' | 'left' | 'right';
  enterEdge: 'left' | 'right';
  rev: number;
}

/** What the caps dropped — surfaced so the dashboard never hides truncation. */
export interface SnapshotOmissions {
  aiFeed: number;
  ledgerCalls: number;
  queue: number;
  primitives: number;
  recipes: number;
  /** Plan drawings left out of `boardDrawings` (invalid or over the size cap).
   *  Present only when something was dropped. */
  drawings?: number;
}

export interface ControlSnapshot {
  v: typeof SNAPSHOT_VERSION;
  /** Monotonic publish counter; the dashboard uses it to tell fresh from stale. */
  rev: number;
  activeDevice: DeviceId;
  ai: AiFeedEntry[];
  ledger: { calls: CloudCall[]; counts: LedgerCounts };
  queue: QueueEntry[];
  appliances: ApplianceSnapshot;
  caption: CaptionLine | null;
  scene: SceneSnapshot | null;
  recipes: RecipeCard[];
  /** Reviewed change log (newest last); present when there are entries. */
  changes?: ChangeCard[];
  /** Site checklist; present when there are items. */
  checklist?: ChecklistCard[];
  /** Which phone is on which side of the laptop (screen arrangement). Optional:
   *  old snapshots without it still coerce; phones default to the empty layout. */
  layout?: ScreenLayout;
  /** The shared board the phones mirror/pick tiles from. Re-validated through
   *  coerceSurfacePlan (bounded, no media). Optional + backward compatible. */
  board?: SurfacePlan;
  /** When set, `board` was sent to ONE phone (a whole-board edge drag): only
   *  the phone of this platform shows it; the other phone ignores it. */
  boardFor?: 'ios' | 'android';
  /** Set only on a REAL board send (a whole-board edge drag), never on a
   *  republish: the phone lights the arrived board once per id. */
  boardSend?: { id: string; at: number };
  /** What is drawn on `board`'s plan tiles right now (plan board id → plan
   *  doc), BESIDE the surface plan — never inside it. Each doc sanitized,
   *  only ids `board` has, size-capped (planDocs.coerceBoardDrawings). */
  boardDrawings?: Record<string, Record<string, unknown>>;
  /** The most recent committed tile transfer (for the enter-from-edge animation). */
  transfer?: TransferMarker;
  omitted: SnapshotOmissions;
}

// ---------------------------------------------------------------------------
// Builder input (the live laptop state, before clamping/redaction).

export interface AiFeedInput {
  source: Source;
  reason: RouteReason;
  utterance?: string;
  ms?: number;
}

export interface SceneInput {
  mode: string;
  summary?: string;
  primitives?: ScenePrimitive[];
  rev?: number;
}

export interface ControlSnapshotInput {
  rev?: number;
  activeDevice?: DeviceId;
  ai?: AiFeedInput[];
  ledger?: { calls: CloudCall[]; counts: LedgerCounts } | null;
  queue?: QueuedJob[];
  appliances?: { lamp?: ApplianceState; music?: ApplianceState; lampDetail?: string; musicTitle?: string };
  caption?: { heard: string; translation?: string | null; langCode?: string; langLabel?: string } | null;
  scene?: SceneInput | null;
  recipes?: RecipeCardInput[];
  changes?: { id: string; actor: string; title: string; why?: string; status: string }[];
  checklist?: { id: string; question: string; status: string; askedOffline?: boolean; answer?: string }[];
  /** Screen arrangement (coerced defensively, so wire junk is safe). */
  layout?: ScreenLayout | null;
  /** Shared board (re-coerced via coerceSurfacePlan; dropped if invalid). */
  board?: unknown;
  /** Target phone for `board` (validated; anything else is dropped). */
  boardFor?: unknown;
  /** Stamp of a real board send (validated; dropped without a board). */
  boardSend?: unknown;
  /** Drawings for `board`'s plan tiles (re-sanitized; dropped if invalid). */
  boardDrawings?: unknown;
  /** Drawings the SENDER already left out (a rebuilt wire snapshot keeps
   *  the count, so the phone can say so). */
  omittedDrawings?: unknown;
  /** Last committed transfer marker. */
  transfer?: { componentId?: unknown; to?: unknown; enterEdge?: unknown; rev?: unknown } | null;
}

export interface RecipeCardInput {
  id: string;
  name: string;
  device: string;
  taughtBy?: string;
  summary?: string;
  steps?: number;
}

const EMPTY_COUNTS: LedgerCounts = { cloud: 0, onDevice: 0, rules: 0, private: 0, bytesSent: 0 };

/** Redact then trim a free-text string to `max` chars (… suffix when cut). */
function safeText(raw: string, max: number): string {
  const { text } = redact(raw);
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function clampFinite(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

function keepLast<T>(items: readonly T[], max: number): { kept: T[]; dropped: number } {
  if (items.length <= max) return { kept: items.slice(), dropped: 0 };
  return { kept: items.slice(items.length - max), dropped: items.length - max };
}

/**
 * Build the privacy-safe snapshot the laptop publishes. Deterministic over its
 * input (no clock, no randomness), so it is fully unit-testable.
 */
export function buildControlSnapshot(input: ControlSnapshotInput): ControlSnapshot {
  // AI feed: newest-last, capped; cloud utterance kept (already left the
  // device), private utterances dropped to source+reason only.
  const aiAll = (input.ai ?? []).map((e): AiFeedEntry => {
    const entry: AiFeedEntry = {
      source: e.source,
      reason: e.reason,
      badge: badgeLabel(e.source, e.reason),
    };
    if (e.source === 'cloud' && typeof e.utterance === 'string' && e.utterance.trim()) {
      entry.utterance = safeText(e.utterance, UTTERANCE_MAX);
    }
    if (typeof e.ms === 'number' && Number.isFinite(e.ms)) entry.ms = Math.round(e.ms);
    return entry;
  });
  const ai = keepLast(aiAll, AI_FEED_MAX);

  const calls = keepLast((input.ledger?.calls ?? []).map(clampCall), LEDGER_CALLS_MAX);
  const counts = input.ledger?.counts ?? EMPTY_COUNTS;

  const queueAll = (input.queue ?? []).map((j): QueueEntry => ({
    id: j.id,
    kind: j.kind,
    mode: j.mode,
    label: safeText(j.label, LABEL_MAX),
    status: j.status,
    seq: j.seq,
  }));
  const queue = keepLast(queueAll, QUEUE_MAX);

  let scene: SceneSnapshot | null = null;
  let primitivesDropped = 0;
  if (input.scene) {
    const prims = keepLast(
      (input.scene.primitives ?? []).map(clampPrimitive),
      PRIMITIVES_MAX,
    );
    primitivesDropped = prims.dropped;
    scene = {
      mode: safeText(input.scene.mode ?? '', 24),
      summary: safeText(input.scene.summary ?? '', SUMMARY_MAX),
      primitives: prims.kept,
      rev: Number.isFinite(input.scene.rev) ? Math.round(input.scene.rev as number) : 0,
    };
  }

  const recipeAll = (input.recipes ?? [])
    .filter((r) => typeof r?.id === 'string' && r.id && typeof r.name === 'string' && r.name)
    .map((r): RecipeCard => ({
      id: safeText(r.id, 64),
      name: safeText(r.name, LABEL_MAX),
      device: safeText(r.device ?? '', 16),
      taughtBy: safeText(r.taughtBy ?? '', 40),
      summary: safeText(r.summary ?? '', SUMMARY_MAX),
      steps: typeof r.steps === 'number' && Number.isFinite(r.steps) ? Math.max(0, Math.round(r.steps)) : 0,
    }));
  const recipes = keepLast(recipeAll, RECIPES_MAX);

  let caption: CaptionLine | null = null;
  if (input.caption && input.caption.heard.trim()) {
    const heard = safeText(input.caption.heard, CAPTION_MAX);
    const tr = input.caption.translation ? safeText(input.caption.translation, CAPTION_MAX) : '';
    caption = {
      heard,
      translation: tr || null,
      langCode: safeText(input.caption.langCode ?? '', 8),
      langLabel: safeText(input.caption.langLabel ?? '', 24),
    };
  }

  const WHO = ['her', 'nano', 'gemini', 'rules'] as const;
  const CST = ['pending', 'applied', 'rejected', 'reverted'] as const;
  const IST = ['open', 'answered', 'emailed', 'done'] as const;
  const changes = keepLast((input.changes ?? [])
    .filter((c) => c && typeof c.id === 'string' && c.id && (WHO as readonly string[]).includes(c.actor) && (CST as readonly string[]).includes(c.status))
    .map((c): ChangeCard => ({
      id: safeText(c.id, 40), who: c.actor as ChangeCard['who'], status: c.status as ChangeCard['status'],
      title: safeText(c.title ?? '', LABEL_MAX), why: safeText(c.why ?? '', SUMMARY_MAX),
    })), CHANGES_MAX).kept;
  const checklist = keepLast((input.checklist ?? [])
    .filter((c) => c && typeof c.id === 'string' && c.id && typeof c.question === 'string' && c.question.trim() && (IST as readonly string[]).includes(c.status))
    .map((c): ChecklistCard => ({
      id: safeText(c.id, 40), question: safeText(c.question, SUMMARY_MAX), status: c.status as ChecklistCard['status'],
      offline: c.askedOffline === true,
      ...(c.answer ? { answer: safeText(c.answer, SUMMARY_MAX) } : {}),
    })), CHECKLIST_MAX).kept;

  // Screen arrangement, shared board, and the last transfer marker — all
  // optional and added only when present, so snapshots that predate these
  // fields (or a laptop that never arranges phones) stay byte-for-byte as before
  // and old consumers are unaffected.
  // Only carry a layout when at least one phone is actually placed — an empty
  // {left:null,right:null} (no arrangement / wire junk) is omitted so old
  // snapshots and un-arranged laptops stay field-for-field identical.
  const coercedLayout = input.layout ? coerceLayout(input.layout) : null;
  const layout = coercedLayout && (coercedLayout.left || coercedLayout.right) ? coercedLayout : null;
  let board: SurfacePlan | null = null;
  if (input.board !== undefined && input.board !== null) {
    const c = coerceSurfacePlan(input.board);
    if (c.ok) board = c.value;
  }
  const transfer = coerceTransferMarker(input.transfer);
  const boardFor = board && (input.boardFor === 'ios' || input.boardFor === 'android') ? input.boardFor : null;
  const bsIn = (input.boardSend ?? null) as { id?: unknown; at?: unknown } | null;
  const boardSend = board && bsIn && typeof bsIn.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(bsIn.id) && typeof bsIn.at === 'number' && Number.isFinite(bsIn.at)
    ? { id: bsIn.id, at: Math.round(bsIn.at) } : null;
  const bd = board && input.boardDrawings !== undefined ? coerceBoardDrawings(input.boardDrawings, board) : { drawings: {}, dropped: 0 };
  const boardDrawings = Object.keys(bd.drawings).length ? bd.drawings : null;

  const snap: ControlSnapshot = {
    v: SNAPSHOT_VERSION,
    rev: Number.isFinite(input.rev) ? Math.round(input.rev as number) : 0,
    activeDevice: input.activeDevice ?? 'laptop',
    ai: ai.kept,
    ledger: { calls: calls.kept, counts },
    queue: queue.kept,
    appliances: buildAppliances(input.appliances),
    caption,
    scene,
    recipes: recipes.kept,
    ...(changes.length ? { changes } : {}),
    ...(checklist.length ? { checklist } : {}),
    ...(layout ? { layout } : {}),
    ...(board ? { board } : {}),
    ...(boardFor ? { boardFor } : {}),
    ...(boardSend ? { boardSend } : {}),
    ...(boardDrawings ? { boardDrawings } : {}),
    ...(transfer ? { transfer } : {}),
    omitted: {
      aiFeed: ai.dropped,
      ledgerCalls: calls.dropped,
      queue: queue.dropped,
      primitives: primitivesDropped,
      recipes: recipes.dropped,
    },
  };
  const before = typeof input.omittedDrawings === 'number' && Number.isFinite(input.omittedDrawings) ? Math.max(0, Math.min(8, Math.round(input.omittedDrawings))) : 0;
  let shed = bd.dropped + before;
  // The whole snapshot must fit one relay message: shed drawings, largest
  // first, until it does (the phone shows that board's starting layout).
  while (snap.boardDrawings && !snapshotFits(snap)) {
    const entries = Object.entries(snap.boardDrawings);
    const size = (d: unknown): number => utf8Bytes(JSON.stringify(d));
    const [biggest] = entries.reduce((a, b) => (size(b[1]) > size(a[1]) ? b : a));
    const rest = Object.fromEntries(entries.filter(([k]) => k !== biggest));
    if (Object.keys(rest).length) snap.boardDrawings = rest; else delete snap.boardDrawings;
    shed++;
  }
  if (shed) snap.omitted = { ...snap.omitted, drawings: shed };
  return snap;
}

/** Build the appliance block, adding the optional detail labels only when the
 *  laptop actually provided them (so the plain `{lamp,music}` shape is kept when
 *  there's nothing extra to say — and never a fabricated label). */
function buildAppliances(
  a: ControlSnapshotInput['appliances'],
): ApplianceSnapshot {
  const out: ApplianceSnapshot = {
    lamp: a?.lamp ?? 'unknown',
    music: a?.music ?? 'unknown',
  };
  const lampDetail = a?.lampDetail ? safeText(a.lampDetail, LABEL_MAX) : '';
  const musicTitle = a?.musicTitle ? safeText(a.musicTitle, LABEL_MAX) : '';
  if (lampDetail) out.lampDetail = lampDetail;
  if (musicTitle) out.musicTitle = musicTitle;
  return out;
}

/** Coerce an untrusted transfer marker, or null when malformed/absent. */
function coerceTransferMarker(
  raw: ControlSnapshotInput['transfer'],
): TransferMarker | null {
  if (!raw || typeof raw !== 'object') return null;
  const to = raw.to;
  const edge = raw.enterEdge;
  const componentId = typeof raw.componentId === 'string' ? raw.componentId : '';
  if (!componentId || componentId.length > 80) return null;
  if (to !== 'laptop' && to !== 'left' && to !== 'right') return null;
  if (edge !== 'left' && edge !== 'right') return null;
  return {
    componentId: componentId.slice(0, 80),
    to,
    enterEdge: edge,
    rev: typeof raw.rev === 'number' && Number.isFinite(raw.rev) ? Math.round(raw.rev) : 0,
  };
}

function clampPrimitive(p: ScenePrimitive): ScenePrimitive {
  if (p.t === 'seg') {
    return { t: 'seg', x1: clampFinite(p.x1), y1: clampFinite(p.y1), x2: clampFinite(p.x2), y2: clampFinite(p.y2) };
  }
  return { t: 'box', x: clampFinite(p.x), y: clampFinite(p.y), w: clampFinite(p.w), h: clampFinite(p.h) };
}

/** UTF-8 byte size of a snapshot's JSON (for the size-limit tests + the UI). */
export function snapshotBytes(snap: ControlSnapshot): number {
  const json = JSON.stringify(snap);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(json).length;
  return json.length;
}

// ---------------------------------------------------------------------------
// Defensive coercion for an untrusted snapshot arriving over the wire. The
// dashboard treats incoming data as untrusted and rebuilds it through the same
// clamping/redaction path, so a malformed or oversized message can never break
// the page or smuggle an un-redacted payload onto the screen.

const DEVICES: readonly DeviceId[] = ['laptop', 'phone', 'other'];
const APPLIANCES: readonly ApplianceState[] = ['on', 'off', 'unknown'];
const SOURCES: readonly Source[] = ['on-device', 'cloud', 'rules'];
const STATUSES: readonly JobStatus[] = ['queued', 'running', 'ready', 'error'];
const KINDS: readonly JobKind[] = ['plan', 'a11y', 'question'];

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function oneOf<T>(v: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;
}

/** Rebuild a trusted ControlSnapshot from arbitrary wire data, or null. */
export function coerceSnapshot(raw: unknown): ControlSnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== SNAPSHOT_VERSION) return null;

  const led = (r.ledger ?? {}) as Record<string, unknown>;
  const rawCalls = Array.isArray(led.calls) ? led.calls : [];
  const calls: CloudCall[] = rawCalls.slice(0, LEDGER_CALLS_MAX).map((c) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const { text } = redact(str(o.sent));
    return {
      id: num(o.id),
      job: safeText(str(o.job), 40),
      reason: safeText(str(o.reason), 48),
      sent: text,
      bytes: num(o.bytes),
      redactions: num(o.redactions),
      ms: typeof o.ms === 'number' ? o.ms : undefined,
    };
  });
  const rc = (led.counts ?? {}) as Record<string, unknown>;
  const counts: LedgerCounts = {
    cloud: num(rc.cloud), onDevice: num(rc.onDevice), rules: num(rc.rules),
    private: num(rc.private), bytesSent: num(rc.bytesSent),
  };

  const ai: AiFeedInput[] = (Array.isArray(r.ai) ? r.ai : []).map((e) => {
    const o = (e ?? {}) as Record<string, unknown>;
    return {
      source: oneOf<Source>(o.source, SOURCES, 'rules'),
      reason: oneOf<RouteReason>(o.reason, REASON_KEYS, 'fallback'),
      utterance: typeof o.utterance === 'string' ? o.utterance : undefined,
      ms: typeof o.ms === 'number' ? o.ms : undefined,
    };
  });

  const queue: QueuedJob[] = (Array.isArray(r.queue) ? r.queue : []).map((j) => {
    const o = (j ?? {}) as Record<string, unknown>;
    return {
      id: str(o.id), kind: oneOf<JobKind>(o.kind, KINDS, 'plan'), mode: str(o.mode),
      label: str(o.label), payload: {}, createdAt: 0, seq: num(o.seq),
      status: oneOf<JobStatus>(o.status, STATUSES, 'queued'),
    };
  });

  const rs = r.scene as Record<string, unknown> | null | undefined;
  const scene: SceneInput | null = rs
    ? {
        mode: str(rs.mode),
        summary: str(rs.summary),
        rev: num(rs.rev),
        primitives: (Array.isArray(rs.primitives) ? rs.primitives : []).map((p) => {
          const o = (p ?? {}) as Record<string, unknown>;
          return o.t === 'box'
            ? { t: 'box' as const, x: num(o.x), y: num(o.y), w: num(o.w), h: num(o.h) }
            : { t: 'seg' as const, x1: num(o.x1), y1: num(o.y1), x2: num(o.x2), y2: num(o.y2) };
        }),
      }
    : null;

  const rcap = r.caption as Record<string, unknown> | null | undefined;
  const caption = rcap && str(rcap.heard).trim()
    ? {
        heard: str(rcap.heard),
        translation: typeof rcap.translation === 'string' ? rcap.translation : null,
        langCode: str(rcap.langCode),
        langLabel: str(rcap.langLabel),
      }
    : null;

  const recipes: RecipeCardInput[] = (Array.isArray(r.recipes) ? r.recipes : []).map((c) => {
    const o = (c ?? {}) as Record<string, unknown>;
    return {
      id: str(o.id), name: str(o.name), device: str(o.device),
      taughtBy: str(o.taughtBy), summary: str(o.summary),
      steps: num(o.steps),
    };
  });

  const ap = (r.appliances ?? {}) as Record<string, unknown>;

  // Re-run the real builder so every cap + redaction is applied identically to
  // the publish path — the dashboard shows exactly what a well-formed laptop
  // would have sent, never raw wire data.
  return buildControlSnapshot({
    rev: num(r.rev),
    activeDevice: oneOf<DeviceId>(r.activeDevice, DEVICES, 'laptop'),
    ai,
    ledger: { calls, counts },
    queue,
    appliances: {
      lamp: oneOf<ApplianceState>(ap.lamp, APPLIANCES, 'unknown'),
      music: oneOf<ApplianceState>(ap.music, APPLIANCES, 'unknown'),
      lampDetail: str(ap.lampDetail) || undefined,
      musicTitle: str(ap.musicTitle) || undefined,
    },
    caption,
    scene,
    recipes,
    changes: (Array.isArray(r.changes) ? r.changes : []).map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return { id: str(o.id), actor: str(o.who), title: str(o.title), why: str(o.why), status: str(o.status) };
    }),
    checklist: (Array.isArray(r.checklist) ? r.checklist : []).map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return { id: str(o.id), question: str(o.question), status: str(o.status), askedOffline: o.offline === true, answer: str(o.answer) || undefined };
    }),
    // New optional fields — absent on old snapshots, so these stay undefined and
    // buildControlSnapshot omits them (backward compatible). coerceSurfacePlan /
    // coerceLayout / coerceTransferMarker re-validate the untrusted wire data.
    layout: r.layout ? coerceLayout(r.layout) : null,
    board: r.board,
    boardFor: r.boardFor,
    boardSend: r.boardSend,
    boardDrawings: r.boardDrawings,
    omittedDrawings: (r.omitted as { drawings?: unknown } | undefined)?.drawings,
    transfer: (r.transfer ?? null) as ControlSnapshotInput['transfer'],
  });
}

// ---------------------------------------------------------------------------
// A deterministic demo sequence. The fake adapter publishes these in order to
// drive the dashboard in tests and in the Play demo (no clock, no randomness,
// no network): a device switch, private + cloud AI events, a cloud ledger call,
// a queued job, a Kannada caption, and a compact 3D/plan snapshot.

/**
 * Fake adapter for the /control dashboard: publishes the deterministic demo
 * sequence through whatever `publish` it is handed (a host's publishState over
 * the in-page fake transport, or a test spy). Pure of the DOM — the only
 * ambient it uses is setTimeout — so tests drive it without a browser. Loops so
 * a judge who opens the page late still sees the whole story.
 */
export async function playControlDemo(
  publish: (snapshot: ControlSnapshot) => void | Promise<void>,
  opts: { delayMs?: number; loop?: boolean; shouldStop?: () => boolean } = {},
): Promise<void> {
  const delayMs = opts.delayMs ?? 1600;
  const snapshots = controlDemoSnapshots();
  do {
    for (const snap of snapshots) {
      if (opts.shouldStop?.()) return;
      await publish(snap);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  } while (opts.loop && !opts.shouldStop?.());
}

export function controlDemoSnapshots(): ControlSnapshot[] {
  const counts = (cloud: number): LedgerCounts => ({
    cloud, onDevice: 3, rules: 2, private: 5, bytesSent: cloud * 180,
  });
  const cloudCall: CloudCall = {
    id: 1, job: 'generate', reason: 'big job',
    sent: 'plan: studio apartment — rooms[living,kitchen,bath] + text',
    bytes: 54, redactions: 0, ms: 420,
  };
  const walls: ScenePrimitive[] = [
    { t: 'seg', x1: 0, y1: 0, x2: 420, y2: 0 },
    { t: 'seg', x1: 420, y1: 0, x2: 420, y2: 300 },
    { t: 'seg', x1: 420, y1: 300, x2: 0, y2: 300 },
    { t: 'seg', x1: 0, y1: 300, x2: 0, y2: 0 },
    { t: 'seg', x1: 240, y1: 0, x2: 240, y2: 300 },
  ];
  const ai: AiFeedInput[] = [
    { source: 'rules', reason: 'exact', utterance: 'two bedroom plan', ms: 3 },
    { source: 'on-device', reason: 'private', utterance: 'thicker by 50', ms: 38 },
    { source: 'cloud', reason: 'big-job', utterance: 'studio apartment', ms: 420 },
  ];

  const recipes: RecipeCardInput[] = [
    { id: 'rcp-bath', name: "Amma's bathroom", device: 'designer', taughtBy: 'you', summary: '7 steps · adds room, door ×2 · plan', steps: 7 },
    { id: 'rcp-cozy', name: 'Evening cozy', device: 'lamp', taughtBy: 'you', summary: 'lamp on · warm', steps: 2 },
    { id: 'rcp-bhaj', name: 'Play bhajans', device: 'music', taughtBy: 'Aunty', summary: 'play “bhajans”', steps: 1 },
    { id: 'rcp-wellt', name: 'Tell them I’m well', device: 'browser', taughtBy: 'you', summary: 'Opens mail.example.com · 1 confirm', steps: 4 },
  ];

  const base: ControlSnapshotInput = {
    activeDevice: 'laptop',
    recipes,
  };

  // Lamp + music toggle across the loop so the Play demo shows them changing
  // with no real bulb or audio: off → lamp on → lamp+music on → music only.
  return [
    buildControlSnapshot({ ...base, rev: 1, ai: ai.slice(0, 1),
      appliances: { lamp: 'off', music: 'off' },
      scene: { mode: 'plan', summary: '4 walls, 2 rooms', rev: 4, primitives: walls.slice(0, 4) } }),
    buildControlSnapshot({ ...base, rev: 2, ai: ai.slice(0, 2),
      ledger: { calls: [], counts: counts(0) },
      appliances: { lamp: 'on', music: 'off', lampDetail: 'On · 80% · 2700K' },
      scene: { mode: 'plan', summary: '5 walls, 2 rooms', rev: 6, primitives: walls } }),
    buildControlSnapshot({ ...base, rev: 3, ai,
      ledger: { calls: [cloudCall], counts: counts(1) },
      appliances: { lamp: 'on', music: 'on', lampDetail: 'On · 80% · 2700K', musicTitle: 'Clair de Lune — Debussy' },
      queue: [{ id: 'job-1', kind: 'plan', mode: 'plan', label: 'studio apartment',
        payload: { prompt: 'studio apartment' }, createdAt: 0, seq: 1, status: 'queued' }],
      scene: { mode: 'plan', summary: '5 walls, 2 rooms', rev: 6, primitives: walls } }),
    buildControlSnapshot({ ...base, rev: 4, activeDevice: 'phone', ai,
      ledger: { calls: [cloudCall], counts: counts(1) },
      appliances: { lamp: 'off', music: 'on', musicTitle: 'Clair de Lune — Debussy' },
      queue: [{ id: 'job-1', kind: 'plan', mode: 'plan', label: 'studio apartment',
        payload: { prompt: 'studio apartment' }, createdAt: 0, seq: 1, status: 'running' }],
      caption: { heard: 'ಈ ಗೋಡೆಯನ್ನು ದಪ್ಪ ಮಾಡು', translation: 'make this wall thick',
        langCode: 'kn', langLabel: 'Kannada' },
      scene: { mode: 'plan', summary: '5 walls, 2 rooms', rev: 7, primitives: walls } }),
  ];
}
