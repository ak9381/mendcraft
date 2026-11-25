// One on-device model, one job at a time. Gemini Nano is a single model on
// this machine: prompts launched together do not run in parallel, they queue
// inside Chrome and starve the page. Every on-device prompt goes through this
// queue so at most `limit` run at once, a board turn goes ahead of background
// picks, and a job nobody is waiting for any more is never started.

export interface NanoJobOptions {
  /** Higher runs first. Board turns use 10; background picks use 0. */
  priority?: number;
  /** Give up (without ever starting) when the job has waited this long. */
  maxWaitMs?: number;
  /** Abort before start (rejects) — a started job gets the same signal itself. */
  signal?: AbortSignal;
}

export class NanoQueueSkipped extends Error {
  constructor(why: string) { super(why); this.name = 'NanoQueueSkipped'; }
}

export interface NanoQueue {
  run<T>(job: () => Promise<T>, opts?: NanoJobOptions): Promise<T>;
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

export function createNanoQueue(limit = 1): NanoQueue {
  const cap = Math.max(1, Math.floor(limit));
  const waiters: Waiter[] = [];
  let running = 0;
  let peak = 0;
  let seq = 0;

  function pump(): void {
    while (running < cap && waiters.length) {
      let best = 0;
      for (let i = 1; i < waiters.length; i++) {
        const a = waiters[i], b = waiters[best];
        if (a.priority > b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
      }
      const [next] = waiters.splice(best, 1);
      next.start();
    }
  }

  return {
    run<T>(job: () => Promise<T>, opts: NanoJobOptions = {}): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (opts.signal?.aborted) { reject(new NanoQueueSkipped('cancelled before it started')); return; }
        let timer: ReturnType<typeof setTimeout> | null = null;
        let onAbort: (() => void) | null = null;
        const tidy = (): void => {
          if (timer) clearTimeout(timer);
          if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
        };
        const waiter: Waiter = {
          priority: opts.priority ?? 0,
          seq: seq++,
          start: () => {
            tidy();
            running++;
            if (running > peak) peak = running;
            let p: Promise<T>;
            try { p = job(); } catch (e) { p = Promise.reject(e); }
            p.then(resolve, reject).finally(() => { running--; pump(); });
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
        pump();
      });
    },
    active: () => running,
    waiting: () => waiters.length,
    idle: () => running === 0 && waiters.length === 0,
    peak: () => peak,
  };
}

/** The page-wide queue: every on-device prompt on this page shares it. */
export const nanoQueue: NanoQueue = createNanoQueue(1);
