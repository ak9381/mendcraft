import { describe, expect, it } from 'vitest';
import { coerceLayout, joinCanvasDoc, splitCanvasDoc, tooManyBoardsWhy, unjoinedIds, type CanvasLayout } from '../../src/canvas/canvasPersistence';
import { emptyDoc } from '../../src/canvas/firstOpen';
import { createFrameRegistry } from '../../src/canvas/frames';
import { frameIdOfArtifactId } from '../../src/artifacts/artifact';
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
    expect(put.map((a) => a.id).sort()).toEqual(['board-f1', 'board-f2', 'pack-kn', 'plan-2-f2-f2-cad']);
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
    expect(third.remove.sort()).toEqual(['board-f2', 'plan-2-f2-f2-cad']);
  });

  it('a move, rename or pin keeps the stored maker; only a content change takes a new one', () => {
    // Stored by an engine (or a laptop, on a phone) in an earlier session.
    const stored = splitCanvasDoc(doc(), [], () => 'replay', 1000).put;
    const fresh = () => joinCanvasDoc(null, stored)!; // after a reload: no history, no memory
    const her = () => 'person' as const;
    const moved = fresh();
    moved.frames = moved.frames.map((f) => (f.id === 'f1' ? { ...f, rect: { ...f.rect, x: 400 }, title: 'Study', pinned: false } : f));
    const out = splitCanvasDoc(moved, stored, her, 2000).put;
    expect(out.map((a) => [a.id, a.v, a.by])).toEqual([['board-f1', 2, 'replay']]);
    // Her own content edit after the reload: hers.
    const edited = fresh();
    edited.surfaces.f1 = { kind: 'room', title: 'Desk', tiles: [{ type: 'stat', label: 'Temperature', value: '19 °C' }] };
    expect(splitCanvasDoc(edited, stored, her, 3000).put.map((a) => [a.id, a.by])).toEqual([['board-f1', 'person']]);
    // A drawing changed by hand is hers too; an unchanged one keeps its maker.
    const drawn = fresh();
    drawn.drawings = { f2: { 'f2-cad': { ...DRAWING, walls: [] } } };
    expect(splitCanvasDoc(drawn, stored, her, 4000).put.map((a) => [a.id, a.by])).toEqual([['plan-2-f2-f2-cad', 'person']]);
  });

  it('join returns null when parseCanvasDoc refuses the result', () => {
    // A layout whose focus names a frame that is not there is refused whole.
    const bad = { version: CANVAS_DOC_VERSION, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: [{ id: 'F1', kind: 'note', title: 'x', rect: { x: 0, y: 0, w: 1, h: 1 }, pinned: false }] } as CanvasLayout;
    expect(joinCanvasDoc(bad, [board('f1')])).toBeNull();
  });

  it('41 stored boards: the 40 newest open (laid out oldest first), the oldest is reported, and a save removes nothing', () => {
    const stored: Artifact[] = Array.from({ length: 41 }, (_, i) => board(`f${i + 1}`, { at: 1000 + i }));
    const dropped: { id: string; why: string }[] = [];
    const doc = joinCanvasDoc(null, stored, (d) => dropped.push(d));
    expect(doc?.frames).toHaveLength(40);
    expect(dropped).toEqual([{ id: 'board-f1', why: tooManyBoardsWhy }]);
    expect(doc!.frames[0].id).toBe('f2');
    expect(doc!.frames.at(-1)!.id).toBe('f41');
    expect(doc!.frames[1].rect.x).toBeGreaterThan(doc!.frames[0].rect.x);
    const keep = unjoinedIds(doc, stored);
    expect([...keep]).toEqual(['board-f1']);
    const out = splitCanvasDoc(doc!, stored.filter((a) => !keep.has(a.id)), by, 9000, keep);
    expect(out.remove).toEqual([]);
    // Opened boards may get their new position stored; the closed one is untouched.
    expect(out.put.map((x) => x.id)).not.toContain('board-f1');
  });

  it('a refused document removes and overwrites nothing on the first save', () => {
    const stored: Artifact[] = [board('f1'), board('f2')];
    const keep = unjoinedIds(null, stored);
    expect([...keep].sort()).toEqual(['board-f1', 'board-f2']);
    // She opens a blank canvas and makes a board that reuses id f1.
    const d = emptyDoc();
    d.frames = [{ id: 'f1', kind: 'room', title: 'New', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: false }];
    d.surfaces = { f1: { kind: 'room', title: 'New', tiles: [{ type: 'stat', label: 'A', value: '1' }] } };
    const out = splitCanvasDoc(d, [], by, 9000, keep);
    expect(out.remove).toEqual([]);
    expect(out.put.map((a) => a.id)).not.toContain('board-f1');
  });

  it('coerceLayout refuses a layout with a bad camera and keeps only layout fields', () => {
    expect(coerceLayout({ version: 1, camera: { x: 0, y: 0, z: 99 }, focusId: null, frames: [] })).toBeNull();
    expect(coerceLayout('nope')).toBeNull();
    const l = coerceLayout({ version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: [], surfaces: { x: 1 }, lang: 'kn' });
    expect(l).toEqual({ version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: [], lang: 'kn' });
  });

  it('a refused document, then a new board: it gets a fresh id and its artifact is put', () => {
    const stored: Artifact[] = [board('f1'), board('f3')];
    const keep = unjoinedIds(null, stored);
    const reserved = [...keep].map(frameIdOfArtifactId).filter((x): x is string => !!x);
    const reg = createFrameRegistry([], reserved);
    const f = reg.add('room', 'New');
    expect(f.id).toBe('f4'); // past every kept id, never f1
    const d = emptyDoc();
    d.frames = reg.list();
    d.surfaces = { [f.id]: { kind: 'room', title: 'New', tiles: [{ type: 'stat', label: 'A', value: '1' }] } };
    const out = splitCanvasDoc(d, [], by, 9000, keep);
    expect(out.put.map((a) => a.id)).toEqual(['board-f4']);
    expect(out.remove).toEqual([]);
  });

  it('the frame registry never hands out a reserved id', () => {
    const reg = createFrameRegistry([{ id: 'f2', kind: 'note', title: 'b', rect: { x: 0, y: 0, w: 1, h: 1 }, pinned: false }], ['f3', 'my-board']);
    expect(reg.add('note', 'x').id).toBe('f4');
    expect(reg.add('note', 'y').id).toBe('f5');
  });
});
