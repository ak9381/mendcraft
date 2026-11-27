// e2eWait.lib.mjs — the e2e scripts' "poll until true, or time out", made
// safe against the host pausing (a laptop's idle or maintenance sleep, the
// display sleeping, the browser stalled). A paused page runs none of its
// timers while the wall clock keeps going, so a plain Date.now() deadline
// expires during the pause and the check fails though the app did nothing
// wrong (the "review opens" timeouts of 27 Nov all fell on sleep / wake
// moments in `pmset -g log`). Here a poll that takes far longer than a poll
// should (gapMs) counts as a pause: that time is given back to the deadline,
// and the caller is told how long the host was paused. A real hang still
// times out — ordinary polls keep using up the budget.

/** One poll normally takes ~200 ms (+ an evaluate); longer than this is a pause. */
export const PAUSE_GAP_MS = 3000;

/**
 * @param {() => Promise<unknown>} check  truthy ends the wait; a throw counts as false
 * @param {number} ms                     the budget, in time the host was running
 * @param {{ now?: () => number, sleep?: (ms: number) => Promise<void>, everyMs?: number, gapMs?: number }} [o]
 * @returns {Promise<{ ok: boolean, pausedMs: number }>}
 */
export async function pollUntil(check, ms, o = {}) {
  const now = o.now ?? (() => Date.now());
  const sleep = o.sleep ?? ((t) => new Promise((r) => setTimeout(r, t)));
  const everyMs = o.everyMs ?? 200;
  const gapMs = o.gapMs ?? PAUSE_GAP_MS;
  let end = now() + ms;
  let pausedMs = 0;
  let last = now();
  for (;;) {
    const ok = await Promise.resolve().then(check).catch(() => false);
    if (ok) return { ok: true, pausedMs };
    const t = now();
    // This check took far longer than a check takes: the host (or the
    // browser) was paused meanwhile. Give that time back.
    const took = t - last;
    if (took > gapMs) { pausedMs += took; end += took; }
    if (t >= end) return { ok: false, pausedMs };
    await sleep(everyMs);
    last = now();
    // A pause during the sleep itself shows up here.
    const slept = last - t - everyMs;
    if (slept > gapMs) { pausedMs += slept; end += slept; }
  }
}
