import { describe, expect, it } from 'vitest';
import { createPlanController } from '../../src/plan/controller';
import { beginTwoHandDraw, roomBetween, wallBetween } from '../../src/plan/twoHandSession';
import type { PlanDoc } from '../../src/plan/doc';

const view = { toWorld: (x: number, y: number) => ({ x, y }), screenScale: () => 1, render: () => {} };
type Ctl = ReturnType<typeof createPlanController>;
const doc = (c: Ctl) => c.snapshot() as PlanDoc;
const undoDepth = (c: Ctl) => { let n = 0; while (c.applyOp({ op: 'undo' }).ok) n++; for (let i = 0; i < n; i++) c.applyOp({ op: 'redo' }); return n; };

describe('two-hand draw geometry', () => {
  it('wallBetween locks near-ortho / near-45° walls, leaves others free', () => {
    expect(wallBetween({ x: 0, y: 0 }, { x: 1000, y: 50 }).b).toEqual({ x: 1001, y: 0 });
    const d = wallBetween({ x: 0, y: 0 }, { x: 1000, y: 1050 }).b;
    expect(Math.abs(d.x - d.y)).toBeLessThanOrEqual(1);
    expect(wallBetween({ x: 0, y: 0 }, { x: 1000, y: 400 }).b).toEqual({ x: 1000, y: 400 });
  });
  it('roomBetween is the rectangle on the two hands, any order', () => {
    expect(roomBetween({ x: 3000, y: 100 }, { x: 0, y: 2100 })).toEqual({ x: 0, y: 100, w: 3000, h: 2000 });
  });
});

describe('two-hand draw session', () => {
  it('wall: follows the hands live, ONE wall and one undo step on release', () => {
    const c = createPlanController();
    const s = beginTwoHandDraw(c, view, 'wall')!;
    s.move({ x: 0, y: 0 }, { x: 1000, y: 0 });
    s.move({ x: 0, y: 0 }, { x: 3000, y: 20 });
    expect(doc(c).walls.length).toBe(1);
    s.end();
    const w = doc(c).walls[0];
    expect(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)).toBeCloseTo(3000, -1);
    expect(undoDepth(c)).toBe(1);
  });
  it('room: one room on release; a lost hand leaves nothing', () => {
    const c = createPlanController();
    const s = beginTwoHandDraw(c, view, 'room')!;
    s.move({ x: 0, y: 0 }, { x: 3000, y: 2000 });
    s.end();
    expect(doc(c).rooms.length).toBe(1);
    const c2 = createPlanController();
    const s2 = beginTwoHandDraw(c2, view, 'room')!;
    s2.move({ x: 0, y: 0 }, { x: 3000, y: 2000 });
    s2.cancel();
    expect(doc(c2).rooms.length).toBe(0);
    expect(doc(c2).walls.length).toBe(0);
    expect(undoDepth(c2)).toBe(0);
  });
  it('hands too close draw nothing', () => {
    const c = createPlanController();
    const s = beginTwoHandDraw(c, view, 'wall')!;
    s.move({ x: 0, y: 0 }, { x: 40, y: 0 });
    s.end();
    expect(doc(c).walls.length).toBe(0);
  });
});
