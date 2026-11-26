// First-valid race between a primary cloud model and a slower backup.
// Pure: no Firebase. The caller starts the backup after `hedgeAfterMs`
// if the primary has not yet produced a valid result.

export const HEDGE_AFTER_MS = 2000;
export const PRIMARY_CLOUD_MODEL = 'gemini-3.5-flash-lite';
export const HEDGE_CLOUD_MODEL = 'gemini-3.1-flash-lite';

export type HedgeWinner = 'primary' | 'backup';

export interface HedgeResult<T> {
  value: T;
  winner: HedgeWinner;
  model: string;
  ms: number;
}

/**
 * Run `primary` immediately. If it has not produced a non-null value after
 * `hedgeAfterMs`, start `backup`. The first valid value wins; the other
 * promise is ignored (the caller may also abort it).
 */
export async function raceHedged<T>(opts: {
  primary: () => Promise<T | null>;
  backup?: () => Promise<T | null>;
  hedgeAfterMs?: number;
  primaryModel?: string;
  backupModel?: string;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}): Promise<HedgeResult<T> | null> {
  const now = opts.now ?? Date.now;
  const wait = opts.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const hedgeAfter = opts.hedgeAfterMs ?? HEDGE_AFTER_MS;
  const t0 = now();
  let settled = false;
  let backupStarted = false;

  return new Promise<HedgeResult<T> | null>((resolve) => {
    const finish = (value: T | null, winner: HedgeWinner, model: string) => {
      if (settled) return;
      if (value == null) return;
      settled = true;
      resolve({ value, winner, model, ms: Math.max(0, now() - t0) });
    };
    const failIfIdle = () => {
      if (settled) return;
      // Only end empty when both legs have finished without a value.
      if (primaryDone && (backupDone || !backupStarted || !opts.backup)) {
        settled = true;
        resolve(null);
      }
    };

    let primaryDone = false;
    let backupDone = false;

    void Promise.resolve()
      .then(() => opts.primary())
      .then((v) => { primaryDone = true; finish(v, 'primary', opts.primaryModel ?? PRIMARY_CLOUD_MODEL); failIfIdle(); })
      .catch(() => { primaryDone = true; failIfIdle(); });

    if (opts.backup) {
      void wait(hedgeAfter).then(() => {
        if (settled) return;
        backupStarted = true;
        return opts.backup!()
          .then((v) => { backupDone = true; finish(v, 'backup', opts.backupModel ?? HEDGE_CLOUD_MODEL); failIfIdle(); })
          .catch(() => { backupDone = true; failIfIdle(); });
      });
    }
  });
}
