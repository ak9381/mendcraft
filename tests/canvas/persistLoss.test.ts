// Saved boards are never lost (ported from sim-main's persist-loss fix, for
// main's layout key — what boards show lives in the artifact store):
// ?fresh=1 copies the saved layout aside and leaves the address bar; a layout
// this build can't read is copied aside (never overwritten) and the canvas
// says so once; a repaired layout is copied aside first (rotating, never
// claimed kept when it wasn't); the devices-board marker is trusted only on
// the devices list itself.
import { describe, expect, it } from 'vitest';
import { parseCanvasDoc } from '../../src/canvas/frames';
import { coerceLayout } from '../../src/canvas/canvasPersistence';
import {
  BEFORE_FRESH_KEY, CANVAS_STORAGE_KEY, DEVICES_BOARD_KEY, FRESH_SLOTS, MAX_UNREADABLE, REPAIR_SLOTS,
  UNREADABLE_KEY, UNREADABLE_LINE, UNSAVED_LINE,
  BEFORE_FRESH_ARTIFACTS_KEY, clearStoreForFresh, keepUnreadable, loadLayout, loadLine, openFresh, reservedIds, saveCanvasDoc, startFresh, withoutFresh, STORE_SAVE_OFF_LINE,
} from '../../src/canvas/canvasStore';

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
  };
}
const quiet = () => undefined;
const frame = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'note', title, rect: { x: 0, y: 0, w: 10, h: 10 }, pinned: false, ...extra });
const layoutOf = (...titles: string[]) => JSON.stringify({ version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: titles.map((t, i) => frame(`f${i + 1}`, t)) });
const THREE = JSON.stringify({ version: 1, camera: { x: 10, y: 20, z: 1.5 }, focusId: 'f2', frames: [frame('f1', 'Board A'), frame('f2', 'Board B', { from: 'laptop' }), { ...frame('f3', 'Floor plan'), kind: 'plan' }], lang: 'kn' });
const BLANK = layoutOf();

describe('a saved layout round-trips', () => {
  it('loads back exactly as saved (no repair, no copy)', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: THREE });
    const loaded = loadLayout(s, CANVAS_STORAGE_KEY, quiet);
    expect(loaded.unreadable).toBe(false);
    expect(loaded.repaired).toBeUndefined();
    expect(s.getItem(REPAIR_SLOTS[0])).toBeNull();
    expect(loaded.layout).toEqual(JSON.parse(THREE));
  });
  it('a board received from the laptop keeps that mark across a reload', () => {
    expect(coerceLayout(JSON.parse(THREE))!.frames[1].from).toBe('laptop');
    expect(coerceLayout(JSON.parse(THREE))!.frames[0]).not.toHaveProperty('from');
    expect(parseCanvasDoc({ ...JSON.parse(THREE), frames: [frame('f1', 'x', { from: 'phone' })] })!.frames[0]).not.toHaveProperty('from');
  });
});

describe('a repaired layout is copied aside first, and the repair is named', () => {
  const slip = JSON.stringify({ ...JSON.parse(THREE), camera: { x: 0, y: 0, z: 0.01 }, focusId: 'f9' });
  it('the raw text goes aside and the log says where', () => {
    const logs: string[] = [];
    const s = memStorage({ [CANVAS_STORAGE_KEY]: slip });
    const loaded = loadLayout(s, CANVAS_STORAGE_KEY, (l) => logs.push(l));
    expect(loaded.layout!.frames).toHaveLength(3);
    expect(loaded.layout!.focusId).toBeNull();
    expect(loaded.repaired).toEqual(['camera', 'focus']);
    expect(s.getItem(REPAIR_SLOTS[0])).toBe(slip);
    expect(logs[0]).toMatch(/repaired on load: camera, focus \(the saved text is kept under mc\.canvas\.v1\.beforeRepair\)/);
  });
  it('the first copy is kept for good; later repairs rotate (none is lost to a single slot)', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: slip });
    loadLayout(s, CANVAS_STORAGE_KEY, quiet);
    const second = JSON.stringify({ ...JSON.parse(slip), focusId: 'nope' });
    const third = JSON.stringify({ ...JSON.parse(slip), focusId: 'nope2' });
    const fourth = JSON.stringify({ ...JSON.parse(slip), focusId: 'nope3' });
    for (const t of [second, third, fourth]) { s.setItem(CANVAS_STORAGE_KEY, t); loadLayout(s, CANVAS_STORAGE_KEY, quiet); }
    expect(REPAIR_SLOTS.map((k) => s.getItem(k))).toEqual([slip, fourth, third]);
  });
  it('never claims the text was kept when the copy failed', () => {
    const logs: string[] = [];
    const s = memStorage({ [CANVAS_STORAGE_KEY]: slip, [REPAIR_SLOTS[0]]: 'other text' });
    s.setItem = (k: string, v: string) => { if (k !== CANVAS_STORAGE_KEY) throw new Error('QuotaExceededError'); s.m.set(k, v); };
    loadLayout(s, CANVAS_STORAGE_KEY, (l) => logs.push(l));
    expect(s.getItem(REPAIR_SLOTS[0])).toBe('other text');
    expect(logs[0]).toMatch(/could not be copied aside/);
    expect(logs[0]).not.toMatch(/kept under/);
  });
});

describe('a layout this build cannot read is kept safe, never overwritten', () => {
  const unreadable = JSON.stringify({ ...JSON.parse(THREE), version: 2 });
  it('is copied aside before anything can write, and the line says so', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: unreadable });
    const loaded = loadLayout(s, CANVAS_STORAGE_KEY, quiet);
    expect(loaded).toEqual({ layout: null, unreadable: true, safe: true });
    expect(s.getItem(UNREADABLE_KEY)).toBe(unreadable);
    expect(loadLine(loaded)).toBe(UNREADABLE_LINE);
    expect(UNREADABLE_LINE).toBe('Couldn’t open your saved boards — they’re kept safe.');
    s.setItem(CANVAS_STORAGE_KEY, BLANK); // the canvas saves again…
    expect(s.getItem(UNREADABLE_KEY)).toBe(unreadable); // …the copy stays
  });
  it('a second, different unreadable layout never replaces the first copy', () => {
    const s = memStorage({ [UNREADABLE_KEY]: 'first' });
    expect(keepUnreadable(s, 'second', () => 42)).toBe(true);
    expect(s.getItem(UNREADABLE_KEY)).toBe('first');
    expect(s.getItem(`${UNREADABLE_KEY}.42`)).toBe('second');
    expect(keepUnreadable(s, 'first')).toBe(true);
    expect(keepUnreadable(s, 'second', () => 43)).toBe(true);
  });
  it(`keeps at most ${MAX_UNREADABLE}; past that nothing is added and the canvas won't save`, () => {
    const s = memStorage({ [UNREADABLE_KEY]: 'a', [`${UNREADABLE_KEY}.1`]: 'b', [`${UNREADABLE_KEY}.2`]: 'c', [CANVAS_STORAGE_KEY]: 'd {' });
    const loaded = loadLayout(s, CANVAS_STORAGE_KEY, quiet);
    expect(loaded).toEqual({ layout: null, unreadable: true, safe: false });
    expect([...s.m.keys()].filter((k) => k.startsWith(UNREADABLE_KEY))).toHaveLength(3);
    expect(loadLine(loaded)).toBe(UNSAVED_LINE);
  });
  it('when the copy cannot be made: not safe, and the line says this session won’t be saved', () => {
    const full = memStorage({ [CANVAS_STORAGE_KEY]: 'not json {' });
    full.setItem = (k: string, v: string) => { if (k !== CANVAS_STORAGE_KEY) throw new Error('QuotaExceededError'); full.m.set(k, v); };
    const loaded = loadLayout(full, CANVAS_STORAGE_KEY, quiet);
    expect(loaded).toEqual({ layout: null, unreadable: true, safe: false });
    expect(loadLine(loaded)).toBe('Couldn’t open your saved boards, and changes in this session won’t be saved.');
  });
  it('nothing saved (or no storage) is not "unreadable", and says nothing', () => {
    expect(loadLayout(memStorage(), CANVAS_STORAGE_KEY, quiet)).toEqual({ layout: null, unreadable: false, safe: true });
    expect(loadLine(loadLayout(null))).toBeNull();
  });
});

describe('?fresh=1 never just deletes her boards', () => {
  it('copies the saved layout aside, clears it and the devices marker, and strips fresh from the address', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: THREE, [DEVICES_BOARD_KEY]: 'f1' });
    expect(openFresh(s, 'https://x.web.app/canvas.html?fresh=1&nanoTrace=1')).toEqual({ fresh: true, url: '/canvas.html?nanoTrace=1' });
    expect(s.getItem(BEFORE_FRESH_KEY)).toBe(THREE);
    expect(s.getItem(CANVAS_STORAGE_KEY)).toBeNull();
    expect(s.getItem(DEVICES_BOARD_KEY)).toBeNull();
  });
  it('?fresh runs in a row keep the original layout (later copies rotate)', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: THREE });
    startFresh(s, CANVAS_STORAGE_KEY);
    for (const t of ['Two', 'Three', 'Four']) { s.setItem(CANVAS_STORAGE_KEY, layoutOf(t)); expect(startFresh(s, CANVAS_STORAGE_KEY)).toBe(true); }
    expect(FRESH_SLOTS.map((k) => s.getItem(k))).toEqual([THREE, layoutOf('Four'), layoutOf('Three')]);
    // a blank layout is not worth a copy and never replaces one
    s.setItem(CANVAS_STORAGE_KEY, BLANK);
    startFresh(s, CANVAS_STORAGE_KEY);
    expect(FRESH_SLOTS.map((k) => s.getItem(k))).toEqual([THREE, layoutOf('Four'), layoutOf('Three')]);
  });
  it('an unreadable layout under ?fresh goes to the unreadable copy, not lost', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: 'not json {' });
    expect(startFresh(s, CANVAS_STORAGE_KEY)).toBe(true);
    expect(s.getItem(UNREADABLE_KEY)).toBe('not json {');
  });
  it('a failed copy: nothing is cleared and the open is NOT fresh', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: THREE });
    s.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(openFresh(s, 'https://x.web.app/canvas.html?fresh=1')).toEqual({ fresh: false, url: '/canvas.html' });
    expect(s.getItem(CANVAS_STORAGE_KEY)).toBe(THREE);
  });
  it('no ?fresh: nothing happens; a reload of the stripped address is not fresh', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: THREE });
    expect(openFresh(s, 'https://x.web.app/canvas.html?nanoTrace=1')).toEqual({ fresh: false, url: null });
    expect(s.getItem(CANVAS_STORAGE_KEY)).toBe(THREE);
    expect(withoutFresh('https://x.web.app/canvas.html?fresh=1#a')).toBe('/canvas.html#a');
    const open = openFresh(s, 'https://x.web.app/canvas.html?fresh=1&sim=1');
    s.setItem(CANVAS_STORAGE_KEY, layoutOf('Built in the fresh session'));
    expect(openFresh(s, `https://x.web.app${open.url}`).fresh).toBe(false);
    expect(loadLayout(s, CANVAS_STORAGE_KEY, quiet).layout!.frames[0].title).toBe('Built in the fresh session');
  });
});

describe('a store that could not be read is never written over', () => {
  const rect = { x: 0, y: 0, w: 1000, h: 680 };
  const layout = { version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: 'f1', frames: [{ id: 'f1', kind: 'room' as const, title: 'Desk', rect, pinned: false }] };
  // What the canvas opens when the read failed: the layout's frames, empty.
  const doc = { version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: 'f1', frames: layout.frames, surfaces: { f1: { kind: 'plan' as const, title: 'Floor plan', tiles: [{ type: 'plan' as const, boardId: 'f1-cad', template: 'blank' as const }] } } };
  const targets = (storeBlocked: boolean) => {
    const puts: string[] = []; const removes: string[] = []; const layoutWrites: string[] = [];
    return { puts, removes, layoutWrites, t: {
      layoutStorage: { setItem: (_k: string, v: string) => { layoutWrites.push(v); } },
      store: { put: async (a: { id: string }) => { puts.push(a.id); }, remove: async (id: string) => { removes.push(id); } },
      layoutBlocked: false, storeBlocked,
    } };
  };
  it('read failed: an edit (a plan on the "empty" board) puts, removes and lays out nothing', () => {
    const x = targets(true);
    const out = saveCanvasDoc(doc as never, [], () => 'person', 1, new Set(), x.t);
    expect(out).toEqual([]);
    expect([x.puts, x.removes, x.layoutWrites]).toEqual([[], [], []]);
    expect(STORE_SAVE_OFF_LINE).toBe('Changes in this session won’t be saved. Reload to try again.');
  });
  it('read fine: the same save writes the board and the layout', () => {
    const x = targets(false);
    saveCanvasDoc(doc as never, [], () => 'person', 1, new Set(), x.t);
    expect(x.puts).toEqual(['board-f1']);
    expect(x.layoutWrites).toHaveLength(1);
  });
  it('read failed: every layout frame id is reserved, so no new board takes an unread board’s id', () => {
    expect(reservedIds({ keepIds: [], loaded: [], readFailed: true, layout: coerceLayout(layout) }).sort()).toEqual(['f1']);
    expect(reservedIds({ keepIds: [], loaded: [], readFailed: false, layout: coerceLayout(layout) })).toEqual([]);
    expect(reservedIds({ keepIds: ['board-f7'], loaded: [], readFailed: false, layout: null })).toEqual(['f7']);
  });
});

describe('a test build’s ?fresh copies the stored artifacts aside before clearing them', () => {
  const rows = [{ id: 'board-f1', kind: 'board' }];
  const store = (list: () => Promise<unknown[]>) => { const s = { cleared: false, list, clear: async () => { s.cleared = true; } }; return s; };
  it('copies, then clears; the first copy is kept for good', async () => {
    const st = memStorage();
    const a = store(async () => rows);
    expect(await clearStoreForFresh(a, st)).toBe(true);
    expect(a.cleared).toBe(true);
    expect(JSON.parse(st.getItem(BEFORE_FRESH_ARTIFACTS_KEY)!)).toEqual(rows);
    const b = store(async () => [{ id: 'board-f2' }]);
    await clearStoreForFresh(b, st);
    expect(JSON.parse(st.getItem(BEFORE_FRESH_ARTIFACTS_KEY)!)).toEqual(rows);
    expect(JSON.parse(st.getItem(`${BEFORE_FRESH_ARTIFACTS_KEY}.2`)!)).toEqual([{ id: 'board-f2' }]);
  });
  it('a failed read or copy clears nothing', async () => {
    const a = store(async () => { throw new Error('blocked'); });
    expect(await clearStoreForFresh(a, memStorage())).toBe(false);
    expect(a.cleared).toBe(false);
    const full = memStorage(); full.setItem = () => { throw new Error('QuotaExceededError'); };
    const b = store(async () => rows);
    expect(await clearStoreForFresh(b, full)).toBe(false);
    expect(b.cleared).toBe(false);
  });
});
