// Point-to-connect: the DOM half (camera frame → cropped ≤512 px JPEG). The
// geometry lives in pointCrop.ts (pure, tested). One camera, many features:
// when hands are on, the tracker's live <video> is reused — no second
// getUserMedia. Hands off, the camera opens once for one frame and closes.
import { isLiveVideoStream } from '../input/cameraShare';
import { base64ByteLength, fitWithin, type Rect } from './pointCrop';

export interface CroppedFrame {
  mimeType: 'image/jpeg';
  dataBase64: string;
  /** Decoded JPEG bytes — what goes to the cloud if Nano can't answer. */
  bytes: number;
  w: number;
  h: number;
}

const isLiveFrame = (v: HTMLVideoElement): boolean => isLiveVideoStream(v.srcObject) && v.readyState >= 2 && v.videoWidth > 0;

/** A <video> already showing a live camera frame: the hand tracker's own
 *  (tagged data-mc-hand-tracker, the frame the landmarks came from) first,
 *  else any other live camera preview. */
export function findLiveVideo(doc: Document = document): HTMLVideoElement | null {
  const tracker = Array.from(doc.querySelectorAll<HTMLVideoElement>('video[data-mc-hand-tracker]')).find(isLiveFrame);
  if (tracker) return tracker;
  return Array.from(doc.querySelectorAll('video')).find(isLiveFrame) ?? null;
}

/** Hands off: open the camera for ONE frame. Resolves null if it can't. */
export async function openCameraOnce(timeoutMs = 6000): Promise<{ video: HTMLVideoElement; stop(): void } | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;
  let stream: MediaStream | null = null;
  const stop = () => { stream?.getTracks().forEach((t) => t.stop()); };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await Promise.race([
      new Promise<void>((resolve) => {
        const ready = () => { if (video.readyState >= 2 && video.videoWidth) resolve(); };
        video.addEventListener('loadeddata', ready);
        video.addEventListener('playing', ready);
        void video.play().then(ready, ready);
      }),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('camera timed out')), timeoutMs)),
    ]);
    // Give auto-exposure a moment: the very first frame is often dark.
    await new Promise((r) => setTimeout(r, 350));
    return { video, stop };
  } catch {
    stop();
    return null;
  }
}

/** Draw `rect` of the video's native frame into a JPEG no larger than 512 px. */
export function captureCrop(video: HTMLVideoElement, rect: Rect, quality = 0.75): CroppedFrame | null {
  try {
    const { w, h } = fitWithin(rect.w, rect.h);
    if (!w || !h) return null;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
    const url = c.toDataURL('image/jpeg', quality);
    const dataBase64 = url.slice(url.indexOf(',') + 1);
    if (!dataBase64) return null;
    return { mimeType: 'image/jpeg', dataBase64, bytes: base64ByteLength(dataBase64), w, h };
  } catch {
    return null;
  }
}
