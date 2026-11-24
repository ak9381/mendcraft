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
import type { PhoneCamera } from './phoneCamera';

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
  // ?sim=1, or no cloud model reachable: the engines are scripted. Say so —
  // a scripted turn is never shown as a real model or a real send.
  // On an iPhone whose Apple model isn't running, never name Apple.
  if (input.sim || !input.cloud) return `SIM · ${input.ios ? 'scripted' : 'Gemini · cloud'}`;
  const why = input.appleReason && APPLE_REASON[input.appleReason];
  return why ? `Gemini · cloud · ${why}` : 'Gemini · cloud';
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
  opts: { sim?: boolean; enabled?: boolean; camera?: PhoneCamera } = {},
): () => void {
  // Look-to-edit is opt-in: when off, never open the front camera for it.
  if (!(opts.enabled ?? readLookToEdit())) return () => undefined;
  if (opts.sim || typeof document === 'undefined') return () => undefined;
  // The phone shell's shared front camera (phoneCamera.ts): one stream and
  // one tracker for look-to-edit AND hands. It also handles hide/show.
  const cam = opts.camera;
  if (cam) {
    let last: boolean | null | undefined;
    const report = (f: boolean | null): void => { if (f !== last) { last = f; handle.setFacing(f); } };
    const offFrame = cam.onFrame((f) => report(f.facing === true));
    const offStatus = cam.onStatus((s) => { if (s !== 'live') report(null); });
    let armed = true;
    const arm = (): void => { if (armed) void cam.setUse('face', true); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(arm, 400));
    else setTimeout(arm, 400);
    return () => {
      armed = false;
      offFrame(); offStatus();
      void cam.setUse('face', false);
      report(null);
    };
  }
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
