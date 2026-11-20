// OWNER REGISTRATION: a short, hand-driven flow at canvas start —
// "Look at the camera" → capture the face signature, "Show your right hand —
// pinch", "Show your left hand — pinch" — after which tracking LOCKS to that
// person (presence.ts ignores other faces; handBinding.ts rejects other
// people's hands). Pure state machine, clock injected, so every transition is
// unit-testable without a camera. The signature persists in sessionStorage so
// a reload re-locks silently; nothing ever leaves the device.

import type { FaceSignature } from '../input/faceLogic';

export type RegStep = 'face' | 'right' | 'left' | 'done';

export interface RegConfig {
  /** The face must be continuously visible this long before capture. */
  faceHoldMs: number;
  /** A pinch must be held this long to count as "that hand, deliberately". */
  pinchHoldMs: number;
  /** A pinch from a WRONG/unlabelled hand held this long still advances —
   *  handedness labels are sometimes wrong, and the flow must never trap. */
  fallbackHoldMs: number;
}

export const REG_DEFAULTS: RegConfig = {
  faceHoldMs: 800,
  pinchHoldMs: 350,
  fallbackHoldMs: 1500,
};

export interface RegHandInput {
  /** MediaPipe handedness label, when known. */
  label?: string;
  pinching: boolean;
}

export interface RegInput {
  faceVisible: boolean;
  hands: RegHandInput[];
  now: number;
}

export interface RegState {
  step: RegStep;
  /** True exactly on the frame a step completed. */
  justAdvanced: boolean;
  /** The status-chip line for this step. */
  prompt: string;
}

export const REG_PROMPTS: Record<RegStep, string> = {
  face: 'Register: look at the camera…',
  right: 'Now show your RIGHT hand and pinch.',
  left: 'And your LEFT hand — pinch.',
  done: 'Locked: you · L+R hands',
};

const wantedLabel: Partial<Record<RegStep, string>> = { right: 'Right', left: 'Left' };

export interface RegistrationFlow {
  update(input: RegInput): RegState;
  readonly step: RegStep;
  reset(): void;
  /** Jump straight to done (restored from storage / sim). */
  complete(): void;
}

export function createRegistrationFlow(cfg: RegConfig = REG_DEFAULTS): RegistrationFlow {
  let step: RegStep = 'face';
  let holdSince: number | null = null;        // matching-hand (or face) hold
  let fallbackSince: number | null = null;    // any-pinch fallback hold

  function advance(): void {
    step = step === 'face' ? 'right' : step === 'right' ? 'left' : 'done';
    holdSince = null;
    fallbackSince = null;
  }

  function update(input: RegInput): RegState {
    const { now } = input;
    let justAdvanced = false;

    if (step === 'face') {
      if (input.faceVisible) {
        if (holdSince === null) holdSince = now;
        if (now - holdSince >= cfg.faceHoldMs) { advance(); justAdvanced = true; }
      } else {
        holdSince = null;
      }
    } else if (step === 'right' || step === 'left') {
      const want = wantedLabel[step];
      const match = input.hands.some((h) => h.pinching && (h.label === want || h.label === undefined));
      const any = input.hands.some((h) => h.pinching);
      if (match) {
        if (holdSince === null) holdSince = now;
      } else {
        holdSince = null;
      }
      if (any) {
        if (fallbackSince === null) fallbackSince = now;
      } else {
        fallbackSince = null;
      }
      if (
        (holdSince !== null && now - holdSince >= cfg.pinchHoldMs) ||
        (fallbackSince !== null && now - fallbackSince >= cfg.fallbackHoldMs)
      ) {
        advance();
        justAdvanced = true;
      }
    }

    return { step, justAdvanced, prompt: REG_PROMPTS[step] };
  }

  return {
    update,
    get step() { return step; },
    reset() { step = 'face'; holdSince = null; fallbackSince = null; },
    complete() { step = 'done'; holdSince = null; fallbackSince = null; },
  };
}

// ---------------------------------------------------------------- persistence

export const REG_STORAGE_KEY = 'mc.operator.v1';

export function loadStoredSignature(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): FaceSignature | null {
  try {
    const raw = storage?.getItem(REG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FaceSignature;
    if (!Array.isArray(parsed?.ratios) || parsed.ratios.length < 4) return null;
    if (typeof parsed.box?.w !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeSignature(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined,
  sig: FaceSignature | null,
): void {
  try {
    if (sig) storage?.setItem(REG_STORAGE_KEY, JSON.stringify(sig));
    else storage?.removeItem(REG_STORAGE_KEY);
  } catch {
    // storage full / disabled — registration just won't survive a reload
  }
}
