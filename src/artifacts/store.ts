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

/** IndexedDB when it opens and answers; else memory (`persistent: false`). */
export async function openArtifactStore(): Promise<{ store: ArtifactStore; persistent: boolean }> {
  try {
    const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!idb) throw new Error('no IndexedDB');
    const store = createIdbArtifactStore(idb);
    await store.list();
    return { store, persistent: true };
  } catch {
    return { store: createMemoryArtifactStore(), persistent: false };
  }
}

const rowId = (row: unknown): string => {
  const id = (row as { id?: unknown } | null)?.id;
  return typeof id === 'string' && id ? id.slice(0, 64) : '(no id)';
};

/** Every stored row through `coerceArtifact`, newest first, at most
 *  ARTIFACT_MAX_COUNT. A row that fails is dropped (with why); the rest load. */
export async function loadArtifacts(store: ArtifactStore): Promise<{ ok: Artifact[]; dropped: { id: string; why: string }[] }> {
  let rows: unknown[];
  try { rows = await store.list(); } catch { rows = []; }
  const ok: Artifact[] = [];
  const dropped: { id: string; why: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const r = coerceArtifact(row);
    if (!r.ok) { dropped.push({ id: rowId(row), why: r.error }); continue; }
    if (seen.has(r.value.id)) continue;
    seen.add(r.value.id);
    ok.push(r.value);
  }
  ok.sort((a, b) => b.at - a.at);
  for (const a of ok.splice(ARTIFACT_MAX_COUNT)) dropped.push({ id: a.id, why: `more than ${ARTIFACT_MAX_COUNT} stored items` });
  return { ok, dropped };
}
