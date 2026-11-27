import { describe, expect, it } from 'vitest';
import { pollUntil } from '../scripts/e2eWait.lib.mjs';

/** A fake clock: `sleep` and slow checks move it; nothing really waits. */
function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => { t += ms; }, sleep: async (ms: number) => { t += ms; } };
}

describe('pollUntil (e2e waits survive a host pause)', () => {
  it('a host sleep during the wait does not use up the budget (the 27 Nov "review opens" timeouts)', async () => {
    // The review opens 4.5 s of RUNNING time after the request. The host
    // sleeps for 5 minutes 1 s in: the page's timers stop with it.
    const c = clock();
    const start = c.now();
    let running = 0;
    let last = c.now();
    let slept = false;
    const check = async () => {
      const dt = c.now() - last; last = c.now();
      if (!slept && running >= 1000) { slept = true; c.advance(300_000); last = c.now(); return false; }
      running += dt;
      return running >= 4500;
    };
    const r = await pollUntil(check, 15_000, { now: c.now, sleep: c.sleep });
    expect(r.ok).toBe(true);
    expect(r.pausedMs).toBeGreaterThanOrEqual(300_000);
    expect(c.now() - start).toBeGreaterThan(300_000);
  });

  it('a pause inside the poll sleep is given back too', async () => {
    const c = clock();
    let n = 0;
    const sleep = async (ms: number) => { n++; c.advance(n === 3 ? 60_000 : ms); };
    let calls = 0;
    const r = await pollUntil(async () => ++calls > 10, 3_000, { now: c.now, sleep });
    expect(r.ok).toBe(true);
    expect(r.pausedMs).toBeGreaterThan(50_000);
  });

  it('a real hang still times out after the budget', async () => {
    const c = clock();
    const start = c.now();
    const r = await pollUntil(async () => false, 15_000, { now: c.now, sleep: c.sleep });
    expect(r).toEqual({ ok: false, pausedMs: 0 });
    expect(c.now() - start).toBeGreaterThanOrEqual(15_000);
    expect(c.now() - start).toBeLessThan(15_500);
  });

  it('a check that throws counts as not yet', async () => {
    const c = clock();
    let calls = 0;
    const r = await pollUntil(async () => { calls++; if (calls < 3) throw new Error('page navigating'); return true; }, 5_000, { now: c.now, sleep: c.sleep });
    expect(r.ok).toBe(true);
  });

  it('a plain wall-clock deadline (the old waitFor) fails the same sleep', async () => {
    // The old loop: while (Date.now() < end) { if (await check()) return true; await sleep(200); }
    const c = clock();
    let running = 0; let last = c.now(); let slept = false;
    const check = async () => {
      const dt = c.now() - last; last = c.now();
      if (!slept && running >= 1000) { slept = true; c.advance(300_000); last = c.now(); return false; }
      running += dt; return running >= 4500;
    };
    const end = c.now() + 15_000;
    let ok = false;
    while (c.now() < end) { if (await check()) { ok = true; break; } await c.sleep(200); }
    expect(ok).toBe(false);
  });
});
