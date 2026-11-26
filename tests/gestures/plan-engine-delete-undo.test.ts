// B16/B18 (Delete cascade, rapid undo): the delete/undo paths are
// input-agnostic (engine-level), reached identically by a mouse click or a
// pinch-tap on the same button/trash-zone. Exercises the real PlanEngine.
import { describe, expect, it } from 'vitest';
import { PlanEngine } from '../../src/plan/engine';
import { validatePlanOp } from '../../src/plan/ops';

function run(engine: PlanEngine, env: Record<string, unknown>) {
  const v = validatePlanOp(env);
  if (!v.ok) return { ok: false as const, error: v.error };
  return engine.apply(v.op);
}

describe('B-133 deleting a room cascades: all its walls + their openings/dims', () => {
  it('delete on a room removes every wall in it, plus their hosted openings and dims', () => {
    const e = new PlanEngine();
    run(e, { op: 'add_room', nums: { x: 0, y: 0, w: 4000, h: 3000 } });
    run(e, { op: 'add_door', target: 'w2' });
    run(e, { op: 'add_dim', target: 'w3' });
    const before = e.getState();
    const roomId = before.rooms[0].id;
    const wallIds = [...before.rooms[0].wallIds];
    expect(wallIds.length).toBeGreaterThan(0);

    const res = run(e, { op: 'delete', target: roomId });
    expect(res.ok).toBe(true);
    const doc = e.getState();
    expect(doc.rooms).toHaveLength(0);
    for (const id of wallIds) expect(doc.walls.find((w) => w.id === id)).toBeUndefined();
    expect(doc.openings).toHaveLength(0);
    expect(doc.dims).toHaveLength(0);
  });
});

describe('B-145 rapid repeated undo requests each pop exactly one step', () => {
  it('three undo calls in a row, with no gap between them, each restore one prior state', () => {
    const e = new PlanEngine();
    run(e, { op: 'add_room', nums: { x: 0, y: 0, w: 4000, h: 3000 } }); // step 1
    run(e, { op: 'rename', target: e.getState().rooms[0].id, name: 'A' }); // step 2
    run(e, { op: 'rename', target: e.getState().rooms[0].id, name: 'B' }); // step 3
    expect(e.getState().rooms[0].name).toBe('B');

    const u1 = e.apply({ op: 'undo' });
    expect(u1.ok).toBe(true);
    expect(e.getState().rooms[0].name).toBe('A');

    const u2 = e.apply({ op: 'undo' });
    expect(u2.ok).toBe(true);
    expect(e.getState().rooms).toHaveLength(1); // back to the freshly-added room, name reset

    const u3 = e.apply({ op: 'undo' });
    expect(u3.ok).toBe(true);
    expect(e.getState().rooms).toHaveLength(0); // back to the empty plan

    const u4 = e.apply({ op: 'undo' }); // a fourth rapid tap with nothing left
    expect(u4.ok).toBe(false);
  });
});
