// Draggable floating panels (the Nano/Gemini terminals): pinch-hold on a
// title bar with the virtual hand, or an ordinary mouse/touch drag — both
// land here as plain PointerEvents (see handPointer.ts's DRAG_HANDLE branch,
// which dispatches synthetic pointerdown/move/up at the pinch position for
// the hand path; real input needs no translation). A panel starts docked in
// its normal document-flow spot; the first drag "undocks" it into a fixed
// floating position (leaving a same-size spacer so layout below it doesn't
// jump) and remembers that position for the rest of the tab's session.

export interface Size { width: number; height: number }
export interface Pos { left: number; top: number }
export interface Viewport { width: number; height: number }

/** Keep a panel's whole box on screen, with a small margin — never the snap
 *  target itself drifting half off an edge. */
export function clampToViewport(pos: Pos, size: Size, vp: Viewport, margin = 8): Pos {
  const maxLeft = Math.max(margin, vp.width - size.width - margin);
  const maxTop = Math.max(margin, vp.height - size.height - margin);
  return {
    left: Math.min(Math.max(pos.left, margin), maxLeft),
    top: Math.min(Math.max(pos.top, margin), maxTop),
  };
}

const KEY_PREFIX = 'mc.panelPos.';
const SIZE_PREFIX = 'mc.panelSize.';

/** Comfortable bounds for a hand-resized terminal: never smaller than a couple
 *  of log lines, never larger than the screen (with a margin) or an absolute cap. */
export const MIN_PANEL: Size = { width: 240, height: 140 };
export const MAX_PANEL: Size = { width: 900, height: 900 };

/** Clamp a resize to [min,max], and to the viewport when one is given, so a
 *  corner-drag can neither shrink the panel to nothing nor grow it off-screen. */
export function clampSize(size: Size, min: Size = MIN_PANEL, max: Size = MAX_PANEL, vp?: Viewport): Size {
  let w = Math.min(Math.max(size.width, min.width), max.width);
  let h = Math.min(Math.max(size.height, min.height), max.height);
  if (vp) {
    w = Math.max(min.width, Math.min(w, vp.width - 16));
    h = Math.max(min.height, Math.min(h, vp.height - 16));
  }
  return { width: w, height: h };
}

export function loadPanelSize(storage: Pick<Storage, 'getItem'>, id: string): Size | null {
  try {
    const raw = storage.getItem(SIZE_PREFIX + id);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Size>;
    if (typeof v.width === 'number' && typeof v.height === 'number') return { width: v.width, height: v.height };
  } catch {
    // corrupt or unavailable — fall back to the CSS default size
  }
  return null;
}

export function savePanelSize(storage: Pick<Storage, 'setItem'>, id: string, size: Size): void {
  try { storage.setItem(SIZE_PREFIX + id, JSON.stringify(size)); } catch { /* storage unavailable — size just won't persist */ }
}

export function clearPanelSize(storage: Pick<Storage, 'removeItem'>, id: string): void {
  try { storage.removeItem(SIZE_PREFIX + id); } catch { /* storage unavailable */ }
}

export function loadPanelPos(storage: Pick<Storage, 'getItem'>, id: string): Pos | null {
  try {
    const raw = storage.getItem(KEY_PREFIX + id);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Pos>;
    if (typeof v.left === 'number' && typeof v.top === 'number') return { left: v.left, top: v.top };
  } catch {
    // corrupt value or storage unavailable (private mode) — fall back to the default spot
  }
  return null;
}

export function savePanelPos(storage: Pick<Storage, 'setItem'>, id: string, pos: Pos): void {
  try { storage.setItem(KEY_PREFIX + id, JSON.stringify(pos)); } catch { /* storage unavailable — position just won't persist */ }
}

export function clearPanelPos(storage: Pick<Storage, 'removeItem'>, id: string): void {
  try { storage.removeItem(KEY_PREFIX + id); } catch { /* storage unavailable */ }
}

type PanelStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface DraggablePanelOptions {
  /** sessionStorage key suffix — unique per panel ("nano"/"gemini"). */
  id: string;
  storage?: PanelStorage;
  win?: Pick<Window, 'innerWidth' | 'innerHeight'>;
  /** Already `position: fixed` (review window). Skip the flow spacer and
   *  just drag in place, clearing `right`/`bottom` so left/top win. */
  alreadyFixed?: boolean;
}

export interface DraggablePanel {
  /** True once the panel has left its document-flow spot for a fixed one. */
  readonly floating: boolean;
  resetPosition(): void;
  destroy(): void;
}

/** A minimal DOM surface this needs from `panel`/`handle` — real elements
 *  satisfy it; tests can pass a much smaller fake. */
export interface DragPanelElement {
  classList: { add(c: string): void; remove(c: string): void };
  style: { left: string; top: string; width?: string; height?: string };
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  before?(node: unknown): void;
}
export interface DragHandleElement {
  addEventListener(type: string, fn: (e: PointerLikeEvent) => void): void;
  removeEventListener(type: string, fn: (e: PointerLikeEvent) => void): void;
  setPointerCapture?(id: number): void;
}
export interface PointerLikeEvent { clientX: number; clientY: number; pointerId?: number }

export function mountDraggablePanel(
  panel: DragPanelElement,
  handle: DragHandleElement,
  opts: DraggablePanelOptions,
  makeSpacer: () => DragPanelElement = () => ({ classList: { add() {}, remove() {} }, style: { left: '', top: '' }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) }),
): DraggablePanel {
  const storage = opts.storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  const win = opts.win ?? (typeof window !== 'undefined' ? window : { innerWidth: 1280, innerHeight: 800 });
  let floating = false;
  let spacer: DragPanelElement | null = null;
  let dragStart: { x: number; y: number; left: number; top: number } | null = null;

  function floatAt(left: number, top: number): void {
    if (!floating) {
      if (!opts.alreadyFixed) {
        const r = panel.getBoundingClientRect();
        spacer = makeSpacer();
        spacer.style.height = `${r.height}px`; // holds the panel's old slot open in the flow below it
        panel.before?.(spacer);
      }
      panel.classList.add('is-floating');
      floating = true;
    }
    const style = panel.style as { left: string; top: string; right?: string; bottom?: string };
    style.right = 'auto';
    style.bottom = 'auto';
    style.left = `${left}px`;
    style.top = `${top}px`;
  }

  function applyClamped(left: number, top: number): void {
    const r = panel.getBoundingClientRect();
    const clamped = clampToViewport({ left, top }, { width: r.width, height: r.height }, { width: win.innerWidth, height: win.innerHeight });
    panel.style.left = `${clamped.left}px`;
    panel.style.top = `${clamped.top}px`;
  }

  function onDown(e: PointerLikeEvent): void {
    if (!floating) floatAt(panel.getBoundingClientRect().left, panel.getBoundingClientRect().top);
    const r = panel.getBoundingClientRect();
    dragStart = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    if (e.pointerId != null) handle.setPointerCapture?.(e.pointerId);
  }
  function onMove(e: PointerLikeEvent): void {
    if (!dragStart) return;
    applyClamped(dragStart.left + (e.clientX - dragStart.x), dragStart.top + (e.clientY - dragStart.y));
  }
  function onUp(): void {
    if (!dragStart) return;
    dragStart = null;
    if (storage) savePanelPos(storage, opts.id, { left: panel.getBoundingClientRect().left, top: panel.getBoundingClientRect().top });
  }
  handle.addEventListener('pointerdown', onDown);
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);

  const saved = storage ? loadPanelPos(storage, opts.id) : null;
  if (saved) floatAt(saved.left, saved.top);

  return {
    get floating() { return floating; },
    resetPosition() {
      dragStart = null;
      floating = false;
      panel.classList.remove('is-floating');
      panel.style.left = '';
      panel.style.top = '';
      spacer = null;
      if (storage) clearPanelPos(storage, opts.id);
    },
    destroy() {
      handle.removeEventListener('pointerdown', onDown);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    },
  };
}

export interface ResizablePanel {
  resetSize(): void;
  destroy(): void;
}

/**
 * Corner-handle resize for a floating terminal (A6-008). The handle is a
 * `[data-mc-resize-handle]`, so the same mouse/touch drag and the virtual-hand
 * pinch-drag (handPointer dispatches synthetic pointer events to it) both land
 * here. Width/height are clamped to [MIN_PANEL, MAX_PANEL] and the viewport,
 * and the size persists per panel in sessionStorage exactly like position.
 */
export function mountResizablePanel(
  panel: DragPanelElement,
  handle: DragHandleElement,
  opts: DraggablePanelOptions,
): ResizablePanel {
  const storage = opts.storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  const win = opts.win ?? (typeof window !== 'undefined' ? window : { innerWidth: 1280, innerHeight: 800 });
  let start: { x: number; y: number; width: number; height: number } | null = null;

  function apply(width: number, height: number): Size {
    const s = clampSize({ width, height }, MIN_PANEL, MAX_PANEL, { width: win.innerWidth, height: win.innerHeight });
    panel.style.width = `${s.width}px`;
    panel.style.height = `${s.height}px`;
    return s;
  }
  function onDown(e: PointerLikeEvent): void {
    const r = panel.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, width: r.width, height: r.height };
    if (e.pointerId != null) handle.setPointerCapture?.(e.pointerId);
  }
  function onMove(e: PointerLikeEvent): void {
    if (!start) return;
    apply(start.width + (e.clientX - start.x), start.height + (e.clientY - start.y));
  }
  function onUp(): void {
    if (!start) return;
    start = null;
    const r = panel.getBoundingClientRect();
    if (storage) savePanelSize(storage, opts.id, { width: r.width, height: r.height });
  }
  handle.addEventListener('pointerdown', onDown);
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);

  const saved = storage ? loadPanelSize(storage, opts.id) : null;
  if (saved) apply(saved.width, saved.height);

  return {
    resetSize() {
      start = null;
      panel.style.width = '';
      panel.style.height = '';
      if (storage) clearPanelSize(storage, opts.id);
    },
    destroy() {
      handle.removeEventListener('pointerdown', onDown);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    },
  };
}
