// B14 direct-manipulation resize gaps: on-canvas drag handles that previously
// existed for NEITHER mouse nor hand. Drives the real select tool through the
// fake ToolContext. See tests/gestures/toolCtxFake.ts.
import { describe, expect, it } from 'vitest';
import { createPlanTools } from '../../src/plan/tools';
import { emptyPlan, type Fixture, type Opening, type Wall } from '../../src/plan/doc';
import { makeFakeCtx, ptr } from './toolCtxFake';

const fixture = (id: string, x: number, y: number, w = 400, d = 400, rotation = 0): Fixture => ({
  id, kind: 'chair', x, y, w, d, rotation,
});
const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({
  id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 100,
});
const opening = (id: string, wallId: string, offset: number, width: number): Opening => ({
  id, kind: 'door', wallId, offset, width, swing: 'left',
});

function selectToolFrom(ctx: Parameters<typeof createPlanTools>[0]) {
  return createPlanTools(ctx).find((t) => t.id === 'select')!;
}

describe('B-123 fixture resize by dragging a footprint corner', () => {
  it.each(['mouse', 'pinch'] as const)('%s: dragging a corner outward grows w/d (set_size), anchored at centre', (source) => {
    const doc = emptyPlan();
    doc.fixtures.push(fixture('f1', 0, 0)); // corners at (±200, ±200)
    const { ctx, state } = makeFakeCtx({ pickResult: 'f1', selectedId: 'f1', doc });
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(200, 200, source)); // grab the +,+ corner exactly
    select.onMove!(ptr(400, 400, source)); // pull it out to (400,400)
    const sz = state.applied.find((a) => a.op === 'set_size') as { w: number; d: number } | undefined;
    expect(sz).toBeDefined();
    expect(sz!.w).toBe(800); // 2 * |localX| = 2 * 400
    expect(sz!.d).toBe(800);
    // centre-anchored: never emits a move op
    expect(state.applied.some((a) => a.op === 'move')).toBe(false);
  });

  it('resizes a rotated fixture in its own local frame', () => {
    const doc = emptyPlan();
    doc.fixtures.push(fixture('f1', 0, 0, 400, 400, 90)); // rotated 90°
    const { ctx, state } = makeFakeCtx({ pickResult: 'f1', selectedId: 'f1', doc });
    const select = selectToolFrom(ctx);
    // At 90° a corner sits at (∓200, ±200); grab one and pull out along +x world.
    const corner = { x: 200, y: 200 };
    select.onDown!(ptr(corner.x, corner.y, 'pinch'));
    select.onMove!(ptr(600, 200, 'pinch')); // world dx=600 → local depth axis (rotated)
    const sz = state.applied.find((a) => a.op === 'set_size') as { w: number; d: number } | undefined;
    expect(sz).toBeDefined();
    expect(sz!.d).toBe(1200); // world +x maps to the fixture's local depth at 90°
  });

  it('a pinch gets a forgiving corner grab radius a mouse does not', () => {
    const make = (source: 'mouse' | 'pinch') => {
      const doc = emptyPlan();
      doc.fixtures.push(fixture('f1', 0, 0));
      const { ctx, state } = makeFakeCtx({ pickResult: 'f1', selectedId: 'f1', doc });
      const select = selectToolFrom(ctx);
      select.onDown!(ptr(214, 214, source)); // ~19.8px off the corner — mouse miss, pinch hit
      select.onMove!(ptr(300, 300, source));
      return state.applied.some((a) => a.op === 'set_size');
    };
    expect(make('mouse')).toBe(false);
    expect(make('pinch')).toBe(true);
  });
});

describe('B-122 opening width by dragging a jamb on canvas', () => {
  // wall along +x, 1000mm; door spans offset 300 .. 700 (width 400).
  function setup() {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    doc.openings.push(opening('o1', 'w1', 300, 400));
    return makeFakeCtx({ pickResult: 'o1', selectedId: 'o1', doc });
  }

  it.each(['mouse', 'pinch'] as const)('%s: dragging the far jamb widens via set_width, near edge fixed', (source) => {
    const { ctx, state } = setup();
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(700, 0, source)); // far jamb
    select.onMove!(ptr(900, 0, source)); // pull toward b
    const sw = state.applied.find((a) => a.op === 'set_width') as { width: number } | undefined;
    expect(sw?.width).toBe(600); // 900 - offset(300)
    // far-edge drag keeps the near edge: it's a plain set_width, not a batch
    expect(state.applied.some((a) => a.op === 'batch')).toBe(false);
  });

  it('dragging the near jamb keeps the far edge anchored (batched set_width + move_opening)', () => {
    const { ctx, state } = setup();
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(300, 0, 'pinch')); // near jamb
    select.onMove!(ptr(100, 0, 'pinch')); // pull toward a
    const batch = state.applied.find((a) => a.op === 'batch') as { ops: Array<Record<string, unknown>> } | undefined;
    expect(batch).toBeDefined();
    const sw = batch!.ops.find((o) => o.op === 'set_width') as { width: number };
    const mv = batch!.ops.find((o) => o.op === 'move_opening') as { offset: number };
    expect(sw.width).toBe(600); // farEdge(700) - 100
    expect(mv.offset).toBe(100); // new near edge; far edge stays at 700
  });

  it('a pinch gets a forgiving jamb grab radius a mouse does not', () => {
    const grab = (source: 'mouse' | 'pinch') => {
      const { ctx, state } = setup();
      const select = selectToolFrom(ctx);
      select.onDown!(ptr(700, 18, source)); // 18px off the far jamb — mouse miss, pinch hit
      select.onMove!(ptr(900, 0, source));
      return state.applied.some((a) => a.op === 'set_width' || a.op === 'batch');
    };
    expect(grab('mouse')).toBe(false);
    expect(grab('pinch')).toBe(true);
  });
});

describe('B-120 room resize by dragging a corner', () => {
  // A 1000×1000 room: four walls looping (0,0)→(1000,0)→(1000,1000)→(0,1000).
  function setup() {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    doc.walls.push(wall('w2', 1000, 0, 1000, 1000));
    doc.walls.push(wall('w3', 1000, 1000, 0, 1000));
    doc.walls.push(wall('w4', 0, 1000, 0, 0));
    doc.rooms.push({ id: 'r1', name: 'Room', wallIds: ['w1', 'w2', 'w3', 'w4'] });
    return makeFakeCtx({ pickResult: 'r1', selectedId: 'r1', doc });
  }

  it.each(['mouse', 'pinch'] as const)('%s: grabbing a corner drives move_end on the owning wall (cascade pulls the neighbour)', (source) => {
    const { ctx, state } = setup();
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(0, 0, source)); // the (0,0) corner
    select.onMove!(ptr(-200, 0, source)); // pull it out
    const mv = state.applied.find((a) => a.op === 'move_end') as { target: string; end: string; x: number; y: number } | undefined;
    expect(mv).toBeDefined();
    expect(mv!.end).toBe('a'); // w1.a sits at (0,0)
    expect(mv!.x).toBe(-200);
    expect(mv!.y).toBe(0);
  });

  it('a pinch gets a forgiving corner grab radius a mouse does not', () => {
    const grab = (source: 'mouse' | 'pinch') => {
      const { ctx, state } = setup();
      const select = selectToolFrom(ctx);
      select.onDown!(ptr(0, 18, source)); // 18px off the corner
      select.onMove!(ptr(-200, 0, source));
      return state.applied.some((a) => a.op === 'move_end');
    };
    expect(grab('mouse')).toBe(false);
    expect(grab('pinch')).toBe(true);
  });
});
