// Pure (MediaPipe-free, DOM-free) face logic: head pose, "facing this device"
// hysteresis, on-device face signatures, operator matching across frames, and a
// presence timeout gate. No I/O here so every branch is unit-testable, and no
// landmark data ever leaves this process.

export interface Pt3 { x: number; y: number; z?: number }
export type FaceLandmarks = Pt3[];

export interface FaceBox {
  x: number; y: number; w: number; h: number;
  /** Centre, for continuity scoring. */
  cx: number; cy: number;
}

/** Degrees. Frontal ≈ { yaw: 0, pitch: 0 }. */
export interface HeadPose { yaw: number; pitch: number }

/** Normalized geometry ratios + box; the whole identity signal stays on-device. */
export interface FaceSignature {
  ratios: number[];
  box: FaceBox;
}

/** Canonical MediaPipe FaceLandmarker (468/478-point) indices we rely on. */
export const FACE = {
  LEFT_EYE_OUTER: 33, RIGHT_EYE_OUTER: 263,
  LEFT_EYE_INNER: 133, RIGHT_EYE_INNER: 362,
  NOSE_TIP: 1, CHIN: 152, FOREHEAD: 10,
  LEFT_CHEEK: 234, RIGHT_CHEEK: 454,
  MOUTH_LEFT: 61, MOUTH_RIGHT: 291,
} as const;

const toDeg = (r: number) => (r * 180) / Math.PI;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const dist = (a: Pt3, b: Pt3) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt3, b: Pt3): Pt3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// ---- head pose ----

/**
 * Yaw/pitch from a 4x4 facial transformation matrix (column-major, as MediaPipe
 * returns in `facialTransformationMatrixes[i].data`). Rotation convention
 * R = Ry(yaw)·Rx(pitch); extraction is the exact inverse of that construction.
 */
export function headPoseFromMatrix(m: number[]): HeadPose {
  // Column-major: R[row][col] = m[col*4 + row].
  const r00 = m[0];   // R[0][0]
  const r20 = m[2];   // R[2][0]
  const r12 = m[9];   // R[1][2]
  const pitch = Math.asin(clamp(-r12, -1, 1));
  const yaw = Math.atan2(-r20, r00);
  return { yaw: toDeg(yaw), pitch: toDeg(pitch) };
}

/**
 * Fallback pose from landmark geometry when no transformation matrix is present:
 * nose-tip offset from the cheek midpoint (yaw) and from the eye↔chin span
 * (pitch), each mapped through asin so the result is bounded to ±90°.
 */
export function headPoseFromLandmarks(lm: FaceLandmarks): HeadPose {
  const eyeL = lm[FACE.LEFT_EYE_OUTER];
  const eyeR = lm[FACE.RIGHT_EYE_OUTER];
  const nose = lm[FACE.NOSE_TIP];
  const chin = lm[FACE.CHIN];
  const cheekL = lm[FACE.LEFT_CHEEK];
  const cheekR = lm[FACE.RIGHT_CHEEK];
  const eyeMid = mid(eyeL, eyeR);
  const cheekMid = mid(cheekL, cheekR);

  const halfWidth = Math.abs(cheekR.x - cheekL.x) / 2 || 1e-6;
  const yawNorm = (nose.x - cheekMid.x) / halfWidth;

  const faceH = chin.y - eyeMid.y || 1e-6;
  const noseFrac = (nose.y - eyeMid.y) / faceH; // ~0.5 when frontal
  const pitchNorm = (noseFrac - 0.5) * 2;

  return {
    yaw: toDeg(Math.asin(clamp(yawNorm, -1, 1))),
    pitch: toDeg(Math.asin(clamp(pitchNorm, -1, 1))),
  };
}

/** Prefer the transformation matrix; fall back to landmark geometry. */
export function headPose(lm: FaceLandmarks, matrix?: number[] | null): HeadPose {
  if (matrix && matrix.length >= 16) return headPoseFromMatrix(matrix);
  return headPoseFromLandmarks(lm);
}

// ---- boxes ----

export function faceBox(lm: FaceLandmarks): FaceBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  return { x: minX, y: minY, w, h, cx: minX + w / 2, cy: minY + h / 2 };
}

export function boxArea(b: FaceBox): number {
  return Math.max(0, b.w) * Math.max(0, b.h);
}

export function boxIoU(a: FaceBox, b: FaceBox): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const uni = boxArea(a) + boxArea(b) - inter;
  return uni > 0 ? inter / uni : 0;
}

export function boxCenterDistance(a: FaceBox, b: FaceBox): number {
  return Math.hypot(a.cx - b.cx, a.cy - b.cy);
}

// ---- signature ----

/** Normalized ratios (inter-ocular = 1) between a handful of stable landmarks. */
export function computeSignature(lm: FaceLandmarks): FaceSignature {
  const eyeL = lm[FACE.LEFT_EYE_OUTER];
  const eyeR = lm[FACE.RIGHT_EYE_OUTER];
  const io = dist(eyeL, eyeR) || 1e-6;
  const nose = lm[FACE.NOSE_TIP];
  const chin = lm[FACE.CHIN];
  const forehead = lm[FACE.FOREHEAD];
  const mouthL = lm[FACE.MOUTH_LEFT];
  const mouthR = lm[FACE.MOUTH_RIGHT];
  const eyeMid = mid(eyeL, eyeR);
  const mouthMid = mid(mouthL, mouthR);

  const ratios = [
    dist(lm[FACE.LEFT_EYE_INNER], lm[FACE.RIGHT_EYE_INNER]) / io,
    dist(nose, chin) / io,
    dist(mouthL, mouthR) / io,
    dist(lm[FACE.LEFT_CHEEK], lm[FACE.RIGHT_CHEEK]) / io,
    dist(nose, forehead) / io,
    dist(nose, eyeL) / io,
    dist(nose, eyeR) / io,
    dist(eyeMid, mouthMid) / io,
  ];
  return { ratios, box: faceBox(lm) };
}

/** RMS distance between two signatures' ratio vectors (box ignored). */
export function signatureDistance(a: FaceSignature, b: FaceSignature): number {
  const n = Math.min(a.ratios.length, b.ratios.length) || 1;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = a.ratios[i] - b.ratios[i];
    sum += d * d;
  }
  return Math.sqrt(sum / n);
}

// ---- facing hysteresis + debounce ----

export interface FacingOptions {
  /** Enter "facing" when max(|yaw|,|pitch|) < this (deg). */
  enterDeg?: number;
  /** Leave "facing" when max(|yaw|,|pitch|) > this (deg). */
  leaveDeg?: number;
  /** A change must persist this long before it takes effect (ms). */
  debounceMs?: number;
}

export interface FacingTracker {
  update(pose: HeadPose, now: number): boolean;
  readonly isFacing: boolean;
  reset(): void;
}

export function createFacingTracker(opts: FacingOptions = {}): FacingTracker {
  const enterDeg = opts.enterDeg ?? 20;
  const leaveDeg = opts.leaveDeg ?? 28;
  const debounceMs = opts.debounceMs ?? 250;

  let facing = false;
  let pendingTarget: boolean | null = null;
  let pendingSince = 0;

  function update(pose: HeadPose, now: number): boolean {
    const mag = Math.max(Math.abs(pose.yaw), Math.abs(pose.pitch));
    // Hysteresis: the bar to stay facing (leaveDeg) is looser than to enter.
    const wantFacing = facing ? mag < leaveDeg : mag < enterDeg;
    if (wantFacing === facing) {
      pendingTarget = null;
      return facing;
    }
    // Debounce: the new target must persist for debounceMs before it takes hold.
    if (pendingTarget !== wantFacing) {
      pendingTarget = wantFacing;
      pendingSince = now;
    }
    if (pendingTarget === wantFacing && now - pendingSince >= debounceMs) {
      facing = wantFacing;
      pendingTarget = null;
    }
    return facing;
  }

  return {
    update,
    get isFacing() { return facing; },
    reset() { facing = false; pendingTarget = null; pendingSince = 0; },
  };
}

// ---- operator lock (register & track one face) ----

export interface OperatorOptions {
  /** Max signature distance for a candidate to count as the operator. */
  sigGate?: number;
  /** Weight on (1 - IoU) continuity when recently seen. */
  iouWeight?: number;
  /** Weight on box-centre drift when recently seen. */
  posWeight?: number;
  /** Continuity scoring only applies within this window after last sighting. */
  lossGraceMs?: number;
}

export interface OperatorResult {
  /** Index into the candidate list, or null if the operator is not present. */
  index: number | null;
  score: number;
}

export interface OperatorTracker {
  register(sig: FaceSignature): void;
  reset(): void;
  update(candidates: FaceSignature[], now: number): OperatorResult;
  readonly registered: boolean;
  readonly lastBox: FaceBox | null;
}

/**
 * Picks the registered operator out of up-to-N candidate faces by combining
 * signature distance with IoU/position continuity against the last accepted
 * box. Signature alone can re-acquire after a brief loss (continuity decays).
 */
export function createOperatorTracker(opts: OperatorOptions = {}): OperatorTracker {
  const sigGate = opts.sigGate ?? 0.35;
  const iouW = opts.iouWeight ?? 0.5;
  const posW = opts.posWeight ?? 0.5;
  const grace = opts.lossGraceMs ?? 1500;

  let registered: FaceSignature | null = null;
  let lastBox: FaceBox | null = null;
  let lastSeen = -Infinity;

  function update(candidates: FaceSignature[], now: number): OperatorResult {
    if (!registered || candidates.length === 0) return { index: null, score: Infinity };
    const continuity = lastBox !== null && now - lastSeen <= grace;
    let best = -1;
    let bestScore = Infinity;
    candidates.forEach((c, i) => {
      const sd = signatureDistance(c, registered!);
      if (sd > sigGate) return; // identity gate: strangers never qualify
      let score = sd;
      if (continuity && lastBox) {
        score += iouW * (1 - boxIoU(c.box, lastBox)) + posW * boxCenterDistance(c.box, lastBox);
      }
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0) { lastBox = candidates[best].box; lastSeen = now; }
    return { index: best >= 0 ? best : null, score: best >= 0 ? bestScore : Infinity };
  }

  return {
    register(sig) { registered = sig; lastBox = sig.box; lastSeen = -Infinity; },
    reset() { registered = null; lastBox = null; lastSeen = -Infinity; },
    update,
    get registered() { return registered !== null; },
    get lastBox() { return lastBox; },
  };
}

// ---- presence timeout gate (pause/resume) ----

export interface PresenceState {
  paused: boolean;
  justPaused: boolean;
  justResumed: boolean;
}

export interface PresenceGate {
  update(present: boolean, now: number): PresenceState;
  reset(): void;
  readonly paused: boolean;
}

/** Pause after the operator is absent for `timeoutMs`; resume on re-acquire. */
export function createPresenceGate(timeoutMs = 2500): PresenceGate {
  let paused = false;
  let lastPresent: number | null = null;

  function update(present: boolean, now: number): PresenceState {
    let justPaused = false;
    let justResumed = false;
    if (present) {
      lastPresent = now;
      if (paused) { paused = false; justResumed = true; }
    } else {
      if (lastPresent === null) lastPresent = now; // start the clock on first absence
      if (!paused && now - lastPresent > timeoutMs) { paused = true; justPaused = true; }
    }
    return { paused, justPaused, justResumed };
  }

  return {
    update,
    reset() { paused = false; lastPresent = null; },
    get paused() { return paused; },
  };
}
