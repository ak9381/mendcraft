// PLAN PART 2 (Revit-like editing depth): selection sets + marquee, batch ops
// as one undo step, move_many rigid translation, fixture rotate math/snap,
// temporary dimensions + their inline-edit reducers, wall-face snapping, and
// sill/height ops reflected in the 3D wall segments.

import { describe, expect, it } from 'vitest';
import { PlanEngine } from '../src/plan/engine';
import { validatePlanOp, type PlanOp } from '../src/plan/ops';
import {
  fixtureHandlePoint,
  handleAngle,
  normalizeAngle,
  rectHits,
  snapAngle,
  tempDims,
  tempDimEditOp,
  toggleSelection,
  wallSegments,
} from '../src/plan/editing';
import { measureSnap, snapToWallFaces } from '../src/plan/snap';
import { wallLength, type PlanDoc } from '../src/plan/doc';

const ok = (raw: unknown): PlanOp => {
  const v = validatePlanOp(raw);
  if (!v.ok) throw new Error(v.error);
  return v.op;
};

/** Engine with a 4 × 3 m room. Ids are resolved from the state (the id counter
 *  is shared across kinds, so walls are NOT literally w1..w4). */
function setup() {
  const e = new PlanEngine();
  e.apply(ok({ op: 'add_room', x: 0, y: 0, w: 4000, h: 3000 }));
  const d = e.getState();
  const [bottom, right, top, left] = d.walls.map((w) => w.id);
  return { e, bottom, right, top, left, roomId: d.rooms[0].id };
}
const lastOpening = (e: PlanEngine) => e.getState().openings.at(-1)!.id;
const lastFixture = (e: PlanEngine) => e.getState().fixtures.at(-1)!.id;

describe('selection set logic', () => {
  it('toggleSelection adds then removes', () => {
    expect(toggleSelection([], 'w1')).toEqual(['w1']);
    expect(toggleSelection(['w1'], 'w2')).toEqual(['w1', 'w2']);
    expect(toggleSelection(['w1', 'w2'], 'w1')).toEqual(['w2']);
  });

  it('select_set replaces the selection; last id is primary; empty clears', () => {
    const { e, bottom, right } = setup();
    e.apply(ok({ op: 'select_set', ids: [bottom, right] }));
    expect(e.getState().selectedIds).toEqual([bottom, right]);
    expect(e.getState().selectedId).toBe(right);
    e.apply(ok({ op: 'select_set', ids: [] }));
    expect(e.getState().selectedIds).toEqual([]);
    expect(e.getState().selectedId).toBeNull();
  });

  it('select_set drops unknown ids; plain select collapses to one', () => {
    const { e, bottom, top, right } = setup();
    e.apply(ok({ op: 'select_set', ids: [bottom, 'nope', top] }));
    expect(e.getState().selectedIds).toEqual([bottom, top]);
    e.apply(ok({ op: 'select', target: right }));
    expect(e.getState().selectedIds).toEqual([right]);
  });

  it('marquee rectHits: walls need both endpoints inside; fixture/opening by centre', () => {
    const { e, bottom, top } = setup();
    e.apply(ok({ op: 'add_door', target: bottom, offset: 1000, width: 900 }));
    const door = lastOpening(e);
    e.apply(ok({ op: 'add_fixture', kind: 'sofa', x: 2000, y: 1500, w: 1800, d: 800 }));
    const sofa = lastFixture(e);
    const d = e.getState();
    const all = rectHits(d, { x: -100, y: -100, w: 4200, h: 3200 });
    expect(all).toContain(bottom);
    expect(all).toContain(top);
    expect(all).toContain(door);
    expect(all).toContain(sofa);
    // A rect over only the left half misses walls that poke out of it.
    const half = rectHits(d, { x: -100, y: -100, w: 2200, h: 3200 });
    expect(half).not.toContain(bottom); // bottom wall spans the full 4 m
    expect(half).toContain(sofa); // centre at x=2000 is inside
  });

  it('deleting a selected wall prunes it from the selection', () => {
    const { e, bottom, right } = setup();
    e.apply(ok({ op: 'select_set', ids: [bottom, right] }));
    e.apply(ok({ op: 'delete', target: bottom }));
    expect(e.getState().selectedIds).toEqual([right]);
    expect(e.getState().selectedId).toBe(right);
  });
});

describe('batch ops: one undoable step', () => {
  it('batch delete removes all items and one undo restores them', () => {
    const { e, bottom } = setup();
    e.apply(ok({ op: 'add_fixture', kind: 'sofa', x: 2000, y: 1500, w: 1800, d: 800 }));
    const sofa = lastFixture(e);
    e.apply(ok({ op: 'batch', ops: [
      { op: 'delete', target: bottom },
      { op: 'delete', target: sofa },
    ] }));
    expect(e.getState().walls.some((w) => w.id === bottom)).toBe(false);
    expect(e.getState().fixtures).toHaveLength(0);
    e.apply(ok({ op: 'undo' }));
    expect(e.getState().walls.some((w) => w.id === bottom)).toBe(true);
    expect(e.getState().fixtures).toHaveLength(1);
    e.apply(ok({ op: 'redo' }));
    expect(e.getState().fixtures).toHaveLength(0);
  });

  it('batch tolerates a sub-op defeated by a cascade (wall + its door)', () => {
    const { e, bottom } = setup();
    e.apply(ok({ op: 'add_door', target: bottom, offset: 1000, width: 900 }));
    const door = lastOpening(e);
    const r = e.apply(ok({ op: 'batch', ops: [
      { op: 'delete', target: bottom }, // cascades the door away
      { op: 'delete', target: door }, // already gone — skipped, not fatal
    ] }));
    expect(r.ok).toBe(true);
    expect(e.getState().openings).toHaveLength(0);
  });

  it('a batch that creates objects (duplicate/paste) selects ALL of them', () => {
    const { e } = setup();
    e.apply(ok({ op: 'add_fixture', kind: 'sofa', x: 1000, y: 1000, w: 1800, d: 800 }));
    e.apply(ok({ op: 'add_fixture', kind: 'wc', x: 3000, y: 2000, w: 400, d: 600 }));
    const [f1, f2] = e.getState().fixtures.map((f) => f.id);
    e.apply(ok({ op: 'select_set', ids: [f1, f2] }));
    e.apply(ok({ op: 'batch', ops: [
      { op: 'add_fixture', kind: 'sofa', x: 1300, y: 700, w: 1800, d: 800 },
      { op: 'add_fixture', kind: 'wc', x: 3300, y: 1700, w: 400, d: 600 },
    ] }));
    const d = e.getState();
    expect(d.fixtures).toHaveLength(4);
    const created = d.fixtures.slice(2).map((f) => f.id);
    expect(d.selectedIds).toEqual(created);
    expect(d.selectedId).toBe(created[1]);
  });

  it('validator rejects nested batch and undo/redo inside a batch', () => {
    expect(validatePlanOp({ op: 'batch', ops: [{ op: 'undo' }] }).ok).toBe(false);
    expect(validatePlanOp({ op: 'batch', ops: [{ op: 'batch', ops: [] }] }).ok).toBe(false);
    expect(validatePlanOp({ op: 'batch', ops: [] }).ok).toBe(false);
  });

  it('move_many translates a wall set rigidly (shared endpoints move once)', () => {
    const { e } = setup();
    const ids = e.getState().walls.map((w) => w.id);
    const before = e.getState().walls.map((w) => ({ a: { ...w.a }, b: { ...w.b } }));
    e.apply(ok({ op: 'move_many', ids, dx: 500, dy: -200 }));
    const after = e.getState().walls;
    after.forEach((w, i) => {
      expect(w.a.x).toBeCloseTo(before[i].a.x + 500);
      expect(w.a.y).toBeCloseTo(before[i].a.y - 200);
      expect(w.b.x).toBeCloseTo(before[i].b.x + 500);
      expect(w.b.y).toBeCloseTo(before[i].b.y - 200);
      expect(wallLength(w)).toBeCloseTo(wallLength({ ...w, ...before[i] }));
    });
    e.apply(ok({ op: 'undo' })); // one step restores everything
    e.getState().walls.forEach((w, i) => expect(w.a).toEqual(before[i].a));
  });

  it('move_many drags coincident endpoints of unselected neighbours once', () => {
    const { e, bottom, right } = setup();
    e.apply(ok({ op: 'move_many', ids: [bottom], dx: 0, dy: -300 }));
    const d = e.getState();
    const w1 = d.walls.find((w) => w.id === bottom)!;
    expect(w1.a.y).toBeCloseTo(-300);
    // Perpendicular neighbours lengthen (their touching endpoint followed).
    const w2 = d.walls.find((w) => w.id === right)!;
    expect(Math.min(w2.a.y, w2.b.y)).toBeCloseTo(-300);
    expect(wallLength(w2)).toBeCloseTo(3300);
  });
});

describe('rotate math + ops', () => {
  it('normalizeAngle and snapAngle (15°)', () => {
    expect(normalizeAngle(370)).toBe(10);
    expect(normalizeAngle(-90)).toBe(270);
    expect(snapAngle(22)).toBe(15);
    expect(snapAngle(23)).toBe(30);
    expect(snapAngle(359)).toBe(0);
  });

  it('handleAngle is 0 when the handle is due +y and grows CCW', () => {
    expect(handleAngle({ x: 0, y: 0 }, { x: 0, y: 100 })).toBeCloseTo(0);
    expect(handleAngle({ x: 0, y: 0 }, { x: -100, y: 0 })).toBeCloseTo(90);
  });

  it('fixtureHandlePoint rotates with the fixture', () => {
    const f = { id: 'f1', kind: 'sofa', x: 0, y: 0, w: 1000, d: 600, rotation: 0 };
    expect(fixtureHandlePoint(f, 100).y).toBeCloseTo(400);
    const h = fixtureHandlePoint({ ...f, rotation: 90 }, 100);
    expect(h.x).toBeCloseTo(-400);
    expect(h.y).toBeCloseTo(0);
  });

  it('rotate op turns a fixture (wrapping) and flips a door swing', () => {
    const { e, bottom, roomId } = setup();
    e.apply(ok({ op: 'add_fixture', kind: 'wc', x: 1000, y: 1000, w: 400, d: 600, rotation: 345 }));
    const wc = lastFixture(e);
    e.apply(ok({ op: 'rotate', target: wc, angle: 90 }));
    expect(e.getState().fixtures[0].rotation).toBe(75);
    e.apply(ok({ op: 'add_door', target: bottom, offset: 500, width: 900 }));
    const door = lastOpening(e);
    const before = e.getState().openings[0].swing;
    e.apply(ok({ op: 'rotate', target: door }));
    expect(e.getState().openings[0].swing).not.toBe(before);
    expect(e.apply(ok({ op: 'rotate', target: roomId })).ok).toBe(false);
  });
});

describe('temporary dimensions', () => {
  it('a selected wall exposes its length; an opening exposes both end offsets', () => {
    const { e, bottom } = setup();
    e.apply(ok({ op: 'add_window', target: bottom, offset: 1200, width: 1000 }));
    const win = lastOpening(e);
    const d = e.getState();
    const wallTd = tempDims(d, bottom);
    expect(wallTd).toHaveLength(1);
    expect(wallTd[0].kind).toBe('wall-length');
    expect(wallTd[0].value).toBeCloseTo(4000);
    const openTd = tempDims(d, win);
    expect(openTd.map((t) => t.kind)).toEqual(['opening-start', 'opening-end']);
    expect(openTd[0].value).toBeCloseTo(1200);
    expect(openTd[1].value).toBeCloseTo(4000 - 1200 - 1000);
  });

  it('editing reducers: start offset, end offset, and wall length', () => {
    const { e, bottom } = setup();
    e.apply(ok({ op: 'add_window', target: bottom, offset: 1200, width: 1000 }));
    const win = lastOpening(e);
    const d = e.getState();
    expect(tempDimEditOp(d, { kind: 'opening-start', targetId: win }, 800))
      .toEqual({ op: 'move_opening', target: win, offset: 800 });
    // Editing the far-end distance recomputes the near-edge offset.
    expect(tempDimEditOp(d, { kind: 'opening-end', targetId: win }, 500))
      .toEqual({ op: 'move_opening', target: win, offset: 2500 });
    expect(tempDimEditOp(d, { kind: 'wall-length', targetId: bottom }, 4500))
      .toEqual({ op: 'set_length', target: bottom, length: 4500 });
    expect(tempDimEditOp(d, { kind: 'opening-start', targetId: win }, -5)).toBeNull();
    // Applying the end-edit really leaves 500 mm to the wall end.
    e.apply(ok(tempDimEditOp(d, { kind: 'opening-end', targetId: win }, 500)!));
    expect(tempDims(e.getState(), win)[1].value).toBeCloseTo(500);
  });

  it('measure → permanent free dimension via add_dim with points', () => {
    const { e } = setup();
    e.apply(ok({ op: 'add_dim', ax: 0, ay: 0, bx: 2000, by: 0 }));
    const dim = e.getState().dims[0];
    expect(dim.wallId).toBeUndefined();
    expect(dim.a).toEqual({ x: 0, y: 0 });
    expect(dim.b).toEqual({ x: 2000, y: 0 });
    expect(validatePlanOp({ op: 'add_dim' }).ok).toBe(false);
  });
});

describe('wall-face snapping', () => {
  const wall = { id: 'w1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 };

  it('snaps to BOTH faces, not the centreline', () => {
    const top = snapToWallFaces({ x: 1000, y: 130 }, [wall], 80);
    expect(top?.point.y).toBeCloseTo(100);
    expect(top?.kind).toBe('face');
    const bottom = snapToWallFaces({ x: 1000, y: -130 }, [wall], 80);
    expect(bottom?.point.y).toBeCloseTo(-100);
    expect(snapToWallFaces({ x: 1000, y: 500 }, [wall], 80)).toBeNull();
  });

  it('measureSnap prefers endpoints over faces over grid', () => {
    expect(measureSnap({ x: 20, y: 30 }, [wall], 120).kind).toBe('endpoint');
    expect(measureSnap({ x: 1000, y: 130 }, [wall], 120).kind).toBe('face');
    const grid = measureSnap({ x: 1030, y: 980 }, [wall], 120);
    expect(grid.kind).toBe('grid');
    expect(grid.point).toEqual({ x: 1000, y: 1000 });
  });
});

describe('heights (walls, doors, windows) and the 3D segments', () => {
  it('set_height on a wall and a door; set_sill on a window only', () => {
    const { e, bottom, top } = setup();
    e.apply(ok({ op: 'add_door', target: bottom, offset: 500, width: 900 }));
    const door = lastOpening(e);
    e.apply(ok({ op: 'add_window', target: top, offset: 1000, width: 1200 }));
    const win = lastOpening(e);
    expect(e.apply(ok({ op: 'set_height', target: bottom, height: 3000 })).ok).toBe(true);
    expect(e.getState().walls.find((w) => w.id === bottom)?.height).toBe(3000);
    expect(e.apply(ok({ op: 'set_height', target: door, height: 2000 })).ok).toBe(true);
    expect(e.apply(ok({ op: 'set_sill', target: win, sill: 1100 })).ok).toBe(true);
    expect(e.apply(ok({ op: 'set_sill', target: door, sill: 500 })).ok).toBe(false); // doors have no sill
    expect(e.getState().openings.find((o) => o.id === win)?.sill).toBe(1100);
  });

  it('wallSegments honours wall height, door head and window sill/height', () => {
    const { e, bottom } = setup();
    e.apply(ok({ op: 'add_door', target: bottom, offset: 500, width: 900 }));
    const door = lastOpening(e);
    e.apply(ok({ op: 'set_height', target: bottom, height: 3000 }));
    e.apply(ok({ op: 'set_height', target: door, height: 2000 }));
    const d = e.getState() as PlanDoc;
    const w1 = d.walls.find((w) => w.id === bottom)!;
    const segs = wallSegments(w1, d);
    // Full-height flanks + a header band above the 2000 mm door.
    expect(segs).toContainEqual({ s: 0, e: 500, z0: 0, z1: 3000 });
    expect(segs).toContainEqual({ s: 500, e: 1400, z0: 2000, z1: 3000 });
    expect(segs).toContainEqual({ s: 1400, e: 4000, z0: 0, z1: 3000 });

    // Window: sill + head bands from its sill/height.
    const s2 = setup();
    s2.e.apply(ok({ op: 'add_window', target: s2.bottom, offset: 1000, width: 1200 }));
    const win = lastOpening(s2.e);
    s2.e.apply(ok({ op: 'set_sill', target: win, sill: 1100 }));
    s2.e.apply(ok({ op: 'set_height', target: win, height: 800 }));
    const d2 = s2.e.getState() as PlanDoc;
    const segs2 = wallSegments(d2.walls.find((w) => w.id === s2.bottom)!, d2);
    expect(segs2).toContainEqual({ s: 1000, e: 2200, z0: 0, z1: 1100 });
    expect(segs2).toContainEqual({ s: 1000, e: 2200, z0: 1900, z1: 2500 });
  });
});
