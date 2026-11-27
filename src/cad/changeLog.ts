import { sanitizeRoute, type RouteInfo } from './routeReason';

// Reviewed-change log. EVERY change to the drawing — hers, Nano's, Gemini's or
// the rules' — lands here with who, what (before → after), when and why.
// AI changes arrive as PENDING proposals: nothing touches the plan until she
// accepts (pinch, click or "accept"). Her own edits are recorded as applied.
// Any applied entry can be reverted. Persisted locally; the metadata (never the
// document snapshots) syncs to Firestore and shows on the iPad /control page.

export type Actor = 'her' | 'nano' | 'gemini' | 'rules';
export type ChangeStatus = 'pending' | 'applied' | 'rejected' | 'reverted';

export interface ChangeEntry {
  id: string;
  actor: Actor;
  /** Typed tool that produced it, e.g. "add_stair", "fix_guideline", "edit". */
  tool: string;
  /** Short human title: "Add a stair (17 steps)". */
  title: string;
  /** Why: her words, or the AI's stated reason. */
  why: string;
  /** The op envelope (re-validated by the controller on apply). */
  op: Record<string, unknown> | null;
  /** One-line scene summaries before / after (after is filled on apply). */
  before: string;
  after?: string;
  at: number;
  decidedAt?: number;
  status: ChangeStatus;
  /** Where the proposing model ran. */
  source: 'on-device' | 'cloud' | 'rules';
  /** Speculative Copilot: a reviewable Nano guess, later confirmed or corrected. */
  tag?: 'nano-guess' | 'confirmed' | 'corrected' | 'withdrawn';
  /** Factual copilot routing line (rules / Nano / Gemini / offline / speculative). */
  route?: RouteInfo;
}

/** Local-only revert data: the full document just before an entry applied. */
interface Snapshot { id: string; doc: unknown }

export interface ChangeLogState {
  entries: ChangeEntry[];
  snapshots: Snapshot[];
}

export const CHANGELOG_KEY = 'mendcraft.changelog';
export const MAX_ENTRIES = 80;
const MAX_SNAPSHOTS = 30;

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

export const ACTOR_LABEL: Record<Actor, string> = {
  her: 'You', nano: 'Nano (on this device)', gemini: 'Gemini (cloud)', rules: 'Rules (on this device)',
};

const ACTORS: readonly Actor[] = ['her', 'nano', 'gemini', 'rules'];
const STATUSES: readonly ChangeStatus[] = ['pending', 'applied', 'rejected', 'reverted'];

/** Untrusted (storage / Firestore) → clean entry, or null. */
export function sanitizeEntry(raw: unknown): ChangeEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
  if (typeof o.id !== 'string' || !o.id) return null;
  const actor = ACTORS.includes(o.actor as Actor) ? (o.actor as Actor) : null;
  const status = STATUSES.includes(o.status as ChangeStatus) ? (o.status as ChangeStatus) : null;
  if (!actor || !status || typeof o.at !== 'number') return null;
  const source = o.source === 'on-device' || o.source === 'cloud' ? o.source : 'rules';
  const route = sanitizeRoute(o.route);
  return {
    id: o.id.slice(0, 40), actor, status, at: o.at, source,
    tool: str(o.tool, 40) || 'edit',
    title: str(o.title, 160) || 'Change',
    why: str(o.why),
    op: o.op && typeof o.op === 'object' && !Array.isArray(o.op) ? (o.op as Record<string, unknown>) : null,
    before: str(o.before, 300),
    ...(typeof o.after === 'string' ? { after: o.after.slice(0, 300) } : {}),
    ...(typeof o.decidedAt === 'number' ? { decidedAt: o.decidedAt } : {}),
    ...((o.tag === 'nano-guess' || o.tag === 'confirmed' || o.tag === 'corrected' || o.tag === 'withdrawn') ? { tag: o.tag } : {}),
    ...(route ? { route } : {}),
  };
}

/** Newest-wins merge by id (decidedAt ?? at), capped. */
export function mergeEntries(a: readonly ChangeEntry[], b: readonly ChangeEntry[]): ChangeEntry[] {
  const byId = new Map<string, ChangeEntry>();
  for (const e of [...a, ...b]) {
    const cur = byId.get(e.id);
    const t = (x: ChangeEntry) => x.decidedAt ?? x.at;
    if (!cur || t(e) > t(cur)) byId.set(e.id, e);
  }
  return [...byId.values()].sort((x, y) => x.at - y.at).slice(-MAX_ENTRIES);
}

/** What the app must do to the plan for a log action. */
export type ApplyFn = (op: Record<string, unknown>) => { ok: boolean; error?: string };

export interface ChangeLog {
  entries(): ChangeEntry[];
  pending(): ChangeEntry[];
  get(id: string): ChangeEntry | undefined;
  /** AI (or rules) proposal → pending. Returns the entry. */
  propose(p: { actor: Actor; tool: string; title: string; why: string; op: Record<string, unknown>; before: string; source: ChangeEntry['source']; tag?: ChangeEntry['tag']; route?: RouteInfo }): ChangeEntry;
  /** Record a change that already happened (her own edit). */
  recordApplied(p: { actor: Actor; tool: string; title: string; why: string; op: Record<string, unknown> | null; before: string; after: string; source: ChangeEntry['source']; beforeDoc?: unknown }): ChangeEntry;
  /** Accept a pending entry: snapshot → apply → mark applied. */
  accept(id: string, deps: { snapshot(): unknown; apply: ApplyFn; summary(): string }): { ok: boolean; error?: string };
  reject(id: string): boolean;
  /** Update an applied entry in place (a drag folded into one entry). */
  amend(id: string, patch: Partial<Pick<ChangeEntry, 'after' | 'decidedAt' | 'title' | 'why' | 'tag' | 'route'>>): boolean;
  /** Entries a revert of `id` would also roll back (applied after it). */
  revertImpact(id: string): ChangeEntry[];
  /** Restore the document from before `id`; later applied entries are marked
   *  reverted too (honest roll-back, never a silent partial undo). */
  revert(id: string, deps: { restore(doc: unknown): { ok: boolean; error?: string }; summary(): string }): { ok: boolean; error?: string; count?: number };
  /** Adopt merged entries from sync. */
  replaceEntries(entries: ChangeEntry[]): void;
  subscribe(fn: () => void): () => void;
  /** Write any batched changes to storage now. */
  flush(): void;
}

export function createChangeLog(storage: KV | null, now: () => number = Date.now): ChangeLog {
  let state: ChangeLogState = load();
  const subs = new Set<() => void>();
  let counter = 0;

  function load(): ChangeLogState {
    try {
      const raw = storage?.getItem(CHANGELOG_KEY);
      if (!raw) return { entries: [], snapshots: [] };
      const parsed = JSON.parse(raw) as { entries?: unknown[]; snapshots?: Snapshot[] };
      return {
        entries: (parsed.entries ?? []).map(sanitizeEntry).filter((e): e is ChangeEntry => !!e).slice(-MAX_ENTRIES),
        snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots.filter((s) => s && typeof s.id === 'string').slice(-MAX_SNAPSHOTS) : [],
      };
    } catch {
      return { entries: [], snapshots: [] };
    }
  }
  let writeTimer: ReturnType<typeof setTimeout> | null = null;
  function write(): void {
    writeTimer = null;
    try { storage?.setItem(CHANGELOG_KEY, JSON.stringify(state)); } catch { /* quota — keep in memory */ }
  }
  function save(): void {
    // Storage writes are batched (a drag can amend many times a second).
    if (!writeTimer) writeTimer = setTimeout(write, 250);
    for (const fn of subs) fn();
  }
  function newId(): string {
    counter += 1;
    return `c${now().toString(36)}${counter.toString(36)}`;
  }
  function put(e: ChangeEntry): void {
    const i = state.entries.findIndex((x) => x.id === e.id);
    if (i >= 0) state.entries = state.entries.map((x, j) => (j === i ? e : x));
    else state.entries = [...state.entries, e].slice(-MAX_ENTRIES);
  }
  function snap(id: string, doc: unknown): void {
    if (doc === undefined) return;
    state.snapshots = [...state.snapshots.filter((s) => s.id !== id), { id, doc: JSON.parse(JSON.stringify(doc)) }].slice(-MAX_SNAPSHOTS);
  }

  const log: ChangeLog = {
    entries: () => state.entries.slice(),
    pending: () => state.entries.filter((e) => e.status === 'pending'),
    get: (id) => state.entries.find((e) => e.id === id),
    propose(p) {
      const e: ChangeEntry = { id: newId(), at: now(), status: 'pending', ...p };
      put(e);
      save();
      return e;
    },
    recordApplied(p) {
      const { beforeDoc, ...rest } = p;
      const e: ChangeEntry = { id: newId(), at: now(), decidedAt: now(), status: 'applied', ...rest };
      put(e);
      snap(e.id, beforeDoc);
      save();
      return e;
    },
    accept(id, deps) {
      const e = log.get(id);
      if (!e || e.status !== 'pending') return { ok: false, error: 'That change is no longer waiting.' };
      if (!e.op) return { ok: false, error: 'Nothing to apply.' };
      const before = deps.snapshot();
      const res = deps.apply(e.op);
      if (!res.ok) return res;
      snap(id, before);
      put({ ...e, status: 'applied', decidedAt: now(), after: deps.summary().slice(0, 300) });
      save();
      return { ok: true };
    },
    reject(id) {
      const e = log.get(id);
      if (!e || e.status !== 'pending') return false;
      put({ ...e, status: 'rejected', decidedAt: now() });
      save();
      return true;
    },
    amend(id, patch) {
      const e = log.get(id);
      if (!e) return false;
      put({ ...e, ...patch });
      save();
      return true;
    },
    revertImpact(id) {
      // Entries are kept in creation order; everything applied after it.
      const idx = state.entries.findIndex((x) => x.id === id);
      if (idx < 0) return [];
      return state.entries.slice(idx + 1).filter((x) => x.status === 'applied');
    },
    revert(id, deps) {
      const e = log.get(id);
      if (!e || e.status !== 'applied') return { ok: false, error: 'Only applied changes can be reverted.' };
      const s = state.snapshots.find((x) => x.id === id);
      if (!s) return { ok: false, error: 'This change is too old to revert from here. Use undo instead.' };
      const res = deps.restore(s.doc);
      if (!res.ok) return res;
      const later = log.revertImpact(id);
      const t = now();
      for (const x of [e, ...later]) put({ ...x, status: 'reverted', decidedAt: t, after: deps.summary().slice(0, 300) });
      save();
      return { ok: true, count: later.length + 1 };
    },
    replaceEntries(entries) {
      state.entries = entries.slice(-MAX_ENTRIES);
      save();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    flush() {
      if (writeTimer) { clearTimeout(writeTimer); write(); }
    },
  };
  return log;
}

/** "2 min ago" style label (en). */
export function agoLabel(at: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(at).toLocaleDateString();
}

/** A short, human before/after line for the change log, e.g.
 *  "8 walls · 4 rooms · 3 doors · 2 windows · 1 stair". Works on a plan doc
 *  snapshot; anything else gives an empty string. */
export function planDigest(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';
  const d = doc as Record<string, unknown>;
  const list = (k: string): Record<string, unknown>[] => (Array.isArray(d[k]) ? (d[k] as Record<string, unknown>[]) : []);
  const n = (count: number, one: string, many = `${one}s`) => (count ? `${count} ${count === 1 ? one : many}` : '');
  const openings = list('openings');
  const fixtures = list('fixtures');
  const stairs = fixtures.filter((f) => f.kind === 'stairs').length;
  const parts = [
    n(list('walls').length, 'wall'),
    n(list('rooms').length, 'room'),
    n(openings.filter((o) => o.kind === 'door').length, 'door'),
    n(openings.filter((o) => o.kind === 'window').length, 'window'),
    n(stairs, 'stair'),
    n(fixtures.length - stairs, 'item'),
    n(list('dims').length, 'dimension'),
    n(list('texts').length, 'note'),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'empty plan';
}
