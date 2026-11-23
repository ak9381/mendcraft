import { describe, expect, it } from 'vitest';
import { createPlanController } from '../../src/plan/controller';
import { beginTwoHandSession, bothOnFixture, twistAngle } from '../../src/plan/twoHandSession';
import type { PlanDoc } from '../../src/plan/doc';

const view = { toWorld: (x: number, y: number) => ({ x, y }), screenScale: () => 1, render: () => {} };
type Ctl = ReturnType<typeof createPlanController>;
const doc = (c: Ctl) => c.snapshot() as PlanDoc;
function withFixture() {
  const c = createPlanController();
  expect(c.applyOp({ op: 'add_fixture', kind: 'table', x: 1000, y: 1000, w: 800, d: 400 }).ok).toBe(true);
  const id = doc(c).fixtures[0].id;
  c.selectId(id);
  return { c, id };
}
function withWall() {
  const c = createPlanController();
  expect(c.applyOp({ op: 'add_wall', x1: 0, y1: 0, x2: 2000, y2: 0 }).ok).toBe(true);
  const id = doc(c).walls[0].id;
  c.selectId(id);
  return { c, id };
}
const undoDepth = (c: Ctl) => { let n = 0; const saved = JSON.stringify(doc(c)); while (c.applyOp({ op: 'undo' }).ok) n++; for (let i = 0; i < n; i++) c.applyOp({ op: 'redo' }); expect(JSON.stringify(doc(c))).toBe(saved); return n; };
const rot = (c: Ctl, id: string) => doc(c).fixtures.find((f) => f.id === id)!.rotation;

describe('twistAngle', () => {
  it('snaps to 15° and wraps', () => {
    expect(twistAngle(0, 7)).toBe(0);
    expect(twistAngle(0, 8)).toBe(15);
    expect(twistAngle(0, 44)).toBe(45);
    expect(twistAngle(170, -170)).toBe(15);
    expect(twistAngle(-170, 170)).toBe(-15);
    expect(twistAngle(0, 37, 0)).toBe(37);
  });
});

describe('two-hand plan session', () => {
  it('nothing selected / hands off the selection → null (zoom/pan)', () => {
    expect(beginTwoHandSession(createPlanController(), view, { x: 0, y: 0 }, { x: 100, y: 0 })).toBeNull();
    const { c } = withFixture();
    expect(beginTwoHandSession(c, view, { x: 5000, y: 5000 }, { x: 6000, y: 5000 })).toBeNull();
  });
  it('fixture twist: rotates live, one undo step on release', () => {
    const { c, id } = withFixture();
    const before = undoDepth(c);
    const s = beginTwoHandSession(c, view, { x: 900, y: 1000 }, { x: 1100, y: 1000 })!;
    expect(s.kind).toBe('twist');
    const a = Math.PI / 6;
    s.move({ x: 1000 - 100 * Math.cos(a), y: 1000 - 100 * Math.sin(a) }, { x: 1000 + 100 * Math.cos(a), y: 1000 + 100 * Math.sin(a) });
    expect(rot(c, id)).toBe(30);
    s.move({ x: 1000, y: 900 }, { x: 1000, y: 1100 });
    expect(rot(c, id)).toBe(90);
    s.end();
    expect(rot(c, id)).toBe(90);
    expect(undoDepth(c)).toBe(before + 1);
  });
  it('a lost hand rolls the twist back with nothing applied', () => {
    const { c, id } = withFixture();
    const before = undoDepth(c);
    const s = beginTwoHandSession(c, view, { x: 900, y: 1000 }, { x: 1100, y: 1000 })!;
    s.move({ x: 1000, y: 900 }, { x: 1000, y: 1100 });
    s.cancel();
    expect(rot(c, id)).toBe(0);
    expect(undoDepth(c)).toBe(before);
  });
  it('wall stretch: both ends follow the hands, one undo step', () => {
    const { c, id } = withWall();
    const before = undoDepth(c);
    const s = beginTwoHandSession(c, view, { x: 10, y: 0 }, { x: 1990, y: 0 })!;
    expect(s.kind).toBe('stretch');
    s.move({ x: -500, y: 0 }, { x: 2500, y: 0 });
    s.move({ x: -1000, y: 0 }, { x: 3000, y: 0 });
    s.end();
    const w = doc(c).walls.find((x) => x.id === id)!;
    expect(Math.abs(w.b.x - w.a.x)).toBeGreaterThanOrEqual(3900);
    expect(undoDepth(c)).toBe(before + 1);
  });
  it('a held-still release applies nothing', () => {
    const { c } = withFixture();
    const before = undoDepth(c);
    const s = beginTwoHandSession(c, view, { x: 900, y: 1000 }, { x: 1100, y: 1000 })!;
    s.move({ x: 900, y: 1001 }, { x: 1100, y: 1000 });
    s.end();
    expect(undoDepth(c)).toBe(before);
  });
  it('bothOnFixture needs both hands on it', () => {
    const { c, id } = withFixture();
    expect(bothOnFixture(doc(c), id, { x: 900, y: 1000 }, { x: 1100, y: 1000 }, 36)).toBe(true);
    expect(bothOnFixture(doc(c), id, { x: 900, y: 1000 }, { x: 3000, y: 1000 }, 36)).toBe(false);
  });
  it('small fixture (hands on its corners): a turn twists, a spread resizes', () => {
    const small = () => { const c = createPlanController(); c.applyOp({ op: 'add_fixture', kind: 'chair', x: 0, y: 0, w: 40, d: 40 }); const f = doc(c).fixtures[0]; c.selectId(f.id); return { c, id: f.id, h: f.w / 2, k: f.d / 2 }; };
    const t = small();
    const s1 = beginTwoHandSession(t.c, view, { x: -t.h, y: -t.k }, { x: t.h, y: t.k })!;
    expect(s1.kind).toBe('twist-or-resize');
    s1.move({ x: -t.h, y: -t.k + 1 }, { x: t.h, y: t.k }); // jitter: undecided, nothing applied
    expect(s1.kind).toBe('twist-or-resize');
    const r0 = Math.hypot(t.h, t.k), a0 = Math.atan2(t.k, t.h) + Math.PI / 4; // turned 45°
    s1.move({ x: -r0 * Math.cos(a0), y: -r0 * Math.sin(a0) }, { x: r0 * Math.cos(a0), y: r0 * Math.sin(a0) });
    expect(s1.kind).toBe('twist');
    s1.end();
    expect(rot(t.c, t.id)).toBe(45);
    const r = small();
    const s2 = beginTwoHandSession(r.c, view, { x: -r.h, y: -r.k }, { x: r.h, y: r.k })!;
    s2.move({ x: -2 * r.h, y: -2 * r.k }, { x: 2 * r.h, y: 2 * r.k }); // spread, no turn
    expect(s2.kind).toBe('fixture');
    s2.end();
    expect(rot(r.c, r.id)).toBe(0);
    expect(doc(r.c).fixtures[0].w).toBeGreaterThan(2 * r.h);
  });
});
