// ONE front camera for the phone shell. Three uses want the front camera:
// look-to-edit (face only), hand control (hands + face, for the facing gate)
// and, on the iPhone, hand SENSING for the gimbal and point-to-connect
// ('sense': hands + face, never acts on the UI). iOS lets only one getUserMedia caller own the lens, and two trackers
// would halve the frame rate, so this hub owns the single stream and the
// single presence tracker and fans frames out to both users.
//
//  - The camera opens only when a use is turned on (setUse) — never at boot
//    unless the user had turned it on before (the persisted toggles).
//  - Hands on → tracker with hands + face; look-to-edit alone → face only.
//    Switching mode restarts the TRACKER on the same stream (no second
//    getUserMedia).
//  - Backgrounded → tracker and camera stopped at once; back → reopened if a
//    use is still on. Native webviews don't reliably fire visibilitychange,
//    so pagehide/pageshow and the Capacitor App pause/resume events count too.
//  - Camera taken by the OS (a call, another app) while visible: retried a
//    few times (CAMERA_LOST_RETRY_MS × CAMERA_LOST_RETRIES), then 'error'
//    with a CameraLostError so the UI can turn Hands off and say so.
//  - A start failure (denied, no camera) latches: nothing reopens the camera
//    until a use is turned ON again — turning Hands off never re-prompts for
//    look-to-edit.
//  - Phone head-pose thresholds: PHONE_HAND_GATE / PHONE_FACING (the camera
//    sits below the face in a normal grip).
//  - Throttle: ~30 fps while a hand was seen in the last 2 s, 10 fps
//    otherwise (PHONE_HAND_FEEL).

import { createPresenceTracker, type PresenceFrame, type PresenceTracker } from '../input/presence';
import { PHONE_FACING, PHONE_HAND_GATE, type FacingOptions, type HandGateConfig } from '../input/faceLogic';
import { phoneTrackIntervalMs } from './handFeel';

export type PhoneCameraUse = 'hands' | 'face' | 'sense';
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

/** A camera lost to the OS is retried this many times, this far apart. */
export const CAMERA_LOST_RETRIES = 3;
export const CAMERA_LOST_RETRY_MS = 1000;

/** The camera was taken away (a call, another app) and did not come back. */
export class CameraLostError extends Error {
  constructor() {
    super('The camera was taken by another app or a call.');
    this.name = 'CameraLostError';
  }
}

export interface PhoneTrackerOptions {
  detectHands: boolean;
  detectFaces: boolean;
  frameIntervalMs: () => number;
  onCameraLost: () => void;
  handGate: HandGateConfig;
  facing: FacingOptions;
}

type TrackerFactory = (
  onEvent: () => void,
  onFrame: (f: PresenceFrame) => void,
  opts: PhoneTrackerOptions,
) => Pick<PresenceTracker, 'start' | 'stop'>;

/** The slice of @capacitor/app the hub listens to. */
export interface AppLifecycle {
  addListener(event: 'pause' | 'resume', fn: () => void): Promise<{ remove(): unknown }> | { remove(): unknown };
}

type EventTargetLike = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export interface PhoneCameraDeps {
  createTracker?: TrackerFactory;
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  doc?: (Pick<Document, 'visibilityState'> & EventTargetLike) | null;
  /** pagehide / pageshow (default: window). */
  win?: EventTargetLike | null;
  /** Capacitor App plugin (native shells): pause / resume. */
  app?: AppLifecycle | null;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

export interface PhoneCamera {
  /** Turn one use on/off; resolves once the camera has (re)started or stopped. */
  setUse(use: PhoneCameraUse, on: boolean): Promise<void>;
  uses(): PhoneCameraUse[];
  onFrame(cb: (f: PresenceFrame) => void): () => void;
  onStatus(cb: (s: PhoneCameraStatus) => void): () => void;
  status(): PhoneCameraStatus;
  /** The last start failure (permission denied, no camera, model download,
   *  CameraLostError). */
  lastError(): unknown;
  /** Current minimum ms between tracking runs (the throttle). */
  intervalMs(): number;
  destroy(): void;
}

export function createPhoneCamera(deps: PhoneCameraDeps = {}): PhoneCamera {
  const doc = deps.doc !== undefined ? deps.doc : (typeof document !== 'undefined' ? document : null);
  const win = deps.win !== undefined ? deps.win : (typeof window !== 'undefined' ? window : null);
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const later = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = deps.clearTimeout ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
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
  /** A start failed / the camera was lost for good: stay off until a use is turned on again. */
  let failed = false;
  let suspended = false; // Capacitor pause / pagehide
  let lostTries = 0;
  let retryTimer: unknown = null;
  let lastHandAt = -Infinity;
  let chain: Promise<void> = Promise.resolve();
  let destroyed = false;

  const visible = (): boolean => !suspended && (!doc || doc.visibilityState !== 'hidden');
  const active = (): boolean => !destroyed && !failed && want.size > 0 && visible();
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
  function clearRetry(): void {
    if (retryTimer !== null) { cancel(retryTimer); retryTimer = null; }
  }
  function onPresence(f: PresenceFrame): void {
    if (f.hands.length) lastHandAt = now();
    for (const cb of frameSubs) cb(f);
  }
  function idleStatus(): PhoneCameraStatus {
    return failed && want.size ? 'error' : 'off';
  }

  function onLost(): void {
    stopTracker();
    stopStream();
    if (!active()) { setStatus(idleStatus()); return; }
    if (lostTries < CAMERA_LOST_RETRIES) {
      lostTries++;
      setStatus('starting');
      clearRetry();
      retryTimer = later(() => { retryTimer = null; void run(); }, CAMERA_LOST_RETRY_MS);
      return;
    }
    failed = true;
    error = new CameraLostError();
    setStatus('error');
  }

  async function reconcile(): Promise<void> {
    if (!active()) {
      stopTracker();
      stopStream();
      setStatus(idleStatus());
      return;
    }
    const hands = want.has('hands') || want.has('sense');
    if (tracker && trackerHands === hands && streamLive()) return;
    setStatus('starting');
    // Hoisted so the catch can tell a real failure from a start that was
    // cancelled (stopped / superseded while `video.play()` was pending).
    let t: ReturnType<typeof makeTracker> | null = null;
    try {
      if (!streamLive()) { stopStream(); stream = await gum(PHONE_CAMERA_CONSTRAINTS); }
      // A use was turned off or the app hid while the camera opened.
      if (!active()) { stopTracker(); stopStream(); setStatus(idleStatus()); return; }
      stopTracker(); // a mode switch: the tracker restarts, the stream stays
      trackerHands = hands;
      lastHandAt = -Infinity;
      t = makeTracker(() => undefined, onPresence, {
        detectHands: hands,
        detectFaces: true,
        frameIntervalMs: intervalMs,
        onCameraLost: () => { if (tracker === t) onLost(); },
        handGate: PHONE_HAND_GATE,
        facing: PHONE_FACING,
      });
      tracker = t;
      await t.start(stream ?? undefined);
      if (tracker !== t) return; // superseded / stopped meanwhile
      error = null;
      setStatus('live');
    } catch (err) {
      // A start cancelled mid-way (stop() during `await video.play()`) is not
      // a camera failure: the run that stopped it owns the status. Marking it
      // failed would leave look-to-edit dead until a reload.
      if (t && tracker !== t) return;
      error = err;
      failed = true;
      stopTracker();
      stopStream();
      setStatus('error');
    }
  }
  const run = (): Promise<void> => {
    // Stopping never waits behind a start still loading the models: the
    // camera goes off at once (the in-flight start sees it and bails).
    if (!active()) { clearRetry(); stopTracker(); stopStream(); setStatus(idleStatus()); }
    chain = chain.then(reconcile, reconcile);
    return chain;
  };
  const onVisibility = (): void => { if (visible()) lostTries = 0; void run(); };
  const onPageHide = (): void => { suspended = true; void run(); };
  const onPageShow = (): void => { suspended = false; lostTries = 0; void run(); };
  doc?.addEventListener('visibilitychange', onVisibility);
  win?.addEventListener('pagehide', onPageHide);
  win?.addEventListener('pageshow', onPageShow);
  const appHandles: Array<{ remove(): unknown }> = [];
  const keep = (h: Promise<{ remove(): unknown }> | { remove(): unknown }): void => {
    void Promise.resolve(h).then((x) => { if (destroyed) void x.remove(); else appHandles.push(x); }, () => undefined);
  };
  if (deps.app) {
    try {
      keep(deps.app.addListener('pause', onPageHide));
      keep(deps.app.addListener('resume', onPageShow));
    } catch { /* plugin unavailable on this build */ }
  }

  return {
    setUse(use, on) {
      if (on) { want.add(use); failed = false; error = null; lostTries = 0; } else want.delete(use);
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
      clearRetry();
      doc?.removeEventListener('visibilitychange', onVisibility);
      win?.removeEventListener('pagehide', onPageHide);
      win?.removeEventListener('pageshow', onPageShow);
      for (const h of appHandles.splice(0)) void h.remove();
      stopTracker();
      stopStream();
      setStatus('off');
    },
  };
}

/** The phone shell gets the ONE shared camera hub on both platforms.
 *  Hand CONTROL (palm cursor, fist tap, grab, zoom) is behind the Hands pill
 *  on both, off by default and facing-gated: phoneHandsControl = Android ||
 *  iPhone-with-the-pill-on (the pill decides at run time). Hand SENSING (frames
 *  for the gimbal and point-to-connect, never UI actions) is the iPhone's:
 *  see phoneSensingAllowed and phoneSensor.ts. */
export function phoneHandsAllowed(phoneShell: boolean, platform: 'ios' | 'android' | null | undefined): boolean {
  return phoneShell && (platform === 'android' || platform === 'ios');
}

/** Hand sensing (gimbal follow + pointing from the phone's own camera): the
 *  iPhone only. On Android sensing is implied by control. */
export function phoneSensingAllowed(phoneShell: boolean, platform: 'ios' | 'android' | null | undefined): boolean {
  return phoneShell && platform === 'ios';
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
