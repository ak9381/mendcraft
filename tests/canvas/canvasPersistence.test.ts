import { describe, expect, it } from 'vitest';
import { coerceLayout, joinCanvasDoc, splitCanvasDoc, type CanvasLayout } from '../../src/canvas/canvasPersistence';
import { CANVAS_DOC_VERSION, type CanvasDoc } from '../../src/canvas/frames';
import { LANG_STRING_KEYS } from '../../src/canvas/languagePack';
import type { Artifact } from '../../src/artifacts/artifact';
import { board } from '../artifacts/sample';

const DRAWING = { walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 3, y: 0 }, thickness: 0.1 }], openings: [], rooms: [], dims: [], fixtures: [], texts: [], selectedId: null, selectedIds: [] };

function doc(): CanvasDoc {
  return {
    version: CANVAS_DOC_VERSION, camera: { x: 10, y: 20, z: 1 }, focusId: 'f2',
    frames: [
      { id: 'f1', kind: 'room', title: 'Desk', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: true },
      { id: 'f2', kind: 'plan', title: 'Floor plan', rect: { x: 1160, y: 0, w: 1000, h: 680 }, pinned: false },
      { id: 'f3', kind: 'note', title: 'Board 3', rect: { x: 2320, y: 0, w: 1000, h: 680 }, pinned: false },
    ],
    surfaces: {
      f1: { kind: 'room', title: 'Desk', tiles: [{ type: 'stat', label: 'Temperature', value: '21 °C' }] },
      f2: { kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'f2-cad', template: 'studio' }] },
    },
    drawings: { f2: { 'f2-cad': DRAWING } },
    lang: 'kn',
    pack: { lang: 'kn', strings: Object.fromEntries(LANG_STRING_KEYS.map((k) => [k, 'ಉಳಿಸು'])), phrases: {} },
  };
}
const by = () => 'gemini' as const;

describe('canvasPersistence', () => {
  it('split then join gives back the same CanvasDoc', () => {
    const d = doc();
    const { layout, put, remove } = splitCanvasDoc(d, [], by, 5000);
    expect(remove).toEqual([]);
    expect(put.map((a) => a.id).sort()).toEqual(['board-f1', 'board-f2', 'pack-kn', 'plan-f2-f2-cad']);
    expect(put.every((a) => a.v === 1 && a.at === 5000 && a.by === 'gemini' && a.status === 'approved')).toBe(true);
    // The layout holds no content: no surfaces, drawings or pack.
    expect(Object.keys(layout).sort()).toEqual(['camera', 'focusId', 'frames', 'lang', 'version']);
    const back = joinCanvasDoc(coerceLayout(JSON.parse(JSON.stringify(layout))), put);
    expect(back).toEqual(d);
  });

  it('join with no artifacts and no layout returns null', () => {
    expect(joinCanvasDoc(null, [])).toBeNull();
  });

  it('join appends a frame for a board artifact the layout does not know', () => {
    const layout: CanvasLayout = { version: CANVAS_DOC_VERSION, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: [{ id: 'f1', kind: 'note', title: 'Board 1', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: false }] };
    const out = joinCanvasDoc(layout, [board('f7', { title: 'Desk' })]);
    expect(out?.frames.map((f) => f.id)).toEqual(['f1', 'f7']);
    const f7 = out!.frames[1];
    expect(f7.rect.x).toBeGreaterThan(1000);
    expect(f7.title).toBe('Desk');
    expect(out!.surfaces.f7.tiles).toHaveLength(1);
    // Without any layout, the board still opens.
    expect(joinCanvasDoc(null, [board('f1')])?.frames.map((f) => f.id)).toEqual(['f1']);
  });

  it('split bumps v only for artifacts whose data changed', () => {
    const first = splitCanvasDoc(doc(), [], by, 1000).put;
    const d = doc();
    d.surfaces.f1 = { kind: 'room', title: 'Desk', tiles: [{ type: 'stat', label: 'Temperature', value: '22 °C' }] };
    const second = splitCanvasDoc(d, first, () => 'person', 2000);
    expect(second.put.map((a) => [a.id, a.v, a.by])).toEqual([['board-f1', 2, 'person']]);
    // A board closed since: its artifacts are removed.
    const d3 = doc();
    d3.frames = d3.frames.filter((f) => f.id !== 'f2');
    delete d3.surfaces.f2; delete d3.drawings; d3.focusId = null;
    const third = splitCanvasDoc(d3, first, by, 3000);
    expect(third.remove.sort()).toEqual(['board-f2', 'plan-f2-f2-cad']);
  });

  it('join returns null when parseCanvasDoc refuses the result', () => {
    const tooMany: Artifact[] = Array.from({ length: 41 }, (_, i) => board(`f${i + 1}`));
    expect(joinCanvasDoc(null, tooMany)).toBeNull();
  });

  it('coerceLayout refuses a layout with a bad camera and keeps only layout fields', () => {
    expect(coerceLayout({ version: 1, camera: { x: 0, y: 0, z: 99 }, focusId: null, frames: [] })).toBeNull();
    expect(coerceLayout('nope')).toBeNull();
    const l = coerceLayout({ version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: [], surfaces: { x: 1 }, lang: 'kn' });
    expect(l).toEqual({ version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: [], lang: 'kn' });
  });
});
