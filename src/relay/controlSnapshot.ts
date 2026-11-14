// CONTROL-ROOM SNAPSHOT — the small, privacy-safe state the laptop publishes to
// the paired iPad /control dashboard. It is PURE (no DOM, no Firebase, no
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

/** One shared-recipe card for the iPad dashboard: what it does, which device
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

/** What the caps dropped — surfaced so the dashboard never hides truncation. */
export interface SnapshotOmissions {
  aiFeed: number;
  ledgerCalls: number;
  queue: number;
  primitives: number;
  recipes: number;
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

  return {
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
    omitted: {
      aiFeed: ai.dropped,
      ledgerCalls: calls.dropped,
      queue: queue.dropped,
      primitives: primitivesDropped,
      recipes: recipes.dropped,
    },
  };
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
const KINDS: readonly JobKind[] = ['plan', 'ui', 'a11y'];

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
