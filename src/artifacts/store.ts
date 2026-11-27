// The artifact store: approved artifacts kept on this device, apart from the
// code. IndexedDB when the browser has it; otherwise a memory store that
// lasts until the tab closes (and the canvas says so once). The store keeps
// rows as they are — `loadArtifacts` is the only reader the canvas uses, and
// it checks every row again (storage can be edited).
import { ARTIFACT_MAX_COUNT, coerceArtifact, type Artifact } from './artifact';

export interface ArtifactStore {
  /** Every stored artifact, unvalidated. */
  list(): Promise<Artifact[]>;
  /** Replaces the same id. */
  put(a: Artifact): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export const ARTIFACT_DB_NAME = 'mendcraft-artifacts';
const STORE = 'artifacts';
export const STORE_FALLBACK_LINE = "This browser can't keep boards. They last until you close the tab.";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function createMemoryArtifactStore(initial: Artifact[] = []): ArtifactStore {
  const rows = new Map<string, Artifact>();
  for (const a of initial) rows.set(String((a as { id?: unknown }).id), clone(a));
  return {
    async list() { return [...rows.values()].map(clone); },
    async put(a) { rows.set(a.id, clone(a)); },
    async remove(id) { rows.delete(id); },
    async clear() { rows.clear(); },
  };
}

export function createIdbArtifactStore(
  idb: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined,
): ArtifactStore {
  let opened: Promise<IDBDatabase> | null = null;
  function open(): Promise<IDBDatabase> {
    if (!idb) return Promise.reject(new Error('no IndexedDB'));
    if (!opened) {
      opened = new Promise<IDBDatabase>((resolve, reject) => {
        const req = idb.open(ARTIFACT_DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('kind', 'kind');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
        req.onblocked = () => reject(new Error('IndexedDB open blocked'));
      });
      // A failed open may succeed later (another tab closed): try again next call.
      opened.catch(() => { opened = null; });
    }
    return opened;
  }
  async function tx<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest | null, result?: (r: IDBRequest | null) => T): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = work(t.objectStore(STORE));
      t.oncomplete = () => resolve(result ? result(req) : (undefined as T));
      t.onerror = () => reject(t.error ?? new Error('IndexedDB write failed'));
      t.onabort = () => reject(t.error ?? new Error('IndexedDB write aborted'));
    });
  }
  return {
    list: () => tx('readonly', (s) => s.getAll(), (r) => ((r?.result as Artifact[] | undefined) ?? [])),
    put: (a) => tx('readwrite', (s) => s.put(clone(a))),
    remove: (id) => tx('readwrite', (s) => s.delete(id)),
    clear: () => tx('readwrite', (s) => s.clear()),
  };
}

/** How long boot waits for IndexedDB to open and answer its first read. Some
 *  iOS webviews never answer `indexedDB.open`: the canvas then opens on the
 *  memory store and says so, instead of never mounting (final review I13). */
export const STORE_OPEN_TIMEOUT_MS = 3000;
const TICK_MS = 250;
/** `p`, or a rejection once `ms` of running time has passed with no answer.
 *  Time the page was frozen (a busy or suspended host: a tick that comes far
 *  too late) is not counted — IndexedDB could not answer then either, and a
 *  slow open must not cost her stored boards. */
export function withinRunningTime<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let waited = 0;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      waited += Math.min(now - last, TICK_MS);
      last = now;
      if (waited >= ms) { clearInterval(timer); reject(new Error('IndexedDB did not answer')); }
    }, TICK_MS);
    p.then((v) => { clearInterval(timer); resolve(v); }, (e: unknown) => { clearInterval(timer); reject(e); });
  });
}

/** IndexedDB when it opens and answers in time; else memory (`persistent: false`). */
export async function openArtifactStore(): Promise<{ store: ArtifactStore; persistent: boolean }> {
  try {
    const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!idb) throw new Error('no IndexedDB');
    const store = createIdbArtifactStore(idb);
    await withinRunningTime(store.list(), STORE_OPEN_TIMEOUT_MS);
    return { store, persistent: true };
  } catch {
    return { store: createMemoryArtifactStore(), persistent: false };
  }
}

const rowId = (row: unknown): string => {
  const id = (row as { id?: unknown } | null)?.id;
  return typeof id === 'string' && id ? id.slice(0, 64) : '(no id)';
};

export const STORE_READ_FAILED_LINE = "Stored boards couldn't be read. This session starts empty; nothing stored was changed.";
export const overCapLine = (n: number): string => `${n} older stored item${n === 1 ? ' was' : 's were'} not loaded (the limit is ${ARTIFACT_MAX_COUNT}).`;

export interface LoadedArtifacts {
  /** Checked, newest first, at most ARTIFACT_MAX_COUNT. */
  ok: Artifact[];
  /** Rows that failed their check (with why). */
  dropped: { id: string; why: string }[];
  /** Well-formed rows past ARTIFACT_MAX_COUNT: kept in the store, not loaded. */
  overCap: string[];
  /** What the checks left out of rows that still loaded (a bad control), with its row id. */
  notes: { id: string; note: string }[];
  /** The store could not be read at all (nothing was loaded). */
  readFailed?: boolean;
}

/** Every stored row through `coerceArtifact`, newest first, at most
 *  ARTIFACT_MAX_COUNT. A row that fails is dropped (with why); the rest load. */
export async function loadArtifacts(store: ArtifactStore): Promise<LoadedArtifacts> {
  let rows: unknown[];
  try { rows = await store.list(); } catch { return { ok: [], dropped: [], overCap: [], notes: [], readFailed: true }; }
  const ok: Artifact[] = [];
  const dropped: { id: string; why: string }[] = [];
  const notes: { id: string; note: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const r = coerceArtifact(row);
    if (!r.ok) { dropped.push({ id: rowId(row), why: r.error }); continue; }
    if (seen.has(r.value.id)) continue;
    seen.add(r.value.id);
    ok.push(r.value);
    for (const note of r.notes ?? []) notes.push({ id: r.value.id, note });
  }
  ok.sort((a, b) => b.at - a.at);
  const overCap = ok.splice(ARTIFACT_MAX_COUNT).map((a) => a.id);
  return { ok, dropped, overCap, notes };
}
