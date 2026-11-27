// Final review 2, I4: a connector or next steps written on its own (keepOne)
// that the store refuses is tried again on the next change, like a board.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createOneWriter, revertFailedSave, type SaveFailure } from '../../src/canvas/canvasStore';
import type { Artifact } from '../../src/artifacts/store';

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const art = (id: string, v: number): Artifact => ({ id, kind: 'connector', v, title: id, data: { v }, by: 'replay' } as unknown as Artifact);

function rig(fails: number) {
  let artifacts: Artifact[] = [];
  const puts: string[] = [];
  const failures: SaveFailure[] = [];
  let left = fails;
  let blocked = false;
  const w = createOneWriter({
    get: () => artifacts,
    set: (l) => { artifacts = l; },
    put: async (a) => { puts.push(`${a.id}@${(a as { v: number }).v}`); if (left > 0) { left--; throw new Error('quota'); } },
    blocked: () => blocked,
    onOk: () => undefined,
    onFail: (f) => { failures.push(f); artifacts = revertFailedSave(artifacts, f); },
  });
  return { w, puts, failures, list: () => artifacts, block: (b: boolean) => { blocked = b; } };
}

describe('keepOne: a refused write is tried again on the next change', () => {
  it('a failed connector put is re-queued and written by the next retry', async () => {
    const r = rig(1);
    r.w.keep(art('connector-x', 1));
    await flush();
    expect(r.failures.length).toBe(1);
    expect(r.list().some((a) => a.id === 'connector-x')).toBe(false); // not counted as stored
    expect(r.w.pending()).toEqual(['connector-x']);
    r.w.retry(); // the next change
    await flush();
    expect(r.puts).toEqual(['connector-x@1', 'connector-x@1']);
    expect(r.list().map((a) => a.id)).toEqual(['connector-x']);
    expect(r.w.pending()).toEqual([]);
  });

  it('keeping another artifact also retries the queued one', async () => {
    const r = rig(1);
    r.w.keep(art('connector-x', 1));
    await flush();
    r.w.keep(art('steps-y', 1));
    await flush();
    expect(r.puts.sort()).toEqual(['connector-x@1', 'connector-x@1', 'steps-y@1']);
    expect(r.list().map((a) => a.id).sort()).toEqual(['connector-x', 'steps-y']);
  });

  it('a newer version replaces the queued one; nothing is written while the store is blocked', async () => {
    const r = rig(1);
    r.w.keep(art('connector-x', 1));
    await flush();
    r.block(true);
    r.w.keep(art('connector-x', 2));
    r.w.retry();
    await flush();
    expect(r.puts).toEqual(['connector-x@1']);
    r.block(false);
    r.w.retry();
    await flush();
    expect(r.puts).toEqual(['connector-x@1', 'connector-x@2']);
    expect(r.w.pending()).toEqual([]);
  });

  it('the canvas wires it: connectors and next steps go through keepOne, every save retries', () => {
    const main = readFileSync(new URL('../../src/canvas/canvasMain.ts', import.meta.url), 'utf8');
    const persist = main.slice(main.indexOf('function persistDoc('), main.indexOf('function keepOne('));
    expect(persist).toContain('oneWriter.retry();');
    expect(main).toMatch(/blocked: \(\) => !!loaded\.readFailed \|\| reloading/);
  });
});
