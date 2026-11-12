// MediaPipe HandLandmarker: webcam landmarks stay on-device, nothing is
// uploaded. Pinch (thumb tip <-> index tip) drives select/drag gestures.

import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const THUMB_TIP = 4;
const INDEX_TIP = 8;
const WRIST = 0;
const MIDDLE_MCP = 9;

// Pinch ratio (tip distance / hand-size reference) hysteresis: engage below
// PINCH_ON, release above PINCH_OFF. User-calibratable via setPinchThreshold.
const DEFAULT_PINCH_ON = 0.35;
const DEFAULT_PINCH_OFF = 0.48;
const TAP_MOVE_LIMIT = 0.03; // normalised screen units; beyond this a pinch is a drag, not a tap

export type HandEvent =
  | { type: 'pinch-tap'; x: number; y: number }
  | { type: 'pinch-start'; x: number; y: number }
  | { type: 'pinch-move'; x: number; y: number; dx: number; dy: number }
  | { type: 'pinch-end' }
  | { type: 'lost' }
  | { type: 'tracking'; x: number; y: number };

export interface HandTracker {
  start(): Promise<void>;
  stop(): void;
  setPinchThreshold(on: number, off: number): void;
  readonly videoEl: HTMLVideoElement;
}

export function createHandTracker(onEvent: (e: HandEvent) => void): HandTracker {
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.style.display = 'none';
  document.body.appendChild(video);

  let landmarker: HandLandmarker | null = null;
  let stream: MediaStream | null = null;
  let rafId = 0;
  let running = false;
  let pinching = false;
  let tapCandidate = true;
  let lastX = 0;
  let lastY = 0;
  let pinchOn = DEFAULT_PINCH_ON;
  let pinchOff = DEFAULT_PINCH_OFF;

  function setPinchThreshold(on: number, off: number): void {
    pinchOn = on;
    pinchOff = off;
  }

  function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function handleResult(result: HandLandmarkerResult): void {
    const hand = result.landmarks[0];
    if (!hand) {
      if (pinching) {
        pinching = false;
        onEvent({ type: 'pinch-end' });
      }
      onEvent({ type: 'lost' });
      return;
    }

    const handSize = dist(hand[WRIST], hand[MIDDLE_MCP]) || 1;
    const ratio = dist(hand[THUMB_TIP], hand[INDEX_TIP]) / handSize;
    // Mirror x so the cursor matches what the user sees in a front-facing camera.
    const x = 1 - hand[INDEX_TIP].x;
    const y = hand[INDEX_TIP].y;

    if (!pinching && ratio < pinchOn) {
      pinching = true;
      tapCandidate = true;
      lastX = x;
      lastY = y;
      onEvent({ type: 'pinch-start', x, y });
      return;
    }

    if (pinching && ratio > pinchOff) {
      pinching = false;
      if (tapCandidate) onEvent({ type: 'pinch-tap', x, y });
      onEvent({ type: 'pinch-end' });
      return;
    }

    if (pinching) {
      const dx = x - lastX;
      const dy = y - lastY;
      if (Math.hypot(dx, dy) > TAP_MOVE_LIMIT) tapCandidate = false;
      lastX = x;
      lastY = y;
      onEvent({ type: 'pinch-move', x, y, dx, dy });
      return;
    }

    onEvent({ type: 'tracking', x, y });
  }

  function loop(): void {
    if (!running || !landmarker || video.readyState < 2) {
      rafId = requestAnimationFrame(loop);
      return;
    }
    const result = landmarker.detectForVideo(video, performance.now());
    handleResult(result);
    rafId = requestAnimationFrame(loop);
  }

  async function start(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
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
    landmarker?.close();
    landmarker = null;
  }

  return { start, stop, setPinchThreshold, videoEl: video };
}
