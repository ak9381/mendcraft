// MediaPipe's Hand/Face Landmarker warns "Using NORM_RECT without
// IMAGE_DIMENSIONS is only supported for the square ROI" on a 16:9 webcam
// and can skew landmark x/y. We feed a square, letterboxed frame (the full
// image, no crop) and map the normalised landmarks back to the video's 0–1
// space so the cursor and mesh stay lined up with the real hand.

export function ensureSquareCanvas(video: HTMLVideoElement, buf: HTMLCanvasElement): HTMLCanvasElement | HTMLVideoElement {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h || w === h) return video;
  const size = Math.max(w, h);
  if (buf.width !== size || buf.height !== size) { buf.width = size; buf.height = size; }
  const ctx = buf.getContext('2d');
  if (!ctx) return video;
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(video, (size - w) / 2, (size - h) / 2, w, h);
  return buf;
}

/** Map a landmark from the letterboxed square frame back to the video's 0–1 space. */
export function unletterboxNorm<T extends { x: number; y: number }>(p: T, videoW: number, videoH: number): T {
  if (!videoW || !videoH || videoW === videoH) return p;
  const size = Math.max(videoW, videoH);
  const x = (p.x * size - (size - videoW) / 2) / videoW;
  const y = (p.y * size - (size - videoH) / 2) / videoH;
  return { ...p, x, y };
}

export function unletterboxLandmarks<T extends { x: number; y: number }>(lms: readonly T[], videoW: number, videoH: number): T[] {
  if (!videoW || !videoH || videoW === videoH) return lms as T[];
  return lms.map((p) => unletterboxNorm(p, videoW, videoH));
}
