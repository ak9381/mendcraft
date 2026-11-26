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
  type PhonePlatform,
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

// ---- whole-board path ---------------------------------------------------------
// A whole board dragged (one held fist, or the mouse by its title) to a paired
// phone's edge and HELD there for the same dwell goes to that phone; the laptop
// board snaps back to where the drag began. Same edgeIntent glow and
// evaluateDwell guard as the tile path, but a board only commits on a HOLD:
// releasing early, leaving the edge, or losing the hand sends nothing.

export interface BoardDragEdgeEvent {
  frameId: string;
  phase: 'start' | 'move' | 'end' | 'cancel';
  clientX: number;
  clientY: number;
}

export interface BoardRect { x: number; y: number; w: number; h: number }

export interface BoardSend {
  frameId: string;
  board: SurfacePlan;
  side: Side;
  target: PhonePlatform;
}

export interface BoardEdgeDeps {
  getViewportWidth: () => number;
  /** Only the sides where a phone is actually paired (see pairedEdgeLayout). */
  getLayout: () => ScreenLayout;
  getRect: (frameId: string) => BoardRect | null;
  /** Snap the board back (world rect) after a send. */
  restoreRect: (frameId: string, rect: BoardRect) => void;
  getBoard: (frameId: string) => SurfacePlan | null;
  onGlow: (glow: EdgeGlow) => void;
  onCommit: (send: BoardSend) => void;
  now: () => number;
  dwellMs?: number;
  tuning?: EdgeTuning;
  /** Repeating timer for the hold check. A pointer/fist held STILL at the edge
   *  sends no move events (mouse) or zero deltas (clamped palm), so the dwell is
   *  re-evaluated with the last point on a ~60 ms tick. Injectable for tests. */
  every?: (fn: () => void, ms: number) => unknown;
  stopEvery?: (handle: unknown) => void;
  tickMs?: number;
}

export interface BoardEdgeTransferController {
  /** Returns true when the caller should apply this move to the board. */
  handleBoardDrag(ev: BoardDragEdgeEvent): boolean;
  /** Re-check the dwell with the last drag point (driven by the internal timer). */
  tick(): void;
  /** Boards sent to a phone this session (the journey's 'shared' step). */
  sharedBoards(): ReadonlySet<string>;
  reset(): void;
}

interface BoardDragState {
  frameId: string;
  start: BoardRect | null;
  committed: boolean;
  lastX: number;
  inZone: boolean;
}

export function createBoardEdgeTransferController(deps: BoardEdgeDeps): BoardEdgeTransferController {
  const every = deps.every ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const stopEvery = deps.stopEvery ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  let dwell: DwellState = INITIAL_DWELL;
  let drag: BoardDragState | null = null;
  let timer: unknown = null;
  const shared = new Set<string>();

  function reset(): void {
    if (timer !== null) { stopEvery(timer); timer = null; }
    if (drag) deps.onGlow(CLEAR);
    dwell = INITIAL_DWELL;
    drag = null;
  }

  function begin(frameId: string): BoardDragState {
    if (!drag || drag.frameId !== frameId) {
      reset();
      drag = { frameId, start: deps.getRect(frameId), committed: false, lastX: NaN, inZone: false };
      timer = every(() => tick(), deps.tickMs ?? 60);
    }
    return drag;
  }

  /** Glow + dwell at the drag's last point; commits (send + snap back) once. */
  function evaluate(d: BoardDragState): boolean {
    if (d.committed || !Number.isFinite(d.lastX)) return false;
    const intent = edgeIntent(d.lastX, deps.getViewportWidth(), deps.getLayout(), deps.tuning);
    d.inZone = intent.inZone && !!intent.side;
    deps.onGlow({ side: intent.side, glow: intent.glow });
    const res = evaluateDwell(dwell, intent, deps.now(), deps.dwellMs);
    dwell = res.state;
    if (!res.commit || !intent.side || !intent.target) return false;
    const board = deps.getBoard(d.frameId);
    if (!board) return false;
    d.committed = true;
    deps.onGlow(CLEAR);
    if (d.start) deps.restoreRect(d.frameId, d.start);
    shared.add(d.frameId);
    deps.onCommit({ frameId: d.frameId, board, side: intent.side, target: intent.target });
    return true;
  }

  function tick(): void {
    if (drag) evaluate(drag);
  }

  return {
    reset,
    tick,
    sharedBoards: () => shared,
    handleBoardDrag(ev) {
      if (ev.phase === 'end' || ev.phase === 'cancel') {
        // A cancelled drag, or a release AT a paired edge before the hold
        // finished, puts the board back where it started (never half off-screen).
        const d = drag;
        if (d && !d.committed && d.start && (ev.phase === 'cancel' || d.inZone)) deps.restoreRect(d.frameId, d.start);
        reset();
        return false;
      }
      const d = begin(ev.frameId);
      if (Number.isFinite(ev.clientX)) d.lastX = ev.clientX;
      if (ev.phase === 'start') { evaluate(d); return false; }
      if (d.committed) return false; // sent: the board stays put until the fist opens
      return !evaluate(d) && !d.committed;
    },
  };
}

/** A joined phone as the pair-first row knows it. */
export interface KnownPhone { id: string; label: string; sim: boolean }

/** A real phone's platform comes from its announce (id 'android' / 'ios').
 *  Only the scripted SIM phones, which never announce, fall back to the label. */
function phonePlatform(p: KnownPhone): PhonePlatform | null {
  if (p.id === 'android' || p.id === 'ios') return p.id;
  if (!p.sim) return null;
  if (/nothing|android/i.test(p.label)) return 'android';
  if (/iphone/i.test(p.label)) return 'ios';
  return null;
}

/**
 * The edges a board may be sent to: the arrangement strip's layout, limited to
 * phones that are actually paired. Live (host session): a named phone restricts
 * to its side; an unnamed one (paired by chime, platform not yet announced)
 * trusts the strip. Not live: only SIM phones from the scripted pairing count.
 *
 * `announced` (live only): platforms that sent a live announce this session.
 * They count even when the pair-first row does not list them — the row drops
 * a phone that announced while it was idle, and keep-alive re-announces never
 * re-add it, so the row alone left a really-paired phone's edge dark.
 */
export function pairedEdgeLayout(
  layout: ScreenLayout,
  phones: readonly KnownPhone[],
  o: { live: boolean; announced?: Iterable<PhonePlatform> },
): ScreenLayout {
  const pool = phones.filter((p) => p.sim !== o.live);
  const announced = o.live ? [...(o.announced ?? [])].filter((p) => p === 'android' || p === 'ios') : [];
  if (o.live && ((pool.length === 0 && announced.length === 0) || pool.some((p) => !phonePlatform(p)))) return { left: layout.left, right: layout.right };
  const have = new Set(pool.map(phonePlatform).filter((x): x is PhonePlatform => !!x));
  for (const p of announced) have.add(p);
  return {
    left: layout.left && have.has(layout.left) ? layout.left : null,
    right: layout.right && have.has(layout.right) ? layout.right : null,
  };
}

/**
 * Host memory of the last board sent to ONE phone. Routine republishes (a
 * phone announcing, a layout swap, a phone rejoining) re-send THAT board with
 * its target instead of the laptop's focused board, so the phone keeps what was
 * sent to it — until the laptop's focused board changes (another board focused,
 * or the focused board edited), after which the focused board mirrors again.
 */
export interface SentBoardMemo {
  remember(sent: { boardFor: PhonePlatform; board: SurfacePlan }, focusId: string | null, focusPlan: SurfacePlan | null): void;
  /** What a routine republish should carry now. */
  current(focusId: string | null, focusPlan: SurfacePlan | null): { board: SurfacePlan | null; boardFor?: PhonePlatform };
}

export function createSentBoardMemo(): SentBoardMemo {
  let last: { boardFor: PhonePlatform; board: SurfacePlan; focusId: string | null; focusPlan: SurfacePlan | null } | null = null;
  return {
    remember(sent, focusId, focusPlan) { last = { ...sent, focusId, focusPlan }; },
    current(focusId, focusPlan) {
      if (last && last.focusId === focusId && last.focusPlan === focusPlan) return { board: last.board, boardFor: last.boardFor };
      last = null;
      return { board: focusPlan };
    },
  };
}

const PHONE_NAME: Record<PhonePlatform, string> = { ios: 'iPhone', android: 'Nothing phone' };

/** Status line for a board send (not an AI action: never goes to the AI feed). */
export function boardSendLine(target: PhonePlatform, title: string, live: boolean): string {
  return live ? `Sent ${title || 'the board'} to the ${PHONE_NAME[target]}.` : `Sent to ${PHONE_NAME[target]} (SIM).`;
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
