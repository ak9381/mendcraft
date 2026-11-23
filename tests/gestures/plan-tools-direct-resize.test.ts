// B14 direct-manipulation resize gaps: on-canvas drag handles that previously
// existed for NEITHER mouse nor hand. Drives the real select tool through the
// fake ToolContext. See tests/gestures/toolCtxFake.ts.
import { describe, expect, it } from 'vitest';
import { createPlanTools } from '../../src/plan/tools';
import { emptyPlan, type Fixture } from '../../src/plan/doc';
import { makeFakeCtx, ptr } from './toolCtxFake';

const fixture = (id: string, x: number, y: number, w = 400, d = 400, rotation = 0): Fixture => ({
  id, kind: 'chair', x, y, w, d, rotation,
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
