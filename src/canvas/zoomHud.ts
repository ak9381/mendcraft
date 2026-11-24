// Zoom HUD: bottom-left −  [pct]  +  Fit. Pure view; the app supplies the actions.
import './zoomHud.css';
export { isTypingTarget } from './canvasNav';

export interface ZoomHudApi { zoomIn(): void; zoomOut(): void; reset(): void; fit(): void }
export interface ZoomHud { setZoom(z: number): void; el: HTMLElement }

export function mountZoomHud(root: HTMLElement, api: ZoomHudApi): ZoomHud {
  const doc = root.ownerDocument;
  const el = doc.createElement('div');
  el.className = 'mc-zoom-hud';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Zoom');
  const mk = (cls: string, label: string, text: string, fn: () => void): HTMLElement => {
    const b = doc.createElement('button');
    b.className = `mc-zoom-btn ${cls}`;
    b.setAttribute('type', 'button');
    b.setAttribute('aria-label', label);
    b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  };
  const pct = mk('mc-zoom-pct', 'Reset zoom to 100%', '100%', () => api.reset());
  for (const b of [
    mk('mc-zoom-out', 'Zoom out', '−', () => api.zoomOut()),
    pct,
    mk('mc-zoom-in', 'Zoom in', '+', () => api.zoomIn()),
    mk('mc-zoom-fit', 'Fit all boards', 'Fit', () => api.fit()),
  ]) el.appendChild(b);
  root.appendChild(el);
  return { el, setZoom(z) { pct.textContent = `${Math.round(z * 100)}%`; } };
}
