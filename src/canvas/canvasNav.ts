// Pure navigation maths for the infinite canvas: zoom steps, wheel intent.
import { MAX_Z, MIN_Z, screenToWorld, type Camera, type Viewport } from './camera';

export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2] as const;

/** Next zoom step strictly above (dir 1) or below (dir -1) `z`, clamped to the range. */
export function stepZoom(z: number, dir: 1 | -1): number {
  const eps = 1e-6;
  if (dir === 1) {
    for (const s of ZOOM_STEPS) if (s > z + eps) return s;
    return ZOOM_STEPS[ZOOM_STEPS.length - 1];
  }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < z - eps) return ZOOM_STEPS[i];
  return ZOOM_STEPS[0];
}

export type WheelIntent = { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number };

export function wheelIntent(e: { deltaX: number; deltaY: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; deltaMode: number }): WheelIntent {
  const k = e.deltaMode === 1 ? 16 : 1;
  if (e.ctrlKey || e.metaKey) {
    const dy = Math.min(30, Math.max(-30, e.deltaY * k));
    return { kind: 'zoom', factor: Math.exp(-dy * 0.01) };
  }
  let dx = e.deltaX * k, dy = e.deltaY * k;
  if (e.shiftKey && e.deltaX === 0) { dx = dy; dy = 0; }
  return { kind: 'pan', dx, dy };
}

/** True when keystrokes belong to a text field (input/textarea/select/contenteditable). */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as (Partial<HTMLElement> & { closest?: (s: string) => unknown }) | null;
  if (!el || typeof el !== 'object') return false;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable === true) return true;
  const ce = typeof el.getAttribute === 'function' ? el.getAttribute('contenteditable') : null;
  if (ce !== null && ce !== undefined && ce !== 'false') return true;
  return typeof el.closest === 'function' && !!el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

/** Zoom to `z` about the viewport centre. */
export function zoomCameraTo(c: Camera, vp: Viewport, z: number): Camera {
  const nz = Math.min(MAX_Z, Math.max(MIN_Z, z));
  const mid = { x: vp.w / 2, y: vp.h / 2 };
  const w = screenToWorld(c, mid);
  return { x: w.x - mid.x / nz, y: w.y - mid.y / nz, z: nz };
}
