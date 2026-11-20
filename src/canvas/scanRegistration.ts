// REGISTRATION SCAN: the guided face → left palm → right palm capture behind
// the Register button. Pure, clock-injected state machine (testable without a
// camera): each step fills a progress ring while STABLE frames of the right
// thing are seen for holdMs, averages a signature over that hold window, and
// advances. Replaces the old pinch-to-register prompt (registration.ts).
//
// Captures: face = scale-normalised inter-landmark ratios (FaceSignature,
// faceLogic.ts), hands = normalised bone-length proportions + handedness
// (handSignature.ts). Everything stays on-device; sessionStorage only.

import type { FaceSignature } from '../input/faceLogic';
import { classifyGesture } from '../input/gestures';
import type { Pt } from '../input/handLogic';
import {
  averageRatios,
  handSignatureRatios,
  type HandSignature,
  type OwnerHands,
} from '../input/handSignature';

export type ScanStep = 'face' | 'left' | 'right' | 'done';

export interface ScanConfig {
  /** Stable frames must be seen this long per step. */
  holdMs: number;
  /** Face centre may drift at most this much (0..1 units) between frames. */
  stableDist: number;
}

export const SCAN_DEFAULTS: ScanConfig = { holdMs: 1500, stableDist: 0.08 };
/** Sim replay uses a snappier hold so the demo takes ~2 s, not ~5. */
export const SCAN_SIM: ScanConfig = { holdMs: 600, stableDist: 0.08 };

export interface ScanFrameInput {
  /** Signature of the main face this frame (null when no face). */
  faceSig: FaceSignature | null;
  /** Its centre, for the hold-still stability check. */
  faceCenter: { x: number; y: number } | null;
  /** Tracked hands: label + 21 landmarks (mirrored or not — ratios don't care). */
  hands: { label?: string; points: readonly Pt[] }[];
  now: number;
}

export interface ScanState {
  step: ScanStep;
  /** 0..1 fill of the current step's progress ring. */
  progress: number;
  /** True exactly on the frame a step completed. */
  justAdvanced: boolean;
  prompt: string;
}

export const SCAN_PROMPTS: Record<ScanStep, string> = {
  face: 'Look at the camera and hold still.',
  left: 'Show your open LEFT palm.',
  right: 'Now your open RIGHT palm.',
  done: 'Registered — tracking locked to you.',
};

export interface OwnerRecord {
  face: FaceSignature;
  left: HandSignature;
  right: HandSignature;
}

export interface ScanFlow {
  update(input: ScanFrameInput): ScanState;
  readonly step: ScanStep;
  readonly progress: number;
  /** The captured owner, once step === 'done'. */
  result(): OwnerRecord | null;
  reset(): void;
}

const wantedLabel: Partial<Record<ScanStep, string>> = { left: 'Left', right: 'Right' };

export function createScanFlow(cfg: ScanConfig = SCAN_DEFAULTS): ScanFlow {
  let step: ScanStep = 'face';
  let heldMs = 0;
  let lastNow: number | null = null;
  let lastCenter: { x: number; y: number } | null = null;

  let faceSamples: FaceSignature[] = [];
  let handSamples: number[][] = [];
  let face: FaceSignature | null = null;
  let left: HandSignature | null = null;
  let right: HandSignature | null = null;

  function resetStepState(): void {
    heldMs = 0;
    lastCenter = null;
    faceSamples = [];
    handSamples = [];
  }

  function advance(): void {
    step = step === 'face' ? 'left' : step === 'left' ? 'right' : 'done';
    resetStepState();
  }

  function update(input: ScanFrameInput): ScanState {
    const dt = lastNow === null ? 0 : Math.min(100, Math.max(0, input.now - lastNow));
    lastNow = input.now;
    let justAdvanced = false;

    if (step === 'face') {
      const c = input.faceCenter;
      const stable =
        !!input.faceSig && !!c &&
        (lastCenter === null || Math.hypot(c.x - lastCenter.x, c.y - lastCenter.y) <= cfg.stableDist);
      lastCenter = c;
      if (stable && input.faceSig) {
        heldMs += dt;
        faceSamples.push(input.faceSig);
        if (heldMs >= cfg.holdMs) {
          face = {
            ratios: averageRatios(faceSamples.map((s) => s.ratios)),
            box: faceSamples[faceSamples.length - 1].box,
          };
          advance();
          justAdvanced = true;
        }
      } else {
        heldMs = 0;
        faceSamples = [];
      }
    } else if (step === 'left' || step === 'right') {
      const want = wantedLabel[step];
      const match = input.hands.find(
        (h) =>
          h.points.length >= 21 &&
          (h.label === undefined || h.label === want) &&
          classifyGesture(h.points as Pt[]) === 'open-palm',
      );
      if (match) {
        heldMs += dt;
        handSamples.push(handSignatureRatios(match.points));
        if (heldMs >= cfg.holdMs) {
          const sig: HandSignature = { ratios: averageRatios(handSamples), label: want! };
          if (step === 'left') left = sig; else right = sig;
          advance();
          justAdvanced = true;
        }
      } else {
        heldMs = 0;
        handSamples = [];
      }
    }

    return {
      step,
      progress: step === 'done' ? 1 : Math.min(1, heldMs / cfg.holdMs),
      justAdvanced,
      prompt: SCAN_PROMPTS[step],
    };
  }

  return {
    update,
    get step() { return step; },
    get progress() { return step === 'done' ? 1 : Math.min(1, heldMs / cfg.holdMs); },
    result() {
      return step === 'done' && face && left && right ? { face, left, right } : null;
    },
    reset() {
      step = 'face';
      lastNow = null;
      face = null; left = null; right = null;
      resetStepState();
    },
  };
}

// ---------------------------------------------------------------- persistence

/** One owner per browser session; nothing ever leaves the device. */
export const OWNER_STORAGE_KEY = 'mc.owner.v2';

export function loadOwner(storage: Pick<Storage, 'getItem'> | null | undefined): OwnerRecord | null {
  try {
    const raw = storage?.getItem(OWNER_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as OwnerRecord;
    if (!Array.isArray(o?.face?.ratios) || o.face.ratios.length < 4) return null;
    if (!Array.isArray(o?.left?.ratios) || o.left.label !== 'Left') return null;
    if (!Array.isArray(o?.right?.ratios) || o.right.label !== 'Right') return null;
    return o;
  } catch {
    return null;
  }
}

export function storeOwner(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined,
  owner: OwnerRecord | null,
): void {
  try {
    if (owner) storage?.setItem(OWNER_STORAGE_KEY, JSON.stringify(owner));
    else storage?.removeItem(OWNER_STORAGE_KEY);
  } catch {
    // storage full / disabled — registration just won't survive a reload
  }
}

export function ownerHandsOf(owner: OwnerRecord): OwnerHands {
  return { left: owner.left, right: owner.right };
}

// ---------------------------------------------------------------- sim replay

/** A deterministic synthetic open palm (same construction as the test
 *  fixtures): all four fingers extended away from the wrist, thumb out. */
export function openPalmLandmarks(): Pt[] {
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  lm[0] = { x: 0.5, y: 0.9 };
  const fingers: ReadonlyArray<readonly [number, number, number]> = [
    [5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20],
  ];
  fingers.forEach(([mcp, pip, tip], i) => {
    const x = 0.44 + i * 0.045;
    lm[mcp] = { x, y: 0.5 };
    lm[pip] = { x, y: 0.3 };
    lm[tip] = { x, y: 0.1 };
  });
  lm[2] = { x: 0.35, y: 0.7 }; lm[3] = { x: 0.3, y: 0.6 }; lm[4] = { x: 0.25, y: 0.5 };
  return lm;
}

const REPLAY_FACE_SIG: FaceSignature = {
  ratios: [0.9, 1.6, 0.95, 1.9, 1.1, 0.8, 0.8, 1.2],
  box: { x: 0.4, y: 0.25, w: 0.2, h: 0.26, cx: 0.5, cy: 0.38 },
};

/**
 * ?sim=1 demo without a camera: feed the flow whatever its CURRENT step asks
 * for — a stable face, then a left palm, then a right palm — so the same UI
 * walks through all three scans on a timer.
 */
export function replayInputFor(step: ScanStep, now: number): ScanFrameInput {
  if (step === 'face') {
    return { faceSig: REPLAY_FACE_SIG, faceCenter: { x: 0.5, y: 0.38 }, hands: [], now };
  }
  if (step === 'left' || step === 'right') {
    return {
      faceSig: null,
      faceCenter: null,
      hands: [{ label: step === 'left' ? 'Left' : 'Right', points: openPalmLandmarks() }],
      now,
    };
  }
  return { faceSig: null, faceCenter: null, hands: [], now };
}
