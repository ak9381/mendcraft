import { describe, expect, it } from 'vitest';
import {
  compareJobs,
  createJobQueue,
  createMemoryStore,
  type NewJob,
  type QueuedJob,
} from '../src/offline/queue';

// A fixed clock so createdAt ties on purpose — ordering must then fall back to
// the monotonic seq, proving FIFO holds even when jobs land in the same tick.
const fixedClock = () => 1000;

function planJob(label: string): NewJob {
  return { kind: 'plan', mode: 'plan', label, payload: { prompt: label } };
}

describe('offline job queue', () => {
  it('enqueues in FIFO order and keeps it under a tied clock', async () => {
    let n = 0;
    const q = createJobQueue(createMemoryStore(), { now: fixedClock, genId: (s) => `j${s}` });
    await q.init();
    for (const label of ['a', 'b', 'c']) await q.enqueue(planJob(label));
    n = q.count();
    expect(n).toBe(3);
    expect(q.jobs().map((j) => j.label)).toEqual(['a', 'b', 'c']);
    expect(q.jobs().map((j) => j.seq)).toEqual([1, 2, 3]);
  });

  it('persists across a store reload with order intact', async () => {
    const store = createMemoryStore();
    const q1 = createJobQueue(store, { now: fixedClock, genId: (s) => `j${s}` });
    await q1.init();
    await q1.enqueue(planJob('first'));
    await q1.enqueue(planJob('second'));
    await q1.enqueue({ kind: 'a11y', mode: 'plan', label: 'audit', payload: { issues: [], summary: 's' } });

    // A brand-new queue over the SAME store must see the same jobs, same order.
    const q2 = createJobQueue(store, { now: fixedClock });
    await q2.init();
    expect(q2.count()).toBe(3);
    expect(q2.jobs().map((j) => j.label)).toEqual(['first', 'second', 'audit']);
    expect(q2.jobs().map((j) => j.kind)).toEqual(['plan', 'plan', 'a11y']);
  });

  it('continues seq numbering after a reload (no collisions)', async () => {
    const store = createMemoryStore();
    const q1 = createJobQueue(store, { now: fixedClock, genId: (s) => `j${s}` });
    await q1.init();
    await q1.enqueue(planJob('a'));
    await q1.enqueue(planJob('b'));

    const q2 = createJobQueue(store, { now: fixedClock, genId: (s) => `j${s}` });
    await q2.init();
    const next = await q2.enqueue(planJob('c'));
    expect(next.seq).toBe(3);
    expect(q2.jobs().map((j) => j.seq)).toEqual([1, 2, 3]);
  });

  it('drives status transitions and persists them', async () => {
    const store = createMemoryStore();
    const q = createJobQueue(store, { now: fixedClock, genId: (s) => `j${s}` });
    await q.init();
    const job = await q.enqueue(planJob('design a kitchen'));
    expect(job.status).toBe('queued');
    expect(q.nextRunnable()?.id).toBe(job.id);

    await q.setStatus(job.id, 'running');
    expect(q.jobs()[0].status).toBe('running');
    expect(q.nextRunnable()).toBeNull(); // running jobs are not re-runnable

    await q.setStatus(job.id, 'error', 'cloud timed out');
    expect(q.jobs()[0].status).toBe('error');
    expect(q.jobs()[0].error).toBe('cloud timed out');
    expect(q.nextRunnable()?.id).toBe(job.id); // errored jobs retry on reconnect

    await q.setStatus(job.id, 'ready');
    expect(q.jobs()[0].error).toBeUndefined(); // error cleared on success

    // The status + cleared error must have been written through to the store.
    const reloaded = createJobQueue(store, { now: fixedClock });
    await reloaded.init();
    expect(reloaded.jobs()[0].status).toBe('ready');
    expect(reloaded.jobs()[0].error).toBeUndefined();
  });

  it('resets a job stuck in "running" back to queued on reload', async () => {
    const store = createMemoryStore();
    const q1 = createJobQueue(store, { now: fixedClock, genId: (s) => `j${s}` });
    await q1.init();
    const job = await q1.enqueue(planJob('half-run'));
    await q1.setStatus(job.id, 'running');

    const q2 = createJobQueue(store, { now: fixedClock });
    await q2.init();
    expect(q2.jobs()[0].status).toBe('queued'); // retryable again
    expect(q2.nextRunnable()?.id).toBe(job.id);
  });

  it('removes jobs from memory and the store', async () => {
    const store = createMemoryStore();
    const q = createJobQueue(store, { now: fixedClock, genId: (s) => `j${s}` });
    await q.init();
    const a = await q.enqueue(planJob('a'));
    await q.enqueue(planJob('b'));
    await q.remove(a.id);
    expect(q.jobs().map((j) => j.label)).toEqual(['b']);

    const reloaded = createJobQueue(store, { now: fixedClock });
    await reloaded.init();
    expect(reloaded.jobs().map((j) => j.label)).toEqual(['b']);
  });

  it('notifies subscribers on every change', async () => {
    const q = createJobQueue(createMemoryStore(), { now: fixedClock, genId: (s) => `j${s}` });
    await q.init();
    const seen: number[] = [];
    const off = q.subscribe((jobs) => seen.push(jobs.length));
    const job = await q.enqueue(planJob('a'));
    await q.setStatus(job.id, 'running');
    await q.remove(job.id);
    off();
    await q.enqueue(planJob('b')); // after unsubscribe — not observed
    expect(seen).toEqual([1, 1, 0]);
  });

  it('compareJobs orders by createdAt then seq', () => {
    const mk = (createdAt: number, seq: number): QueuedJob => ({
      id: `${createdAt}-${seq}`, kind: 'plan', mode: 'plan', label: '', payload: {},
      createdAt, seq, status: 'queued',
    });
    const jobs = [mk(2, 1), mk(1, 9), mk(1, 2)].sort(compareJobs);
    expect(jobs.map((j) => j.id)).toEqual(['1-2', '1-9', '2-1']);
  });
});
