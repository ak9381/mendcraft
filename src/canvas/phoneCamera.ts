// ONE front camera for the phone shell. Two features want the front camera:
// look-to-edit (face only) and hand control (hands + face, for the facing
// gate). iOS lets only one getUserMedia caller own the lens, and two trackers
// would halve the frame rate, so this hub owns the single stream and the
// single presence tracker and fans frames out to both users.
//
//  - The camera opens only when a use is turned on (setUse) — never at boot
//    unless the user had turned it on before (the persisted toggles).
//  - Hands on → tracker with hands + face; look-to-edit alone → face only.
//    Switching mode restarts the TRACKER on the same stream (no second
//    getUserMedia).
//  - Hidden app (visibilitychange) → tracker and camera stopped; visible
//    again → reopened if any use is still on.
//  - Throttle: ~30 fps while a hand was seen in the last 2 s, 10 fps
//    otherwise (PHONE_HAND_FEEL).

import { createPresenceTracker, type PresenceFrame, type PresenceTracker } from '../input/presence';
import { phoneTrackIntervalMs } from './handFeel';

export type PhoneCameraUse = 'hands' | 'face';
export type PhoneCameraStatus = 'off' | 'starting' | 'live' | 'error';

/** Front camera, modest size: the hand model runs on a ~224 px crop anyway. */
export const PHONE_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: 'user',
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 30, max: 30 },
  },
  audio: false,
};

type TrackerFactory = (
  onEvent: () => void,
  onFrame: (f: PresenceFrame) => void,
  opts: { detectHands: boolean; detectFaces: boolean; frameIntervalMs: () => number; onCameraLost: () => void },
) => Pick<PresenceTracker, 'start' | 'stop'>;

export interface PhoneCameraDeps {
  createTracker?: TrackerFactory;
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> | null;
  now?: () => number;
}

export interface PhoneCamera {
  /** Turn one use on/off; resolves once the camera has (re)started or stopped. */
  setUse(use: PhoneCameraUse, on: boolean): Promise<void>;
  uses(): PhoneCameraUse[];
  onFrame(cb: (f: PresenceFrame) => void): () => void;
  onStatus(cb: (s: PhoneCameraStatus) => void): () => void;
  status(): PhoneCameraStatus;
  /** The last start failure (permission denied, no camera, model download). */
  lastError(): unknown;
  /** Current minimum ms between tracking runs (the throttle). */
  intervalMs(): number;
  destroy(): void;
}

export function createPhoneCamera(deps: PhoneCameraDeps = {}): PhoneCamera {
  const doc = deps.doc !== undefined ? deps.doc : (typeof document !== 'undefined' ? document : null);
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const gum = deps.getUserMedia ?? ((c) => {
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md?.getUserMedia) return Promise.reject(new Error('Camera needs a secure page (HTTPS) on this device.'));
    return md.getUserMedia(c);
  });
  const makeTracker: TrackerFactory = deps.createTracker
    ?? ((onEvent, onFrame, opts) => createPresenceTracker(onEvent, onFrame, opts));

  const want = new Set<PhoneCameraUse>();
  const frameSubs = new Set<(f: PresenceFrame) => void>();
  const statusSubs = new Set<(s: PhoneCameraStatus) => void>();
  let stream: MediaStream | null = null;
  let tracker: Pick<PresenceTracker, 'start' | 'stop'> | null = null;
  let trackerHands = false;
  let status: PhoneCameraStatus = 'off';
  let error: unknown = null;
  let lastHandAt = -Infinity;
  let chain: Promise<void> = Promise.resolve();
  let destroyed = false;

  const visible = (): boolean => !doc || doc.visibilityState !== 'hidden';
  const setStatus = (s: PhoneCameraStatus): void => {
    if (s === status) return;
    status = s;
    for (const cb of statusSubs) cb(s);
  };
  const streamLive = (): boolean =>
    !!stream && stream.getVideoTracks().some((t) => t.readyState === 'live');
  const intervalMs = (): number => phoneTrackIntervalMs(now(), lastHandAt, trackerHands);

  function stopTracker(): void {
    const t = tracker;
    tracker = null;
    try { t?.stop(); } catch { /* already stopped */ }
  }
  function stopStream(): void {
    for (const t of stream?.getTracks() ?? []) { try { t.stop(); } catch { /* ended */ } }
    stream = null;
  }
  function onPresence(f: PresenceFrame): void {
    if (f.hands.length) lastHandAt = now();
    for (const cb of frameSubs) cb(f);
  }

  async function reconcile(): Promise<void> {
    if (destroyed || want.size === 0 || !visible()) {
      stopTracker();
      stopStream();
      setStatus(error && want.size ? 'error' : 'off');
      return;
    }
    const hands = want.has('hands');
    if (tracker && trackerHands === hands && streamLive()) return;
    setStatus('starting');
    try {
      if (!streamLive()) { stopStream(); stream = await gum(PHONE_CAMERA_CONSTRAINTS); }
      // A use was turned off or the app hid while the camera opened.
      if (destroyed || want.size === 0 || !visible()) { stopTracker(); stopStream(); setStatus('off'); return; }
      stopTracker(); // a mode switch: the tracker restarts, the stream stays
      trackerHands = hands;
      lastHandAt = -Infinity;
      const t = makeTracker(() => undefined, onPresence, {
        detectHands: hands,
        detectFaces: true,
        frameIntervalMs: intervalMs,
        onCameraLost: () => {
          // Another app took the camera / the OS revoked it: drop it; the
          // next visibility change (or toggle) reopens it.
          stopTracker(); stopStream(); setStatus('off');
        },
      });
      tracker = t;
      await t.start(stream ?? undefined);
      if (tracker !== t) return; // superseded meanwhile
      error = null;
      setStatus('live');
    } catch (err) {
      error = err;
      stopTracker();
      stopStream();
      setStatus('error');
    }
  }
  const run = (): Promise<void> => {
    chain = chain.then(reconcile, reconcile);
    return chain;
  };
  const onVisibility = (): void => { void run(); };
  doc?.addEventListener('visibilitychange', onVisibility);

  return {
    setUse(use, on) {
      if (on) { want.add(use); error = null; } else want.delete(use);
      return run();
    },
    uses: () => [...want],
    onFrame(cb) { frameSubs.add(cb); return () => { frameSubs.delete(cb); }; },
    onStatus(cb) { statusSubs.add(cb); return () => { statusSubs.delete(cb); }; },
    status: () => status,
    lastError: () => error,
    intervalMs,
    destroy() {
      destroyed = true;
      want.clear();
      doc?.removeEventListener('visibilitychange', onVisibility);
      stopTracker();
      stopStream();
      setStatus('off');
    },
  };
}

/** Persisted Hands switch for the phone shell. Off unless explicitly '1'. */
export const PHONE_HANDS_KEY = 'mc.phoneHands';
export function readPhoneHands(storage?: Pick<Storage, 'getItem'> | null): boolean {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    return s?.getItem(PHONE_HANDS_KEY) === '1';
  } catch { return false; }
}
export function writePhoneHands(on: boolean, storage?: Pick<Storage, 'setItem' | 'removeItem'> | null): void {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (on) s?.setItem(PHONE_HANDS_KEY, '1'); else s?.removeItem(PHONE_HANDS_KEY);
  } catch { /* private mode */ }
}
