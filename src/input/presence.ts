// Camera orchestrator: runs MediaPipe HandLandmarker (numHands 4) and, at a
// lower rate, FaceLandmarker (numFaces 4) on ONE shared video. All frames stay
// on-device. Pure logic in faceLogic.ts / handBinding.ts / handLogic.ts decides
// facing, the locked operator, and which hands belong to them; only accepted
// hands (≤2) drive the existing pinch processor. Exposes a small facing API
// (isFacing / onFacingChange) plus register / re-register for future Relay code.

import {
  FilesetResolver,
  HandLandmarker,
  FaceLandmarker,
  type HandLandmarkerResult,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';

import { createHandsProcessor, WRIST, type HandEvent, type HandFrame, type Pt } from './handLogic';
import {
  computeSignature,
  headPose,
  boxArea,
  createFacingTracker,
  createOperatorTracker,
  createPresenceGate,
  type FaceSignature,
  type FaceBox,
} from './faceLogic';
import { createHandBinder, type HandCandidate } from './handBinding';

export type { HandEvent, HandFrame } from './handLogic';
export type { FaceBox } from './faceLogic';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** Run face detection on every Nth hand frame to spare laptop GPUs. */
const FACE_EVERY = 3;
const LOST_TIMEOUT_MS = 2500;

/** Face as drawn by the overlay (box already mirrored to screen space 0..1). */
export interface FaceFrame {
  box: FaceBox;
  /** The locked operator (or, before registration, the main/largest face). */
  isOperator: boolean;
  facing: boolean;
  /** Non-operator faces are drawn greyed out. */
  dim: boolean;
}

export interface PresenceFrame {
  hands: HandFrame[];
  /** Rejected hands' points (mirrored) for a dimmed draw. */
  rejectedHands: Pt[][];
  faces: FaceFrame[];
  facing: boolean;
  registered: boolean;
  paused: boolean;
}

export interface PresenceTracker {
  start(): Promise<void>;
  stop(): void;
  setPinchThreshold(on: number, off: number): void;
  /** Lock onto the current main (largest, most frontal) face. Returns false if none. */
  register(): boolean;
  /** Forget the signature and revert to best-2-hands behaviour. */
  reregister(): void;
  readonly isRegistered: boolean;
  readonly isFacing: boolean;
  readonly isPaused: boolean;
  /** Subscribe to "facing this device" transitions; returns an unsubscribe fn. */
  onFacingChange(cb: (facing: boolean) => void): () => void;
  /** Subscribe to pause/resume transitions; returns an unsubscribe fn. */
  onPauseChange(cb: (paused: boolean) => void): () => void;
  readonly videoEl: HTMLVideoElement;
}

interface Candidate {
  signature: FaceSignature;
  matrix: number[] | null;
}

/** Create a MediaPipe task on the GPU delegate, falling back to CPU if the GPU
 *  delegate cannot be initialised (headless / software WebGL / no GPU). */
async function createWithFallback<T>(make: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  try {
    return await make('GPU');
  } catch (err) {
    console.warn('[mendcraft] MediaPipe GPU delegate unavailable — falling back to CPU.', err);
    return await make('CPU');
  }
}

function mirrorBox(b: FaceBox): FaceBox {
  const x = 1 - (b.x + b.w);
  return { x, y: b.y, w: b.w, h: b.h, cx: 1 - b.cx, cy: b.cy };
}

export function createPresenceTracker(
  onEvent: (e: HandEvent) => void,
  onFrame?: (f: PresenceFrame) => void,
): PresenceTracker {
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.style.display = 'none';
  document.body.appendChild(video);

  let handLm: HandLandmarker | null = null;
  let faceLm: FaceLandmarker | null = null;
  let stream: MediaStream | null = null;
  let rafId = 0;
  let running = false;
  let frameCount = 0;
  let ts = 0;

  const processor = createHandsProcessor(onEvent);
  const facingTracker = createFacingTracker();
  const operator = createOperatorTracker();
  const gate = createPresenceGate(LOST_TIMEOUT_MS);
  const binder = createHandBinder();

  // Cached last face detection (face runs less often than hands).
  let candidates: Candidate[] = [];
  let operatorIdx: number | null = null;
  let mainIdx: number | null = null; // largest face, used for pre-registration + register()

  let lastFacing = false;
  let lastPaused = false;
  const facingSubs = new Set<(f: boolean) => void>();
  const pauseSubs = new Set<(p: boolean) => void>();

  function pickMain(): number | null {
    if (candidates.length === 0) return null;
    let best = 0;
    for (let i = 1; i < candidates.length; i++) {
      if (boxArea(candidates[i].signature.box) > boxArea(candidates[best].signature.box)) best = i;
    }
    return best;
  }

  function updateFaces(result: FaceLandmarkerResult, now: number): void {
    const matrices = result.facialTransformationMatrixes ?? [];
    candidates = result.faceLandmarks.map((lm, i) => ({
      signature: computeSignature(lm),
      matrix: matrices[i]?.data ? Array.from(matrices[i].data) : null,
    }));
    mainIdx = pickMain();

    if (operator.registered) {
      const res = operator.update(candidates.map((c) => c.signature), now);
      operatorIdx = res.index;
    } else {
      operatorIdx = null;
    }

    // Facing is judged on the tracked operator (or the main face pre-registration).
    const focusIdx = operator.registered ? operatorIdx : mainIdx;
    if (focusIdx !== null) {
      const c = candidates[focusIdx];
      const facing = facingTracker.update(headPose(result.faceLandmarks[focusIdx], c.matrix), now);
      emitFacing(facing);
    } else {
      emitFacing(facingTracker.update({ yaw: 90, pitch: 90 }, now)); // no face → not facing
    }
  }

  function emitFacing(facing: boolean): void {
    if (facing !== lastFacing) {
      lastFacing = facing;
      for (const cb of facingSubs) cb(facing);
    }
  }
  function emitPaused(paused: boolean): void {
    if (paused !== lastPaused) {
      lastPaused = paused;
      for (const cb of pauseSubs) cb(paused);
    }
  }

  function faceFrames(): FaceFrame[] {
    const focusIdx = operator.registered ? operatorIdx : mainIdx;
    return candidates.map((c, i) => ({
      box: mirrorBox(c.signature.box),
      isOperator: i === focusIdx,
      facing: i === focusIdx && lastFacing,
      dim: operator.registered ? i !== operatorIdx : i !== mainIdx,
    }));
  }

  function handleHands(result: HandLandmarkerResult): void {
    const now = ts;
    const rawHands = result.landmarks.map((landmarks, i) => ({
      landmarks,
      label: result.handedness?.[i]?.[0]?.categoryName,
    }));

    let acceptedInputs = rawHands.slice(0, 2); // default (pre-registration) behaviour
    let rejectedPts: Pt[][] = [];
    let paused = false;

    if (operator.registered) {
      const operatorPresent = operatorIdx !== null;
      const presence = gate.update(operatorPresent, now);
      paused = presence.paused;
      emitPaused(paused);

      if (paused || !operatorPresent) {
        // Lost the operator: end any active drag cleanly and feed no hands.
        acceptedInputs = [];
        rejectedPts = rawHands.map((h) => h.landmarks.map((p) => ({ x: 1 - p.x, y: p.y })));
      } else {
        const box = operator.lastBox!;
        const cands: HandCandidate[] = rawHands.map((h, i) => ({
          index: i,
          wrist: h.landmarks[WRIST],
          label: h.label,
        }));
        const acceptedIdx = binder.bind(cands, box);
        const acceptedSet = new Set(acceptedIdx);
        acceptedInputs = acceptedIdx.map((i) => rawHands[i]);
        rejectedPts = rawHands
          .filter((_, i) => !acceptedSet.has(i))
          .map((h) => h.landmarks.map((p) => ({ x: 1 - p.x, y: p.y })));
      }
    }

    const frames = processor.process(acceptedInputs);
    onFrame?.({
      hands: frames,
      rejectedHands: rejectedPts,
      faces: faceFrames(),
      facing: lastFacing,
      registered: operator.registered,
      paused,
    });
  }

  function loop(): void {
    if (!running || !handLm || !faceLm || video.readyState < 2) {
      rafId = requestAnimationFrame(loop);
      return;
    }
    ts = performance.now();
    // Timestamps must strictly increase per MediaPipe task.
    if (frameCount % FACE_EVERY === 0) {
      const fr = faceLm.detectForVideo(video, ts);
      updateFaces(fr, ts);
    }
    const hr = handLm.detectForVideo(video, ts + 0.5);
    handleHands(hr);
    frameCount++;
    rafId = requestAnimationFrame(loop);
  }

  async function start(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    // Try the fast GPU (WebGL) delegate first; some machines (headless Chrome,
    // locked-down GPUs, software renderers) cannot create it, so fall back to the
    // CPU delegate automatically rather than failing the whole camera. Tracking is
    // slower on CPU but still works — far better than no hands/face at all.
    handLm = await createWithFallback((delegate) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numHands: 4,
      }),
    );
    faceLm = await createWithFallback((delegate) =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numFaces: 4,
        outputFacialTransformationMatrixes: true,
      }),
    );

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
    handLm?.close();
    faceLm?.close();
    handLm = null;
    faceLm = null;
    onFrame?.({ hands: [], rejectedHands: [], faces: [], facing: lastFacing, registered: operator.registered, paused: false });
  }

  function register(): boolean {
    if (mainIdx === null) return false;
    operator.register(candidates[mainIdx].signature);
    operatorIdx = mainIdx;
    gate.reset();
    binder.reset();
    return true;
  }

  function reregister(): void {
    operator.reset();
    operatorIdx = null;
    gate.reset();
    binder.reset();
    emitPaused(false);
  }

  return {
    start,
    stop,
    setPinchThreshold(on, off) { processor.setPinchThreshold(on, off); },
    register,
    reregister,
    get isRegistered() { return operator.registered; },
    get isFacing() { return lastFacing; },
    get isPaused() { return lastPaused; },
    onFacingChange(cb) { facingSubs.add(cb); return () => facingSubs.delete(cb); },
    onPauseChange(cb) { pauseSubs.add(cb); return () => pauseSubs.delete(cb); },
    videoEl: video,
  };
}
