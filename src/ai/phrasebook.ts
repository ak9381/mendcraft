// PERSONAL PHRASEBOOK — the user's own phrasings and corrections, kept on-device
// and fed to Gemini Nano as FEW-SHOT examples so the on-device model learns how
// THIS person talks ("the big room" => the living room; "pop a door here" =>
// add_door). Two ways things land here:
//   1. a deliberate teach — "when I say X, do Y";
//   2. a correction — after a wrong parse the user says what they meant, and we
//      store (what they originally said → the op they actually wanted).
//
// PRIVACY: the phrasebook is the user's private speech. It lives in IndexedDB on
// the device and is attached ONLY to on-device Nano prompts. It never rides a
// cloud request UNLESS the router already escalated that one command to the
// cloud (low confidence) — and even then only the few examples relevant to that
// command, selected by selectExamples(). The caller (main.ts) enforces that gate;
// this module just stores, selects, and renders.
//
// Like the offline queue, the logic is PURE over a small PhrasebookStore seam so
// it unit-tests with an in-memory store; the real app uses the IndexedDB adapter
// so a taught phrase survives a reload. No network, no Firebase, no DOM here.

/** How an entry was captured. */
export type PhraseKind = 'phrase' | 'correction';

/** One learned mapping: a phrase the user says → the validated result it means. */
export interface PhrasebookEntry {
  id: string;
  /** What the user says (the trigger), stored verbatim for display. */
  phrase: string;
  /** The mode-validated result this phrase maps to (an op envelope / template),
   *  as produced by the active mode. Kept as plain JSON so it persists cleanly. */
  op: Record<string, unknown>;
  /** The editor mode this was taught in ('plan' | 'ui' | 'part'); an example is
   *  only shown to a matching mode's model (a plan op makes no sense in ui). */
  mode: string;
  kind: PhraseKind;
  createdAt: number;
  /** Monotonic tiebreaker so newest-wins ordering is stable across a reload. */
  seq: number;
}

/** Persistence seam — in-memory (tests / fallback) and IndexedDB both implement
 *  it. All async to match IndexedDB. Mirrors the offline queue's QueueStore. */
export interface PhrasebookStore {
  load(): Promise<PhrasebookEntry[]>;
  put(entry: PhrasebookEntry): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface PhrasebookOptions {
  now?: () => number;
  genId?: (seq: number) => string;
}

export interface NewPhrase {
  phrase: string;
  op: Record<string, unknown>;
  mode: string;
  kind: PhraseKind;
}

// ---------------------------------------------------------------------------
// Pure text helpers (exported for direct testing).

/** Normalise a phrase for de-duplication and token matching: lowercase, strip
 *  surrounding punctuation per word, collapse whitespace. */
export function normalizePhrase(raw: string): string {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .filter(Boolean)
    .join(' ');
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'it', 'this', 'that', 'is', 'of', 'and', 'my', 'me',
  'i', 'please', 'make', 'do', 'set', 'put',
]);

/** Content tokens of a phrase, stopwords dropped so "the big room" and "big
 *  room" still overlap. Falls back to all tokens if everything is a stopword. */
export function phraseTokens(raw: string): string[] {
  const all = normalizePhrase(raw).split(' ').filter(Boolean);
  const content = all.filter((w) => !STOPWORDS.has(w));
  return content.length ? content : all;
}

/** Overlap score of a stored entry against the utterance tokens: how many of the
 *  entry's content tokens appear in what the user just said, normalised by the
 *  entry length so a short exact phrase isn't buried by a long rambling one. An
 *  exact normalised match scores 1 (and is nudged above any partial overlap). */
export function scoreEntry(entry: PhrasebookEntry, utteranceTokens: readonly string[]): number {
  const tokens = phraseTokens(entry.phrase);
  if (!tokens.length) return 0;
  const set = new Set(utteranceTokens);
  let hit = 0;
  for (const t of tokens) if (set.has(t)) hit += 1;
  if (!hit) return 0;
  const base = hit / tokens.length;
  // Exact phrase match (all entry tokens present AND the user said no more of its
  // own content than the phrase) is the strongest signal.
  if (hit === tokens.length) return Math.min(1, base) + 0.001;
  return base;
}

/** Caps so the few-shot block always fits Nano's small context window. */
export const MAX_FEWSHOT = 4;
export const MAX_OP_CHARS = 160;

/**
 * Pick the few most relevant entries for an utterance: positive overlap only,
 * best score first, newest (higher seq) breaking ties, capped at `limit`. Entries
 * from a different mode are skipped. Returns [] when nothing is relevant, so a
 * cloud escalation sends no phrasebook at all unless a mapping actually applies.
 */
export function selectExamples(
  entries: readonly PhrasebookEntry[],
  utterance: string,
  mode: string,
  limit = MAX_FEWSHOT,
): PhrasebookEntry[] {
  const tokens = phraseTokens(utterance);
  if (!tokens.length) return [];
  return entries
    .filter((e) => e.mode === mode)
    .map((e) => ({ e, score: scoreEntry(e, tokens) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.e.seq - a.e.seq)
    .slice(0, limit)
    .map((s) => s.e);
}

/** Compact JSON for one example's op, truncated so one odd entry can't blow the
 *  window. Truncation is marked so it's never mistaken for valid JSON. */
function opPreview(op: Record<string, unknown>): string {
  const json = JSON.stringify(op);
  return json.length > MAX_OP_CHARS ? `${json.slice(0, MAX_OP_CHARS)}… (truncated)` : json;
}

/**
 * Render selected entries into a few-shot block to prepend to the on-device
 * fusion prompt. Returns '' for an empty list so the prompt is unchanged when the
 * user has taught nothing (or nothing relevant). PURE — the caller decides
 * whether this block may be attached to a given model call (privacy gate).
 */
export function buildFewShotPrefix(entries: readonly PhrasebookEntry[]): string {
  if (!entries.length) return '';
  const lines = entries.map((e) => `- "${e.phrase.replace(/"/g, "'")}" => ${opPreview(e.op)}`);
  return `This user has taught you how THEY phrase commands. When the transcript matches one of these, map it the same way (these win over a literal reading when the wording is close):\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Teach / correction parsing (pure, exported for testing). English only — the
// non-English path translates in the cloud and never reaches these.

/** A deliberate teach: "when I say X, do Y" / "teach X means Y". */
export interface TeachCommand {
  phrase: string;
  target: string;
}

const TEACH_RES: RegExp[] = [
  /^\s*when i say\s+(.+?)\s*[,:]?\s+(?:do|it means|that means|i mean|say)\s+(.+?)\s*$/i,
  /^\s*teach\s*[:,]?\s+(.+?)\s+(?:means|=|->|:)\s+(.+?)\s*$/i,
  /^\s*remember(?: that)?\s+(.+?)\s+means\s+(.+?)\s*$/i,
];

export function parseTeachCommand(utterance: string): TeachCommand | null {
  for (const re of TEACH_RES) {
    const m = re.exec(utterance);
    if (m) {
      const phrase = stripQuotes(m[1]);
      const target = stripQuotes(m[2]);
      if (phrase && target) return { phrase, target };
    }
  }
  return null;
}

/** A correction of the PREVIOUS command: "no, I meant Y" / "actually Y". The
 *  phrase is the prior utterance (supplied by the caller), the target is Y. */
export interface CorrectionCommand {
  target: string;
}

// Every pattern requires an explicit "I meant" / "should have been" correction
// marker. A BARE lead-in like "actually …" is deliberately NOT a correction:
// "actually" is a common speech filler people use to start ordinary commands
// ("actually move the wall left"), so matching it alone would hijack normal
// routing. It only counts when followed by "I meant".
const CORRECTION_RES: RegExp[] = [
  /^\s*no[,.]?\s+(?:actually[,]?\s+)?i (?:meant|mean)\s+(.+?)\s*$/i,
  /^\s*actually[,]?\s+i (?:meant|mean)\s+(.+?)\s*$/i,
  /^\s*i (?:meant|mean)\s+(.+?)\s*$/i,
  /^\s*that should (?:be|have been)\s+(.+?)\s*$/i,
];

export function parseCorrectionCommand(utterance: string): CorrectionCommand | null {
  for (const re of CORRECTION_RES) {
    const m = re.exec(utterance);
    if (m) {
      const target = stripQuotes(m[1]);
      if (target) return { target };
    }
  }
  return null;
}

function stripQuotes(s: string): string {
  return s.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
}

// ---------------------------------------------------------------------------
// The stateful phrasebook (pure over the store seam).

export interface Phrasebook {
  init(): Promise<void>;
  entries(): PhrasebookEntry[];
  count(): number;
  /** Add (or, for a duplicate phrase in the same mode, replace) a mapping. */
  add(input: NewPhrase): Promise<PhrasebookEntry>;
  /** Edit an existing entry's phrase/op. Returns the updated entry or null. */
  update(id: string, patch: Partial<Pick<PhrasebookEntry, 'phrase' | 'op'>>): Promise<PhrasebookEntry | null>;
  remove(id: string): Promise<void>;
  /** The few relevant entries for an utterance in the given mode. */
  select(utterance: string, mode: string, limit?: number): PhrasebookEntry[];
  /** Ready-to-prepend few-shot block for an utterance ('' when none apply). */
  fewShotFor(utterance: string, mode: string, limit?: number): string;
  subscribe(fn: (entries: PhrasebookEntry[]) => void): () => void;
}

export function createPhrasebook(store: PhrasebookStore, opts: PhrasebookOptions = {}): Phrasebook {
  const now = opts.now ?? Date.now;
  const genId = opts.genId ?? ((seq) => `phrase-${now()}-${seq}`);
  const byId = new Map<string, PhrasebookEntry>();
  let maxSeq = 0;
  const listeners = new Set<(entries: PhrasebookEntry[]) => void>();

  // Newest first — a later correction should outrank an older teaching of the
  // same phrasing both in display and in selection ties.
  function sorted(): PhrasebookEntry[] {
    return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt || b.seq - a.seq);
  }
  function emit(): void {
    const snap = sorted();
    for (const fn of listeners) fn(snap);
  }
  function findDuplicate(phrase: string, mode: string): PhrasebookEntry | null {
    const key = normalizePhrase(phrase);
    for (const e of byId.values()) {
      if (e.mode === mode && normalizePhrase(e.phrase) === key) return e;
    }
    return null;
  }

  return {
    async init() {
      const loaded = await store.load();
      for (const e of loaded) {
        byId.set(e.id, e);
        if (e.seq > maxSeq) maxSeq = e.seq;
      }
      emit();
    },

    entries: sorted,
    count: () => byId.size,

    async add(input) {
      // Teaching the same phrase again overwrites the old mapping in place (keeps
      // its id/seq) rather than piling up contradictory examples.
      const dup = findDuplicate(input.phrase, input.mode);
      if (dup) {
        dup.phrase = input.phrase;
        dup.op = input.op;
        dup.kind = input.kind;
        dup.createdAt = now();
        await store.put(dup);
        emit();
        return dup;
      }
      const seq = ++maxSeq;
      const entry: PhrasebookEntry = {
        id: genId(seq),
        phrase: input.phrase,
        op: input.op,
        mode: input.mode,
        kind: input.kind,
        createdAt: now(),
        seq,
      };
      byId.set(entry.id, entry);
      await store.put(entry);
      emit();
      return entry;
    },

    async update(id, patch) {
      const entry = byId.get(id);
      if (!entry) return null;
      if (patch.phrase !== undefined) entry.phrase = patch.phrase;
      if (patch.op !== undefined) entry.op = patch.op;
      await store.put(entry);
      emit();
      return entry;
    },

    async remove(id) {
      if (!byId.delete(id)) return;
      await store.remove(id);
      emit();
    },

    select(utterance, mode, limit) {
      return selectExamples(sorted(), utterance, mode, limit);
    },

    fewShotFor(utterance, mode, limit) {
      return buildFewShotPrefix(selectExamples(sorted(), utterance, mode, limit));
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// ---------------------------------------------------------------------------
// Adapters (mirror the offline queue's stores).

/** In-memory store — the test seam and the fallback when IndexedDB is blocked. */
export function createMemoryPhrasebookStore(initial: PhrasebookEntry[] = []): PhrasebookStore {
  const map = new Map<string, PhrasebookEntry>(initial.map((e) => [e.id, clone(e)]));
  return {
    async load() {
      return [...map.values()].map(clone);
    },
    async put(entry) {
      map.set(entry.id, clone(entry));
    },
    async remove(id) {
      map.delete(id);
    },
  };
}

function clone(entry: PhrasebookEntry): PhrasebookEntry {
  return JSON.parse(JSON.stringify(entry)) as PhrasebookEntry;
}

const DB_NAME = 'mendcraft-phrasebook';
const STORE_NAME = 'phrases';

/** IndexedDB-backed store so taught phrases survive a reload. Raw API, no deps;
 *  falls back to in-memory when IndexedDB is unavailable so callers never special
 *  case it. Same shape as the offline queue's adapter. */
export function createIndexedDbPhrasebookStore(dbName = DB_NAME): PhrasebookStore {
  const idb: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined;
  if (!idb) return createMemoryPhrasebookStore();

  let dbPromise: Promise<IDBDatabase> | null = null;
  function open(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = idb!.open(dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) {
          req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return open().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const t = db.transaction(STORE_NAME, mode);
          const req = run(t.objectStore(STORE_NAME));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        }),
    );
  }

  return {
    async load() {
      try {
        const all = await tx<PhrasebookEntry[]>('readonly', (s) => s.getAll() as IDBRequest<PhrasebookEntry[]>);
        return all ?? [];
      } catch {
        return [];
      }
    },
    async put(entry) {
      await tx('readwrite', (s) => s.put(entry));
    },
    async remove(id) {
      await tx('readwrite', (s) => s.delete(id));
    },
  };
}
