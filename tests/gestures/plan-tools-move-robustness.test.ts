// B11 (Move) remaining rows: single-fixture drag, tremor jitter, a fast
// under-sampled flick, losing hand-tracking mid-drag, and far-off-canvas
// coordinates. Drives the real select tool via ToolContext (see
// tests/gestures/toolCtxFake.ts). B-092 (opening slide) is the SAME code path
// already exercised by B-044 in plan-tools-draw-wall-room-opening.test.ts.
import { describe, expect, it } from 'vitest';
import { createPlanTools } from '../../src/plan/tools';
import { emptyPlan, type Fixture } from '../../src/plan/doc';
import { makeFakeCtx, ptr } from './toolCtxFake';

const fixture = (id: string, x: number, y: number): Fixture => ({
  id, kind: 'chair', x, y, w: 400, d: 400, rotation: 0,
});

function selectToolFrom(ctx: Parameters<typeof createPlanTools>[0]) {
  return createPlanTools(ctx).find((t) => t.id === 'select')!;
}

describe('B-091 single fixture drag-to-move', () => {
  it.each(['mouse', 'pinch'] as const)('%s: dragging a fixture applies a move op for it', (source) => {
    const doc = emptyPlan();
    doc.fixtures.push(fixture('f1', 1000, 1000));
    const { ctx, state } = makeFakeCtx({ pickResult: 'f1', selectedId: 'f1', doc });
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(1000, 1000, source));
    select.onMove!(ptr(1200, 1000, source));
    const mv = state.applied.find((a) => a.op === 'move') as { target: string; dx: number } | undefined;
    expect(mv?.target).toBe('f1');
    expect(mv!.dx).toBeCloseTo(200, 0);
  });
});

describe('B-098 tremor: small jittery moves still converge on the same grid-snapped target', () => {
  it('several tiny back-and-forth moves all resolve to the identical snapped delta, not drift', () => {
    const doc = emptyPlan();
    doc.fixtures.push(fixture('f1', 1000, 1000));
    const { ctx, state } = makeFakeCtx({ pickResult: 'f1', selectedId: 'f1', doc });
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(1000, 1000, 'pinch'));
    // A shaky hand overshoots and corrects a few times before settling near +200mm.
    for (const [x, y] of [[1198, 1002], [1203, 999], [1197, 1001], [1200, 1000]]) {
      select.onMove!(ptr(x, y, 'pinch'));
    }
    const moves = state.applied.filter((a) => a.op === 'move') as Array<{ dx: number }>;
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) expect(m.dx).toBeCloseTo(200, 0); // grid snap absorbs the jitter every time
  });
});

describe('B-099 a fast under-sampled flick (one big jump, no intermediate frames) still lands correctly', () => {
  it('a single large onMove (simulating a dropped camera frame) applies the full delta, not a partial one', () => {
    const doc = emptyPlan();
    doc.fixtures.push(fixture('f1', 0, 0));
    const { ctx, state } = makeFakeCtx({ pickResult: 'f1', selectedId: 'f1', doc });
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(0, 0, 'pinch'));
    select.onMove!(ptr(5000, 0, 'pinch')); // one big jump, as if several frames were skipped
    const mv = state.applied.find((a) => a.op === 'move') as { dx: number } | undefined;
    expect(mv!.dx).toBeCloseTo(5000, 0);
  });
});

describe('B-100 losing hand-tracking mid-drag: cancel() leaves no stale drag state', () => {
  it('onCancel after a down (no onUp ever fired) fully clears the drag; the next down starts clean', () => {
    const doc = emptyPlan();
    doc.fixtures.push(fixture('f1', 0, 0));
    doc.fixtures.push(fixture('f2', 2000, 2000));
    const { ctx, state } = makeFakeCtx({ pickResult: 'f1', selectedId: 'f1', doc });
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(0, 0, 'pinch'));
    select.onMove!(ptr(100, 0, 'pinch'));
    // The hand vanishes here — main.ts's tracking-lost handler is expected to
    // call cancel() (unverified wiring; this test covers the tool's own side).
    select.onCancel!();
    state.applied.length = 0;
    state.pickResult = 'f2';
    state.selectedId = 'f2';
    select.onDown!(ptr(2000, 2000, 'pinch'));
    select.onMove!(ptr(2100, 2000, 'pinch'));
    const mv = state.applied.find((a) => a.op === 'move') as { target: string } | undefined;
    expect(mv?.target).toBe('f2'); // not contaminated by the abandoned f1 drag
  });
});

describe('B-101 drag near/at the edge of the canvas (far-off or negative coordinates)', () => {
  it('a drag entirely in negative coordinate space works the same as anywhere else', () => {
    const doc = emptyPlan();
    doc.fixtures.push(fixture('f1', -5000, -5000));
    const { ctx, state } = makeFakeCtx({ pickResult: 'f1', selectedId: 'f1', doc });
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(-5000, -5000, 'pinch'));
    select.onMove!(ptr(-4800, -5000, 'pinch'));
    const mv = state.applied.find((a) => a.op === 'move') as { dx: number } | undefined;
    expect(mv!.dx).toBeCloseTo(200, 0);
  });
});
