// EDIT MODE: once a board is built, every tile/widget/floor-plan on it can be
// moved and resized by hand (pinch-hold a handle — forwarded by
// handPointer.ts's DRAG_HANDLE branch, same mechanism as the terminal title
// bars in dragPanel.ts) or by ordinary mouse/touch. Chrome (border + move +
// resize handles) only shows while editing; layout itself persists in
// sessionStorage per board and stays applied once editing turns off, until
// "Reset layout" clears it and the board goes back to its default flow.
//
// DOM structure while a board has a layout (editing on, or a saved layout
// from earlier this session): each tile host (`<mc-lamp-tile>`, a
// `.mc-fb-tile` div, …) is pulled out of the Column's normal flow into its
// own absolutely-positioned `.mc-edit-item` wrapper, inside one
// `.mc-edit-canvas` (position:relative) sibling of the Column's other
// children (its title). Handles are light-DOM siblings of the tile host
// inside the wrapper — never inside the tile's own shadow root, so they
// survive hand/mouse hit-testing and stay visible regardless of the tile's
// own markup.

export interface Size { width: number; height: number }
export interface Rect { left: number; top: number; width: number; height: number }
export interface ItemLayout { left: number; top: number; width: number; height: number }

export const MIN_ITEM_SIZE: Size = { width: 220, height: 200 };
export const MAX_ITEM_SIZE: Size = { width: 640, height: 520 };
const PAD = 12;
/** No real vertical ceiling: the frame body scrolls (`overflow: auto`). */
const TALL = 100000;

const clampNum = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** Pure: keep an item's whole box inside `bounds` — it never drifts off the
 *  board or into whatever `bounds` already excludes (e.g. the reserved
 *  terminal column, baked in by the caller via {@link computeBounds}). */
export function clampMove(layout: ItemLayout, bounds: Rect): ItemLayout {
  const maxLeft = Math.max(bounds.left, bounds.left + bounds.width - layout.width);
  const maxTop = Math.max(bounds.top, bounds.top + bounds.height - layout.height);
  return { ...layout, left: clampNum(layout.left, bounds.left, maxLeft), top: clampNum(layout.top, bounds.top, maxTop) };
}

/** Pure: keep a resize within [min,max] and inside `bounds`, growing from the
 *  item's current (unmoved) top-left corner. */
export function clampResize(layout: ItemLayout, bounds: Rect, min: Size = MIN_ITEM_SIZE, max: Size = MAX_ITEM_SIZE): ItemLayout {
  const maxW = Math.max(1, Math.min(max.width, bounds.left + bounds.width - layout.left));
  const maxH = Math.max(1, Math.min(max.height, bounds.top + bounds.height - layout.top));
  return {
    ...layout,
    width: clampNum(layout.width, Math.min(min.width, maxW), maxW),
    height: clampNum(layout.height, Math.min(min.height, maxH), maxH),
  };
}

export type ResizeHandleDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Pure: resize a tile by dragging one of the 8 handles by (dx,dy). The edge(s)
 *  named by the handle move; the OPPOSITE edge stays anchored (so a top-left
 *  drag pins the bottom-right, a right-edge drag pins the left, etc.). Each
 *  moving edge is clamped so the size stays in [min,max] AND inside `bounds`,
 *  without ever dragging the anchored edge. */
export function resizeByHandle(layout: ItemLayout, handle: ResizeHandleDir, dx: number, dy: number, bounds: Rect, min: Size = MIN_ITEM_SIZE, max: Size = MAX_ITEM_SIZE): ItemLayout {
  let left = layout.left, top = layout.top;
  let right = layout.left + layout.width, bottom = layout.top + layout.height;
  const bl = bounds.left, bt = bounds.top, br = bounds.left + bounds.width, bb = bounds.top + bounds.height;
  const movesW = handle.includes('w'), movesE = handle.includes('e');
  const movesN = handle.includes('n'), movesS = handle.includes('s');

  if (movesW) { // anchor = right edge; width = right - left
    const w = clampNum(right - (left + dx), Math.min(min.width, right - bl), Math.min(max.width, right - bl));
    left = right - w;
  } else if (movesE) { // anchor = left edge
    const w = clampNum((right + dx) - left, Math.min(min.width, br - left), Math.min(max.width, br - left));
    right = left + w;
  }
  if (movesN) { // anchor = bottom edge
    const h = clampNum(bottom - (top + dy), Math.min(min.height, bottom - bt), Math.min(max.height, bottom - bt));
    top = bottom - h;
  } else if (movesS) { // anchor = top edge
    const h = clampNum((bottom + dy) - top, Math.min(min.height, bb - top), Math.min(max.height, bb - top));
    bottom = top + h;
  }
  return { left, top, width: right - left, height: bottom - top };
}

export interface XY { x: number; y: number }

/** Pure: Akash's two-hand anchored resize. Each finger is assigned to the
 *  NEAREST corner of the grab-time `box`; that corner then tracks its finger's
 *  delta. Opposite corners → the box spans between the two fingers; same-side
 *  corners → that shared edge moves (the other axis of each corner still
 *  tracks its own finger); a still hand → only the other corner moves. Deltas
 *  are frame-invariant, so callers can assign corners in client space and apply
 *  the result to a tile's own local layout. No clamping here — pure geometry;
 *  bounds/min/max are enforced by the caller via {@link clampResize}. */
export function resizeToCorners(box: Rect, grabA: XY, grabB: XY, curA: XY, curB: XY): Rect {
  const l = box.left, t = box.top, r = box.left + box.width, b = box.top + box.height;
  const corners = { TL: { x: l, y: t }, TR: { x: r, y: t }, BL: { x: l, y: b }, BR: { x: r, y: b } } as const;
  type Corner = keyof typeof corners;
  const nearest = (p: XY): Corner => {
    let best: Corner = 'TL', bd = Infinity;
    for (const k of Object.keys(corners) as Corner[]) {
      const c = corners[k], d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  };
  const leftDx: number[] = [], rightDx: number[] = [], topDy: number[] = [], botDy: number[] = [];
  const contribute = (k: Corner, dx: number, dy: number): void => {
    (k === 'TL' || k === 'BL' ? leftDx : rightDx).push(dx);
    (k === 'TL' || k === 'TR' ? topDy : botDy).push(dy);
  };
  contribute(nearest(grabA), curA.x - grabA.x, curA.y - grabA.y);
  contribute(nearest(grabB), curB.x - grabB.x, curB.y - grabB.y);
  const avg = (a: number[]): number => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const nl = l + avg(leftDx), nr = r + avg(rightDx), nt = t + avg(topDy), nb = b + avg(botDy);
  const left = Math.min(nl, nr), right = Math.max(nl, nr), top = Math.min(nt, nb), bottom = Math.max(nt, nb);
  return { left, top, width: right - left, height: bottom - top };
}

/** Pure: how many px of a board's right edge the reserved terminal column
 *  (`.mc-ai`, when open) eats into — 0 when they don't overlap or it's closed. */
export function terminalCutPx(boardRect: Rect, aiPanelRect: Rect | null): number {
  if (!aiPanelRect) return 0;
  return Math.max(0, boardRect.left + boardRect.width - aiPanelRect.left);
}

/** Pure: the movable/resizable area of a board, in the board's OWN local
 *  coordinates (its own top-left is {0,0}) — `rightCutPx` shrinks it to stay
 *  clear of the terminal column. */
export function computeBounds(container: Size, rightCutPx = 0, pad = PAD): Rect {
  return {
    left: pad,
    top: pad,
    width: Math.max(0, container.width - pad * 2 - Math.max(0, rightCutPx)),
    height: Math.max(0, container.height - pad * 2),
  };
}

// ---------------------------------------------------------------- storage

export type FrameLayoutMap = Record<string, ItemLayout>;
const KEY_PREFIX = 'mc.editLayout.';

export function loadFrameLayout(storage: Pick<Storage, 'getItem'>, frameId: string): FrameLayoutMap | null {
  try {
    const raw = storage.getItem(KEY_PREFIX + frameId);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as FrameLayoutMap;
  } catch {
    // corrupt value or storage unavailable (private mode) — behave as unsaved
  }
  return null;
}

export function saveFrameLayout(storage: Pick<Storage, 'setItem'>, frameId: string, map: FrameLayoutMap): void {
  try { storage.setItem(KEY_PREFIX + frameId, JSON.stringify(map)); } catch { /* quota or private mode: layout just won't persist */ }
}

export function clearFrameLayout(storage: Pick<Storage, 'removeItem'>, frameId: string): void {
  try { storage.removeItem(KEY_PREFIX + frameId); } catch { /* storage unavailable */ }
}

// ---------------------------------------------------------- per-item drag

export interface PointerLikeEvent { clientX: number; clientY: number; pointerId?: number }
export interface EditItemStyle { left?: string; top?: string; width?: string; height?: string }
export interface EditItemElement { style: EditItemStyle }
export interface HandleElement {
  addEventListener(type: string, fn: (e: PointerLikeEvent) => void): void;
  removeEventListener(type: string, fn: (e: PointerLikeEvent) => void): void;
  setPointerCapture?(id: number): void;
}

export interface MountHandlesOptions {
  min?: Size;
  max?: Size;
  /** Re-measured on every pointerdown/move — never cached across a drag,
   *  since the terminal column can open/close mid-session. */
  getBounds(): Rect;
  onCommit?(layout: ItemLayout): void;
  /** Accidental-touch guard: a move/resize does nothing (and never commits)
   *  until the pointer has travelled past this many px from the pointerdown —
   *  so a tremor or a brush against a tile in Edit mode can't nudge it. Kept in
   *  step with handPointer's 6px drag threshold (see A4-018). */
  engageSlopPx?: number;
}

/** True once a pointer has moved past the engage slop from its down point. */
const pastSlop = (dx: number, dy: number, slop: number): boolean => Math.hypot(dx, dy) > slop;

export interface ItemHandles {
  getLayout(): ItemLayout;
  /** Two-hand anchored corner resize. `pinchStart` freezes the current layout
   *  as the grab box (and returns it); `pinchApply` sets a caller-computed
   *  layout (clamped to bounds/min/max); `pinchEnd` commits it through the SAME
   *  onCommit path as the resize handle — so the self-check re-runs on commit.
   *  The controller does the corner geometry (see {@link resizeToCorners}) so
   *  it can anchor corners in client space; these only apply/clamp/commit.
   *  Mouse/touch/hand single-handle drags are untouched. */
  pinchStart(): ItemLayout;
  pinchApply(next: ItemLayout): void;
  pinchEnd(): void;
  destroy(): void;
}

export interface DirectionedHandle { el: HandleElement; dir: ResizeHandleDir }

/** Wires a move handle and one or more resize handles to one item's inline box
 *  style — the same plain-PointerEvent pattern as dragPanel.ts's title-bar
 *  drag, so hand pinch (via handPointer.ts's DRAG_HANDLE forwarding), mouse and
 *  touch all land here identically. A bare `resizeHandle` is the bottom-right
 *  ('se') corner; pass an array to wire any of the 8 corners/edges, each
 *  anchored at its opposite edge (see {@link resizeByHandle}). */
export function mountItemHandles(
  item: EditItemElement,
  moveHandle: HandleElement,
  resizeHandle: HandleElement | DirectionedHandle[],
  initial: ItemLayout,
  opts: MountHandlesOptions,
): ItemHandles {
  let layout: ItemLayout = { ...initial };
  const min = opts.min ?? MIN_ITEM_SIZE;
  const max = opts.max ?? MAX_ITEM_SIZE;
  const slop = opts.engageSlopPx ?? 6;

  function apply(): void {
    item.style.left = `${layout.left}px`;
    item.style.top = `${layout.top}px`;
    item.style.width = `${layout.width}px`;
    item.style.height = `${layout.height}px`;
  }
  apply();

  let moveStart: { x: number; y: number; left: number; top: number; engaged: boolean } | null = null;
  function onMoveDown(e: PointerLikeEvent): void {
    moveStart = { x: e.clientX, y: e.clientY, left: layout.left, top: layout.top, engaged: false };
    armEscape();
    if (e.pointerId != null) moveHandle.setPointerCapture?.(e.pointerId);
  }
  function onMoveMove(e: PointerLikeEvent): void {
    if (!moveStart) return;
    if (!moveStart.engaged) {
      if (!pastSlop(e.clientX - moveStart.x, e.clientY - moveStart.y, slop)) return;
      moveStart.engaged = true;
    }
    layout = clampMove({ ...layout, left: moveStart.left + (e.clientX - moveStart.x), top: moveStart.top + (e.clientY - moveStart.y) }, opts.getBounds());
    apply();
  }
  function onMoveEnd(): void {
    if (!moveStart) return;
    const engaged = moveStart.engaged;
    moveStart = null;
    disarmEscape();
    if (engaged) opts.onCommit?.(layout);
  }
  /** A3-006: pointercancel (hand lost mid-drag, Hands off) or Escape aborts —
   *  the tile goes back to where it was grabbed and nothing is committed. */
  function onMoveCancel(): void {
    if (!moveStart) return;
    layout = { ...layout, left: moveStart.left, top: moveStart.top };
    moveStart = null;
    disarmEscape();
    apply();
  }

  const resizeHandles: DirectionedHandle[] = Array.isArray(resizeHandle) ? resizeHandle : [{ el: resizeHandle, dir: 'se' }];
  // One active resize at a time; records the grab-time box and which handle.
  let resizeStart: { x: number; y: number; box: ItemLayout; dir: ResizeHandleDir; el: HandleElement; engaged: boolean } | null = null;
  function onResizeDown(h: DirectionedHandle, e: PointerLikeEvent): void {
    resizeStart = { x: e.clientX, y: e.clientY, box: { ...layout }, dir: h.dir, el: h.el, engaged: false };
    armEscape();
    if (e.pointerId != null) h.el.setPointerCapture?.(e.pointerId);
  }
  function onResizeMove(e: PointerLikeEvent): void {
    if (!resizeStart) return;
    if (!resizeStart.engaged) {
      if (!pastSlop(e.clientX - resizeStart.x, e.clientY - resizeStart.y, slop)) return;
      resizeStart.engaged = true;
    }
    layout = resizeByHandle(resizeStart.box, resizeStart.dir, e.clientX - resizeStart.x, e.clientY - resizeStart.y, opts.getBounds(), min, max);
    apply();
  }
  function onResizeEnd(): void {
    if (!resizeStart) return;
    const engaged = resizeStart.engaged;
    resizeStart = null;
    disarmEscape();
    if (engaged) opts.onCommit?.(layout);
  }
  function onResizeCancel(): void {
    if (!resizeStart) return;
    layout = { ...resizeStart.box };
    resizeStart = null;
    disarmEscape();
    apply();
  }

  // Escape mid-drag = the mouse/keyboard way to abort (same as losing the hand).
  const keyHost = (globalThis as { addEventListener?: typeof addEventListener; removeEventListener?: typeof removeEventListener });
  let escArmed = false;
  function onEscape(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || (!moveStart && !resizeStart)) return;
    e.preventDefault(); e.stopPropagation();
    onMoveCancel(); onResizeCancel();
  }
  function armEscape(): void {
    if (escArmed || !keyHost.addEventListener) return;
    keyHost.addEventListener('keydown', onEscape, true); escArmed = true;
  }
  function disarmEscape(): void {
    if (!escArmed) return;
    keyHost.removeEventListener?.('keydown', onEscape, true); escArmed = false;
  }

  moveHandle.addEventListener('pointerdown', onMoveDown);
  moveHandle.addEventListener('pointermove', onMoveMove);
  moveHandle.addEventListener('pointerup', onMoveEnd);
  moveHandle.addEventListener('pointercancel', onMoveCancel);
  const resizeDownFns = new Map<HandleElement, (e: PointerLikeEvent) => void>();
  for (const h of resizeHandles) {
    const down = (e: PointerLikeEvent): void => onResizeDown(h, e);
    resizeDownFns.set(h.el, down);
    h.el.addEventListener('pointerdown', down);
    h.el.addEventListener('pointermove', onResizeMove);
    h.el.addEventListener('pointerup', onResizeEnd);
    h.el.addEventListener('pointercancel', onResizeCancel);
  }

  let pinching = false;
  function pinchStart(): ItemLayout {
    pinching = true;
    return { ...layout };
  }
  function pinchApply(next: ItemLayout): void {
    if (!pinching) return;
    layout = clampResize(clampMove(next, opts.getBounds()), opts.getBounds(), min, max);
    apply();
  }
  function pinchEnd(): void {
    if (!pinching) return;
    pinching = false;
    opts.onCommit?.(layout);
  }

  return {
    getLayout: () => layout,
    pinchStart,
    pinchApply,
    pinchEnd,
    destroy() {
      moveHandle.removeEventListener('pointerdown', onMoveDown);
      moveHandle.removeEventListener('pointermove', onMoveMove);
      moveHandle.removeEventListener('pointerup', onMoveEnd);
      moveHandle.removeEventListener('pointercancel', onMoveCancel);
      disarmEscape();
      for (const h of resizeHandles) {
        const down = resizeDownFns.get(h.el);
        if (down) h.el.removeEventListener('pointerdown', down);
        h.el.removeEventListener('pointermove', onResizeMove);
        h.el.removeEventListener('pointerup', onResizeEnd);
        h.el.removeEventListener('pointercancel', onResizeCancel);
      }
    },
  };
}

// --------------------------------------------------------- board controller

/** Minimal DOM surface `mountEditBoard` needs — real elements satisfy it;
 *  tests pass a much smaller fake (see editBoard.test.ts). */
export interface EditEl {
  classList: { add(c: string): void; remove(c: string): void; toggle(c: string, on?: boolean): void; contains(c: string): boolean };
  style: { left?: string; top?: string; width?: string; height?: string; minHeight?: string; position?: string };
  getBoundingClientRect(): Rect;
  parentElement: EditEl | null;
  clientWidth: number;
  clientHeight: number;
  hidden?: boolean;
  disabled?: boolean;
  textContent?: string;
  append(...nodes: EditEl[]): void;
  remove(): void;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, fn: (e: PointerLikeEvent) => void): void;
  removeEventListener(type: string, fn: (e: PointerLikeEvent) => void): void;
}

export interface EditItemRef {
  /** Stable across re-renders of the same board (e.g. `tileComponentId`). */
  key: string;
  el: EditEl;
  /** Used in handle aria-labels: "Move the {label} tile". */
  label: string;
}

export interface ContainmentEl {
  contains(other: unknown): boolean;
}

/** Keeps only the elements with no OTHER matched element as an ancestor —
 *  e.g. given a Card containing a nested StatTile plus a top-level sibling
 *  tile, keeps the card and the sibling, drops the StatTile. This is how
 *  nested children (inside a Card/Tabs/Grid/Row/Split) stay inside their
 *  parent instead of getting their own independent move/resize chrome: the
 *  caller just needs to list every candidate (any depth), not know the
 *  tree shape. Works regardless of nesting depth or which container type. */
export function topLevelOf<T extends ContainmentEl>(all: T[]): T[] {
  return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
}

export interface EditBoardOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  createElement(tag: string): EditEl;
  getAiPanelEl(): EditEl | null;
  /** The current host elements for a board's tiles, in stable order —
   *  called fresh every time (after re-renders too). [] if the board has
   *  nothing (or doesn't exist). */
  getItems(frameId: string): EditItemRef[];
  minSize?: Size;
  maxSize?: Size;
  /** Fired once a move or resize drag ends (pointerup/cancel) and the new
   *  layout has been saved — the hook the self-check corner mark uses to
   *  re-check a tile after it's been dragged or resized, not only after it
   *  was first built. */
  onItemCommit?(frameId: string, key: string): void;
}

export interface EditBoardController {
  readonly editing: boolean;
  /** Call whenever the focused frame (or its availability) changes. */
  setFocus(frameId: string | null, available: boolean): void;
  /** Two-hand anchored tile resize while editing, in Akash's corner-tracking
   *  model. 'start' hit-tests the tile under the pinch midpoint and grabs it
   *  (returns false if none / not editing); 'move' moves whichever corner(s)
   *  each finger grabbed to follow the fingers ({@link resizeToCorners}); 'end'
   *  commits. `a`/`b` are the two pinch points in client coords. One tile per
   *  gesture; returns whether a tile is engaged. */
  pinchResize(phase: 'start' | 'move' | 'end', a?: XY, b?: XY): boolean;
  destroy(): void;
}

/** Dissolves a previously built `.mc-edit-canvas` wrapper back to the plain
 *  flow it came from, if `items` are currently wrapped — a cheap no-op
 *  otherwise. Always called first so every rebuild starts from the same
 *  (unwrapped) state, regardless of how many times it's been wrapped before. */
function unwrap(items: EditItemRef[]): void {
  const first = items[0]?.el.parentElement;
  if (!first || !first.classList.contains('mc-edit-item')) return;
  const canvasEl = first.parentElement;
  const column = canvasEl?.parentElement ?? null;
  for (const it of items) {
    const wrapper = it.el.parentElement;
    column?.append(it.el);
    wrapper?.remove();
  }
  canvasEl?.remove();
}

export function mountEditBoard(root: EditEl, opts: EditBoardOptions): EditBoardController {
  const storage = opts.storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  const minSize = opts.minSize ?? MIN_ITEM_SIZE;
  const maxSize = opts.maxSize ?? MAX_ITEM_SIZE;

  let currentFrameId: string | null = null;
  let available = false;
  let editing = false;
  // The tiles mounted in the current edit canvas, for two-hand pinch hit-test.
  let mounted: Array<{ wrapper: EditEl; handles: ItemHandles }> = [];
  // The tile grabbed by a two-hand pinch, with its grab-time client box, the
  // two grab points, and the frozen local layout — so each finger's corner can
  // track in client space and apply to the tile's own local coordinates.
  let pinchTarget: { handles: ItemHandles; grabBox: Rect; grabA: XY; grabB: XY; local0: ItemLayout } | null = null;

  const editBtn = opts.createElement('button');
  editBtn.setAttribute('type', 'button');
  editBtn.classList.add('mc-edit-toggle');
  root.append(editBtn);

  const resetBtn = opts.createElement('button');
  resetBtn.setAttribute('type', 'button');
  resetBtn.classList.add('mc-edit-reset');
  resetBtn.textContent = 'Reset layout';
  resetBtn.setAttribute('aria-label', 'Reset layout');
  root.append(resetBtn);

  function renderButtons(): void {
    editBtn.disabled = !available;
    editBtn.setAttribute('aria-pressed', String(editing));
    editBtn.setAttribute('aria-label', editing ? 'Done editing' : 'Edit board');
    editBtn.textContent = editing ? 'Done' : 'Edit';
    resetBtn.hidden = !editing;
  }

  function makeHandle(kind: 'move' | 'resize', label: string): EditEl {
    const el = opts.createElement('button');
    el.setAttribute('type', 'button');
    el.classList.add(kind === 'move' ? 'mc-edit-move' : 'mc-edit-resize');
    el.setAttribute(kind === 'move' ? 'data-mc-drag-handle' : 'data-mc-resize-handle', '');
    el.setAttribute('aria-label', `${kind === 'move' ? 'Move' : 'Resize'} the ${label} tile`);
    el.textContent = kind === 'move' ? '⠿' : '⤡';
    return el;
  }

  // Edit-mode words it as "bottom-right corner", "top edge", … for the label.
  const RESIZE_DIRS: ResizeHandleDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const DIR_WORD: Record<ResizeHandleDir, string> = {
    nw: 'top-left corner', n: 'top edge', ne: 'top-right corner', e: 'right edge',
    se: 'bottom-right corner', s: 'bottom edge', sw: 'bottom-left corner', w: 'left edge',
  };
  function makeResizeHandle(dir: ResizeHandleDir, label: string): EditEl {
    const el = opts.createElement('button');
    el.setAttribute('type', 'button');
    el.classList.add('mc-edit-resize');
    el.classList.add(`mc-edit-resize-${dir}`);
    el.setAttribute('data-mc-resize-handle', dir);
    el.setAttribute('aria-label', `Resize the ${label} tile from the ${DIR_WORD[dir]}`);
    // Corners keep the diagonal glyph; edges get a bar so they read as edges.
    el.textContent = dir.length === 2 ? '⤡' : (dir === 'n' || dir === 's' ? '↕' : '↔');
    return el;
  }

  function liveBounds(canvasEl: EditEl): Rect {
    const r = canvasEl.getBoundingClientRect();
    const ai = opts.getAiPanelEl();
    const aiRect = ai && !ai.hidden ? ai.getBoundingClientRect() : null;
    const cut = terminalCutPx(r, aiRect);
    return computeBounds({ width: canvasEl.clientWidth || r.width, height: TALL }, cut, PAD);
  }

  function applyFrame(): void {
    mounted = [];
    pinchTarget = null;
    if (!currentFrameId) return;
    const frameId = currentFrameId;
    const items = opts.getItems(frameId);
    if (!items.length) return;
    unwrap(items);

    const saved = loadFrameLayout(storage ?? { getItem: () => null }, frameId) ?? {};
    const hasSaved = Object.keys(saved).length > 0;
    if (!editing && !hasSaved) return; // default flow, zero overhead — the common case

    const column = items[0].el.parentElement;
    if (!column) return;
    const rects = items.map((it) => it.el.getBoundingClientRect());
    const originLeft = Math.min(...rects.map((r) => r.left));
    const originTop = Math.min(...rects.map((r) => r.top));

    const canvasEl = opts.createElement('div');
    canvasEl.classList.add('mc-edit-canvas');
    canvasEl.style.position = 'relative';
    column.append(canvasEl);

    let dirty = false;
    let maxBottom = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const wrapper = opts.createElement('div');
      wrapper.classList.add('mc-edit-item');
      canvasEl.append(wrapper);
      wrapper.append(it.el);

      let layout = saved[it.key];
      if (!layout) {
        const r = rects[i];
        layout = clampResize(
          clampMove({ left: r.left - originLeft, top: r.top - originTop, width: r.width, height: r.height }, computeBounds({ width: canvasEl.clientWidth || r.width, height: TALL }, 0, PAD)),
          computeBounds({ width: canvasEl.clientWidth || r.width, height: TALL }, 0, PAD),
          minSize,
          maxSize,
        );
        saved[it.key] = layout;
        dirty = true;
      }
      wrapper.style.position = 'absolute';

      const moveHandle = makeHandle('move', it.label);
      const resizeEls = RESIZE_DIRS.map((dir) => ({ el: makeResizeHandle(dir, it.label), dir }));
      wrapper.append(moveHandle, ...resizeEls.map((r) => r.el));
      const handles = mountItemHandles(wrapper, moveHandle, resizeEls.map((r) => ({ el: r.el as unknown as HandleElement, dir: r.dir })), layout, {
        min: minSize,
        max: maxSize,
        getBounds: () => liveBounds(canvasEl),
        onCommit: (l) => {
          saved[it.key] = l;
          let bottom = 0;
          for (const other of items) { const ol = saved[other.key]; if (ol) bottom = Math.max(bottom, ol.top + ol.height); }
          canvasEl.style.minHeight = `${bottom + PAD}px`;
          if (storage) saveFrameLayout(storage, frameId, saved);
          opts.onItemCommit?.(frameId, it.key);
        },
      });
      mounted.push({ wrapper, handles });

      maxBottom = Math.max(maxBottom, layout.top + layout.height);
    }

    canvasEl.classList.toggle('mc-editing', editing);
    canvasEl.style.minHeight = `${maxBottom + PAD}px`;
    if (dirty && storage) saveFrameLayout(storage, frameId, saved);
  }

  function toggleEditing(): void {
    if (!available) return;
    editing = !editing;
    applyFrame();
    renderButtons();
  }
  function resetLayout(): void {
    if (!currentFrameId) return;
    if (storage) clearFrameLayout(storage, currentFrameId);
    applyFrame();
    renderButtons();
  }

  editBtn.addEventListener('click', toggleEditing);
  resetBtn.addEventListener('click', resetLayout);
  renderButtons();

  return {
    get editing() { return editing; },
    setFocus(frameId, avail) {
      const switching = frameId !== currentFrameId;
      if (switching && editing) { editing = false; applyFrame(); } // hide chrome on the frame being left
      if (switching) currentFrameId = frameId;
      available = avail;
      if (!available) editing = false;
      applyFrame();
      renderButtons();
    },
    pinchResize(phase, a, b) {
      if (phase === 'start') {
        pinchTarget = null;
        if (!editing || !a || !b) return false;
        const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
        for (const m of mounted) {
          const r = m.wrapper.getBoundingClientRect();
          if (midX >= r.left && midX <= r.left + r.width && midY >= r.top && midY <= r.top + r.height) {
            pinchTarget = { handles: m.handles, grabBox: r, grabA: { ...a }, grabB: { ...b }, local0: m.handles.pinchStart() };
            break;
          }
        }
        return !!pinchTarget;
      }
      if (!pinchTarget) return false;
      if (phase === 'move') {
        if (!a || !b) return true;
        // Corner geometry in client space, applied as frame-invariant edge
        // deltas to the tile's own (local) grab-time layout.
        const nc = resizeToCorners(pinchTarget.grabBox, pinchTarget.grabA, pinchTarget.grabB, a, b);
        const gb = pinchTarget.grabBox, l0 = pinchTarget.local0;
        const nl = l0.left + (nc.left - gb.left);
        const nr = l0.left + l0.width + (nc.left + nc.width - (gb.left + gb.width));
        const nt = l0.top + (nc.top - gb.top);
        const nb = l0.top + l0.height + (nc.top + nc.height - (gb.top + gb.height));
        pinchTarget.handles.pinchApply({ left: Math.min(nl, nr), top: Math.min(nt, nb), width: Math.abs(nr - nl), height: Math.abs(nb - nt) });
        return true;
      }
      // end
      pinchTarget.handles.pinchEnd();
      pinchTarget = null;
      return true;
    },
    destroy() {
      editBtn.remove();
      resetBtn.remove();
    },
  };
}
