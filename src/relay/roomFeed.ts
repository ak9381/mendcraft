// A room's message feed that survives a silent listener. The live listener
// (Firestore onSnapshot) can stop delivering without ever reporting an error:
// the laptop then looks paired ("✓ Nothing phone", the phone says "Laptop ✓")
// but hears nothing more — no phone AI activity on the monitor, no commands.
// So the listener is backed by a slow catch-up read: every few seconds the
// room is read from the server from the last message seen, anything the
// listener missed is delivered (once — messages are de-duplicated by id), and
// a listener that keeps missing messages, or a read that hangs, restarts the
// connection. Pure over injected I/O so it is unit-tested with fakes.

export interface RoomDoc {
  id: string;
  /** Server time in ms; null while the write is still pending locally. */
  at: number | null;
  data: unknown;
}

export interface RoomFeedDeps {
  /** Start the live listener; returns its unsubscribe. */
  listen(onDocs: (docs: RoomDoc[]) => void, onError: () => void): () => void;
  /** Read the room from the server, oldest first, from `at` (inclusive; null = all). */
  fetchSince(at: number | null): Promise<RoomDoc[]>;
  /** Restart the underlying connection (the listener stays subscribed). */
  restart?(): Promise<void>;
  onDoc(data: unknown): void;
  onError?(): void;
  pollMs?: number;
  fetchTimeoutMs?: number;
  /** Least time between two restarts. */
  restartGapMs?: number;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
}

export const ROOM_POLL_MS = 5000;
export const ROOM_FETCH_TIMEOUT_MS = 6000;
export const ROOM_RESTART_GAP_MS = 20_000;
/** Catch-up reads in a row that found messages the listener never delivered. */
export const STALE_READS_BEFORE_RESTART = 2;

export interface RoomFeed {
  stop(): void;
  /** Run one catch-up read now (tests; also used right after a publish). */
  catchUp(): Promise<void>;
  /** Messages only the catch-up read delivered (the listener missed them). */
  recovered(): number;
  restarts(): number;
}

export function createRoomFeed(deps: RoomFeedDeps): RoomFeed {
  const pollMs = deps.pollMs ?? ROOM_POLL_MS;
  const fetchTimeoutMs = deps.fetchTimeoutMs ?? ROOM_FETCH_TIMEOUT_MS;
  const restartGapMs = deps.restartGapMs ?? ROOM_RESTART_GAP_MS;
  const now = deps.now ?? (() => Date.now());
  const setIntervalFn = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearIntervalFn = deps.clearInterval ?? ((id: unknown) => clearInterval(id as ReturnType<typeof setInterval>));
  const setTimeoutFn = deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));

  const seen = new Set<string>();
  let lastAt: number | null = null;
  let stopped = false;
  let reading = false;
  let staleReads = 0;
  let recovered = 0;
  let restarts = 0;
  let lastRestart = -Infinity;

  /** Deliver unseen docs in order; returns how many were new. */
  const deliver = (docs: RoomDoc[]): number => {
    let fresh = 0;
    for (const d of docs) {
      if (d.at !== null && (lastAt === null || d.at > lastAt)) lastAt = d.at;
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      fresh++;
      try { deps.onDoc(d.data); } catch { /* one bad handler never stops the feed */ }
    }
    return fresh;
  };

  const restart = (): void => {
    if (!deps.restart || now() - lastRestart < restartGapMs) return;
    lastRestart = now();
    restarts++;
    staleReads = 0;
    void deps.restart().catch(() => undefined);
  };

  async function catchUp(): Promise<void> {
    if (stopped || reading) return;
    reading = true;
    try {
      let timedOut = false;
      const docs = await Promise.race([
        deps.fetchSince(lastAt),
        new Promise<null>((resolve) => { setTimeoutFn(() => { timedOut = true; resolve(null); }, fetchTimeoutMs); }),
      ]);
      if (stopped) return;
      if (!docs) { if (timedOut) restart(); return; }
      const fresh = deliver(docs);
      recovered += fresh;
      // The listener should have delivered these already. Once is a race
      // (it was about to); twice in a row means it has gone quiet.
      staleReads = fresh > 0 ? staleReads + 1 : 0;
      if (staleReads >= STALE_READS_BEFORE_RESTART) restart();
    } catch {
      if (!stopped) restart();
    } finally {
      reading = false;
    }
  }

  const unsubscribe = deps.listen(
    (docs) => { if (!stopped) deliver(docs); },
    () => { if (!stopped) deps.onError?.(); },
  );
  const timer = setIntervalFn(() => { void catchUp(); }, pollMs);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearIntervalFn(timer);
      unsubscribe();
    },
    catchUp,
    recovered: () => recovered,
    restarts: () => restarts,
  };
}
