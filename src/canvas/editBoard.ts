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
}

export interface ItemHandles {
  getLayout(): ItemLayout;
  destroy(): void;
}

/** Wires a move handle and a resize handle to one item's inline box style —
 *  the same plain-PointerEvent pattern as dragPanel.ts's title-bar drag, so
 *  hand pinch (via handPointer.ts's DRAG_HANDLE forwarding), mouse and touch
 *  all land here identically. */
export function mountItemHandles(
  item: EditItemElement,
  moveHandle: HandleElement,
  resizeHandle: HandleElement,
  initial: ItemLayout,
  opts: MountHandlesOptions,
): ItemHandles {
  let layout: ItemLayout = { ...initial };
  const min = opts.min ?? MIN_ITEM_SIZE;
  const max = opts.max ?? MAX_ITEM_SIZE;

  function apply(): void {
    item.style.left = `${layout.left}px`;
    item.style.top = `${layout.top}px`;
    item.style.width = `${layout.width}px`;
    item.style.height = `${layout.height}px`;
  }
  apply();

  let moveStart: { x: number; y: number; left: number; top: number } | null = null;
  function onMoveDown(e: PointerLikeEvent): void {
    moveStart = { x: e.clientX, y: e.clientY, left: layout.left, top: layout.top };
    if (e.pointerId != null) moveHandle.setPointerCapture?.(e.pointerId);
  }
  function onMoveMove(e: PointerLikeEvent): void {
    if (!moveStart) return;
    layout = clampMove({ ...layout, left: moveStart.left + (e.clientX - moveStart.x), top: moveStart.top + (e.clientY - moveStart.y) }, opts.getBounds());
    apply();
  }
  function onMoveEnd(): void {
    if (!moveStart) return;
    moveStart = null;
    opts.onCommit?.(layout);
  }

  let resizeStart: { x: number; y: number; width: number; height: number } | null = null;
  function onResizeDown(e: PointerLikeEvent): void {
    resizeStart = { x: e.clientX, y: e.clientY, width: layout.width, height: layout.height };
    if (e.pointerId != null) resizeHandle.setPointerCapture?.(e.pointerId);
  }
  function onResizeMove(e: PointerLikeEvent): void {
    if (!resizeStart) return;
    layout = clampResize({ ...layout, width: resizeStart.width + (e.clientX - resizeStart.x), height: resizeStart.height + (e.clientY - resizeStart.y) }, opts.getBounds(), min, max);
    apply();
  }
  function onResizeEnd(): void {
    if (!resizeStart) return;
    resizeStart = null;
    opts.onCommit?.(layout);
  }

  moveHandle.addEventListener('pointerdown', onMoveDown);
  moveHandle.addEventListener('pointermove', onMoveMove);
  moveHandle.addEventListener('pointerup', onMoveEnd);
  moveHandle.addEventListener('pointercancel', onMoveEnd);
  resizeHandle.addEventListener('pointerdown', onResizeDown);
  resizeHandle.addEventListener('pointermove', onResizeMove);
  resizeHandle.addEventListener('pointerup', onResizeEnd);
  resizeHandle.addEventListener('pointercancel', onResizeEnd);

  return {
    getLayout: () => layout,
    destroy() {
      moveHandle.removeEventListener('pointerdown', onMoveDown);
      moveHandle.removeEventListener('pointermove', onMoveMove);
      moveHandle.removeEventListener('pointerup', onMoveEnd);
      moveHandle.removeEventListener('pointercancel', onMoveEnd);
      resizeHandle.removeEventListener('pointerdown', onResizeDown);
      resizeHandle.removeEventListener('pointermove', onResizeMove);
      resizeHandle.removeEventListener('pointerup', onResizeEnd);
      resizeHandle.removeEventListener('pointercancel', onResizeEnd);
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

  function liveBounds(canvasEl: EditEl): Rect {
    const r = canvasEl.getBoundingClientRect();
    const ai = opts.getAiPanelEl();
    const aiRect = ai && !ai.hidden ? ai.getBoundingClientRect() : null;
    const cut = terminalCutPx(r, aiRect);
    return computeBounds({ width: canvasEl.clientWidth || r.width, height: TALL }, cut, PAD);
  }

  function applyFrame(): void {
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
      const resizeHandle = makeHandle('resize', it.label);
      wrapper.append(moveHandle, resizeHandle);
      mountItemHandles(wrapper, moveHandle, resizeHandle, layout, {
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
    destroy() {
      editBtn.remove();
      resetBtn.remove();
    },
  };
}
