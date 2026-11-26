// A floor plan wired for hand tests with no DOM: the REAL plan controller
// (engine + undo), the REAL plan tools and tool controller, the REAL hand
// editor (plan/handEdit.ts) and the REAL hand pointer (createHandPointer),
// fed synthetic 21-landmark frames at real hand scale. Only the renderer is
// faked: a fixed linear view (px ↔ mm) standing in for the SVG.
import { createHandPointer, type HandPointer, type HandSurfaceEdit } from '../../src/canvas/handPointer';
import { createPlanController } from '../../src/plan/controller';
import { createPlanTools } from '../../src/plan/tools';
import { createToolController, type OverlayDraw, type ToolContext, type ToolController } from '../../src/core/tools';
import { createPlanHandEdit, type PlanHandEdit } from '../../src/plan/handEdit';
import { createPlanJournal, type JournalEntry, type PlanJournal } from '../../src/plan/editJournal';
import { pickPlan } from '../../src/plan/hitTest';
import type { PlanDoc } from '../../src/plan/doc';
import { fakeButton, fakeFrame, fakeHandDoc, type FakeEl } from './fakeHandDoc';
import { synthFist, synthHand } from './synthHands';

export const W = 1000;
export const H = 800;
export const FRAME = 33;
/** px per mm: 1 m = 100 px. World (0, 0) sits at screen (200, 700), y up. */
export const SCALE = 0.1;
const ORIGIN = { x: 200, y: 700 };
/** The drawing surface on screen (inside the board frame). */
export const SURFACE = { left: 120, top: 120, width: 760, height: 620 };
export const BOARD = { left: 100, top: 60, width: 800, height: 700 };

export const toScreen = (p: { x: number; y: number }) => ({ x: ORIGIN.x + p.x * SCALE, y: ORIGIN.y - p.y * SCALE });
export const toWorld = (x: number, y: number) => ({ x: (x - ORIGIN.x) / SCALE, y: -(y - ORIGIN.y) / SCALE });

export interface PlanHandRig {
  hp: HandPointer;
  controller: ReturnType<typeof createPlanController>;
  tools: ToolController;
  hand: PlanHandEdit;
  journal: PlanJournal;
  entries: JournalEntry[];
  doc(): PlanDoc;
  apply(op: Record<string, unknown>): void;
  statuses: string[];
  overlays: number;
  board: { phase: string }[];
  pans: { phase: string }[];
  zooms: { phase: string }[];
  /** Two-fist events the plan surface itself received (opts.zoom2). */
  planZooms: { phase: string; a: { x: number; y: number }; b: { x: number; y: number } }[];
  /** Hand edit on / off for the surface (off = the fist moves the board). */
  armed: boolean;
  t: number;
  open(x: number, y: number, frames?: number): void;
  fist(x: number, y: number, frames?: number): void;
  /** A fist travelling in a straight line, one frame per step. */
  fistTo(from: { x: number; y: number }, to: { x: number; y: number }, frames: number): void;
  /** Open and still, a short fist, open again: a fist TAP at (x, y). */
  tap(x: number, y: number): void;
  /** Open, close and hold (the grab starts), travel, settle, open. */
  stroke(from: { x: number; y: number }, to: { x: number; y: number }): void;
  destroy(): void;
}

export function planHandRig(buttons: FakeEl[] = [], opts: { zoom2?: boolean } = {}): PlanHandRig {
  (globalThis as Record<string, unknown>).innerWidth = W;
  (globalThis as Record<string, unknown>).innerHeight = H;
  const controller = createPlanController();
  const entries: JournalEntry[] = [];
  const journal = createPlanJournal(controller as never, (e) => entries.push(e));
  const statuses: string[] = [];
  const doc = (): PlanDoc => controller.snapshot() as PlanDoc;
  const rig = { overlays: 0 } as PlanHandRig;
  const ctx: ToolContext = {
    apply: (op) => controller.applyOp(op),
    toWorld,
    toScreen,
    scale: () => SCALE,
    pick: (x, y) => pickPlan(doc(), toWorld(x, y), SCALE, 0)?.id ?? null,
    select: (id) => { if (id) controller.selectId(id); },
    selectedId: () => controller.selectedId(),
    snapshot: () => doc(),
    render: () => {},
    setOverlay: (draw: ((ov: OverlayDraw) => void) | null) => { if (draw) rig.overlays++; },
    setStatus: (text) => { statuses.push(text); },
    overTrash: () => false,
    setTrashHover: () => {},
  };
  const tools = createToolController(createPlanTools(ctx), { defaultId: 'select' });
  const hand = createPlanHandEdit({
    ctx, tools,
    dropRedo: (n) => controller.dropRedo?.(n),
    aim: (x, y, r) => pickPlan(doc(), toWorld(x, y), SCALE, r / SCALE)?.id ?? null,
    onEdit: (summary) => journal.note(summary),
  });

  const frame = fakeFrame(BOARD, 'plan');
  const surface = fakeFrame(SURFACE, 'plan');
  surface.matches = () => false;
  surface.closest = (sel: string) => (sel === '[data-hand-surface]' ? surface : sel === '.mc-frame' ? frame : null);
  const edit: HandSurfaceEdit = {
    armed: () => rig.armed,
    drawing: () => hand.mode().kind !== 'select',
    tap: (x, y) => hand.tap(x, y),
    fistStart: (x, y) => hand.fistStart(x, y),
    fistMove: (x, y) => hand.fistMove(x, y),
    fistEnd: () => hand.fistEnd(),
    fistCancel: () => hand.fistCancel(),
    ...(opts.zoom2 ? { zoom2: (phase, a, b) => { if (phase !== 'end' && hand.busy()) hand.fistCancel(); rig.planZooms.push({ phase, a, b }); } } : {}),
  };
  (surface as unknown as { __mcHandSurface: unknown }).__mcHandSurface = {
    beginDrag: () => false, drag: () => {}, endDrag: () => {}, tap: () => {}, handEdit: edit,
  };
  const board: { phase: string }[] = [];
  const pans: { phase: string }[] = [];
  const zooms: { phase: string }[] = [];
  // Buttons on top, then the plan surface, then the board frame.
  const hd = fakeHandDoc(buttons, [frame], []);
  const inner = hd.elementFromPoint.bind(hd);
  const inside = (r: typeof SURFACE, x: number, y: number) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
  (hd as unknown as { elementFromPoint: (x: number, y: number) => unknown }).elementFromPoint = (x, y) => {
    const b = buttons.find((el) => inside(el.rect, x, y));
    if (b) return b;
    if (inside(SURFACE, x, y)) return surface;
    return inner(x, y);
  };
  const hp = createHandPointer(hd, {
    onBoardMove: (ev) => board.push(ev),
    onWorldPan: (ev) => pans.push(ev),
    onWorldZoom: (ev) => zooms.push(ev),
    dwellClick: () => false,
  });

  const feedOpen = (x: number, y: number) => { rig.t += FRAME; hp.update([synthHand(x, y, false, W, H)], rig.t); };
  const feedFist = (x: number, y: number) => { rig.t += FRAME; hp.update([synthFist(x, y, W, H)], rig.t); };
  Object.assign(rig, {
    hp, controller, tools, hand, journal, entries, doc, statuses, board, pans, zooms,
    armed: true, t: 0, planZooms: [],
    apply: (op: Record<string, unknown>) => { const r = controller.applyOp(op); if (!r.ok) throw new Error(r.error ?? 'op failed'); },
    open(x: number, y: number, frames = 1) { for (let i = 0; i < frames; i++) feedOpen(x, y); },
    fist(x: number, y: number, frames = 1) { for (let i = 0; i < frames; i++) feedFist(x, y); },
    fistTo(from: { x: number; y: number }, to: { x: number; y: number }, frames: number) {
      for (let i = 1; i <= frames; i++) feedFist(from.x + ((to.x - from.x) * i) / frames, from.y + ((to.y - from.y) * i) / frames);
    },
    tap(x: number, y: number) { rig.open(x, y, 10); rig.fist(x, y, 4); rig.open(x, y, 5); },
    stroke(from: { x: number; y: number }, to: { x: number; y: number }) {
      rig.open(from.x, from.y, 10);
      rig.fist(from.x, from.y, 14); // closes (2 frames) and passes the 300 ms hold
      rig.fistTo(from, to, 24);
      rig.fist(to.x, to.y, 12); // settle: the smoothed cursor arrives
      rig.open(to.x, to.y, 8); // past the release grace
    },
    destroy() {
      hp.destroy();
      delete (globalThis as Record<string, unknown>).innerWidth;
      delete (globalThis as Record<string, unknown>).innerHeight;
    },
  });
  return rig;
}

export { fakeButton };
