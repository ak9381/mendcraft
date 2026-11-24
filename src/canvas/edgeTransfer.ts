// Cross-device edge transfer — the glue that turns a one-hand/mouse MOVE drag
// (editBoard.onItemDrag) into an edge glow and a committed tile transfer. Kept
// as a tiny injectable controller so both canvasApp (real DOM/Relay) and the
// hand-gesture tests drive the SAME logic: edgeIntent for the glow, evaluateDwell
// for the tremor/debounce guard, and tileTransfer to build the no-media payload.
//
// Rules enforced here:
//   • Only a ONE-hand/mouse move reaches this (editBoard only fires onItemDrag
//     from the move handle, never resize, never a two-hand pinch).
//   • A brief jitter past an edge does NOT transfer (evaluateDwell).
//   • A lost hand mid-drag ('cancel') commits nothing — no fling across devices.
//   • No glow toward an edge with no paired phone.

import {
  edgeIntent, evaluateDwell, phoneExitIntent,
  INITIAL_DWELL, type DwellState, type EdgeIntent, type ScreenLayout, type Side, type EdgeTuning,
} from './screenLayout';
import { enterEdgeForExit, findTile, type TileTransfer, type TransferEndpoint } from './tileTransfer';
import type { SurfacePlan } from './surfacePlan';

export interface ItemDragEvent {
  frameId: string;
  key: string; // equals the tile component id (editBoard keys === tileComponentId)
  phase: 'move' | 'end' | 'cancel';
  clientX: number;
  clientY: number;
}

export interface EdgeGlow {
  side: Side | null;
  glow: number;
}

export interface EdgeTransferDeps {
  /** Laptop canvas viewport width in CSS px. */
  getViewportWidth: () => number;
  /** Which phone is on which side right now. */
  getLayout: () => ScreenLayout;
  /** The current shared board (to pull the dragged tile's spec from). */
  getBoard: () => SurfacePlan | null;
  /** Light / clear the edge glow as the pointer nears a paired edge. */
  onGlow: (glow: EdgeGlow) => void;
  /** A transfer committed: send it over Relay and remove the tile locally. */
  onCommit: (transfer: TileTransfer) => void;
  now: () => number;
  dwellMs?: number;
  tuning?: EdgeTuning;
}

export interface EdgeTransferController {
  handleItemDrag(ev: ItemDragEvent): void;
  /** Reset mid-flight (e.g. layout changed, Edit exited). */
  reset(): void;
}

const CLEAR: EdgeGlow = { side: null, glow: 0 };

/** Laptop side: a tile dragged past the viewport's left/right edge goes to the
 *  phone on that side. */
export function createEdgeTransferController(deps: EdgeTransferDeps): EdgeTransferController {
  let dwell: DwellState = INITIAL_DWELL;
  let committed = false; // one transfer per drag

  function commit(componentId: string, intent: EdgeIntent): void {
    if (committed || !intent.side || !intent.target) return;
    const board = deps.getBoard();
    const tile = board ? findTile(board, componentId) : null;
    if (!tile) return;
    committed = true;
    deps.onGlow(CLEAR);
    const transfer: TileTransfer = {
      tile,
      componentId,
      from: 'laptop',
      to: intent.side,
      enterEdge: enterEdgeForExit(intent.side),
    };
    deps.onCommit(transfer);
  }

  function reset(): void {
    dwell = INITIAL_DWELL;
    committed = false;
    deps.onGlow(CLEAR);
  }

  return {
    reset,
    handleItemDrag(ev) {
      if (ev.phase === 'cancel') {
        // Lost hand / Escape: cancel the pending transfer, never fling.
        reset();
        return;
      }
      const intent = edgeIntent(ev.clientX, deps.getViewportWidth(), deps.getLayout(), deps.tuning);
      if (ev.phase === 'move') {
        if (!committed) deps.onGlow({ side: intent.side, glow: intent.glow });
        const res = evaluateDwell(dwell, intent, deps.now(), deps.dwellMs);
        dwell = res.state;
        if (res.commit) commit(ev.key, intent);
        return;
      }
      // phase 'end' — a deliberate DROP inside a paired edge zone also commits.
      if (!committed && intent.inZone && intent.side) commit(ev.key, intent);
      reset();
    },
  };
}

// ---- phone side -------------------------------------------------------------

export interface PhoneExitDeps {
  getViewportWidth: () => number;
  /** This phone's side (its inner edge faces the laptop). */
  getSide: () => Side;
  getBoard: () => SurfacePlan | null;
  /** Is the other phone paired? Enables the "push further" hop. */
  hasOtherPhone: () => boolean;
  onGlow: (glow: { glow: number; target: 'laptop' | 'other' | null }) => void;
  onCommit: (transfer: TileTransfer) => void;
  now: () => number;
  dwellMs?: number;
  tuning?: EdgeTuning;
}

/** Phone side: a tile dragged off the INNER edge returns to the laptop (or hops
 *  to the other phone when pushed further). Same dwell/tremor guard. */
export function createPhoneExitController(deps: PhoneExitDeps): EdgeTransferController {
  let enteredAt: number | null = null;
  let committed = false;

  function commit(componentId: string, target: 'laptop' | 'other', side: Side): void {
    if (committed) return;
    const board = deps.getBoard();
    const tile = board ? findTile(board, componentId) : null;
    if (!tile) return;
    committed = true;
    deps.onGlow({ glow: 0, target: null });
    // From this phone's side; 'other' means the opposite side slot.
    const to: TransferEndpoint = target === 'laptop' ? 'laptop' : (side === 'left' ? 'right' : 'left');
    deps.onCommit({ tile, componentId, from: side, to, enterEdge: enterEdgeForExit(side) });
  }

  function reset(): void {
    enteredAt = null;
    committed = false;
    deps.onGlow({ glow: 0, target: null });
  }

  return {
    reset,
    handleItemDrag(ev) {
      if (ev.phase === 'cancel') { reset(); return; }
      const side = deps.getSide();
      const exit = phoneExitIntent({
        clientX: ev.clientX,
        viewportWidth: deps.getViewportWidth(),
        side,
        hasOtherPhone: deps.hasOtherPhone(),
        tuning: deps.tuning,
      });
      if (ev.phase === 'move') {
        if (!committed) deps.onGlow({ glow: exit.glow, target: exit.inZone ? exit.target : null });
        if (!exit.inZone) { enteredAt = null; return; }
        if (enteredAt === null) enteredAt = deps.now();
        const held = deps.now() - enteredAt >= (deps.dwellMs ?? 220);
        if ((exit.pastThreshold || held) && exit.target) commit(ev.key, exit.target, side);
        return;
      }
      if (!committed && exit.inZone && exit.target) commit(ev.key, exit.target, side);
      reset();
    },
  };
}
