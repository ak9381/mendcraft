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
  createHandGate,
  createOperatorTracker,
  createPresenceGate,
  type FaceSignature,
  type FaceBox,
  type FacingOptions,
  type HandGateConfig,
} from './faceLogic';
export type { FaceSignature } from './faceLogic';
import { createHandBinder, type HandCandidate } from './handBinding';
import type { OwnerHands } from './handSignature';
import { resolveCameraStream } from './cameraShare';
import { ensureSquareCanvas, unletterboxLandmarks } from './squareFrame';

export type { HandEvent, HandFrame } from './handLogic';
export type { FaceBox } from './faceLogic';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** FaceLandmarker interval — a few fps, so the Facing pill stays cheap. */
export const FACE_INTERVAL_MS = 200;

/** Whether enough time has passed to run another face frame. */
export function shouldRunFace(now: number, last: number, interval = FACE_INTERVAL_MS): boolean {
  return now - last >= interval;
}
const LOST_TIMEOUT_MS = 2500;

/** Face as drawn by the overlay (box already mirrored to screen space 0..1). */
export interface FaceFrame {
  box: FaceBox;
  /** The locked operator (or, before registration, the main/largest face). */
  isOperator: boolean;
  facing: boolean;
  /** Canvas HAND GATE for this face (operator only; null otherwise): true =
   *  facing, false = an actually turned head (looser thresholds than
   *  `facing` — looking down at the keyboard is fine), null = unknown (a
   *  face just (re)appeared and hasn't settled, or none). Only an explicit
   *  false locks the hands, and the canvas "Not facing" pill follows it. */
  handGate?: boolean | null;
  /** Non-operator faces are drawn greyed out. */
  dim: boolean;
}

export interface PresenceFrame {
  hands: HandFrame[];
  /** Rejected hands' points (mirrored) for a dimmed draw. */
  rejectedHands: Pt[][];
  faces: FaceFrame[];
  /** The operator's (or main) face mesh, for optional on-device face cues.
   *  Never drawn, stored or sent anywhere. */
  operatorFace?: { x: number; y: number; z?: number }[] | null;
  facing: boolean;
  /** The canvas HAND GATE for the focus face (the operator, or the main face
   *  before registration), with the gate's short lost-face grace: true /
   *  false / null (no face, or not settled). Present whenever faces run. */
  handGate?: boolean | null;
  registered: boolean;
  paused: boolean;
  /** Camera frame height ÷ width (landmark y is normalised to it). */
  aspect?: number;
}

export interface PresenceTracker {
  /** Optional existing stream: attach tracking to a live preview instead of a new getUserMedia. */
  start(existing?: MediaStream): Promise<void>;
  stop(): void;
  setPinchThreshold(on: number, off: number): void;
  /** Lock onto the current main (largest, most frontal) face. Returns false if none. */
  register(): boolean;
  /** Forget the signature and revert to best-2-hands behaviour. */
  reregister(): void;
  /** Lock onto a previously captured signature (sessionStorage re-lock). */
  registerSignature(sig: FaceSignature): void;
  /** The owner's scanned hand proportions — binding prefers matching hands. */
  setOwnerHands(owner: OwnerHands | null): void;
  /** The signature of the current main face (pre-registration) or the one the
   *  operator registered with — for persisting across a reload. Stays on-device. */
  currentSignature(): FaceSignature | null;
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

/** A track muted this long counts as lost (WebKit MUTES a camera track
 *  when another capture — a call, another app, a native session — takes the
 *  camera; it does not end it). */
export const CAMERA_MUTE_LOST_MS = 2000;

/** Fire `onLost` when a live camera track ends on its own (unplug, OS
 *  revoke) or stays muted for CAMERA_MUTE_LOST_MS — not when we called
 *  stop() (stillLive is then false). An unmute in time cancels it. */
export function watchTracksForEnd(
  stream: { getTracks(): Array<{ addEventListener(type: 'ended' | 'mute' | 'unmute', fn: () => void): void }> },
  onLost: () => void,
  stillLive: () => boolean,
  timers: { set(fn: () => void, ms: number): unknown; clear(id: unknown): void } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  },
): void {
  let fired = false;
  const lost = (): void => { if (!fired && stillLive()) { fired = true; onLost(); } };
  for (const t of stream.getTracks()) {
    let muteTimer: unknown = null;
    t.addEventListener('ended', lost);
    t.addEventListener('mute', () => {
      if (muteTimer !== null) return;
      muteTimer = timers.set(() => { muteTimer = null; lost(); }, CAMERA_MUTE_LOST_MS);
    });
    t.addEventListener('unmute', () => {
      if (muteTimer !== null) { timers.clear(muteTimer); muteTimer = null; }
    });
  }
}

/** A registered operator's hands keep flowing while the presence gate has
 *  not paused (her face may be briefly hidden, e.g. behind her own hand):
 *  they bind to her last-seen face box. Only a pause — or no box ever — drops them. */
export function bindOperatorHands(paused: boolean, lastBox: unknown): boolean {
  return !paused && lastBox != null;
}

/** MediaPipe's detectForVideo is synchronous (on the GPU delegate it waits
 *  for its own readback). When runs stay slow — two in a row over
 *  SLOW_TRACKING_RUN_MS, e.g. the GPU busy with Nano or a heavy render — each
 *  is followed by a short pause (half its time, at most TRACKING_BACKOFF_MAX_MS)
 *  so the page's other work gets the thread. One slow run (a hiccup) and
 *  normal runs wait for nothing extra. */
export const SLOW_TRACKING_RUN_MS = 50;
export const TRACKING_BACKOFF_MAX_MS = 80;
export function trackingBackoffMs(spentMs: number, previousWasSlow: boolean): number {
  if (!(spentMs > SLOW_TRACKING_RUN_MS) || !previousWasSlow) return 0;
  return Math.min(spentMs * 0.5, TRACKING_BACKOFF_MAX_MS);
}

export function createPresenceTracker(
  onEvent: (e: HandEvent) => void,
  onFrame?: (f: PresenceFrame) => void,
  opts?: {
    onCameraLost?: () => void;
    /** When false, skip FaceLandmarker. Default true. */
    detectFaces?: boolean;
    /** When false, skip HandLandmarker (phone companion Facing pill). Default true. */
    detectHands?: boolean;
    /** Minimum ms between tracking runs, read every animation frame (the
     *  phone throttles to ~10 fps with no hand in view). Default 0: every
     *  animation frame. */
    frameIntervalMs?: () => number;
    /** Hand-gate thresholds (default HAND_GATE; the phone passes PHONE_HAND_GATE). */
    handGate?: HandGateConfig;
    /** Facing-tracker options (the phone passes PHONE_FACING). */
    facing?: FacingOptions;
  },
): PresenceTracker {
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.style.display = 'none';
  // Tagged so point-to-connect grabs the very frame the landmarks came from.
  video.setAttribute?.('data-mc-hand-tracker', '1');
  document.body.appendChild(video);

  const wantFaces = opts?.detectFaces !== false;
  const wantHands = opts?.detectHands !== false;
  let handLm: HandLandmarker | null = null;
  let squareBuf: HTMLCanvasElement | null = null;
  let faceLm: FaceLandmarker | null = null;
  let stream: MediaStream | null = null;
  let ownsStream = true;
  let rafId = 0;
  let running = false;
  let stopped = false;
  let lastFaceAt = -Infinity;
  let lastRunAt = -Infinity;
  /** No tracking run before this time: a slow run is followed by as much idle time. */
  let backoffUntil = -Infinity;
  let lastRunSlow = false;
  let ts = 0;

  const processor = createHandsProcessor(onEvent);
  const facingTracker = createFacingTracker(opts?.facing);
  const handGate = createHandGate(opts?.handGate);
  let lastHandGate: boolean | null = null;
  /** The last hand frame saw a hand (the face's lost grace is longer then). */
  let handsInView = false;
  const operator = createOperatorTracker();
  const gate = createPresenceGate(LOST_TIMEOUT_MS);
  const binder = createHandBinder();

  // Cached last face detection (face runs less often than hands).
  let candidates: Candidate[] = [];
  let operatorIdx: number | null = null;
  let mainIdx: number | null = null; // largest face, used for pre-registration + register()

  let lastFacing = false;
  let lastPaused = false;
  let focusFace: { x: number; y: number; z?: number }[] | null = null;
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
    focusFace = focusIdx !== null ? (result.faceLandmarks[focusIdx] ?? null) : null;
    if (focusIdx !== null) {
      const c = candidates[focusIdx];
      const pose = headPose(result.faceLandmarks[focusIdx], c.matrix);
      const facing = facingTracker.update(pose, now);
      lastHandGate = handGate.update(pose, now);
      emitFacing(facing);
    } else {
      // No face → its last state for the lost grace (longer while a hand is
      // in view: her hand over her face), then null = not facing.
      lastHandGate = handGate.update(null, now, handsInView ? LOST_TIMEOUT_MS : undefined);
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
      handGate: i === focusIdx ? lastHandGate : null,
      dim: operator.registered ? i !== operatorIdx : i !== mainIdx,
    }));
  }

  function handleHands(result: HandLandmarkerResult): void {
    const now = ts;
    handsInView = result.landmarks.length > 0;
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

      if (!bindOperatorHands(paused, operator.lastBox)) {
        // Lost the operator for good (the gate paused): end any active drag
        // cleanly and feed no hands. A face only briefly hidden — her own hand
        // in front of it — keeps her hands, bound to her last-seen face box,
        // for the gate's grace (LOST_TIMEOUT_MS).
        acceptedInputs = [];
        rejectedPts = rawHands.map((h) => h.landmarks.map((p) => ({ x: 1 - p.x, y: p.y })));
      } else {
        const box = operator.lastBox!; // last seen: still hers within the grace
        const cands: HandCandidate[] = rawHands.map((h, i) => ({
          index: i,
          wrist: h.landmarks[WRIST],
          label: h.label,
          points: h.landmarks,
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
      operatorFace: focusFace,
      facing: lastFacing,
      ...(wantFaces ? { handGate: lastHandGate } : {}),
      registered: operator.registered,
      paused,
      aspect: video.videoWidth && video.videoHeight ? video.videoHeight / video.videoWidth : undefined,
    });
  }

  function squareSource(): HTMLVideoElement | HTMLCanvasElement {
    try {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h || w === h) return video;
      if (!squareBuf) {
        const doc = video.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
        if (!doc) return video;
        squareBuf = doc.createElement('canvas');
      }
      return ensureSquareCanvas(video, squareBuf);
    } catch {
      return video;
    }
  }

  function loop(): void {
    if (!running || video.readyState < 2 || (!handLm && !faceLm)) {
      rafId = requestAnimationFrame(loop);
      return;
    }
    const at = performance.now();
    const minGap = opts?.frameIntervalMs?.() ?? 0;
    if ((minGap > 0 && at - lastRunAt < minGap) || at < backoffUntil) {
      rafId = requestAnimationFrame(loop);
      return;
    }
    lastRunAt = at;
    ts = at;
    // Timestamps must strictly increase per MediaPipe task.
    // Face runs at a few fps (FACE_INTERVAL_MS) so the small Facing pill
    // stays cheap next to the hand tracker.
    const src = squareSource();
    const vw = video.videoWidth, vh = video.videoHeight;
    const usedSquare = src !== video;
    let ranFace = false;
    if (wantFaces && faceLm && shouldRunFace(ts, lastFaceAt)) {
      lastFaceAt = ts;
      ranFace = true;
      const fr = faceLm.detectForVideo(src, ts);
      if (usedSquare && fr.faceLandmarks) {
        fr.faceLandmarks = fr.faceLandmarks.map((lm) => unletterboxLandmarks(lm, vw, vh));
      }
      updateFaces(fr, ts);
    }
    if (handLm) {
      const hr = handLm.detectForVideo(src, ts + 0.5);
      if (usedSquare && hr.landmarks) {
        hr.landmarks = hr.landmarks.map((lm) => unletterboxLandmarks(lm, vw, vh));
      }
      handleHands(hr);
    } else if (ranFace) {
      // Face-only (phone look-to-edit): still emit a frame per face run, or
      // onFrame subscribers would never see the facing signal.
      handleHands({ landmarks: [], worldLandmarks: [], handedness: [], handednesses: [] } as unknown as HandLandmarkerResult);
    }
    const doneAt = performance.now();
    const spent = doneAt - at;
    backoffUntil = doneAt + trackingBackoffMs(spent, lastRunSlow);
    lastRunSlow = spent > SLOW_TRACKING_RUN_MS;
    rafId = requestAnimationFrame(loop);
  }

  async function start(existing?: MediaStream): Promise<void> {
    stopped = false;
    // Ask for the camera FIRST, in parallel with the wasm/model downloads, so
    // Chrome's permission prompt appears immediately and a model/CSP failure
    // can never hide it (the old order threw before getUserMedia was reached,
    // so the user never even saw a camera prompt).
    const picked = resolveCameraStream(existing);
    const streamPromise: Promise<{ stream: MediaStream; owns: boolean }> = picked.stream
      ? Promise.resolve({ stream: picked.stream, owns: false })
      : navigator.mediaDevices
          .getUserMedia({ video: { width: 640, height: 480 }, audio: false })
          .then((s) => ({ stream: s, owns: true }));
    // Mark the rejection handled so a camera failure during model loading
    // never surfaces as an unhandled rejection; the real await below rethrows.
    streamPromise.catch(() => undefined);

    try {
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      // Try the fast GPU (WebGL) delegate first; some machines (headless Chrome,
      // locked-down GPUs, software renderers) cannot create it, so fall back to the
      // CPU delegate automatically rather than failing the whole camera. Tracking is
      // slower on CPU but still works — far better than no hands/face at all.
      if (wantHands) {
        handLm = await createWithFallback((delegate) =>
          HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
            runningMode: 'VIDEO',
            numHands: 4,
          }),
        );
      }
      if (wantFaces) {
        faceLm = await createWithFallback((delegate) =>
          FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate },
            runningMode: 'VIDEO',
            numFaces: 4,
            outputFacialTransformationMatrixes: true,
          }),
        );
      }
    } catch (err) {
      // Models/wasm failed: release the camera we may have just opened.
      streamPromise
        .then(({ stream: s, owns }) => { if (owns) for (const t of s.getTracks()) t.stop(); })
        .catch(() => undefined);
      throw err;
    }

    const got = await streamPromise;
    // stop() was called while the models loaded (the phone hid, or the user
    // turned hands off): never start the loop after the fact.
    if (stopped) {
      if (got.owns) for (const t of got.stream.getTracks()) t.stop();
      stop();
      return;
    }
    stream = got.stream;
    ownsStream = got.owns;
    video.srcObject = stream;
    await video.play();
    if (stopped) { stop(); return; }

    running = true;
    if (opts?.onCameraLost) watchTracksForEnd(stream, opts.onCameraLost, () => running);
    rafId = requestAnimationFrame(loop);
  }

  function stop(): void {
    stopped = true;
    running = false;
    cancelAnimationFrame(rafId);
    if (ownsStream) {
      for (const track of stream?.getTracks() ?? []) track.stop();
    }
    stream = null;
    video.srcObject = null;
    video.remove(); // idempotent: no-op if already detached
    handLm?.close();
    faceLm?.close();
    handLm = null;
    faceLm = null;
    onFrame?.({ hands: [], rejectedHands: [], faces: [], facing: lastFacing, registered: operator.registered, paused: false });
  }

  let registeredSig: FaceSignature | null = null;

  function register(): boolean {
    if (mainIdx === null) return false;
    registeredSig = candidates[mainIdx].signature;
    operator.register(registeredSig);
    operatorIdx = mainIdx;
    gate.reset();
    binder.reset();
    return true;
  }

  function registerSignature(sig: FaceSignature): void {
    registeredSig = sig;
    operator.register(sig);
    operatorIdx = null; // re-acquired on the next face frame that matches
    gate.reset();
    binder.reset();
  }

  function currentSignature(): FaceSignature | null {
    if (registeredSig) return registeredSig;
    return mainIdx !== null ? candidates[mainIdx]?.signature ?? null : null;
  }

  function reregister(): void {
    registeredSig = null;
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
    registerSignature,
    currentSignature,
    setOwnerHands(owner) { binder.setOwnerHands(owner); },
    get isRegistered() { return operator.registered; },
    get isFacing() { return lastFacing; },
    get isPaused() { return lastPaused; },
    onFacingChange(cb) { facingSubs.add(cb); return () => facingSubs.delete(cb); },
    onPauseChange(cb) { pauseSubs.add(cb); return () => pauseSubs.delete(cb); },
    videoEl: video,
  };
}
