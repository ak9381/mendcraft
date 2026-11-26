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
  /** The model was unloaded (a call failed, or it stopped being available):
   *  forget that it was warm, so the next kick loads it again. */
  reset(): void;
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
    reset() { warmed = false; },
    warmed: () => warmed,
    stop() { stopped = true; drop(); },
  };
}

/** The page's warm schedule: after first paint (a frame, then a short
 *  delay), at the first idle moment — bounded by `idleTimeoutMs`, since hand
 *  tracking keeps the page busy — ask whether Nano is usable (asking warms
 *  it, see canvasMain's refreshNanoAvailable), then keep asking: every 15 s
 *  until it is, once a minute after. The warm-up's own loading/loaded state
 *  is passed on (the engine bar line). `stop()` cancels every pending
 *  callback and the subscription. On-device only: nothing here calls Gemini. */
export interface WarmScheduleDeps {
  refresh(): Promise<boolean>;
  available(): boolean;
  /** Subscribe to the warm-up's state (hybrid.onWarmState); returns unsubscribe. */
  subscribe?(cb: (state: 'loading' | 'loaded' | 'failed') => void): () => void;
  onState?(state: 'loading' | 'loaded' | 'failed'): void;
  raf?: (cb: () => void) => unknown;
  cancelRaf?: (id: unknown) => void;
  idle?: (cb: () => void, o: { timeout: number }) => unknown;
  cancelIdle?: (id: unknown) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  idleTimeoutMs?: number;
}
export const WARM_AFTER_PAINT_MS = 400;
export const WARM_IDLE_TIMEOUT_MS = 1500;
export function startWarmSchedule(d: WarmScheduleDeps): { stop(): void } {
  const setTimer = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = d.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let stopped = false;
  let rafId: unknown = null, idleId: unknown = null;
  const timers = new Set<unknown>();
  const later = (fn: () => void, ms: number): void => { const id = setTimer(() => { timers.delete(id); if (!stopped) fn(); }, ms); timers.add(id); };
  const unsubscribe = d.subscribe?.((s) => { if (!stopped) d.onState?.(s); }) ?? null;
  const poll = (): void => { later(() => { void d.refresh().finally(() => { if (!stopped) poll(); }); }, d.available() ? 60_000 : 15_000); };
  const first = (): void => { idleId = null; if (stopped) return; void d.refresh(); poll(); };
  const whenIdle = (): void => {
    if (stopped) return;
    if (d.idle) idleId = d.idle(first, { timeout: d.idleTimeoutMs ?? WARM_IDLE_TIMEOUT_MS });
    else later(first, 300);
  };
  const afterPaint = (): void => { rafId = null; later(whenIdle, WARM_AFTER_PAINT_MS); };
  if (d.raf) rafId = d.raf(afterPaint); else afterPaint();
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (rafId != null) d.cancelRaf?.(rafId);
      if (idleId != null) d.cancelIdle?.(idleId);
      for (const id of timers) clearTimer(id);
      timers.clear();
      unsubscribe?.();
    },
  };
}
