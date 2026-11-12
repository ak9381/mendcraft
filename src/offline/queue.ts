// Offline-first cloud job queue (pure core + a pluggable persistence store).
//
// Big cloud jobs — whole-plan generation, screen generation, the accessibility
// audit's cloud explanations — are the only things that NEED the network. When
// the browser is offline we drop them here instead of failing; on reconnect the
// shell drains the queue, runs each job on the cloud, and surfaces the result as
// a previewable fix (accept/reject). Normal single-op edits never touch this —
// they keep working on-device (Nano) or via the deterministic rules floor.
//
// The queue logic is pure over a QueueStore interface so it can be unit-tested
// with an in-memory store; the real app uses the IndexedDB adapter below so the
// queue survives a reload while offline. Ordering is strict FIFO: jobs carry a
// monotonic `seq` that breaks ties when two jobs are created in the same tick,
// so persistence round-trips preserve the exact run order.

export type JobKind = 'plan' | 'ui' | 'a11y';

/** queued → running (draining) → ready (cloud answered, awaiting accept/reject)
 *  or error (cloud failed; stays queued for the next reconnect). */
export type JobStatus = 'queued' | 'running' | 'ready' | 'error';

/** One flagged accessibility issue, as handed to the cloud explainer. */
export interface A11yJobIssue {
  id: string;
  rule: string;
  message: string;
  citation: string;
}

/** Everything needed to re-run a job later, kept small + JSON-serialisable so it
 *  persists cleanly in IndexedDB. plan/ui carry the prompt; a11y carries the
 *  already-measured issues + a scene summary (the numbers were computed in code
 *  offline — the cloud only adds prose). */
export interface JobPayload {
  prompt?: string;
  issues?: A11yJobIssue[];
  summary?: string;
}

export interface QueuedJob {
  id: string;
  kind: JobKind;
  /** The editor mode active when queued ('plan' | 'ui' | 'part'); a result can
   *  only be applied back into a matching mode. */
  mode: string;
  /** Human label for the queue UI (e.g. the prompt, or "Accessibility audit"). */
  label: string;
  payload: JobPayload;
  createdAt: number;
  /** Monotonic tiebreaker so same-tick jobs keep a stable FIFO order. */
  seq: number;
  status: JobStatus;
  /** Last error message when status === 'error'. */
  error?: string;
}

/** Persistence seam. Both adapters below (in-memory, IndexedDB) implement this,
 *  and so can a fake in a test. All async to match IndexedDB. */
export interface QueueStore {
  load(): Promise<QueuedJob[]>;
  put(job: QueuedJob): Promise<void>;
  remove(id: string): Promise<void>;
}

/** FIFO comparator: creation time first, then the monotonic seq. */
export function compareJobs(a: QueuedJob, b: QueuedJob): number {
  return a.createdAt - b.createdAt || a.seq - b.seq;
}

export interface JobQueueOptions {
  /** Injectable clock (tests pass a fixed/stepping clock). */
  now?: () => number;
  /** Injectable id generator; receives the assigned seq for determinism. */
  genId?: (seq: number) => string;
}

export interface NewJob {
  kind: JobKind;
  mode: string;
  label: string;
  payload: JobPayload;
}

export interface JobQueue {
  /** Load any persisted jobs into memory. Call once before use. */
  init(): Promise<void>;
  /** Current jobs in FIFO order (a fresh array; safe to render). */
  jobs(): QueuedJob[];
  /** The next still-queued (or previously-errored) job to run, or null. */
  nextRunnable(): QueuedJob | null;
  count(): number;
  enqueue(input: NewJob): Promise<QueuedJob>;
  setStatus(id: string, status: JobStatus, error?: string): Promise<QueuedJob | null>;
  remove(id: string): Promise<void>;
  /** Observe any change (enqueue/status/remove). Returns an unsubscribe fn. */
  subscribe(fn: (jobs: QueuedJob[]) => void): () => void;
}

export function createJobQueue(store: QueueStore, opts: JobQueueOptions = {}): JobQueue {
  const now = opts.now ?? Date.now;
  const genId = opts.genId ?? ((seq) => `job-${now()}-${seq}`);
  const byId = new Map<string, QueuedJob>();
  let maxSeq = 0;
  const listeners = new Set<(jobs: QueuedJob[]) => void>();

  function sorted(): QueuedJob[] {
    return [...byId.values()].sort(compareJobs);
  }
  function emit(): void {
    const snapshot = sorted();
    for (const fn of listeners) fn(snapshot);
  }

  return {
    async init() {
      const loaded = await store.load();
      for (const job of loaded) {
        byId.set(job.id, job);
        if (job.seq > maxSeq) maxSeq = job.seq;
        // A job caught mid-run by a reload is not actually running anymore:
        // reset it to queued so the next drain retries it.
        if (job.status === 'running') job.status = 'queued';
      }
      emit();
    },

    jobs: sorted,
    count: () => byId.size,

    nextRunnable() {
      return sorted().find((j) => j.status === 'queued' || j.status === 'error') ?? null;
    },

    async enqueue(input) {
      const seq = ++maxSeq;
      const job: QueuedJob = {
        id: genId(seq),
        kind: input.kind,
        mode: input.mode,
        label: input.label,
        payload: input.payload,
        createdAt: now(),
        seq,
        status: 'queued',
      };
      byId.set(job.id, job);
      await store.put(job);
      emit();
      return job;
    },

    async setStatus(id, status, error) {
      const job = byId.get(id);
      if (!job) return null;
      job.status = status;
      if (status === 'error') job.error = error;
      else delete job.error;
      await store.put(job);
      emit();
      return job;
    },

    async remove(id) {
      if (!byId.delete(id)) return;
      await store.remove(id);
      emit();
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// ---------------------------------------------------------------------------
// Adapters.

/** In-memory store — the test seam, and the fallback when IndexedDB is blocked
 *  (private mode / storage disabled). The queue still works for the session; it
 *  just won't survive a reload. */
export function createMemoryStore(initial: QueuedJob[] = []): QueueStore {
  const map = new Map<string, QueuedJob>(initial.map((j) => [j.id, clone(j)]));
  return {
    async load() {
      return [...map.values()].map(clone);
    },
    async put(job) {
      map.set(job.id, clone(job));
    },
    async remove(id) {
      map.delete(id);
    },
  };
}

function clone(job: QueuedJob): QueuedJob {
  return JSON.parse(JSON.stringify(job)) as QueuedJob;
}

const DB_NAME = 'mendcraft-jobs';
const STORE_NAME = 'jobs';

/** IndexedDB-backed store (raw API, no extra deps) so the queue persists across
 *  reloads while offline. Falls back to an in-memory store if IndexedDB is
 *  unavailable, so callers never have to special-case it. */
export function createIndexedDbStore(dbName = DB_NAME): QueueStore {
  const idb: IDBFactory | undefined =
    typeof indexedDB !== 'undefined' ? indexedDB : undefined;
  if (!idb) return createMemoryStore();

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
        const all = await tx<QueuedJob[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedJob[]>);
        return all ?? [];
      } catch {
        return [];
      }
    },
    async put(job) {
      await tx('readwrite', (s) => s.put(job));
    },
    async remove(id) {
      await tx('readwrite', (s) => s.delete(id));
    },
  };
}
