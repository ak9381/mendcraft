// One on-device model, one job at a time. Gemini Nano is a single model on
// this machine: prompts launched together do not run in parallel, they queue
// inside Chrome and starve the page. Every on-device prompt goes through this
// queue so at most `limit` run at once, a board turn goes ahead of background
// picks, a job nobody is waiting for any more is never started, and a
// background job (the warm-up) steps aside the moment a real one arrives.

export interface NanoJobOptions {
  /** Higher runs first. Board turns use 10; background picks use 0. */
  priority?: number;
  /** Give up (without ever starting) when the job has waited this long. */
  maxWaitMs?: number;
  /** Abort before start (rejects) — a started job gets the same signal itself. */
  signal?: AbortSignal;
  /** A running job that a higher-priority arrival may push aside: its
   *  `ctx.signal` aborts, its slot is freed at once, and its promise rejects
   *  with NanoQueueSkipped. A function is asked at the moment of the arrival
   *  (a warm-up that is nearly done says no and is left to finish). */
  preemptible?: boolean | (() => boolean);
}

export interface NanoJobContext {
  /** Aborts when this job is pre-empted. Never aborts for other jobs. */
  signal: AbortSignal | null;
}

export class NanoQueueSkipped extends Error {
  constructor(why: string) { super(why); this.name = 'NanoQueueSkipped'; }
}

export interface NanoQueue {
  run<T>(job: (ctx: NanoJobContext) => Promise<T>, opts?: NanoJobOptions): Promise<T>;
  /** Jobs running now. */
  active(): number;
  /** Jobs waiting for a slot. */
  waiting(): number;
  /** Nothing running, nothing waiting. */
  idle(): boolean;
  /** The most jobs that ever ran at once (for tests and the live probe). */
  peak(): number;
}

interface Waiter {
  priority: number;
  seq: number;
  start: () => void;
  cancel: (why: Error) => void;
}

interface Running {
  priority: number;
  preempt: (() => void) | null;
}

export function createNanoQueue(limit = 1): NanoQueue {
  const cap = Math.max(1, Math.floor(limit));
  const waiters: Waiter[] = [];
  const runningJobs = new Set<Running>();
  let peak = 0;
  let seq = 0;

  function pump(): void {
    while (runningJobs.size < cap && waiters.length) {
      let best = 0;
      for (let i = 1; i < waiters.length; i++) {
        const a = waiters[i], b = waiters[best];
        if (a.priority > b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
      }
      const [next] = waiters.splice(best, 1);
      next.start();
    }
  }

  /** A more important job is waiting and every slot is taken: push aside one
   *  running job that agreed to be pushed. */
  function preemptFor(priority: number): void {
    if (runningJobs.size < cap) return;
    for (const r of runningJobs) {
      if (r.preempt && r.priority < priority) r.preempt();
      if (runningJobs.size < cap) return;
    }
  }

  return {
    run<T>(job: (ctx: NanoJobContext) => Promise<T>, opts: NanoJobOptions = {}): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (opts.signal?.aborted) { reject(new NanoQueueSkipped('cancelled before it started')); return; }
        const priority = opts.priority ?? 0;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let onAbort: (() => void) | null = null;
        const tidy = (): void => {
          if (timer) clearTimeout(timer);
          if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
        };
        const waiter: Waiter = {
          priority,
          seq: seq++,
          start: () => {
            tidy();
            const ctl = opts.preemptible && typeof AbortController !== 'undefined' ? new AbortController() : null;
            let released = false;
            const me: Running = { priority, preempt: null };
            const release = (): void => { if (released) return; released = true; runningJobs.delete(me); pump(); };
            if (opts.preemptible) {
              const may = opts.preemptible;
              me.preempt = () => {
                if (released) return;
                if (typeof may === 'function' && !may()) return; // not now: the arrival waits its turn
                ctl?.abort();
                reject(new NanoQueueSkipped('stepped aside for a request'));
                release();
              };
            }
            runningJobs.add(me);
            if (runningJobs.size > peak) peak = runningJobs.size;
            let p: Promise<T>;
            try { p = job({ signal: ctl?.signal ?? null }); } catch (e) { p = Promise.reject(e); }
            p.then(resolve, reject).finally(release);
          },
          cancel: (why) => {
            const i = waiters.indexOf(waiter);
            if (i < 0) return; // already started
            waiters.splice(i, 1);
            tidy();
            reject(why);
          },
        };
        if (opts.maxWaitMs != null) {
          timer = setTimeout(() => waiter.cancel(new NanoQueueSkipped('the on-device model was busy')), opts.maxWaitMs);
        }
        if (opts.signal) {
          onAbort = () => waiter.cancel(new NanoQueueSkipped('cancelled before it started'));
          opts.signal.addEventListener('abort', onAbort, { once: true });
        }
        waiters.push(waiter);
        preemptFor(priority);
        pump();
      });
    },
    active: () => runningJobs.size,
    waiting: () => waiters.length,
    idle: () => runningJobs.size === 0 && waiters.length === 0,
    peak: () => peak,
  };
}

/** The page-wide queue: every on-device prompt on this page shares it. */
export const nanoQueue: NanoQueue = createNanoQueue(1);
