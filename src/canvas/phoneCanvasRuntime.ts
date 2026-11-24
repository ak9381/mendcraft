// Phone-simple canvas runtime: look-to-edit (reuse face-only presence) and
// Relay guest join (reuse joinPhoneAsGuest) so a board dragged from the
// laptop arrives on this phone. No hand tracking, no new protocol.

import type { SurfacePlan } from './surfacePlan';
import type { ControlSnapshot } from '../relay/controlSnapshot';
import { joinPhoneAsGuest } from './phoneGuestJoin';
import { ensureDeviceId, loadPhonePair } from '../relay/pairingStore';
import { createPresenceTracker } from '../input/presence';
import { hasLiveCameraStream } from '../input/cameraShare';
import type { PhonePlatform } from './screenLayout';
import { readLookToEdit } from './phoneEditLock';
import type { AppleAvailabilityStatus } from '../ai/appleAI';
import type { RelayCommand } from '../relay/protocol';
import type { PhoneAiForwarder } from './phoneAiFeed';

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

export function startPhoneRelayGuest(
  handle: { showRemoteBoard(plan: SurfacePlan): void },
  opts: { sim?: boolean; storage?: Storage | null; platform?: PhonePlatform; aiForwarder?: Pick<PhoneAiForwarder, 'bind'> } = {},
): () => void {
  if (opts.sim || typeof window === 'undefined') return () => undefined;
  const storage = opts.storage ?? ((): Storage | null => { try { return localStorage; } catch { return null; } })();
  if (storage) ensureDeviceId(storage);
  const platform = opts.platform ?? 'android';
  let stopSession: (() => Promise<void>) | null = null;

  const bindSession = (session: {
    onSnapshot(cb: (snap: ControlSnapshot) => void): void;
    close(): Promise<void>;
    sendCommand(cmd: RelayCommand): Promise<void>;
  }): void => {
    session.onSnapshot((snap) => { applyGuestSnapshot(snap, handle.showRemoteBoard, platform); });
    // This phone's AI activity now reaches the laptop's monitor (display only).
    opts.aiForwarder?.bind(session);
    stopSession = () => { opts.aiForwarder?.bind(null); return session.close(); };
  };

  const saved = loadPhonePair(storage);
  if (saved?.token) {
    const join = async (): Promise<void> => {
      const res = await joinPhoneAsGuest({
        code: saved.token,
        storage,
        platform,
        hubName: 'the laptop',
      });
      if ('error' in res) return;
      bindSession(res.session);
    };
    void join();
  }
  // Do not open the pairing-chime microphone at launch — that getUserMedia
  // call can stall or blank iOS WKWebView before the canvas is up.

  return () => {
    void stopSession?.();
  };
}
