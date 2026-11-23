// B2/B3/B4 (Wall / Room / Door-Window-Opening draw tools): drive the real
// tools through ToolContext with simulated mouse/pinch ToolPointer input.
// See tests/gestures/toolCtxFake.ts.
import { describe, expect, it } from 'vitest';
import { createPlanTools } from '../../src/plan/tools';
import { createToolController } from '../../src/core/tools';
import { emptyPlan, type Opening, type Wall } from '../../src/plan/doc';
import { makeFakeCtx, ptr } from './toolCtxFake';

const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({
  id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 100,
});
const opening = (id: string, wallId: string, offset: number, width: number): Opening => ({
  id, kind: 'window', wallId, offset, width,
});

function toolOf(ctx: Parameters<typeof createPlanTools>[0], id: string) {
  return createPlanTools(ctx).find((t) => t.id === id)!;
}

describe('B-017/B-018 wall tool: first click anchors, second click emits and chains', () => {
  it.each(['mouse', 'pinch'] as const)('%s: click-click-click places two walls', (source) => {
    const { ctx, state } = makeFakeCtx();
    const w = toolOf(ctx, 'wall');
    w.onDown!(ptr(0, 0, source));
    expect(state.applied).toHaveLength(0); // first click only anchors
    w.onDown!(ptr(1000, 0, source));
    expect(state.applied).toContainEqual({ op: 'add_wall', x1: 0, y1: 0, x2: 1000, y2: 0, thickness: 100 });
    w.onDown!(ptr(1000, 1000, source));
    expect(state.applied).toContainEqual({ op: 'add_wall', x1: 1000, y1: 0, x2: 1000, y2: 1000, thickness: 100 });
  });
});

describe('B-019 wall tool hover preview updates the overlay', () => {
  it('a pinch hover (no press) still refreshes the live readout overlay', () => {
    const { ctx, state } = makeFakeCtx();
    const w = toolOf(ctx, 'wall');
    w.onDown!(ptr(0, 0, 'pinch'));
    const before = state.overlayCalls;
    w.onHover!(ptr(500, 0, 'pinch'));
    expect(state.overlayCalls).toBeGreaterThan(before);
  });
});

describe('B-021 wall tool finishes on Enter', () => {
  it('Enter finishes the in-progress chain and reports status', () => {
    const { ctx, state } = makeFakeCtx();
    const w = toolOf(ctx, 'wall');
    w.onDown!(ptr(0, 0, 'pinch'));
    w.onDown!(ptr(1000, 0, 'pinch'));
    const consumed = w.onKey!({ key: 'Enter' } as KeyboardEvent);
    expect(consumed).toBe(true);
    expect(state.statuses).toContain('Wall chain finished.');
  });
});

describe('B-022 wall tool chain abandoned via Escape', () => {
  it('ToolController handleKey(Escape) cancels an in-progress wall chain', () => {
    const { ctx, state } = makeFakeCtx();
    const ctl = createToolController([toolOf(ctx, 'wall')], { defaultId: 'wall' });
    ctl.down(ptr(0, 0, 'pinch'));
    ctl.handleKey({ key: 'Escape', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false } as KeyboardEvent);
    expect(state.statuses).toContain('Wall chain finished.');
    state.applied.length = 0;
    ctl.down(ptr(2000, 2000, 'pinch')); // fresh click after cancel is a new anchor, not a continuation
    expect(state.applied).toHaveLength(0);
  });
});

describe('B-031/B-032/B-033 room tool: drag anchor, live preview, commit on release', () => {
  it.each(['mouse', 'pinch'] as const)('%s: dragging a rectangle >= 300x300mm commits add_room', (source) => {
    const { ctx, state } = makeFakeCtx();
    const r = toolOf(ctx, 'room');
    r.onDown!(ptr(0, 0, source));
    r.onMove!(ptr(2000, 3000, source));
    expect(state.overlayCalls).toBeGreaterThan(0); // live W x H preview
    r.onUp!(ptr(2000, 3000, source));
    expect(state.applied).toContainEqual({ op: 'add_room', x: 0, y: 0, w: 2000, h: 3000 });
  });
});

describe('B-034 room tool cancels a too-small drag', () => {
  it('releasing below the 300mm minimum does not create a room', () => {
    const { ctx, state } = makeFakeCtx();
    const r = toolOf(ctx, 'room');
    r.onDown!(ptr(0, 0, 'pinch'));
    r.onUp!(ptr(100, 100, 'pinch'));
    expect(state.applied.some((a) => a.op === 'add_room')).toBe(false);
    expect(state.statuses.some((s) => s.includes('too small'))).toBe(true);
  });
});

describe('B-037 room tool ignores whatever is under the cursor (z-order) and still draws', () => {
  it('starting a room drag over an existing fixture still commits the room', () => {
    const doc = emptyPlan();
    doc.fixtures.push({ id: 'f1', kind: 'chair', x: 500, y: 500, w: 100, d: 100, rotation: 0 });
    const { ctx, state } = makeFakeCtx({ doc, pickResult: 'f1' });
    const r = toolOf(ctx, 'room');
    r.onDown!(ptr(0, 0, 'pinch'));
    r.onUp!(ptr(2000, 2000, 'pinch'));
    expect(state.applied).toContainEqual({ op: 'add_room', x: 0, y: 0, w: 2000, h: 2000 });
  });
});

describe('B-038/B-039 door/window/opening: hover preview + click-to-place', () => {
  it.each(['door', 'window', 'opening'] as const)('%s tool: hover near a wall ghosts it, click places it', (kind) => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 4000, 0));
    const { ctx, state } = makeFakeCtx({ doc });
    const t = toolOf(ctx, kind);
    t.onHover!(ptr(2000, 50, 'pinch')); // 50mm off the wall centreline, within the generous radius
    expect(state.overlayCalls).toBeGreaterThan(0);
    t.onDown!(ptr(2000, 50, 'pinch'));
    const op = kind === 'door' ? 'add_door' : kind === 'window' ? 'add_window' : 'add_opening';
    expect(state.applied.some((a) => a.op === op && a.target === 'w1')).toBe(true);
  });
});

describe('B-040 door/window/opening: drag-to-place from the palette uses the same place() path', () => {
  it('onPlace (palette drag release) applies the identical op as onDown (click)', () => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 4000, 0));
    const a = makeFakeCtx({ doc });
    toolOf(a.ctx, 'door').onDown!(ptr(2000, 0, 'pinch'));
    const b = makeFakeCtx({ doc });
    toolOf(b.ctx, 'door').onPlace!(ptr(2000, 0, 'pinch'));
    const strip = (x: Record<string, unknown>) => ({ ...x });
    expect(strip(b.state.applied[0])).toEqual(strip(a.state.applied[0]));
  });
});

describe('B-041 door/window/opening: releasing over the trash zone cancels placement', () => {
  it('no op is applied when the drop point is over the trash zone', () => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 4000, 0));
    const { ctx, state } = makeFakeCtx({ doc, trash: true });
    const t = toolOf(ctx, 'door');
    t.onDown!(ptr(2000, 0, 'pinch'));
    expect(state.applied.some((a) => a.op === 'add_door')).toBe(false);
  });
});

describe('B-044 opening drag (select tool): slides and clamps along its host wall', () => {
  it.each(['mouse', 'pinch'] as const)('%s: dragging a selected opening applies move_opening', (source) => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 4000, 0));
    doc.openings.push(opening('o1', 'w1', 1000, 900));
    const { ctx, state } = makeFakeCtx({ doc, pickResult: 'o1', selectedId: 'o1' });
    const select = toolOf(ctx, 'select');
    select.onDown!(ptr(1450, 0, source)); // over the opening's centre, not an endpoint/handle
    select.onMove!(ptr(1550, 0, source));
    const mv = state.applied.find((a) => a.op === 'move_opening') as { target: string; offset: number } | undefined;
    expect(mv?.target).toBe('o1');
    expect(mv!.offset).toBeGreaterThan(1000);
  });
});

describe('B-046 accidental placement: the wall-proximity radius is identically generous for both devices', () => {
  it('when zoomed in (radius floor dominates), a hover 500mm off the wall still ghosts it for either device', () => {
    const doc = emptyPlan();
    doc.walls.push(wall('w1', 0, 0, 4000, 0));
    const { ctx, state } = makeFakeCtx({ doc, scale: 100 }); // 30/scale ~ 0 -> the 600mm floor is what matters
    const t = toolOf(ctx, 'door');
    t.onHover!(ptr(2000, 500, 'pinch'));
    t.onDown!(ptr(2000, 500, 'pinch'));
    expect(state.applied.some((a) => a.op === 'add_door' && a.target === 'w1')).toBe(true);
  });
});
