// B12/B13 (Rotate handle + wall endpoint resize): drive the real select tool's
// rotate-handle and endpoint-handle grab+drag paths with simulated
// mouse/pinch ToolPointer input. See tests/gestures/toolCtxFake.ts.
import { describe, expect, it } from 'vitest';
import { createPlanTools } from '../../src/plan/tools';
import { emptyPlan, type Fixture, type Wall } from '../../src/plan/doc';
import { makeFakeCtx, ptr } from './toolCtxFake';

const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({
  id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 100,
});
const fixture = (id: string, x: number, y: number, rotation = 0): Fixture => ({
  id, kind: 'chair', x, y, w: 400, d: 400, rotation,
});

function selectToolFrom(ctx: Parameters<typeof createPlanTools>[0]) {
  return createPlanTools(ctx).find((t) => t.id === 'select')!;
}

describe('B-063/B-105 rotate handle: grab within 12px, drag rotates with 15° snap', () => {
  it.each(['mouse', 'pinch'] as const)('%s: grabbing the handle and dragging applies a rotate op', (source) => {
    const doc = emptyPlan();
    doc.fixtures.push(fixture('f1', 0, 0));
    const { ctx, state } = makeFakeCtx({ pickResult: 'f1', selectedId: 'f1', doc });
    const select = selectToolFrom(ctx);
    // handle sits at (0, d/2 + 30/scale) = (0, 230) when rotation is 0
    select.onDown!(ptr(0, 230, source));
    select.onMove!(ptr(150, 190, source)); // implies an angle that snaps to 45°
    const rot = state.applied.find((a) => a.op === 'rotate') as { target: string; angle: number } | undefined;
    expect(rot?.target).toBe('f1');
    expect(rot!.angle % 15).toBeCloseTo(0, 5);
  });
});

describe('B-108 rotate cancel mid-drag', () => {
  it('onCancel drops the drag so a later onMove no longer rotates', () => {
    const doc = emptyPlan();
    doc.fixtures.push(fixture('f1', 0, 0));
    const { ctx, state } = makeFakeCtx({ pickResult: 'f1', selectedId: 'f1', doc });
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(0, 230, 'pinch'));
    select.onCancel!();
    state.applied.length = 0;
    select.onMove!(ptr(150, 190, 'pinch'));
    expect(state.applied.some((a) => a.op === 'rotate')).toBe(false);
  });
});

describe('B-110 tremor: an off-centre grab still within the 12px handle radius rotates fine', () => {
  it('a slightly off (dist ~11px) pinch still grabs the handle, and the 15° snap absorbs jitter', () => {
    const doc = emptyPlan();
    doc.fixtures.push(fixture('f1', 0, 0));
    const { ctx, state } = makeFakeCtx({ pickResult: 'f1', selectedId: 'f1', doc });
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(8, 238, 'pinch')); // ~11.3px from (0,230), inside the 12px handle radius
    select.onMove!(ptr(150, 190, 'pinch'));
    expect(state.applied.some((a) => a.op === 'rotate')).toBe(true);
  });
});

describe('B-112/B-113/B-114 wall endpoint stretch (move_end), both ends symmetric', () => {
  it.each(['mouse', 'pinch'] as const)('%s: grabbing the A-end and dragging applies move_end for "a"', (source) => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    const { ctx, state } = makeFakeCtx({ pickResult: 'w1', selectedId: 'w1', doc });
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(0, 0, source)); // on wall.a
    select.onMove!(ptr(-200, 0, source));
    const mv = state.applied.find((a) => a.op === 'move_end') as { end: string } | undefined;
    expect(mv?.end).toBe('a');
  });

  it('grabbing the B-end (symmetric) applies move_end for "b"', () => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    const { ctx, state } = makeFakeCtx({ pickResult: 'w1', selectedId: 'w1', doc });
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(1000, 0, 'pinch')); // on wall.b
    select.onMove!(ptr(1200, 0, 'pinch'));
    const mv = state.applied.find((a) => a.op === 'move_end') as { end: string } | undefined;
    expect(mv?.end).toBe('b');
  });
});

describe('B-119 endpoint hit-radius boundary (10px, not profile-scaled)', () => {
  it('a grab exactly at 10px still hits; just past it (11px) misses and falls through to a body-drag/select', () => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    const h = makeFakeCtx({ pickResult: 'w1', selectedId: 'w1', doc });
    const tool = selectToolFrom(h.ctx);
    tool.onDown!(ptr(0, 10, 'pinch')); // dist 10 from wall.a — within radius
    tool.onMove!(ptr(0, 50, 'pinch'));
    expect(h.state.applied.some((a) => a.op === 'move_end')).toBe(true);

    const miss = makeFakeCtx({ pickResult: 'w1', selectedId: 'w1', doc });
    const tool2 = selectToolFrom(miss.ctx);
    tool2.onDown!(ptr(0, 11, 'pinch')); // dist 11 — just outside the 10px radius
    tool2.onMove!(ptr(0, 50, 'pinch'));
    expect(miss.state.applied.some((a) => a.op === 'move_end')).toBe(false);
  });
});
