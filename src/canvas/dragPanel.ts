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
  style: { left: string; top: string; height?: string };
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
      const r = panel.getBoundingClientRect();
      spacer = makeSpacer();
      spacer.style.height = `${r.height}px`; // holds the panel's old slot open in the flow below it
      panel.before?.(spacer);
      panel.classList.add('is-floating');
      floating = true;
    }
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
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
