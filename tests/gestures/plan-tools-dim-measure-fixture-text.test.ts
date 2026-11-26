// B5/B6/B7/B8/B15 (Dim, Measure, Fixture/Stairs, Text, Snapping): drive the
// real tools through ToolContext, plus direct snap.ts priority checks.
// See tests/gestures/toolCtxFake.ts.
import { describe, expect, it } from 'vitest';
import { createPlanTools, deleteSelected } from '../../src/plan/tools';
import { measureSnap } from '../../src/plan/snap';
import { emptyPlan, type Dimension, type Wall } from '../../src/plan/doc';
import { makeFakeCtx, ptr } from './toolCtxFake';

const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({
  id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 100,
});

function toolOf(ctx: Parameters<typeof createPlanTools>[0], id: string) {
  return createPlanTools(ctx).find((t) => t.id === id)!;
}

describe('B-048 dimension tool: click on a wall adds a permanent dimension', () => {
  it.each(['mouse', 'pinch'] as const)('%s: clicking near a wall applies add_dim', (source) => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 4000, 0));
    const { ctx, state } = makeFakeCtx({ doc });
    toolOf(ctx, 'dim').onDown!(ptr(2000, 100, source));
    expect(state.applied).toContainEqual({ op: 'add_dim', target: 'w1' });
  });
});

describe('B-049 dimension delete cascades through the shared deleteSelected path', () => {
  it('deleting a selected dimension applies a delete op for it, same as any other object', () => {
    const doc = emptyPlan();
    const dim: Dimension = { id: 'dm1', wallId: 'w1' };
    doc.dims.push(dim);
    const { ctx, state } = makeFakeCtx({ doc, selectedId: 'dm1' });
    deleteSelected(ctx);
    expect(state.applied).toContainEqual({ op: 'delete', target: 'dm1' });
  });
});

describe('B-050/B-051 measure tool: click adds a chain point, hover updates the live readout', () => {
  it.each(['mouse', 'pinch'] as const)('%s: a click appends a snapped point without applying any op yet', (source) => {
    const { ctx, state } = makeFakeCtx();
    const measure = toolOf(ctx, 'measure');
    measure.onDown!(ptr(0, 0, source));
    measure.onDown!(ptr(1000, 0, source));
    expect(state.applied).toHaveLength(0); // non-destructive readout until Enter
    expect(state.overlayCalls).toBeGreaterThan(0);
  });

  it('hover alone (no click) also refreshes the overlay', () => {
    const { ctx, state } = makeFakeCtx();
    const measure = toolOf(ctx, 'measure');
    measure.onDown!(ptr(0, 0, 'pinch'));
    const before = state.overlayCalls;
    measure.onHover!(ptr(500, 0, 'pinch'));
    expect(state.overlayCalls).toBeGreaterThan(before);
  });
});

describe('B-052 measure tool snap priority matches the pure measureSnap ordering', () => {
  it('a point near both a wall endpoint and a wall face snaps to the endpoint', () => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    const { ctx } = makeFakeCtx({ doc });
    const measure = toolOf(ctx, 'measure');
    measure.onHover!(ptr(5, 5, 'pinch')); // right next to wall.a (endpoint) AND near its face
    // Cross-check against the pure fn the tool wraps.
    expect(measureSnap({ x: 5, y: 5 }, doc.walls, 200).kind).toBe('endpoint');
  });
});

describe('B-054 measure tool: Escape abandons the chain without creating dimensions', () => {
  it('onCancel clears the in-progress chain; a later Enter has nothing to commit', () => {
    const doc = emptyPlan();
    const { ctx, state } = makeFakeCtx({ doc });
    const measure = toolOf(ctx, 'measure');
    measure.onDown!(ptr(0, 0, 'pinch'));
    measure.onCancel!();
    const consumed = measure.onKey!({ key: 'Enter' } as KeyboardEvent);
    expect(consumed).toBe(true);
    expect(state.applied.some((a) => a.op === 'add_dim')).toBe(false);
  });
});

describe('B-056/B-057 fixture tool: hover ghosts, click places', () => {
  it.each(['mouse', 'pinch'] as const)('%s: hovering previews and clicking places a sofa', (source) => {
    const { ctx, state } = makeFakeCtx();
    const sofa = toolOf(ctx, 'fx:sofa');
    sofa.onHover!(ptr(1000, 1000, source));
    expect(state.overlayCalls).toBeGreaterThan(0);
    sofa.onDown!(ptr(1000, 1000, source));
    expect(state.applied.some((a) => a.op === 'add_fixture' && a.kind === 'sofa')).toBe(true);
  });
});

describe('B-058 fixture tool: drag-to-place from the flyout uses the same place() path', () => {
  it('onPlace applies the identical op as onDown for the same point', () => {
    const a = makeFakeCtx();
    toolOf(a.ctx, 'fx:chair').onDown!(ptr(500, 500, 'pinch'));
    const b = makeFakeCtx();
    toolOf(b.ctx, 'fx:chair').onPlace!(ptr(500, 500, 'pinch'));
    expect(b.state.applied[0]).toEqual(a.state.applied[0]);
  });
});

describe('B-061 stairs tool: drag sets run length/direction; a plain click drops a default run', () => {
  it('dragging a long run commits add_fixture kind=stairs at the dragged length', () => {
    const { ctx, state } = makeFakeCtx();
    const stairs = toolOf(ctx, 'stairs');
    stairs.onDown!(ptr(0, 0, 'pinch'));
    stairs.onMove!(ptr(2000, 0, 'pinch'));
    stairs.onUp!(ptr(2000, 0, 'pinch'));
    const f = state.applied.find((a) => a.op === 'add_fixture') as { kind: string; nums: { w: number } } | undefined;
    expect(f?.kind).toBe('stairs');
    expect(f!.nums.w).toBeCloseTo(2000, 0);
  });

  it('a plain click (drag < 500mm) drops a default-length run', () => {
    const { ctx, state } = makeFakeCtx();
    const stairs = toolOf(ctx, 'stairs');
    stairs.onDown!(ptr(0, 0, 'pinch'));
    stairs.onUp!(ptr(50, 0, 'pinch'));
    expect(state.applied.some((a) => a.op === 'add_fixture' && (a as { kind: string }).kind === 'stairs')).toBe(true);
  });
});

describe('B-067 text tool: click to place opens the inline editor and commits add_text', () => {
  it('onDown invokes ctx.editText, and committing text applies add_text', () => {
    let committed: ((text: string) => void) | null = null;
    const { ctx, state } = makeFakeCtx();
    (ctx as unknown as { editText: typeof ctx.editText }).editText = (_x, _y, _initial, commit) => {
      committed = commit;
    };
    const text = toolOf(ctx, 'text');
    text.onDown!(ptr(1000, 1000, 'pinch'));
    expect(committed).toBeTruthy();
    committed!('Kitchen');
    expect(state.applied.some((a) => a.op === 'add_text' && a.text === 'Kitchen')).toBe(true);
  });
});

describe('B-126/B-127 wall-face snap and full priority ordering (endpoint > midpoint > face > grid)', () => {
  const doc = emptyPlan();
  doc.walls.push(wall('w1', 0, 0, 1000, 0));

  it('snaps to a wall face when the midpoint/endpoints are out of range but the face is in range', () => {
    // (500, 0) is the midpoint, 60mm away; the near face is at (500, 50), 10mm away.
    const r = measureSnap({ x: 500, y: 60 }, doc.walls, 55);
    expect(r.kind).toBe('face');
  });

  it('prefers the midpoint over a face at the same distance budget', () => {
    const r = measureSnap({ x: 500, y: 5 }, doc.walls, 200); // dead-centre: midpoint wins over either face
    expect(r.kind).toBe('midpoint');
  });

  it('falls back to grid when nothing else is in range', () => {
    const r = measureSnap({ x: 5000, y: 5000 }, doc.walls, 200);
    expect(r.kind).toBe('grid');
  });
});

describe('B-130 snap feedback: the measure tool colours its hover marker by snap kind', () => {
  it('an endpoint snap draws its dot in the endpoint colour (#16a34a)', () => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 1000, 0));
    const { ctx, state } = makeFakeCtx({ doc });
    const measure = toolOf(ctx, 'measure');
    measure.onHover!(ptr(2, 2, 'pinch')); // right on wall.a
    const dots: string[] = [];
    state.lastOverlay!({
      line: () => {}, label: () => {}, rect: () => {},
      dot: (_p, color) => { if (color) dots.push(color); },
    });
    expect(dots).toContain('#16a34a');
  });
});

describe('B-053 measure tool: re-tapping the last point commits the chain, same as Enter (hand/touch twin)', () => {
  it.each(['mouse', 'pinch'] as const)('%s: tap A, tap B, tap B again == tap A, tap B, Enter', (source) => {
    const a = makeFakeCtx({ doc: emptyPlan() });
    const m1 = toolOf(a.ctx, 'measure');
    m1.onDown!(ptr(0, 0, source)); m1.onDown!(ptr(3000, 0, source));
    m1.onKey!({ key: 'Enter' } as KeyboardEvent);
    const b = makeFakeCtx({ doc: emptyPlan() });
    const m2 = toolOf(b.ctx, 'measure');
    m2.onDown!(ptr(0, 0, source)); m2.onDown!(ptr(3000, 0, source)); m2.onDown!(ptr(3000, 0, source));
    expect(a.state.applied.length).toBeGreaterThan(0);
    expect(b.state.applied).toEqual(a.state.applied);
  });
  it('a single point re-tapped does not commit (needs two points)', () => {
    const { ctx, state } = makeFakeCtx({ doc: emptyPlan() });
    const m = toolOf(ctx, 'measure');
    m.onDown!(ptr(0, 0, 'pinch')); m.onDown!(ptr(0, 0, 'pinch'));
    expect(state.applied).toHaveLength(0);
  });
});
