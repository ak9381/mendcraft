// Still-frame capture for the point-and-say path: draw ONE crop of the live
// camera <video> onto an offscreen canvas and return it as base64 JPEG. The
// crop is taken only at the moment the user points and speaks, is tightly
// cropped around the pointer (small payload), and goes nowhere except the
// Firebase AI Logic call that the caller makes — no storage, no other APIs.

import type { CropRect } from '../ai/deixis';

export interface CapturedCrop {
  mimeType: 'image/jpeg';
  dataBase64: string;
  w: number;
  h: number;
}

const JPEG_QUALITY = 0.7;

/** Capture `rect` from the video into a JPEG. Null when the camera has no
 *  frame yet or the canvas is unavailable (caller proceeds without an image). */
export function captureCropFromVideo(video: HTMLVideoElement, rect: CropRect): CapturedCrop | null {
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = rect.w;
    canvas.height = rect.h;
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    const url = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    const comma = url.indexOf(',');
    if (!url.startsWith('data:image/jpeg') || comma < 0) return null;
    return { mimeType: 'image/jpeg', dataBase64: url.slice(comma + 1), w: rect.w, h: rect.h };
  } catch {
    return null; // tainted canvas / OOM — degrade to the no-image prompt
  }
}
