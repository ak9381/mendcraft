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

export interface PhoneRouteBadgeInput {
  appleReady: boolean;
  ios: boolean;
  sim: boolean;
  cloud: boolean;
}

export function phoneRouteBadge(input: PhoneRouteBadgeInput): string {
  if (input.appleReady) return 'Apple · on device';
  if (input.sim && input.ios) return 'Apple · on device';
  if (input.cloud) return 'Gemini · cloud';
  return input.ios ? 'Apple · on device' : 'Gemini · cloud';
}

export function applyGuestSnapshot(
  snap: Pick<ControlSnapshot, 'board'>,
  showBoard: (plan: SurfacePlan) => void,
): boolean {
  if (!snap.board) return false;
  showBoard(snap.board);
  return true;
}

export function startPhoneLookToEdit(
  handle: { setFacing(facing: boolean): void },
  opts: { sim?: boolean } = {},
): () => void {
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
      handle.setFacing(false);
    }
  };
  const stop = (): void => {
    tracker?.stop();
    tracker = null;
    handle.setFacing(false);
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
  opts: { sim?: boolean; storage?: Storage | null; platform?: PhonePlatform } = {},
): () => void {
  if (opts.sim || typeof window === 'undefined') return () => undefined;
  const storage = opts.storage ?? ((): Storage | null => { try { return localStorage; } catch { return null; } })();
  if (storage) ensureDeviceId(storage);
  const platform = opts.platform ?? 'android';
  let stopSession: (() => Promise<void>) | null = null;

  const bindSession = (session: { onSnapshot(cb: (snap: ControlSnapshot) => void): void; close(): Promise<void> }): void => {
    session.onSnapshot((snap) => { applyGuestSnapshot(snap, handle.showRemoteBoard); });
    stopSession = () => session.close();
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
