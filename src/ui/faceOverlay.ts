// Canvas overlay for faces: a soft, rounded corner-bracket frame (not a hard
// box) per detected face — a glowing bracket on the operator, a dim plain
// bracket on strangers — with a "Facing this device" / "Not facing" label on
// the operator. Fades in/out as faces are gained/lost. Shares the viewport
// with the hand overlay; boxes arrive already mirrored to screen space (0..1).

import { HAND_CONNECTIONS, type Pt } from '../input/handLogic';
import type { FaceFrame } from '../input/presence';

export interface FaceOverlay {
  draw(faces: FaceFrame[], rejectedHands: Pt[][]): void;
  clear(): void;
}

export interface FaceOverlayOptions {
  reducedMotion?: boolean;
  /** Override the bracket colours (the canvas passes warm-paper tones). */
  operatorColor?: string;
  dimColor?: string;
  /** Small top-of-screen preview instead of a full-viewport overlay. */
  compact?: boolean;
}

const OPERATOR_COLOR = '#38f8a0';
const DIM_COLOR = '#6b7280';
const MAX_DPR = 2;
const FADE_MS = 180;
/** Corner bracket arm length as a fraction of the shorter box side. */
const BRACKET_FRAC = 0.22;

function readReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function createFaceOverlay(container: HTMLElement, opts: FaceOverlayOptions = {}): FaceOverlay {
  const canvas = document.createElement('canvas');
  canvas.className = opts.compact ? 'face-overlay face-overlay--compact' : 'face-overlay';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const reducedMotion = opts.reducedMotion ?? readReducedMotion();
  const operatorColor = opts.operatorColor ?? OPERATOR_COLOR;
  const dimColor = opts.dimColor ?? DIM_COLOR;

  let opacity = 0;
  let wasIdle = true;

  function fit(): { w: number; h: number; dpr: number } {
    const rect = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w, h, dpr };
  }

  function clear(): void {
    const { w, h } = fit();
    ctx.clearRect(0, 0, w, h);
    opacity = 0;
    wasIdle = true;
  }

  /** Four L-shaped corner brackets (camera-AF style) instead of a hard box. */
  function strokeBracket(x: number, y: number, w: number, h: number, dpr: number): void {
    const arm = Math.max(6 * dpr, Math.min(w, h) * BRACKET_FRAC);
    ctx.beginPath();
    // top-left
    ctx.moveTo(x, y + arm); ctx.lineTo(x, y); ctx.lineTo(x + arm, y);
    // top-right
    ctx.moveTo(x + w - arm, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + arm);
    // bottom-right
    ctx.moveTo(x + w, y + h - arm); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - arm, y + h);
    // bottom-left
    ctx.moveTo(x + arm, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - arm);
    ctx.stroke();
  }

  function draw(faces: FaceFrame[], rejectedHands: Pt[][]): void {
    const isIdle = faces.length === 0 && rejectedHands.length === 0;
    if (isIdle && wasIdle) return;

    const { w, h, dpr } = fit();
    ctx.clearRect(0, 0, w, h);

    const target = faces.length > 0 ? 1 : 0;
    if (reducedMotion) opacity = target;
    else opacity += (target - opacity) * Math.min(1, (1000 / FADE_MS) * (1 / 60));

    // Rejected hands first, faint grey, so operator graphics sit on top.
    ctx.strokeStyle = dimColor;
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
      const color = face.isOperator ? operatorColor : dimColor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      ctx.lineWidth = (face.isOperator ? 2.5 : 2) * dpr;
      if (face.isOperator) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 10 * dpr;
      }
      ctx.globalAlpha = (face.isOperator ? 0.95 : 0.4) * opacity;
      strokeBracket(x, y, bw, bh, dpr);
      ctx.shadowBlur = 0;

      if (face.isOperator) {
        const label = face.facing ? 'Facing this device' : 'Not facing';
        const badgeColor = face.facing ? operatorColor : '#f59e0b';
        ctx.font = `${13 * dpr}px system-ui, sans-serif`;
        const padX = 8 * dpr;
        const tw = ctx.measureText(label).width;
        const bhLabel = 20 * dpr;
        const bx = x;
        const by = Math.max(0, y - bhLabel - 4 * dpr);
        ctx.globalAlpha = 0.85 * opacity;
        ctx.fillStyle = badgeColor;
        ctx.beginPath();
        const r = 5 * dpr;
        const bwBadge = tw + padX * 2;
        ctx.moveTo(bx + r, by);
        ctx.arcTo(bx + bwBadge, by, bx + bwBadge, by + bhLabel, r);
        ctx.arcTo(bx + bwBadge, by + bhLabel, bx, by + bhLabel, r);
        ctx.arcTo(bx, by + bhLabel, bx, by, r);
        ctx.arcTo(bx, by, bx + bwBadge, by, r);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = opacity;
        ctx.fillStyle = '#0b0f14';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + padX, by + bhLabel / 2);
      }
    }
    ctx.globalAlpha = 1;
    wasIdle = isIdle && opacity <= 0.01;
  }

  return { draw, clear };
}
