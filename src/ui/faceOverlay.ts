// Canvas overlay for faces: a box/outline per detected face (the operator bright,
// strangers greyed) with a "Facing this device" / "Not facing" label on the
// operator, plus any camera-rejected hands drawn dimmed. Shares the viewport box
// with the hand overlay; boxes arrive already mirrored to screen space (0..1).

import { HAND_CONNECTIONS, type Pt } from '../input/handLogic';
import type { FaceFrame } from '../input/presence';

export interface FaceOverlay {
  draw(faces: FaceFrame[], rejectedHands: Pt[][]): void;
  clear(): void;
}

const OPERATOR_COLOR = '#38f8a0';
const DIM_COLOR = '#6b7280';

export function createFaceOverlay(container: HTMLElement): FaceOverlay {
  const canvas = document.createElement('canvas');
  canvas.className = 'face-overlay';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  function fit(): { w: number; h: number; dpr: number } {
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w, h, dpr };
  }

  function clear(): void {
    const { w, h } = fit();
    ctx.clearRect(0, 0, w, h);
  }

  function draw(faces: FaceFrame[], rejectedHands: Pt[][]): void {
    const { w, h, dpr } = fit();
    ctx.clearRect(0, 0, w, h);

    // Rejected hands first, faint grey, so operator graphics sit on top.
    ctx.strokeStyle = DIM_COLOR;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 2 * dpr;
    ctx.lineCap = 'round';
    for (const pts of rejectedHands) {
      const P = pts.map((p) => ({ x: p.x * w, y: p.y * h }));
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.moveTo(P[a].x, P[a].y);
        ctx.lineTo(P[b].x, P[b].y);
      }
      ctx.stroke();
    }

    for (const face of faces) {
      const x = face.box.x * w;
      const y = face.box.y * h;
      const bw = face.box.w * w;
      const bh = face.box.h * h;
      const color = face.isOperator ? OPERATOR_COLOR : DIM_COLOR;
      ctx.globalAlpha = face.isOperator ? 0.95 : 0.4;
      ctx.strokeStyle = color;
      ctx.lineWidth = (face.isOperator ? 3 : 2) * dpr;
      ctx.strokeRect(x, y, bw, bh);

      if (face.isOperator) {
        const label = face.facing ? 'Facing this device' : 'Not facing';
        const badgeColor = face.facing ? OPERATOR_COLOR : '#f59e0b';
        ctx.font = `${13 * dpr}px system-ui, sans-serif`;
        const padX = 8 * dpr;
        const tw = ctx.measureText(label).width;
        const bhLabel = 20 * dpr;
        const bx = x;
        const by = Math.max(0, y - bhLabel - 4 * dpr);
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = badgeColor;
        ctx.fillRect(bx, by, tw + padX * 2, bhLabel);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#0b0f14';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + padX, by + bhLabel / 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  return { draw, clear };
}
