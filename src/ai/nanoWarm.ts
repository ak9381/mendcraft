// Keeps Nano warm so the cold start (about 14 s) is never paid by a request.
// The warm-up itself (hybrid.warmBoardOnDevice) can be pushed aside by a real
// request or fail; this decides when to try again: whenever the model becomes
// available, and once more after a failed attempt, 10 s later and only when
// the model is idle.

export interface WarmKeeperDeps {
  /** One warm-up attempt: true when the model is loaded. */
  warm(): Promise<boolean>;
  /** Nothing is using (or waiting for) the on-device model. */
  idle(): boolean;
  /** Injectable timers. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  /** After a failed warm-up, wait this long before the one retry. */
  retryAfterMs?: number;
  /** While waiting for an idle moment to retry, look again this often. */
  pollMs?: number;
  /** Give up looking for an idle moment after this many looks. */
  maxPolls?: number;
}

export interface WarmKeeper {
  /** The model just became available (or the page just loaded): warm it. */
  kick(): void;
  /** A real on-device call finished: the model is loaded, nothing to do. */
  markWarm(): void;
  warmed(): boolean;
  stop(): void;
}

export const WARM_RETRY_AFTER_MS = 10_000;

export function createWarmKeeper(deps: WarmKeeperDeps): WarmKeeper {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const retryAfterMs = deps.retryAfterMs ?? WARM_RETRY_AFTER_MS;
  const pollMs = deps.pollMs ?? 2000;
  const maxPolls = deps.maxPolls ?? 30;
  let warmed = false;
  let running = false;
  let stopped = false;
  let timer: unknown = null;
  const drop = (): void => { if (timer != null) { clearTimer(timer); timer = null; } };

  async function attempt(retryLeft: number): Promise<void> {
    if (warmed || running || stopped) return;
    running = true;
    let ok = false;
    try { ok = await deps.warm(); } catch { ok = false; }
    running = false;
    if (ok) { warmed = true; return; }
    if (retryLeft <= 0 || warmed || stopped) return;
    // One retry: 10 s later, at the first idle moment after that.
    let polls = 0;
    const look = (): void => {
      timer = null;
      if (warmed || stopped) return;
      if (deps.idle()) { void attempt(retryLeft - 1); return; }
      if (++polls < maxPolls) timer = setTimer(look, pollMs);
    };
    drop();
    timer = setTimer(look, retryAfterMs);
  }

  return {
    kick() { drop(); void attempt(1); },
    markWarm() { warmed = true; drop(); },
    warmed: () => warmed,
    stop() { stopped = true; drop(); },
  };
}
