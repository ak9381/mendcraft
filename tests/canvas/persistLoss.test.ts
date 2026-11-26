// Saved boards are never lost: a doc with every kind of board the app makes
// round-trips through save → reload; ?fresh=1 copies the saved doc aside and
// leaves the address bar; a doc this build can't read is copied aside (never
// overwritten) and the canvas says so once; the devices-board marker lives in
// the doc, so a stale one can never turn her dashboard into the devices list.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCanvasDoc, type CanvasDoc } from '../../src/canvas/frames';
import {
  BEFORE_FRESH_KEY, CANVAS_STORAGE_KEY, LEGACY_DEVICES_BOARD_KEY, UNREADABLE_KEY, UNREADABLE_LINE,
  keepUnreadable, loadCanvasDoc, startFresh, withoutFresh,
} from '../../src/canvas/canvasStore';
import { initialDoc } from '../../src/canvas/firstOpen';
import { connectedDevicesPlan, isDevicesPlan } from '../../src/canvas/connectedDevices';
import { createDismissals } from '../../src/canvas/roomRebuild';

const app = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../../src/canvas/canvasMain.ts', import.meta.url), 'utf8');
/** Saved by a real ?sim=1 run: Connected devices, a dashboard with lamps +
 *  speaker + gimbal + connect, a floor plan with a reviewed edit (Study), the
 *  Kannada pack on. */
const ALL_BOARDS = readFileSync(new URL('./fixtures/savedCanvasAllBoards.json', import.meta.url), 'utf8');

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
  };
}
const seedDoc = (): CanvasDoc => { throw new Error('no seed here'); };

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
  it('loads back exactly as saved, and saving that again changes nothing', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: ALL_BOARDS });
    const loaded = loadCanvasDoc(s, CANVAS_STORAGE_KEY);
    expect(loaded.unreadable).toBe(false);
    expect(loaded.doc).toEqual(parseCanvasDoc(doc));
    expect(loaded.doc!.frames).toEqual(doc.frames);
    expect(loaded.doc!.surfaces).toEqual(doc.surfaces);
    expect(loaded.doc!.drawings).toEqual(doc.drawings);
    expect(loaded.doc!.pack).toEqual(doc.pack);
    expect(loaded.doc!.devicesBoard).toBe('f1');
    // reload → save → reload is a fixed point
    const again = loadCanvasDoc(memStorage({ [CANVAS_STORAGE_KEY]: JSON.stringify(loaded.doc) }), CANVAS_STORAGE_KEY);
    expect(again.doc).toEqual(loaded.doc);
    // the stored doc wins over ?fresh / seed / Board 1 on the next open
    expect(initialDoc(loaded.doc, { fresh: true }, seedDoc)).toBe(loaded.doc);
  });
  it('what she took off a board survives too (kept beside the doc)', () => {
    const d = createDismissals({ f2: ['speaker-1'] });
    const back = createDismissals(JSON.parse(JSON.stringify(d.toJSON((id) => doc.frames.some((f) => f.id === id)))));
    expect(back.toJSON(() => true)).toEqual({ f2: ['speaker-1'] });
  });
  it('a harmless slip is repaired, never a reason to drop her boards', () => {
    const slip = { ...doc, camera: { x: 0, y: 0, z: 0.01 }, focusId: 'f9', surfaces: { ...doc.surfaces, f9: doc.surfaces.f2, f2b: { kind: 'room', title: 'x', tiles: [] } } };
    const out = parseCanvasDoc(JSON.parse(JSON.stringify(slip)))!;
    expect(out.frames).toEqual(doc.frames);
    expect(Object.keys(out.surfaces)).toEqual(['f1', 'f2', 'f3']);
    expect(out.focusId).toBeNull();
    expect(out.camera.z).toBeGreaterThanOrEqual(0.1);
  });
});

describe('a doc this build cannot read is kept safe, never overwritten', () => {
  const unreadable = JSON.stringify({ ...JSON.parse(ALL_BOARDS), version: 2 });
  it('is copied aside before anything can write, and said once', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: unreadable });
    const loaded = loadCanvasDoc(s, CANVAS_STORAGE_KEY);
    expect(loaded).toEqual({ doc: null, unreadable: true, safe: true });
    expect(s.getItem(UNREADABLE_KEY)).toBe(unreadable);
    // the canvas then saves its new doc over the main key — the copy stays
    s.setItem(CANVAS_STORAGE_KEY, '{"version":1}');
    expect(s.getItem(UNREADABLE_KEY)).toBe(unreadable);
    expect(UNREADABLE_LINE).toBe('Couldn’t open your saved boards — they’re kept safe.');
    expect(app).toMatch(/if \(loaded\.unreadable\) setTimeout\(\(\) => say\(UNREADABLE_LINE/);
  });
  it('a second, different unreadable doc never replaces the first copy', () => {
    const s = memStorage({ [UNREADABLE_KEY]: 'first' });
    expect(keepUnreadable(s, 'second', () => 42)).toBe(true);
    expect(s.getItem(UNREADABLE_KEY)).toBe('first');
    expect(s.getItem(`${UNREADABLE_KEY}.42`)).toBe('second');
    expect(keepUnreadable(s, 'first')).toBe(true); // the same text: already kept
    expect([...s.m.keys()].filter((k) => k.startsWith(UNREADABLE_KEY))).toHaveLength(2);
  });
  it('when the copy cannot be made, the canvas never writes the main key', () => {
    const full = memStorage({ [CANVAS_STORAGE_KEY]: 'not json {' });
    full.setItem = (k: string, v: string) => { if (k !== CANVAS_STORAGE_KEY) throw new Error('QuotaExceededError'); full.m.set(k, v); };
    const loaded = loadCanvasDoc(full, CANVAS_STORAGE_KEY);
    expect(loaded).toEqual({ doc: null, unreadable: true, safe: false });
    expect(app).toMatch(/const saveBlocked = !loaded\.safe;/);
    expect(app).toMatch(/const ok = !saveBlocked && tryWriteStorage\(storage, STORAGE_KEY/);
  });
  it('nothing saved is not "unreadable"', () => {
    expect(loadCanvasDoc(memStorage(), CANVAS_STORAGE_KEY)).toEqual({ doc: null, unreadable: false, safe: true });
  });
});

describe('?fresh=1 never just deletes her boards', () => {
  it('copies the saved doc aside, clears it and the old devices marker', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: ALL_BOARDS, [LEGACY_DEVICES_BOARD_KEY]: 'f1' });
    expect(startFresh(s, CANVAS_STORAGE_KEY, [LEGACY_DEVICES_BOARD_KEY])).toBe(true);
    expect(s.getItem(BEFORE_FRESH_KEY)).toBe(ALL_BOARDS);
    expect(s.getItem(CANVAS_STORAGE_KEY)).toBeNull();
    expect(s.getItem(LEGACY_DEVICES_BOARD_KEY)).toBeNull();
    // a blank doc never replaces the copy of one with boards
    s.setItem(CANVAS_STORAGE_KEY, JSON.stringify({ version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: [], surfaces: {} }));
    startFresh(s, CANVAS_STORAGE_KEY);
    expect(s.getItem(BEFORE_FRESH_KEY)).toBe(ALL_BOARDS);
  });
  it('clears nothing when the copy fails', () => {
    const s = memStorage({ [CANVAS_STORAGE_KEY]: ALL_BOARDS });
    s.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(startFresh(s, CANVAS_STORAGE_KEY)).toBe(false);
    expect(s.getItem(CANVAS_STORAGE_KEY)).toBe(ALL_BOARDS);
  });
  it('leaves the address bar, so a reload after a ?fresh session opens what she built', () => {
    expect(withoutFresh('https://x.web.app/canvas.html?fresh=1&nanoTrace=1#a')).toBe('/canvas.html?nanoTrace=1#a');
    expect(withoutFresh('https://x.web.app/canvas.html?nanoTrace=1')).toBeNull();
    expect(main).toMatch(/startFresh\(localStorage, CANVAS_STORAGE_KEY, \[LEGACY_DEVICES_BOARD_KEY\]\);\s*const next = withoutFresh\(location\.href\);\s*if \(next\) history\.replaceState/);
    expect(main).not.toMatch(/localStorage\.removeItem\('mc\.canvas\.v1'\)/);
    // the reload: what the ?fresh session saved is what opens
    const s = memStorage();
    s.setItem(CANVAS_STORAGE_KEY, ALL_BOARDS); // saved during the fresh session
    const reload = loadCanvasDoc(s, CANVAS_STORAGE_KEY);
    expect(initialDoc(reload.doc, {}, seedDoc).frames.map((f) => f.title)).toEqual(['Connected devices', 'Living room', 'Floor plan']);
  });
});

describe('the devices-board marker belongs to its doc', () => {
  it('an old marker beside the doc is trusted only on the devices list itself', () => {
    expect(isDevicesPlan(connectedDevicesPlan([{ device: 'Laptop', status: 'This canvas', ok: true }]))).toBe(true);
    expect(isDevicesPlan({ kind: 'room', title: 'Dashboard', tiles: [{ type: 'lamp', deviceId: 'wiz-lamp-1', label: 'Lamp' }] })).toBe(false);
    expect(isDevicesPlan(undefined)).toBe(false);
    expect(app).toMatch(/devicesFrame = stored\.devicesBoard \?\? \(legacy && isDevicesPlan\(stored\.surfaces\[legacy\]\) \? legacy : null\);/);
    expect(app).not.toMatch(/storage\.setItem\(DEVICES_BOARD_KEY/);
  });
  it('a marker for a frame that is not in the doc is dropped', () => {
    const d = JSON.parse(ALL_BOARDS);
    expect(parseCanvasDoc({ ...d, devicesBoard: 'f9' })!.devicesBoard).toBeUndefined();
  });
});
