// Canvas overlay for faces: the original green rectangle around the face
// (394b33c), drawn over a small top-centre camera preview. The "Facing this
// device" pill lives beside/under the preview (facingBanner), not on this
// canvas. Boxes arrive already mirrored to screen/camera space (0..1).

import type { FaceFrame } from '../input/presence';
import { findLiveCameraStream } from '../input/cameraShare';

export interface FaceOverlay {
  draw(faces: FaceFrame[], rejectedHands?: unknown): void;
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

  function draw(faces: FaceFrame[], _rejectedHands?: unknown): void {
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
    ctx.globalAlpha = 1;
  }

  return { draw, clear };
}
