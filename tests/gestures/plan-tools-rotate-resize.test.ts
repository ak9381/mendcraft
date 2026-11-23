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

describe('B-119 endpoint hit-radius boundary (mouse precise, hand forgiving)', () => {
  function grabEnd(source: 'mouse' | 'pinch', dist: number): boolean {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    const h = makeFakeCtx({ pickResult: 'w1', selectedId: 'w1', doc });
    const tool = selectToolFrom(h.ctx);
    tool.onDown!(ptr(0, dist, source)); // dist px straight off wall.a
    tool.onMove!(ptr(0, 50, source));
    return h.state.applied.some((a) => a.op === 'move_end');
  }
  it('mouse keeps the tight 10px target: exactly 10 hits, 11 misses', () => {
    expect(grabEnd('mouse', 10)).toBe(true);
    expect(grabEnd('mouse', 11)).toBe(false);
  });
});

// B-111: the wall-endpoint handle was a 10px target for BOTH devices, far below
// the app's 56px aim-radius standard — punishing for a hand. It is now forgiving
// for pinch while a mouse stays precise.
describe('B-111 wall endpoint handle: forgiving pinch grab radius', () => {
  function grabEnd(source: 'mouse' | 'pinch', dist: number): boolean {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    const h = makeFakeCtx({ pickResult: 'w1', selectedId: 'w1', doc });
    const tool = selectToolFrom(h.ctx);
    tool.onDown!(ptr(0, dist, source));
    tool.onMove!(ptr(0, 50, source));
    return h.state.applied.some((a) => a.op === 'move_end');
  }
  it('a pinch 11px off the endpoint (a mouse miss) now grabs the endpoint', () => {
    expect(grabEnd('mouse', 11)).toBe(false);
    expect(grabEnd('pinch', 11)).toBe(true);
  });
  it('a pinch is forgiving out to ~26px but not unbounded', () => {
    expect(grabEnd('pinch', 25)).toBe(true);
    expect(grabEnd('pinch', 40)).toBe(false); // still falls through to body-drag/select
  });
});

// B-104: the fixture rotate handle was a 12px target for both devices; now a
// pinch gets the same forgiving radius as the endpoint handle.
describe('B-104 rotate handle: forgiving pinch grab radius', () => {
  function grabHandle(source: 'mouse' | 'pinch', off: number): boolean {
    const doc = emptyPlan();
    doc.fixtures.push(fixture('f1', 0, 0)); // handle at (0, 230) when rotation is 0
    const h = makeFakeCtx({ pickResult: 'f1', selectedId: 'f1', doc });
    const tool = selectToolFrom(h.ctx);
    tool.onDown!(ptr(0, 230 + off, source));
    tool.onMove!(ptr(150, 190, source));
    return h.state.applied.some((a) => a.op === 'rotate');
  }
  it('a pinch 20px off the handle (a mouse miss) still grabs it', () => {
    expect(grabHandle('mouse', 20)).toBe(false);
    expect(grabHandle('pinch', 20)).toBe(true);
  });
});
