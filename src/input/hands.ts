// MediaPipe HandLandmarker: webcam landmarks stay on-device, nothing is
// uploaded. Pinch (thumb tip <-> index tip) drives select/drag gestures.

import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

import { createHandsProcessor, type HandEvent, type HandFrame } from './handLogic';
import { ensureSquareCanvas, unletterboxLandmarks } from './squareFrame';

export type { HandEvent, HandFrame } from './handLogic';

export interface HandTracker {
  start(): Promise<void>;
  stop(): void;
  setPinchThreshold(on: number, off: number): void;
  readonly videoEl: HTMLVideoElement;
}

export function createHandTracker(
  onEvent: (e: HandEvent) => void,
  onFrame?: (hands: HandFrame[]) => void,
): HandTracker {
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.style.display = 'none';
  document.body.appendChild(video);

  let landmarker: HandLandmarker | null = null;
  let stream: MediaStream | null = null;
  let rafId = 0;
  let running = false;
  let squareBuf: HTMLCanvasElement | null = null;
  const processor = createHandsProcessor(onEvent);

  function setPinchThreshold(on: number, off: number): void {
    processor.setPinchThreshold(on, off);
  }

  function handleResult(result: HandLandmarkerResult): void {
    const hands = result.landmarks.map((landmarks, i) => ({
      landmarks,
      label: result.handedness?.[i]?.[0]?.categoryName,
    }));
    const frames = processor.process(hands);
    onFrame?.(frames);
  }

  function loop(): void {
    if (!running || !landmarker || video.readyState < 2) {
      rafId = requestAnimationFrame(loop);
      return;
    }
    let src: HTMLVideoElement | HTMLCanvasElement = video;
    try {
      if (!squareBuf) squareBuf = (video.ownerDocument ?? document).createElement('canvas');
      src = ensureSquareCanvas(video, squareBuf);
    } catch { /* keep the raw video if the canvas path fails */ }
    const result = landmarker.detectForVideo(src, performance.now());
    if (src !== video && result.landmarks) {
      result.landmarks = result.landmarks.map((lm) => unletterboxLandmarks(lm, video.videoWidth, video.videoHeight));
    }
    handleResult(result);
    rafId = requestAnimationFrame(loop);
  }

  async function start(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
    });

    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    video.srcObject = stream;
    await video.play();

    running = true;
    rafId = requestAnimationFrame(loop);
  }

  function stop(): void {
    running = false;
    cancelAnimationFrame(rafId);
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    video.srcObject = null;
    video.remove(); // idempotent: no-op if already detached
    landmarker?.close();
    landmarker = null;
    onFrame?.([]);
  }

  return { start, stop, setPinchThreshold, videoEl: video };
}
