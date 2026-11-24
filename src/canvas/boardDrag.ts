// Drag a board by its title (mouse or touch). A press that moves less than
// `threshold` screen px is still a click (focus the board); once past it the
// board follows the pointer and the click that ends the gesture is swallowed.
export interface BoardDragOpts {
  frameId: string;
  getZoom(): number;
  /** World-space delta since the previous call, plus the pointer's client point. */
  onMove(id: string, dxWorld: number, dyWorld: number, clientX: number, clientY: number): void;
  /** `cancelled` is true for pointercancel (no deliberate release). */
  onEnd(id: string, cancelled: boolean): void;
  threshold?: number;
}

export function attachBoardDrag(title: HTMLElement, opts: BoardDragOpts): () => void {
  const threshold = opts.threshold ?? 5;
  let active: { id: number; x: number; y: number; moved: boolean } | null = null;

  const down = (e: PointerEvent) => {
    if (e.button !== 0 || active) return;
    // Keep the viewport's pan from starting under us.
    e.stopPropagation();
    delete title.dataset.dragged;
    active = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    try { title.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
  };
  const move = (e: PointerEvent) => {
    if (!active || e.pointerId !== active.id) return;
    const dx = e.clientX - active.x, dy = e.clientY - active.y;
    if (!active.moved) {
      if (Math.hypot(dx, dy) <= threshold) return;
      active.moved = true;
      title.dataset.dragged = '1';
    }
    const z = opts.getZoom() || 1;
    active.x = e.clientX; active.y = e.clientY;
    if (dx || dy) opts.onMove(opts.frameId, dx / z, dy / z, e.clientX, e.clientY);
  };
  const finish = (e: PointerEvent) => {
    if (!active || e.pointerId !== active.id) return;
    const moved = active.moved;
    active = null;
    try { title.releasePointerCapture?.(e.pointerId); } catch { /* already released */ }
    if (moved) {
      opts.onEnd(opts.frameId, e.type === 'pointercancel');
      // The click that follows pointerup is swallowed; clear the flag afterwards.
      setTimeout(() => { delete title.dataset.dragged; }, 0);
    }
  };
  const click = (e: Event) => {
    if (title.dataset.dragged !== '1') return;
    delete title.dataset.dragged;
    e.preventDefault(); e.stopPropagation();
  };

  title.addEventListener('pointerdown', down);
  title.addEventListener('pointermove', move);
  title.addEventListener('pointerup', finish);
  title.addEventListener('pointercancel', finish);
  title.addEventListener('click', click, true);
  return () => {
    title.removeEventListener('pointerdown', down);
    title.removeEventListener('pointermove', move);
    title.removeEventListener('pointerup', finish);
    title.removeEventListener('pointercancel', finish);
    title.removeEventListener('click', click, true);
  };
}
