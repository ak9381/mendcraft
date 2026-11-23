// B10/B11 (Select + Move): drive the REAL select tool (src/plan/tools.ts
// createPlanTools -> 'select') through its ToolContext with simulated
// mouse/pinch ToolPointer input. No renderer/DOM involved — see
// tests/gestures/toolCtxFake.ts for the fake ToolContext.
import { describe, expect, it } from 'vitest';
import { createPlanTools } from '../../src/plan/tools';
import { createToolController } from '../../src/core/tools';
import { emptyPlan, type Wall } from '../../src/plan/doc';
import { makeFakeCtx, ptr } from './toolCtxFake';

const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({
  id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 100,
});

function selectToolFrom(ctx: Parameters<typeof createPlanTools>[0]) {
  return createPlanTools(ctx).find((t) => t.id === 'select')!;
}

describe('B-078 single select tap (mouse vs pinch identical)', () => {
  it.each(['mouse', 'pinch'] as const)('%s: tapping an object selects it via select_set', (source) => {
    const { ctx, state } = makeFakeCtx({ pickResult: 'w1' });
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(10, 10, source));
    expect(state.applied).toContainEqual({ op: 'select_set', ids: ['w1'] });
  });
});

describe('B-086 tap on empty canvas clears the selection (no accidental-touch guard)', () => {
  it('a brief pinch on empty canvas is indistinguishable from a deliberate one and clears selection, same as mouse — BUG-shaped: no debounce exists for either device', () => {
    const { ctx, state } = makeFakeCtx({ pickResult: null, selectedId: 'w1' });
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(500, 500, 'pinch'));
    select.onUp!(ptr(500, 500, 'pinch'));
    expect(state.applied).toContainEqual({ op: 'select_set', ids: [] });
  });
});

describe('B-080 marquee drag over empty space', () => {
  it('drags a rectangle and selects everything the rect hits (mouse and pinch alike)', () => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 10, 10, 20, 10));
    const { ctx, state } = makeFakeCtx({ pickResult: null, doc });
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(0, 0, 'pinch'));
    select.onUp!(ptr(100, 100, 'pinch'));
    const sel = state.applied.find((a) => a.op === 'select_set') as { ids: string[] } | undefined;
    expect(sel?.ids).toEqual(['w1']);
  });
});

describe('B-083 Escape cancels an in-progress marquee', () => {
  it('ToolController handleKey(Escape) cancels the drag before release, so no selection op fires', () => {
    const { ctx, state } = makeFakeCtx({ pickResult: null });
    const select = selectToolFrom(ctx);
    const ctl = createToolController([select], { defaultId: 'select' });
    ctl.down(ptr(0, 0, 'pinch'));
    ctl.handleKey({ key: 'Escape', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false } as KeyboardEvent);
    ctl.up(ptr(50, 50, 'pinch'));
    expect(state.applied.some((a) => a.op === 'select_set')).toBe(false);
  });
});

describe('B-090 single wall drag-move', () => {
  it.each(['mouse', 'pinch'] as const)('%s: dragging a wall applies a move op with the same delta', (source) => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    const { ctx, state } = makeFakeCtx({ pickResult: 'w1', selectedId: 'w1', doc });
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(500, 0, source)); // mid-span, away from either endpoint handle
    select.onMove!(ptr(600, 0, source));
    const mv = state.applied.find((a) => a.op === 'move') as { dx: number; dy: number } | undefined;
    expect(mv).toBeTruthy();
    expect(mv!.dx).toBeCloseTo(100, 0);
  });
});

describe('B-094/095/096 ToolController down/move/up gating (mouse and pinch share one gate)', () => {
  it('move before any down() is a no-op; move after down() reaches the tool; up() commits', () => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    const { ctx, state } = makeFakeCtx({ pickResult: 'w1', selectedId: 'w1', doc });
    const ctl = createToolController([selectToolFrom(ctx)], { defaultId: 'select' });
    ctl.move(ptr(10, 0, 'pinch')); // no down yet — nothing should happen
    expect(state.applied).toHaveLength(0);
    const consumed = ctl.down(ptr(500, 0, 'pinch'));
    expect(consumed).toBe(true);
    ctl.move(ptr(600, 0, 'pinch'));
    expect(state.applied.length).toBeGreaterThan(0);
    ctl.up(ptr(600, 0, 'pinch'));
  });
});

describe('B-097 Escape mid single-object drag cancels without a further move applying', () => {
  it('onCancel clears the drag so a subsequent onMove is a no-op', () => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    const { ctx, state } = makeFakeCtx({ pickResult: 'w1', selectedId: 'w1', doc });
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(0, 0, 'pinch'));
    select.onCancel!();
    state.applied.length = 0;
    select.onMove!(ptr(999, 999, 'pinch'));
    expect(state.applied).toHaveLength(0);
  });
});

describe('B-102 z-order: hit-test only matters at drag-start, not during move', () => {
  it('changing what pick() would return mid-drag does not redirect the move to a different object', () => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    doc.walls.push(wall('w2', 0, 500, 1000, 500));
    const { ctx, state } = makeFakeCtx({ pickResult: 'w1', selectedId: 'w1', doc });
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(500, 0, 'pinch'));
    state.pickResult = 'w2'; // some other object now sits under the pointer
    select.onMove!(ptr(600, 0, 'pinch'));
    const mv = state.applied.find((a) => a.op === 'move') as { target: string } | undefined;
    expect(mv?.target).toBe('w1'); // still the one grabbed at down, not w2
  });
});

describe('B-134 drag-to-trash deletes an already-placed object (hands-only delete path)', () => {
  it.each(['mouse', 'pinch'] as const)('%s: releasing a dragged selection over the trash zone deletes it', (source) => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    const { ctx, state } = makeFakeCtx({ pickResult: 'w1', selectedId: 'w1', doc, trash: true });
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(500, 0, source));
    select.onMove!(ptr(500, 0, source)); // samples ctx.overTrash() into the drag's hover state
    select.onUp!(ptr(500, 0, source));
    expect(state.applied).toContainEqual({ op: 'delete', target: 'w1' });
  });

  it('releasing NOT over the trash zone does not delete', () => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    const { ctx, state } = makeFakeCtx({ pickResult: 'w1', selectedId: 'w1', doc, trash: false });
    const select = selectToolFrom(ctx);
    select.onDown!(ptr(500, 0, 'pinch'));
    select.onUp!(ptr(500, 0, 'pinch'));
    expect(state.applied.some((a) => a.op === 'delete')).toBe(false);
  });
});
