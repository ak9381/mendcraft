// Minimal fake ToolContext (src/core/tools.ts) for driving the real plan
// tools (src/plan/tools.ts createPlanTools) with simulated mouse/pinch
// ToolPointer input, without a renderer or DOM. apply() just records the op
// envelope — these tests assert on what WOULD be applied, not on engine
// mutation (the engine's own reducers are covered by tests/plan*.test.ts).
import type { OverlayDraw, ToolContext } from '../../src/core/tools';
import { emptyPlan, type PlanDoc } from '../../src/plan/doc';

export interface FakeCtxState {
  doc: PlanDoc;
  selectedId: string | null;
  pickResult: string | null;
  scale: number;
  trash: boolean;
  applied: Array<Record<string, unknown>>;
  overlayCalls: number;
  lastOverlay: ((ov: OverlayDraw) => void) | null;
  statuses: string[];
}

export function makeFakeCtx(initial: Partial<FakeCtxState> = {}): { ctx: ToolContext; state: FakeCtxState } {
  const state: FakeCtxState = {
    doc: initial.doc ?? emptyPlan(),
    selectedId: initial.selectedId ?? null,
    pickResult: initial.pickResult ?? null,
    scale: initial.scale ?? 1,
    trash: initial.trash ?? false,
    applied: [],
    overlayCalls: 0,
    lastOverlay: null,
    statuses: [],
  };
  const ctx: ToolContext = {
    apply(op) {
      state.applied.push(op as Record<string, unknown>);
      return { ok: true };
    },
    toWorld: (x, y) => ({ x, y }),
    toScreen: (p) => ({ x: p.x, y: p.y }),
    scale: () => state.scale,
    pick: () => state.pickResult,
    select: (id) => { state.selectedId = id; },
    selectedId: () => state.selectedId,
    snapshot: () => ({ ...state.doc, selectedId: state.selectedId, selectedIds: state.doc.selectedIds }),
    render: () => {},
    setOverlay: (draw) => { state.overlayCalls++; state.lastOverlay = draw; },
    setStatus: (text) => { state.statuses.push(text); },
    overTrash: () => state.trash,
    setTrashHover: () => {},
  };
  return { ctx, state };
}

/** A ToolPointer at (x, y) for the given source; pinch never carries shift. */
export const ptr = (x: number, y: number, source: 'mouse' | 'pinch' = 'mouse', shift = false) =>
  ({ x, y, source, ...(source === 'mouse' && shift ? { shift: true } : {}) });
