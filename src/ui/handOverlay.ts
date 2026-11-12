// Canvas overlay that draws every tracked hand's 21-point skeleton over the
// viewport, in a per-hand colour that switches when that hand is pinching.

import { HAND_CONNECTIONS, INDEX_TIP, THUMB_TIP, type HandFrame } from '../input/handLogic';

export interface HandOverlay {
  draw(hands: HandFrame[]): void;
  clear(): void;
}

export function createHandOverlay(container: HTMLElement): HandOverlay {
  const canvas = document.createElement('canvas');
  canvas.className = 'hand-overlay';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  function fit(): { w: number; h: number } {
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w, h };
  }

  function clear(): void {
    const { w, h } = fit();
    ctx.clearRect(0, 0, w, h);
  }

  function draw(hands: HandFrame[]): void {
    const { w, h } = fit();
    ctx.clearRect(0, 0, w, h);
    const dpr = window.devicePixelRatio || 1;
    for (const hand of hands) {
      const P = hand.points.map((p) => ({ x: p.x * w, y: p.y * h }));
      ctx.strokeStyle = hand.color;
      ctx.fillStyle = hand.color;
      ctx.globalAlpha = hand.owner || !hand.pinching ? 0.95 : 0.5;
      ctx.lineWidth = (hand.pinching ? 5 : 3) * dpr;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.moveTo(P[a].x, P[a].y);
        ctx.lineTo(P[b].x, P[b].y);
      }
      ctx.stroke();
      for (const p of P) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      // Pinch point: thumb + index tips ringed, and a target at the midpoint.
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2.5 * dpr;
      ctx.strokeStyle = '#ffffff';
      for (const i of [THUMB_TIP, INDEX_TIP]) {
        ctx.beginPath();
        ctx.arc(P[i].x, P[i].y, 8 * dpr, 0, Math.PI * 2);
        ctx.stroke();
      }
      const m = { x: hand.pinchPoint.x * w, y: hand.pinchPoint.y * h };
      ctx.beginPath();
      ctx.arc(m.x, m.y, (hand.pinching ? 14 : 10) * dpr, 0, Math.PI * 2);
      ctx.strokeStyle = hand.color;
      ctx.lineWidth = 4 * dpr;
      ctx.stroke();
      if (hand.pinching) {
        ctx.globalAlpha = 0.35;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  return { draw, clear };
}
