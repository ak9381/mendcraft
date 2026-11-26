// A room's message feed that survives a silent listener. The live listener
// (Firestore onSnapshot) can stop delivering without ever reporting an error:
// the laptop then looks paired ("✓ Nothing phone", the phone says "Laptop ✓")
// but hears nothing more — no phone AI activity on the monitor, no commands.
// So the listener is backed by a slow catch-up read: every few seconds the
// room is read from the server from the last message seen, anything the
// listener missed is delivered (once — messages are de-duplicated by id), and
// a listener that keeps missing messages, or a read that hangs, restarts the
// connection. Pure over injected I/O so it is unit-tested with fakes.
//
// Reads are bounded: the feed starts at the session's start (`since`), so a
// room with a long history is never read whole, and there is never more than
// one read in flight.

export interface RoomDoc {
  id: string;
  /** Server time in ms; null while the write is still pending locally. */
  at: number | null;
  data: unknown;
}

/** Shared by every feed on one connection: a restart restarts them all, so
 *  the gap between two restarts is counted once, not per feed. */
export interface RestartClock { last: number }

export interface RoomFeedDeps {
  /** Start the live listener from `from` (ms, inclusive; null = everything). */
  listen(from: number | null, onDocs: (docs: RoomDoc[]) => void, onError: () => void): () => void;
  /** Read the room from the server, oldest first, from `at` (inclusive). */
  fetchSince(at: number): Promise<RoomDoc[]>;
  /** Restart the underlying connection (the listener stays subscribed). */
  restart?(): Promise<void>;
  onDoc(data: unknown, at: number | null): void;
  onError?(): void;
  /** The session's start (server ms), once known; null = no server clock.
   *  Nothing is listened to or read before it resolves, and nothing older
   *  than it (less `slackMs`) is ever asked for. Absent = listen at once. */
  since?: Promise<number | null>;
  slackMs?: number;
  pollMs?: number;
  fetchTimeoutMs?: number;
  /** Least time between two restarts. */
  restartGapMs?: number;
  restartClock?: RestartClock;
  /** Most message ids remembered for de-duplication (oldest forgotten first). */
  seenMax?: number;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
}

export const ROOM_POLL_MS = 5000;
/** Shorter than the poll, so a hung read is given up on before the next one is due. */
export const ROOM_FETCH_TIMEOUT_MS = 4000;
export const ROOM_RESTART_GAP_MS = 20_000;
export const ROOM_SINCE_SLACK_MS = 2000;
export const ROOM_SEEN_MAX = 2000;
/** Catch-up reads in a row that found messages the listener never delivered. */
export const STALE_READS_BEFORE_RESTART = 2;

export interface RoomFeed {
  stop(): void;
  /** Run one catch-up read now (tests). */
  catchUp(): Promise<void>;
  /** Messages only the catch-up read delivered (the listener missed them). */
  recovered(): number;
  restarts(): number;
}

export function createRoomFeed(deps: RoomFeedDeps): RoomFeed {
  const pollMs = deps.pollMs ?? ROOM_POLL_MS;
  const fetchTimeoutMs = deps.fetchTimeoutMs ?? ROOM_FETCH_TIMEOUT_MS;
  const restartGapMs = deps.restartGapMs ?? ROOM_RESTART_GAP_MS;
  const slackMs = deps.slackMs ?? ROOM_SINCE_SLACK_MS;
  const seenMax = deps.seenMax ?? ROOM_SEEN_MAX;
  const restartClock = deps.restartClock ?? { last: -Infinity };
  const now = deps.now ?? (() => Date.now());
  const setIntervalFn = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearIntervalFn = deps.clearInterval ?? ((id: unknown) => clearInterval(id as ReturnType<typeof setInterval>));
  const setTimeoutFn = deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));

  const seen = new Set<string>();
  /** Where reads start: the session start (less slack), then the last message seen. */
  let floor: number | null = null;
  let lastAt: number | null = null;
  let stopped = false;
  let reading = false;
  let staleReads = 0;
  let recovered = 0;
  let restarts = 0;
  let unsubscribe: () => void = () => undefined;
  let timer: unknown = null;

  /** Deliver unseen docs in order; returns how many were new. */
  const deliver = (docs: RoomDoc[]): number => {
    let fresh = 0;
    for (const d of docs) {
      if (d.at !== null && (lastAt === null || d.at > lastAt)) lastAt = d.at;
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      if (seen.size > seenMax) seen.delete(seen.values().next().value as string);
      fresh++;
      try { deps.onDoc(d.data, d.at); } catch { /* one bad handler never stops the feed */ }
    }
    return fresh;
  };

  const restart = (): void => {
    if (!deps.restart || now() - restartClock.last < restartGapMs) return;
    restartClock.last = now();
    restarts++;
    staleReads = 0;
    void deps.restart().catch(() => undefined);
  };

  async function catchUp(): Promise<void> {
    if (stopped || reading) return;
    // Never the whole room: from the last message seen, else the session start.
    const from = lastAt ?? floor;
    if (from === null) return;
    reading = true;
    // One read at a time: `reading` clears only when the real read settles,
    // however long ago its timeout gave up on it.
    const read = deps.fetchSince(from);
    void read.catch(() => undefined).then(() => { reading = false; });
    try {
      let timedOut = false;
      const docs = await Promise.race([
        read,
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
    }
  }

  const begin = (start: number | null): void => {
    if (stopped) return;
    floor = start === null ? null : start - slackMs;
    unsubscribe = deps.listen(
      floor,
      (docs) => { if (!stopped) deliver(docs); },
      () => { if (!stopped) deps.onError?.(); },
    );
    timer = setIntervalFn(() => { void catchUp(); }, pollMs);
  };
  if (deps.since) void deps.since.then(begin, () => undefined);
  else begin(null);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== null) clearIntervalFn(timer);
      unsubscribe();
    },
    catchUp,
    recovered: () => recovered,
    restarts: () => restarts,
  };
}
