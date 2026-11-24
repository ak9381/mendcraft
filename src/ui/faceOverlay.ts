// Canvas overlay for faces: the original green rectangle around the face
// (394b33c), drawn over a small top-centre camera preview. The "Facing this
// device" pill lives beside/under the preview (facingBanner), not on this
// canvas. Boxes arrive already mirrored to screen/camera space (0..1).

import type { FaceFrame } from '../input/presence';
import { findLiveCameraStream } from '../input/cameraShare';

export interface FaceOverlay {
  /** `hands` are 21-point landmarks already mirrored to screen/camera space (0..1). */
  draw(faces: FaceFrame[], hands?: readonly (readonly { x: number; y: number }[])[]): void;
  clear(): void;
}

export interface FaceOverlayOptions {
  reducedMotion?: boolean;
  operatorColor?: string;
  dimColor?: string;
  /** Small top-centre camera preview with a green face box. */
  compact?: boolean;
}

/** Original operator face-box colour (the green rectangle). */
export const FACE_BOX_GREEN = '#38f8a0';
const DIM_COLOR = '#6b7280';
const MAX_DPR = 2;
const SKELETON_GREEN = '#7dffc0';

/** MediaPipe 21-landmark edges (wrist, fingers, palm). */
export const HAND_SKELETON_EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/** Cheap lines+dots for one hand, in the same 0..1 space as the face box. */
export function drawHandSkeleton(
  ctx: CanvasRenderingContext2D,
  hand: readonly { x: number; y: number }[],
  w: number,
  h: number,
  dpr: number,
  color = SKELETON_GREEN,
): void {
  if (!hand || hand.length < 21) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.2 * dpr;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  for (const [a, b] of HAND_SKELETON_EDGES) {
    const p = hand[a], q = hand[b];
    if (!p || !q) continue;
    ctx.moveTo(p.x * w, p.y * h);
    ctx.lineTo(q.x * w, q.y * h);
  }
  ctx.stroke();
  for (let i = 0; i < 21; i++) {
    const p = hand[i];
    if (!p) continue;
    const r = (i === 4 || i === 8 ? 2.3 : 1.5) * dpr;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function attachPreviewStream(video: HTMLVideoElement): void {
  try {
    const stream = findLiveCameraStream();
    if (stream && video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play?.().catch(() => { /* autoplay can wait */ });
    }
  } catch { /* no camera yet */ }
}

export function createFaceOverlay(container: HTMLElement, opts: FaceOverlayOptions = {}): FaceOverlay {
  const compact = !!opts.compact;
  const operatorColor = opts.operatorColor ?? FACE_BOX_GREEN;
  const dimColor = opts.dimColor ?? DIM_COLOR;

  const host = document.createElement(compact ? 'div' : 'canvas');
  let canvas: HTMLCanvasElement;
  let video: HTMLVideoElement | null = null;

  if (compact) {
    host.className = 'mc-face-preview';
    host.setAttribute('aria-hidden', 'true');
    video = document.createElement('video');
    video.className = 'mc-face-preview-video';
    video.setAttribute('aria-hidden', 'true');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    canvas = document.createElement('canvas');
    canvas.className = 'mc-face-preview-box';
    canvas.setAttribute('aria-hidden', 'true');
    host.append(video, canvas);
    container.appendChild(host);
    attachPreviewStream(video);
  } else {
    canvas = host as HTMLCanvasElement;
    canvas.className = 'face-overlay';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);
  }

  const ctx = canvas.getContext('2d')!;

  function fit(): { w: number; h: number; dpr: number } {
    const box = compact ? host.getBoundingClientRect() : container.getBoundingClientRect();
    const dpr = Math.min((typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1, MAX_DPR);
    const w = Math.max(1, Math.round(box.width * dpr));
    const h = Math.max(1, Math.round(box.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w, h, dpr };
  }

  function clear(): void {
    const { w, h } = fit();
    ctx.clearRect(0, 0, w, h);
    if (compact) host.classList.remove('is-live');
  }

  function draw(faces: FaceFrame[], hands?: readonly (readonly { x: number; y: number }[])[]): void {
    if (compact && video) attachPreviewStream(video);
    const { w, h, dpr } = fit();
    ctx.clearRect(0, 0, w, h);
    if (compact) host.classList.toggle('is-live', faces.length > 0);

    for (const face of faces) {
      const x = face.box.x * w;
      const y = face.box.y * h;
      const bw = face.box.w * w;
      const bh = face.box.h * h;
      const color = face.isOperator ? operatorColor : dimColor;
      ctx.globalAlpha = face.isOperator ? 0.95 : 0.45;
      ctx.strokeStyle = color;
      ctx.lineWidth = (face.isOperator ? 3 : 2) * dpr;
      ctx.shadowColor = face.isOperator ? color : 'transparent';
      ctx.shadowBlur = face.isOperator ? 6 * dpr : 0;
      ctx.strokeRect(x, y, bw, bh);
      ctx.shadowBlur = 0;
    }
    if (hands && hands.length) {
      ctx.shadowBlur = 0;
      for (let i = 0; i < hands.length; i++) {
        drawHandSkeleton(ctx, hands[i]!, w, h, dpr, i === 0 ? SKELETON_GREEN : '#b8ffe0');
      }
    }
    ctx.globalAlpha = 1;
  }

  return { draw, clear };
}
