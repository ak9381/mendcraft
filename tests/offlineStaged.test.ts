import { describe, expect, it } from 'vitest';
import { createJobQueue, createMemoryStore, type NewJob } from '../src/offline/queue';
import { isValidStaged, restoredReadyAction } from '../src/offline/staged';

const fixedClock = () => 1000;

function planJob(label: string): NewJob {
  return { kind: 'plan', mode: 'plan', label, payload: { prompt: label } };
}

// A staged plan result as main.ts stores it on the job (the cloud answer the user
// already saw) — the only thing that must survive a reload so Apply reappears.
const planStaged = { kind: 'plan', payload: { ops: [{ op: 'add_room' }] }, source: 'cloud' };
const a11yStaged = { kind: 'a11y', items: [{ id: 'r1', text: 'Widen the door.' }], source: 'cloud' };

describe('staged-result shape check', () => {
  it('accepts a well-formed plan / a11y staged result', () => {
    expect(isValidStaged(planStaged)).toBe(true);
    expect(isValidStaged(a11yStaged)).toBe(true);
  });

  it('rejects missing / corrupt payloads', () => {
    expect(isValidStaged(undefined)).toBe(false);
    expect(isValidStaged(null)).toBe(false);
    expect(isValidStaged('not an object')).toBe(false);
    expect(isValidStaged({ kind: 'plan', source: 'cloud' })).toBe(false); // no ops
    expect(isValidStaged({ kind: 'plan', payload: {}, source: 'cloud' })).toBe(false); // ops missing
    expect(isValidStaged({ kind: 'plan', payload: { ops: [] } })).toBe(false); // no source
    expect(isValidStaged({ kind: 'a11y', source: 'cloud' })).toBe(false); // no items
    expect(isValidStaged({ kind: 'question', source: 'cloud' })).toBe(false); // not an applyable kind
  });

  it('maps a ready job to Apply when staged is valid, Re-run otherwise', () => {
    expect(restoredReadyAction({ status: 'ready', staged: planStaged })).toBe('apply');
    expect(restoredReadyAction({ status: 'ready', staged: undefined })).toBe('rerun');
    expect(restoredReadyAction({ status: 'ready', staged: { kind: 'plan' } })).toBe('rerun');
    expect(restoredReadyAction({ status: 'queued', staged: planStaged })).toBe('rerun');
  });
});

describe('ready job + staged result survive reload', () => {
  it('persists the staged cloud result so a reloaded ready job can Apply', async () => {
    const store = createMemoryStore();
    const q1 = createJobQueue(store, { now: fixedClock, genId: (s) => `j${s}` });
    await q1.init();
    const job = await q1.enqueue(planJob('design a kitchen'));
    // Cloud answered: stage the result the user saw and mark ready (as main.ts does).
    await q1.setStatus(job.id, 'ready', undefined, planStaged);

    // Brand-new queue over the same store — the ready job AND its staged result
    // come back, so Apply is available (not stuck with no button).
    const q2 = createJobQueue(store, { now: fixedClock });
    await q2.init();
    const restored = q2.jobs().find((j) => j.id === job.id);
    expect(restored?.status).toBe('ready');
    expect(restored?.staged).toEqual(planStaged);
    expect(restoredReadyAction(restored!)).toBe('apply');
  });

  it('Discard clears the ready job and its staged result from the store', async () => {
    const store = createMemoryStore();
    const q1 = createJobQueue(store, { now: fixedClock, genId: (s) => `j${s}` });
    await q1.init();
    const job = await q1.enqueue(planJob('a kitchen'));
    await q1.setStatus(job.id, 'ready', undefined, planStaged);

    await q1.remove(job.id); // Discard

    const q2 = createJobQueue(store, { now: fixedClock });
    await q2.init();
    expect(q2.jobs()).toHaveLength(0);
  });

  it('a corrupt/missing staged payload leaves a ready job on Re-run, and Re-run clears the stale result', async () => {
    const store = createMemoryStore();
    const q1 = createJobQueue(store, { now: fixedClock, genId: (s) => `j${s}` });
    await q1.init();
    const job = await q1.enqueue(planJob('a kitchen'));
    // Mark ready but WITHOUT a staged result — simulates an older build / corrupt
    // record where the cloud answer didn't persist.
    await q1.setStatus(job.id, 'ready');

    const q2 = createJobQueue(store, { now: fixedClock });
    await q2.init();
    const restored = q2.jobs().find((j) => j.id === job.id)!;
    expect(restored.status).toBe('ready');
    expect(restored.staged).toBeUndefined();
    expect(restoredReadyAction(restored)).toBe('rerun'); // Re-run, not stuck

    // Re-run re-queues the job; setStatus(queued) must drop any stale staged field.
    await q2.setStatus(restored.id, 'ready', undefined, planStaged); // pretend it had a stale one
    await q2.setStatus(restored.id, 'queued');
    const q3 = createJobQueue(store, { now: fixedClock });
    await q3.init();
    const reran = q3.jobs().find((j) => j.id === job.id)!;
    expect(reran.status).toBe('queued');
    expect(reran.staged).toBeUndefined(); // stale result cleared, re-runnable
    expect(q3.nextRunnable()?.id).toBe(job.id);
  });
});
