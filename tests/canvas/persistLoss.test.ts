// Saved boards are never lost: a doc with every kind of board the app makes
// round-trips through save → reload; ?fresh=1 copies the saved doc aside and
// leaves the address bar; a doc this build can't read is copied aside (never
// overwritten) and the canvas says so once; a repaired doc is copied aside
// first; the devices-board marker lives in the doc, so a stale one can never
// turn her dashboard into the devices list. (The canvas wiring itself is
// driven end to end by scripts/e2e-persist.mjs.)
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCanvasDoc, parseCanvasDocReport, type CanvasDoc } from '../../src/canvas/frames';
import {
  BEFORE_FRESH_KEY, BEFORE_REPAIR_KEY, CANVAS_STORAGE_KEY, FRESH_SLOTS, REPAIR_SLOTS, LEGACY_DEVICES_BOARD_KEY, MAX_UNREADABLE,
  UNREADABLE_KEY, UNREADABLE_LINE, UNSAVED_LINE,
  SAVE_FULL_LINE, STORAGE_QUOTA_CHARS, createSaveFailNotice, freeChars,
  keepUnreadable, loadCanvasDoc, loadLine, openFresh, resolveDevicesBoard, startFresh, withoutFresh,
} from '../../src/canvas/canvasStore';
import { initialDoc } from '../../src/canvas/firstOpen';
import { connectedDevicesPlan, isDevicesPlan } from '../../src/canvas/connectedDevices';
import { createDismissals } from '../../src/canvas/roomRebuild';
import { canKeepPlanDrawing, storedDrawings } from '../../src/canvas/planDocs';

/** Saved by a real ?sim=1 run: Connected devices, a dashboard with lamps +
 *  speaker + gimbal + connect, a floor plan with a reviewed edit (Study), the
 *  Kannada pack on. */
const ALL_BOARDS = readFileSync(new URL('./fixtures/savedCanvasAllBoards.json', import.meta.url), 'utf8');

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
const seedDoc = (): CanvasDoc => { throw new Error('no seed here'); };
const blankDoc = JSON.stringify({ version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: [], surfaces: {} });
const oneBoard = (title: string) => JSON.stringify({ version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: [{ id: 'f1', kind: 'note', title, rect: { x: 0, y: 0, w: 10, h: 10 }, pinned: false }], surfaces: {} });

describe('every board kind survives save → reload', () => {
  const doc = JSON.parse(ALL_BOARDS) as CanvasDoc;
  it('the fixture really holds every kind', () => {
    expect(doc.frames.map((f) => f.title)).toEqual(['Connected devices', 'Living room', 'Floor plan']);
    const dash = JSON.stringify(doc.surfaces.f2);
    for (const t of ['"lamp"', '"music"', '"gimbal"', '"connect"']) expect(dash).toContain(t);
    expect(JSON.stringify(doc.drawings)).toContain('Study'); // the reviewed plan edit
    expect(doc.pack?.lang).toBe('kn');
    expect(doc.devicesBoard).toBe('f1');
  });
  it('loads back exactly as saved (no repair), and saving that again changes nothing', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: ALL_BOARDS });
    const loaded = loadCanvasDoc(s, CANVAS_STORAGE_KEY, quiet);
    expect(loaded.unreadable).toBe(false);
    expect(loaded.repaired).toBeUndefined();
    expect(s.getItem(BEFORE_REPAIR_KEY)).toBeNull();
    expect(loaded.doc!.frames).toEqual(doc.frames);
    expect(loaded.doc!.surfaces).toEqual(doc.surfaces);
    expect(loaded.doc!.drawings).toEqual(doc.drawings);
    expect(loaded.doc!.pack).toEqual(doc.pack);
    expect(loaded.doc!.devicesBoard).toBe('f1');
    const again = loadCanvasDoc(memStorage({ [CANVAS_STORAGE_KEY]: JSON.stringify(loaded.doc) }), CANVAS_STORAGE_KEY, quiet);
    expect(again.doc).toEqual(loaded.doc);
    expect(initialDoc(loaded.doc, { fresh: true }, seedDoc)).toBe(loaded.doc);
  });
  it('a board received from the laptop keeps that mark across a reload', () => {
    const d = JSON.parse(ALL_BOARDS);
    d.frames[2].from = 'laptop';
    expect(parseCanvasDoc(d)!.frames[2].from).toBe('laptop');
    expect(parseCanvasDoc(JSON.parse(ALL_BOARDS))!.frames[2]).not.toHaveProperty('from');
  });
  it('what she took off a board survives too (kept beside the doc)', () => {
    const d = createDismissals({ f2: ['speaker-1'] });
    const back = createDismissals(JSON.parse(JSON.stringify(d.toJSON((id) => doc.frames.some((f) => f.id === id)))));
    expect(back.toJSON(() => true)).toEqual({ f2: ['speaker-1'] });
  });
});

describe('a repaired doc is copied aside first, and the repair is named', () => {
  const doc = JSON.parse(ALL_BOARDS);
  const slip = JSON.stringify({ ...doc, camera: { x: 0, y: 0, z: 0.01 }, focusId: 'f9', surfaces: { ...doc.surfaces, f9: doc.surfaces.f2, f2b: { kind: 'room', title: 'x', tiles: [] } } });
  it('her boards load; what was repaired is listed', () => {
    const r = parseCanvasDocReport(JSON.parse(slip));
    expect(r.doc!.frames).toEqual(doc.frames);
    expect(Object.keys(r.doc!.surfaces)).toEqual(['f1', 'f2', 'f3']);
    expect(r.doc!.focusId).toBeNull();
    expect(r.doc!.camera.z).toBeGreaterThanOrEqual(0.1);
    expect(r.repaired).toEqual(expect.arrayContaining(['camera', 'focus', 'plan for missing board f9', 'plan for missing board f2b']));
  });
  it('the raw text goes under beforeRepair once (never overwritten) and is logged', () => {
    const logs: string[] = [];
    const s = memStorage({ [CANVAS_STORAGE_KEY]: slip });
    const loaded = loadCanvasDoc(s, CANVAS_STORAGE_KEY, (l) => logs.push(l));
    expect(loaded.doc).not.toBeNull();
    expect(loaded.repaired).toContain('camera');
    expect(s.getItem(BEFORE_REPAIR_KEY)).toBe(slip);
    expect(logs[0]).toMatch(/repaired on load: .*camera/);
    s.setItem(CANVAS_STORAGE_KEY, JSON.stringify({ ...doc, focusId: 'nope' }));
    loadCanvasDoc(s, CANVAS_STORAGE_KEY, quiet);
    expect(s.getItem(BEFORE_REPAIR_KEY)).toBe(slip);
  });
  it('a second, different repaired doc gets its own slot (cap 3, the first kept for good)', () => {
    const logs: string[] = [];
    const s = memStorage({ [CANVAS_STORAGE_KEY]: slip });
    loadCanvasDoc(s, CANVAS_STORAGE_KEY, quiet);
    const second = JSON.stringify({ ...doc, focusId: 'nope' });
    s.setItem(CANVAS_STORAGE_KEY, second);
    loadCanvasDoc(s, CANVAS_STORAGE_KEY, (l) => logs.push(l));
    expect(s.getItem(BEFORE_REPAIR_KEY)).toBe(slip);
    expect(s.getItem(REPAIR_SLOTS[1])).toBe(second);
    expect(logs[0]).toContain(REPAIR_SLOTS[1]);
    expect(logs[0]).not.toContain(`under ${BEFORE_REPAIR_KEY})`);
    const third = JSON.stringify({ ...doc, focusId: 'nope2' });
    s.setItem(CANVAS_STORAGE_KEY, third);
    loadCanvasDoc(s, CANVAS_STORAGE_KEY, quiet);
    const fourth = JSON.stringify({ ...doc, focusId: 'nope3' });
    s.setItem(CANVAS_STORAGE_KEY, fourth);
    loadCanvasDoc(s, CANVAS_STORAGE_KEY, quiet);
    expect(REPAIR_SLOTS.map((k) => s.getItem(k))).toEqual([slip, fourth, third]);
    expect([...s.m.keys()].filter((k) => k.startsWith(BEFORE_REPAIR_KEY))).toHaveLength(3);
  });
  it('a rotating copy is skipped when it would leave less than ~2x the doc free (the first copy is still made)', () => {
    const logs: string[] = [];
    const filler = 'x'.repeat(STORAGE_QUOTA_CHARS - slip.length * 4);
    const s = memStorage({ [CANVAS_STORAGE_KEY]: slip, filler });
    loadCanvasDoc(s, CANVAS_STORAGE_KEY, quiet);
    expect(s.getItem(BEFORE_REPAIR_KEY)).toBe(slip); // slot 1: always
    const second = JSON.stringify({ ...doc, focusId: 'nope' });
    s.setItem(CANVAS_STORAGE_KEY, second);
    loadCanvasDoc(s, CANVAS_STORAGE_KEY, (l) => logs.push(l));
    expect(s.getItem(REPAIR_SLOTS[1])).toBeNull();
    expect(logs[0]).toMatch(/could not be kept/);
    expect(freeChars(s)).toBeLessThan(3 * slip.length);
    expect(freeChars({ getItem: () => null, setItem: () => undefined })).toBe(Infinity);
  });
  it('a failed main save is said once, and again only after a save worked', () => {
    const n = createSaveFailNotice();
    expect(n.after(true)).toBeNull();
    expect(n.after(false)).toBe(SAVE_FULL_LINE);
    expect(n.after(false)).toBeNull();
    expect(n.after(true)).toBeNull();
    expect(n.after(false)).toBe(SAVE_FULL_LINE);
    expect(SAVE_FULL_LINE).toBe('Couldn’t save your boards — storage is full.');
  });
  it('never claims a copy it could not make', () => {
    const logs: string[] = [];
    const s = memStorage({ [CANVAS_STORAGE_KEY]: slip, [BEFORE_REPAIR_KEY]: 'older text' });
    const ro = { ...s, getItem: s.getItem, setItem: (k: string, v: string) => { if (k === CANVAS_STORAGE_KEY) s.setItem(k, v); else throw new Error('quota'); } };
    loadCanvasDoc(ro, CANVAS_STORAGE_KEY, (l) => logs.push(l));
    expect(logs[0]).toMatch(/repaired on load/);
    expect(logs[0]).not.toMatch(/kept under/);
    expect(logs[0]).toMatch(/could not be kept/);
  });
  it('the saver keeps the loader rules (id, at most 8 plans): a saved doc loads with no repair', () => {
    expect(canKeepPlanDrawing([], 'plan-1')).toBe(true);
    expect(canKeepPlanDrawing([], 'BAD ID')).toBe(false);
    const eight = Array.from({ length: 8 }, (_, i) => `p${i}`);
    expect(canKeepPlanDrawing(eight, 'p9')).toBe(false);
    expect(canKeepPlanDrawing(eight, 'p3')).toBe(true); // a redraw of one already kept
    const d = JSON.parse(ALL_BOARDS);
    const one = d.drawings.f3['f3-cad'];
    const ids = [...Array.from({ length: 9 }, (_, i) => `p${i}`), 'BAD ID'];
    const mem = { f3: Object.fromEntries(ids.map((id) => [id, one])) };
    const stored = storedDrawings(mem, { f3: ids });
    expect(Object.keys(stored.f3)).toEqual(eight);
    const r = parseCanvasDocReport({ ...d, drawings: stored });
    expect(r.repaired).toEqual([]);
  });
  it('a drawing coerceDrawings drops is listed among the repairs (and the raw text kept)', () => {
    const d = JSON.parse(ALL_BOARDS);
    d.drawings = { ...d.drawings, f9: { 'plan-1': { walls: [] } }, f3: { ...(d.drawings?.f3 ?? {}), 'BAD ID': { walls: [] } } };
    const raw = JSON.stringify(d);
    const r = parseCanvasDocReport(JSON.parse(raw));
    expect(r.repaired).toEqual(expect.arrayContaining(['drawings for missing board f9', 'drawing BAD ID on f3']));
    const s = memStorage({ [CANVAS_STORAGE_KEY]: raw });
    loadCanvasDoc(s, CANVAS_STORAGE_KEY, quiet);
    expect(s.getItem(BEFORE_REPAIR_KEY)).toBe(raw);
  });
});

describe('a doc this build cannot read is kept safe, never overwritten', () => {
  const unreadable = JSON.stringify({ ...JSON.parse(ALL_BOARDS), version: 2 });
  it('is copied aside before anything can write, and the line says so', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: unreadable });
    const loaded = loadCanvasDoc(s, CANVAS_STORAGE_KEY, quiet);
    expect(loaded).toEqual({ doc: null, unreadable: true, safe: true });
    expect(s.getItem(UNREADABLE_KEY)).toBe(unreadable);
    expect(loadLine(loaded)).toBe(UNREADABLE_LINE);
    expect(UNREADABLE_LINE).toBe('Couldn’t open your saved boards — they’re kept safe.');
    s.setItem(CANVAS_STORAGE_KEY, '{"version":1}'); // the canvas saves again…
    expect(s.getItem(UNREADABLE_KEY)).toBe(unreadable); // …the copy stays
  });
  it('a second, different unreadable doc never replaces the first copy', () => {
    const s = memStorage({ [UNREADABLE_KEY]: 'first' });
    expect(keepUnreadable(s, 'second', () => 42)).toBe(true);
    expect(s.getItem(UNREADABLE_KEY)).toBe('first');
    expect(s.getItem(`${UNREADABLE_KEY}.42`)).toBe('second');
    expect(keepUnreadable(s, 'first')).toBe(true);
    expect(keepUnreadable(s, 'second', () => 43)).toBe(true);
  });
  it(`keeps at most ${MAX_UNREADABLE}; past that nothing is added and the canvas won't save`, () => {
    const s = memStorage({ [UNREADABLE_KEY]: 'a', [`${UNREADABLE_KEY}.1`]: 'b', [`${UNREADABLE_KEY}.2`]: 'c', [CANVAS_STORAGE_KEY]: 'd {' });
    const loaded = loadCanvasDoc(s, CANVAS_STORAGE_KEY, quiet);
    expect(loaded).toEqual({ doc: null, unreadable: true, safe: false });
    expect([...s.m.keys()].filter((k) => k.startsWith(UNREADABLE_KEY))).toHaveLength(3);
    expect(loadLine(loaded)).toBe(UNSAVED_LINE);
  });
  it('when the copy cannot be made: not safe, and the line says this session won’t be saved', () => {
    const full = memStorage({ [CANVAS_STORAGE_KEY]: 'not json {' });
    full.setItem = (k: string, v: string) => { if (k !== CANVAS_STORAGE_KEY) throw new Error('QuotaExceededError'); full.m.set(k, v); };
    const loaded = loadCanvasDoc(full, CANVAS_STORAGE_KEY, quiet);
    expect(loaded).toEqual({ doc: null, unreadable: true, safe: false });
    expect(loadLine(loaded)).toBe('Couldn’t open your saved boards, and changes in this session won’t be saved.');
  });
  it('nothing saved is not "unreadable", and says nothing', () => {
    const loaded = loadCanvasDoc(memStorage(), CANVAS_STORAGE_KEY, quiet);
    expect(loaded).toEqual({ doc: null, unreadable: false, safe: true });
    expect(loadLine(loaded)).toBeNull();
  });
});

describe('?fresh=1 never just deletes her boards', () => {
  it('copies the saved doc aside, clears it and the old devices marker', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: ALL_BOARDS, [LEGACY_DEVICES_BOARD_KEY]: 'f1' });
    expect(openFresh(s, 'https://x.web.app/canvas.html?fresh=1&nanoTrace=1')).toEqual({ fresh: true, url: '/canvas.html?nanoTrace=1' });
    expect(s.getItem(BEFORE_FRESH_KEY)).toBe(ALL_BOARDS);
    expect(s.getItem(CANVAS_STORAGE_KEY)).toBeNull();
    expect(s.getItem(LEGACY_DEVICES_BOARD_KEY)).toBeNull();
  });
  it('?fresh runs in a row keep the original good doc (later copies rotate)', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: ALL_BOARDS });
    startFresh(s, CANVAS_STORAGE_KEY);
    for (const t of ['Two', 'Three', 'Four']) { s.setItem(CANVAS_STORAGE_KEY, oneBoard(t)); expect(startFresh(s, CANVAS_STORAGE_KEY)).toBe(true); }
    expect(s.getItem(FRESH_SLOTS[0])).toBe(ALL_BOARDS);
    expect(s.getItem(FRESH_SLOTS[1])).toBe(oneBoard('Four'));
    expect(s.getItem(FRESH_SLOTS[2])).toBe(oneBoard('Three'));
    // a blank doc is not worth a copy and never replaces one
    s.setItem(CANVAS_STORAGE_KEY, blankDoc);
    startFresh(s, CANVAS_STORAGE_KEY);
    expect(FRESH_SLOTS.map((k) => s.getItem(k))).toEqual([ALL_BOARDS, oneBoard('Four'), oneBoard('Three')]);
  });
  it('a failed copy: nothing is cleared and the open is NOT fresh (what she took off boards stays)', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: ALL_BOARDS });
    s.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(openFresh(s, 'https://x.web.app/canvas.html?fresh=1')).toEqual({ fresh: false, url: '/canvas.html' });
    expect(s.getItem(CANVAS_STORAGE_KEY)).toBe(ALL_BOARDS);
  });
  it('no ?fresh: nothing happens', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: ALL_BOARDS });
    expect(openFresh(s, 'https://x.web.app/canvas.html?nanoTrace=1')).toEqual({ fresh: false, url: null });
    expect(s.getItem(CANVAS_STORAGE_KEY)).toBe(ALL_BOARDS);
    expect(withoutFresh('https://x.web.app/canvas.html?fresh=1#a')).toBe('/canvas.html#a');
  });
  it('a reload after a ?fresh session opens what she built there', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: oneBoard('Old') });
    const open = openFresh(s, 'https://x.web.app/canvas.html?fresh=1&nanoTrace=1');
    expect(initialDoc(loadCanvasDoc(s, CANVAS_STORAGE_KEY, quiet).doc, { fresh: open.fresh }, seedDoc).frames).toEqual([]);
    s.setItem(CANVAS_STORAGE_KEY, ALL_BOARDS); // saved during the fresh session
    const reload = openFresh(s, `https://x.web.app${open.url}`); // the address no longer has fresh
    expect(reload.fresh).toBe(false);
    const doc = initialDoc(loadCanvasDoc(s, CANVAS_STORAGE_KEY, quiet).doc, { fresh: reload.fresh }, seedDoc);
    expect(doc.frames.map((f) => f.title)).toEqual(['Connected devices', 'Living room', 'Floor plan']);
  });
});

describe('the devices-board marker belongs to its doc', () => {
  const doc = parseCanvasDoc(JSON.parse(ALL_BOARDS))!;
  it('the id in the doc wins', () => {
    expect(resolveDevicesBoard(doc, 'f2')).toBe('f1');
  });
  it('an old key beside the doc is trusted only on the devices list itself', () => {
    const { devicesBoard: _gone, ...older } = doc;
    expect(resolveDevicesBoard(older, 'f1')).toBe('f1'); // f1 really is the devices list
    expect(resolveDevicesBoard(older, 'f2')).toBeNull(); // the dashboard: never
    expect(resolveDevicesBoard(older, null)).toBeNull();
    expect(resolveDevicesBoard(null, 'f1')).toBeNull();
    expect(isDevicesPlan(connectedDevicesPlan([{ device: 'Laptop', status: 'This canvas', ok: true }]))).toBe(true);
  });
  it('a marker for a frame that is not in the doc is dropped (and named as a repair)', () => {
    const r = parseCanvasDocReport({ ...JSON.parse(ALL_BOARDS), devicesBoard: 'f9' });
    expect(r.doc!.devicesBoard).toBeUndefined();
    expect(r.repaired).toContain('devices board');
  });
});
