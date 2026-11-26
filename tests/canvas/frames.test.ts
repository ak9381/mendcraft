import { describe, expect, it } from 'vitest';
import { CANVAS_DOC_VERSION, FRAME_GAP, FRAME_SIZE, createFrameRegistry, parseCanvasDoc, type CanvasDoc } from '../../src/canvas/frames';

describe('frame registry', () => {
  it('adds frames to the right of the last one without overlap', () => {
    const r = createFrameRegistry();
    const a = r.add('room', 'Living room');
    const b = r.add('plan', 'Floor plan');
    expect(a.rect).toEqual({ x: 0, y: 0, ...FRAME_SIZE });
    expect(b.rect.x).toBe(a.rect.x + a.rect.w + FRAME_GAP);
    expect(r.list().map((f) => f.id)).toEqual([a.id, b.id]);
  });

  it('gives unique ids and titles are trimmed, markup-free and capped', () => {
    const r = createFrameRegistry();
    const a = r.add('room', '  <b>Den</b>  ');
    const b = r.add('room', 'x'.repeat(200));
    expect(a.id).not.toBe(b.id);
    expect(a.title).toBe('bDen/b');
    expect(b.title.length).toBeLessThanOrEqual(60);
  });

  it('renames, pins and removes', () => {
    const r = createFrameRegistry();
    const a = r.add('room', 'One');
    r.rename(a.id, 'Bedroom');
    r.setPinned(a.id, true);
    expect(r.get(a.id)).toMatchObject({ title: 'Bedroom', pinned: true });
    expect(r.remove(a.id)).toBe(true);
    expect(r.list()).toEqual([]);
    expect(r.remove('nope')).toBe(false);
  });

  it('serialises and restores identically (reload survives)', () => {
    const r = createFrameRegistry();
    r.add('room', 'Living room');
    r.add('plan', 'Floor plan');
    const doc: CanvasDoc = { version: CANVAS_DOC_VERSION, camera: { x: -10, y: 4, z: 0.4 }, focusId: null, frames: r.list(), surfaces: {} };
    const json = JSON.stringify(doc);
    const back = parseCanvasDoc(JSON.parse(json));
    expect(back).toEqual(doc);
    const r2 = createFrameRegistry(back!.frames);
    expect(r2.list()).toEqual(r.list());
    expect(r2.add('note', 'Next').id).not.toBe(r.list()[1].id);
  });

  it('refuses a corrupt or foreign document instead of half-loading it', () => {
    expect(parseCanvasDoc(null)).toBeNull();
    expect(parseCanvasDoc({ version: 99, camera: { x: 0, y: 0, z: 1 }, frames: [], focusId: null })).toBeNull();
    expect(parseCanvasDoc({ version: 1, camera: { x: 0, y: 0, z: 1 }, frames: [{ id: 'a', kind: 'evil', title: 't', rect: { x: 0, y: 0, w: 1, h: 1 } }], focusId: null })).toBeNull();
  });
  it('repairs a harmless slip instead of refusing her boards (camera, focus)', () => {
    expect(parseCanvasDoc({ version: 1, camera: { x: 0, y: 0, z: 'big' }, frames: [], focusId: null })!.camera).toEqual({ x: 0, y: 0, z: 1 });
    expect(parseCanvasDoc({ version: 1, camera: { x: 5, y: 6, z: 9 }, frames: [], focusId: null })!.camera).toEqual({ x: 5, y: 6, z: 2 });
    expect(parseCanvasDoc({ version: 1, camera: { x: 0, y: 0, z: 1 }, frames: [], focusId: 'ghost' })!.focusId).toBeNull();
  });
});

describe('canvas doc surfaces', () => {
  const base = { version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: [{ id: 'f1', kind: 'room', title: 'Den', rect: { x: 0, y: 0, w: 10, h: 10 }, pinned: false }] };
  it('keeps a valid surface plan per frame and defaults to none', () => {
    expect(parseCanvasDoc(base)!.surfaces).toEqual({});
    const plan = { kind: 'room', title: 'Den', tiles: [{ type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' }] };
    expect(parseCanvasDoc({ ...base, surfaces: { f1: plan } })!.surfaces.f1).toEqual(plan);
  });
  it('leaves out a plan whose board is gone; refuses a forged tile', () => {
    expect(parseCanvasDoc({ ...base, surfaces: { ghost: { kind: 'room', title: 'x', tiles: [] } } })!.surfaces).toEqual({});
    expect(parseCanvasDoc({ ...base, surfaces: { f1: { kind: 'room', title: 'x', tiles: [{ type: 'EvilScript' }] } } })).toBeNull();
  });
});
