// Phone-simple canvas runtime: look-to-edit (reuse face-only presence), the
// route badge, and applying a board the laptop sent. The Relay join itself
// (saved-pair rejoin + first-time chime) lives in laptopLink.ts.

import type { SurfacePlan } from './surfacePlan';
import type { ControlSnapshot } from '../relay/controlSnapshot';
import { createPresenceTracker } from '../input/presence';
import { hasLiveCameraStream } from '../input/cameraShare';
import type { PhonePlatform } from './screenLayout';
import { readLookToEdit } from './phoneEditLock';
import type { AppleAvailabilityStatus } from '../ai/appleAI';

export interface PhoneRouteBadgeInput {
  appleReady: boolean;
  ios: boolean;
  sim: boolean;
  cloud: boolean;
  /** Why the Apple model isn't ready, when iOS told us (shown on the badge). */
  appleReason?: AppleAvailabilityStatus;
}

const APPLE_REASON: Partial<Record<AppleAvailabilityStatus, string>> = {
  appleIntelligenceNotEnabled: 'Apple Intelligence is off',
  modelNotReady: 'Apple model downloading',
  deviceNotEligible: 'this iPhone has no Apple model',
};

export function phoneRouteBadge(input: PhoneRouteBadgeInput): string {
  if (input.appleReady) return 'Apple · on device';
  if (input.sim && input.ios) return 'Apple · on device';
  const why = input.appleReason && APPLE_REASON[input.appleReason];
  if (input.cloud) return why ? `Gemini · cloud · ${why}` : 'Gemini · cloud';
  return input.ios ? 'Apple · on device' : 'Gemini · cloud';
}

export function applyGuestSnapshot(
  snap: Pick<ControlSnapshot, 'board' | 'boardFor'>,
  showBoard: (plan: SurfacePlan) => void,
  platform?: PhonePlatform,
): boolean {
  if (!snap.board) return false;
  // A board sent to the OTHER phone is not for us.
  if (snap.boardFor && snap.boardFor !== platform) return false;
  showBoard(snap.board);
  return true;
}

export function startPhoneLookToEdit(
  handle: { setFacing(facing: boolean | null): void },
  opts: { sim?: boolean; enabled?: boolean } = {},
): () => void {
  // Look-to-edit is opt-in: when off, never open the front camera for it.
  if (!(opts.enabled ?? readLookToEdit())) return () => undefined;
  if (opts.sim || typeof document === 'undefined') return () => undefined;
  let tracker: ReturnType<typeof createPresenceTracker> | null = null;
  let cancelled = false;
  const start = async (): Promise<void> => {
    if (cancelled || tracker || hasLiveCameraStream()) return;
    try {
      const t = createPresenceTracker(() => undefined, (f) => {
        handle.setFacing(f.facing === true);
      }, { detectFaces: true, detectHands: false });
      await t.start();
      if (cancelled) { t.stop(); return; }
      tracker = t;
    } catch {
      handle.setFacing(null);
    }
  };
  const stop = (): void => {
    tracker?.stop();
    tracker = null;
    handle.setFacing(null);
  };
  const onVis = (): void => {
    if (document.visibilityState === 'hidden') stop();
    else void start();
  };
  document.addEventListener('visibilitychange', onVis);
  const arm = (): void => { void start(); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(arm, 400));
  else setTimeout(arm, 400);
  return () => {
    cancelled = true;
    document.removeEventListener('visibilitychange', onVis);
    stop();
  };
}
