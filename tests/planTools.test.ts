// Pure-logic tests for the plan tool framework: wall hosting math, the wall
// polyline state machine, ortho/45° constraint, shortcut matching, and the new
// op validators + engine reducers (set_swing / move_opening / set_width /
// move_end / add_opening) including undo/redo.

import { describe, expect, it } from 'vitest';
import { clampOpeningOffset, nearestWall, projectToWall } from '../src/plan/hosting';
import { chainClick, emptyChain, normRect, ortho45 } from '../src/plan/drawTools';
import { matchesShortcut } from '../src/core/tools';
import { validatePlanOp } from '../src/plan/ops';
import { PlanEngine } from '../src/plan/engine';
import type { Wall } from '../src/plan/doc';

const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({
  id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 100,
});

describe('hosting math', () => {
  const w = wall('w1', 0, 0, 4000, 0);

  it('projects a point onto the wall and clamps to the segment', () => {
    expect(projectToWall({ x: 1000, y: 300 }, w)).toMatchObject({ t: 1000, dist: 300 });
    expect(projectToWall({ x: -500, y: 0 }, w).t).toBe(0);
    expect(projectToWall({ x: 9000, y: 0 }, w).t).toBe(4000);
  });

  it('handles degenerate zero-length walls', () => {
    const z = wall('z', 100, 100, 100, 100);
    const p = projectToWall({ x: 400, y: 100 }, z);
    expect(p.t).toBe(0);
    expect(p.dist).toBe(300);
  });

  it('finds the nearest wall within radius, or null', () => {
    const walls = [w, wall('w2', 0, 2000, 4000, 2000)];
    expect(nearestWall({ x: 2000, y: 300 }, walls, 600)?.wall.id).toBe('w1');
    expect(nearestWall({ x: 2000, y: 1700 }, walls, 600)?.wall.id).toBe('w2');
    expect(nearestWall({ x: 2000, y: 1000 }, walls, 600)).toBeNull();
  });

  it('clamps an opening inside its wall (both ends + centring)', () => {
    expect(clampOpeningOffset(2000, 900, 4000)).toBe(1550); // centred
    expect(clampOpeningOffset(100, 900, 4000)).toBe(0); // near start
    expect(clampOpeningOffset(3950, 900, 4000)).toBe(3100); // near end
    expect(clampOpeningOffset(500, 900, 600)).toBe(0); // wall shorter than opening
  });
});

describe('wall-draw state machine', () => {
  it('anchors, emits walls per click, and chains', () => {
    let s = emptyChain();
    const r1 = chainClick(s, { x: 0, y: 0 });
    expect(r1.wall).toBeUndefined();
    const r2 = chainClick(r1.state, { x: 3000, y: 0 });
    expect(r2.wall).toEqual({ a: { x: 0, y: 0 }, b: { x: 3000, y: 0 } });
    const r3 = chainClick(r2.state, { x: 3000, y: 2000 });
    expect(r3.wall).toEqual({ a: { x: 3000, y: 0 }, b: { x: 3000, y: 2000 } });
  });

  it('finishes when clicking on/near the last point (double-click)', () => {
    const s = chainClick(chainClick(emptyChain(), { x: 0, y: 0 }).state, { x: 3000, y: 0 }).state;
    const r = chainClick(s, { x: 3040, y: 0 });
    expect(r.finished).toBe(true);
    expect(r.wall).toBeUndefined();
    expect(r.state.pts).toHaveLength(0);
  });

  it('ortho45 snaps to axis and diagonal rays, preserving length', () => {
    const a = { x: 0, y: 0 };
    expect(ortho45(a, { x: 1000, y: 40 })).toMatchObject({ y: 0 });
    expect(ortho45(a, { x: 40, y: 1000 }).x).toBeCloseTo(0, 6);
    const diag = ortho45(a, { x: 900, y: 1100 });
    expect(diag.x).toBeCloseTo(diag.y, 3); // 45°
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(Math.hypot(900, 1100), 3);
  });

  it('normalizes drag rectangles', () => {
    expect(normRect({ x: 2000, y: 1000 }, { x: 0, y: 3000 })).toEqual({ x: 0, y: 1000, w: 2000, h: 2000 });
  });
});

describe('shortcut matching', () => {
  const key = (k: string, mods: Partial<{ shift: boolean; ctrl: boolean; alt: boolean; meta: boolean }> = {}) => ({
    key: k, shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, metaKey: !!mods.meta,
  });

  it('matches plain letters and shift chords, rejects ctrl/meta', () => {
    expect(matchesShortcut(key('w'), 'w')).toBe(true);
    expect(matchesShortcut(key('W', { shift: true }), 'w')).toBe(false);
    expect(matchesShortcut(key('M', { shift: true }), 'shift+m')).toBe(true);
    expect(matchesShortcut(key('m'), 'shift+m')).toBe(false);
    expect(matchesShortcut(key('w', { ctrl: true }), 'w')).toBe(false);
  });
});

describe('new op validators', () => {
  it('validates add_opening with defaults and clamps', () => {
    const v = validatePlanOp({ op: 'add_opening', target: 'w1' });
    expect(v.ok && v.op).toMatchObject({ op: 'add_opening', target: 'w1', width: 900 });
    expect(validatePlanOp({ op: 'add_opening' }).ok).toBe(false);
  });

  it('validates set_swing / move_opening / set_width / move_end', () => {
    expect(validatePlanOp({ op: 'set_swing', target: 'o1' }).ok).toBe(true);
    const sw = validatePlanOp({ op: 'set_swing', target: 'o1', swing: 'right' });
    expect(sw.ok && sw.op).toMatchObject({ swing: 'right' });
    expect(validatePlanOp({ op: 'move_opening', target: 'o1' }).ok).toBe(false);
    const mo = validatePlanOp({ op: 'move_opening', target: 'o1', offset: -50 });
    expect(mo.ok && mo.op).toMatchObject({ offset: 0 }); // clamped
    expect(validatePlanOp({ op: 'set_width', target: 'o1', width: 50 }).ok && true).toBe(true);
    expect(validatePlanOp({ op: 'move_end', target: 'w1', end: 'c', x: 0, y: 0 }).ok).toBe(false);
    expect(validatePlanOp({ op: 'move_end', target: 'w1', end: 'b', x: 1, y: 2 }).ok).toBe(true);
  });
});

describe('engine reducers for the new ops', () => {
  function engineWithWallAndDoor(): PlanEngine {
    const e = new PlanEngine();
    e.apply({ op: 'add_wall', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 100 });
    e.apply({ op: 'add_door', target: 'w1', offset: 1000, width: 900, swing: 'left' });
    return e;
  }

  it('add_opening creates a plain opening kind', () => {
    const e = new PlanEngine();
    e.apply({ op: 'add_wall', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 100 });
    expect(e.apply({ op: 'add_opening', target: 'w1', width: 1200 }).ok).toBe(true);
    expect(e.getState().openings[0]).toMatchObject({ kind: 'opening', width: 1200 });
  });

  it('set_swing toggles without an explicit side and sets with one', () => {
    const e = engineWithWallAndDoor();
    e.apply({ op: 'set_swing', target: 'o2' });
    expect(e.getState().openings[0].swing).toBe('right');
    e.apply({ op: 'set_swing', target: 'o2', swing: 'right' });
    expect(e.getState().openings[0].swing).toBe('right');
    expect(e.apply({ op: 'set_swing', target: 'w1' }).ok).toBe(false); // not a door
  });

  it('move_opening slides and clamps inside the host wall', () => {
    const e = engineWithWallAndDoor();
    e.apply({ op: 'move_opening', target: 'o2', offset: 2000 });
    expect(e.getState().openings[0].offset).toBe(2000);
    e.apply({ op: 'move_opening', target: 'o2', offset: 99_000 });
    expect(e.getState().openings[0].offset).toBe(3100); // 4000 - 900
  });

  it('set_width resizes and re-clamps the offset', () => {
    const e = engineWithWallAndDoor();
    e.apply({ op: 'move_opening', target: 'o2', offset: 3100 });
    e.apply({ op: 'set_width', target: 'o2', width: 1500 });
    expect(e.getState().openings[0]).toMatchObject({ width: 1500, offset: 2500 });
  });

  it('move_end moves one endpoint and drags coincident neighbours', () => {
    const e = new PlanEngine();
    e.apply({ op: 'add_wall', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 100 });
    e.apply({ op: 'add_wall', a: { x: 4000, y: 0 }, b: { x: 4000, y: 3000 }, thickness: 100 });
    expect(e.apply({ op: 'move_end', target: 'w1', end: 'b', x: 5000, y: 0 }).ok).toBe(true);
    expect(e.getState().walls[0].b).toEqual({ x: 5000, y: 0 });
    expect(e.getState().walls[1].a).toEqual({ x: 5000, y: 0 }); // connected corner followed
    expect(e.apply({ op: 'move_end', target: 'w1', end: 'b', x: 10, y: 0 }).ok).toBe(false); // too short
  });

  it('each new op is one undo step and redo restores it', () => {
    const e = engineWithWallAndDoor();
    e.apply({ op: 'move_opening', target: 'o2', offset: 2000 });
    e.apply({ op: 'set_swing', target: 'o2' });
    e.apply({ op: 'undo' });
    expect(e.getState().openings[0]).toMatchObject({ offset: 2000, swing: 'left' });
    e.apply({ op: 'undo' });
    expect(e.getState().openings[0].offset).toBe(1000);
    e.apply({ op: 'redo' });
    expect(e.getState().openings[0].offset).toBe(2000);
  });
});
