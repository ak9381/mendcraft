import { describe, expect, it } from 'vitest';
import { createPlanController } from '../../src/plan/controller';
import { beginTwoHandDraw, beginTwoHandSession } from '../../src/plan/twoHandSession';
import type { PlanDoc } from '../../src/plan/doc';

const view = { toWorld: (x: number, y: number) => ({ x, y }), screenScale: () => 1, render: () => {} };
type Ctl = ReturnType<typeof createPlanController>;
const snap = (c: Ctl) => JSON.stringify(c.snapshot() as PlanDoc);
function table() {
  const c = createPlanController();
  c.applyOp({ op: 'add_fixture', kind: 'table', x: 1000, y: 1000, w: 800, d: 400 });
  c.selectId((c.snapshot() as PlanDoc).fixtures[0].id);
  return c;
}

describe('Redo after a cancelled two-hand gesture', () => {
  it('a lost-hand twist leaves nothing to redo', () => {
    const c = table();
    const before = snap(c);
    const s = beginTwoHandSession(c, view, { x: 900, y: 1000 }, { x: 1100, y: 1000 })!;
    s.move({ x: 1000, y: 900 }, { x: 1000, y: 1100 });
    s.move({ x: 1050, y: 900 }, { x: 950, y: 1100 });
    s.cancel();
    expect(snap(c)).toBe(before);
    expect(c.applyOp({ op: 'redo' }).ok).toBe(false);
    expect(snap(c)).toBe(before);
  });
  it('a twist turned back to where it started (net zero) leaves nothing to redo', () => {
    const c = table();
    const before = snap(c);
    const s = beginTwoHandSession(c, view, { x: 900, y: 1000 }, { x: 1100, y: 1000 })!;
    s.move({ x: 1000, y: 900 }, { x: 1000, y: 1100 });
    s.move({ x: 900, y: 1000 }, { x: 1100, y: 1000 });
    s.end();
    expect(snap(c)).toBe(before);
    expect(c.applyOp({ op: 'redo' }).ok).toBe(false);
  });
  it('a lost-hand wall/room draw leaves nothing to redo', () => {
    for (const tool of ['wall', 'room'] as const) {
      const c = createPlanController();
      const s = beginTwoHandDraw(c, view, tool)!;
      s.move({ x: 0, y: 0 }, { x: 2000, y: 1500 });
      s.move({ x: 0, y: 0 }, { x: 3000, y: 2000 });
      s.cancel();
      expect(c.applyOp({ op: 'redo' }).ok).toBe(false);
      expect((c.snapshot() as PlanDoc).walls.length).toBe(0);
    }
  });
  it('a released twist undoes in one step and redoes in one step', () => {
    const c = table();
    const before = snap(c);
    const s = beginTwoHandSession(c, view, { x: 900, y: 1000 }, { x: 1100, y: 1000 })!;
    s.move({ x: 1000, y: 900 }, { x: 1000, y: 1100 });
    s.end();
    const after = snap(c);
    expect(c.applyOp({ op: 'undo' }).ok).toBe(true);
    expect(snap(c)).toBe(before);
    expect(c.applyOp({ op: 'redo' }).ok).toBe(true);
    expect(snap(c)).toBe(after);
    expect(c.applyOp({ op: 'redo' }).ok).toBe(false);
  });
  it('an older redo entry the gesture never touched survives a no-op grab', () => {
    const c = table();
    c.applyOp({ op: 'rotate', target: (c.snapshot() as PlanDoc).fixtures[0].id, angle: 90 });
    c.applyOp({ op: 'undo' }); // redo now holds the user's rotate
    const s = beginTwoHandSession(c, view, { x: 900, y: 1000 }, { x: 1100, y: 1000 })!;
    s.cancel(); // grabbed, never moved: nothing applied, nothing dropped
    expect(c.applyOp({ op: 'redo' }).ok).toBe(true);
  });
});
