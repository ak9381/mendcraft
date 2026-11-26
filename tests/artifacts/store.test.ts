import { afterEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  ARTIFACT_DB_NAME, STORE_FALLBACK_LINE, createIdbArtifactStore, createMemoryArtifactStore, loadArtifacts, openArtifactStore,
} from '../../src/artifacts/store';
import { ARTIFACT_MAX_COUNT } from '../../src/artifacts/artifact';
import { board } from './sample';

const g = globalThis as { indexedDB?: unknown };
const had = g.indexedDB;
afterEach(() => { g.indexedDB = had; });

describe('ArtifactStore', () => {
  for (const [name, make] of [
    ['memory', () => createMemoryArtifactStore()],
    ['IndexedDB', () => createIdbArtifactStore(new IDBFactory())],
  ] as const) {
    it(`${name}: put then list returns the artifact; put with the same id replaces it`, async () => {
      const s = make();
      await s.put(board('f1'));
      expect((await s.list()).map((a) => a.id)).toEqual(['board-f1']);
      await s.put(board('f1', { v: 2, title: 'Desk 2' }));
      const all = await s.list();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ v: 2, title: 'Desk 2' });
      await s.put(board('f2'));
      await s.remove('board-f1');
      expect((await s.list()).map((a) => a.id)).toEqual(['board-f2']);
      await s.clear();
      expect(await s.list()).toEqual([]);
    });
  }

  it('the IndexedDB store keeps rows across instances of the same database', async () => {
    const idb = new IDBFactory();
    await createIdbArtifactStore(idb).put(board('f1'));
    expect((await createIdbArtifactStore(idb).list()).map((a) => a.id)).toEqual(['board-f1']);
    const names = await idb.databases();
    expect(names.map((d) => d.name)).toContain(ARTIFACT_DB_NAME);
  });

  it('loadArtifacts drops a corrupt row and keeps the rest', async () => {
    const s = createMemoryArtifactStore([board('f1'), board('f2'), board('bad', {}, { kind: 'room', tiles: 'nope' })]);
    const r = await loadArtifacts(s);
    expect(r.ok).toHaveLength(2);
    expect(r.dropped).toEqual([{ id: 'board-bad', why: expect.any(String) }]);
  });

  it('loadArtifacts keeps at most 200, newest first by at', async () => {
    const rows = Array.from({ length: ARTIFACT_MAX_COUNT + 5 }, (_, i) => board(`f${i}`, { at: 1000 + i }));
    const r = await loadArtifacts(createMemoryArtifactStore(rows));
    expect(r.ok).toHaveLength(ARTIFACT_MAX_COUNT);
    expect(r.ok[0].at).toBe(1000 + ARTIFACT_MAX_COUNT + 4);
    expect(r.ok.every((a, i) => i === 0 || r.ok[i - 1].at >= a.at)).toBe(true);
    expect(r.ok.some((a) => a.at < 1005)).toBe(false);
  });

  it('falls back to memory when indexedDB.open throws', async () => {
    g.indexedDB = { open: () => { throw new Error('blocked'); } };
    const r = await openArtifactStore();
    expect(r.persistent).toBe(false);
    await r.store.put(board('f1'));
    expect(await r.store.list()).toHaveLength(1);
    expect(STORE_FALLBACK_LINE).toBe("This browser can't keep boards. They last until you close the tab.");
  });

  it('opens the IndexedDB store when it works', async () => {
    g.indexedDB = new IDBFactory();
    const r = await openArtifactStore();
    expect(r.persistent).toBe(true);
  });
});
