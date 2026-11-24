// iPhone hand SENSING on the shared phone camera (phoneCamera.ts, use 'sense').
// Feeds camera-space hand frames to the gimbal's hands follow and to
// point-to-connect. It never acts on the UI: no cursor, no click, no grab —
// that is the separate, facing-gated CONTROL layer (phoneHands.ts, Hands pill).
// Sensing is NOT gated by facing: when she points, she looks at the device.
//
// It runs only on an explicit ask (docking alone never starts the camera):
//   - 'pill'    — the small iPhone-only "Track" pill (off by default,
//                 persisted mc.phoneSensor);
//   - 'follow'  — a "follow my hands" request is active;
//   - 'point'   — a point-to-connect request is waiting for a steady point.
// The pill shows what is really running. Tapping it while sensing runs is an
// explicit "sensing off": every reason is dropped and the camera stops. A
// later follow / point request is a new explicit ask and may start it again;
// 'docked' (kept for callers that want it) is ignored after that, for the session.
// Camera lifecycle (hide / pagehide / App pause, retries, one getUserMedia
// shared with look-to-edit and Hands) is the hub's, unchanged.
// Frames never leave the device here; only point-to-connect's crop does,
// through identifyDevice and its ledger entry.

import type { PresenceFrame } from '../input/presence';
import type { Pt } from '../input/handLogic';
import { cameraHandsFromSelfie, stampHandLabel } from './handSpace';
import type { PhoneCamera } from './phoneCamera';

export type SenseReason = 'docked' | 'pill' | 'follow' | 'point';

export const PHONE_SENSOR_KEY = 'mc.phoneSensor';
export const SENSOR_ON_LINE = 'Tracking your hands for the gimbal — camera on';
export const SENSOR_STARTING_LINE = 'Starting the iPhone camera for hand tracking…';
export const SENSOR_OFF_LINE = 'Hand tracking off — camera off';

export interface PhoneSensorDeps {
  camera: PhoneCamera;
  /** Camera-space (un-mirrored) hands, every frame that has one. */
  onHands(hands: Pt[][], now: number): void;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** Called whenever the reasons or the camera status change. */
  onChange?(): void;
  /** Mount the "Track" pill (iPhone shell). Default true. */
  pill?: boolean;
  /** She turned sensing off from the pill (follow / point requests dropped). */
  onUserStop?(): void;
  root?: HTMLElement;
  now?: () => number;
}

export interface PhoneSensor {
  /** Turn one reason on/off; resolves once the camera has started/stopped. */
  request(reason: SenseReason, on: boolean): Promise<void>;
  /** What a tap on the Track pill does (exposed for tests). */
  tap(): Promise<void>;
  reasons(): SenseReason[];
  /** Really sensing: a reason is on AND the camera is live. */
  running(): boolean;
  /** What is really on, for status lines. */
  statusLine(): string;
  readonly pill: HTMLButtonElement | null;
  /** Feed one presence frame (normally from the hub; exposed for tests). */
  frame(f: PresenceFrame): void;
  destroy(): void;
}

export function readPhoneSensor(storage?: Pick<Storage, 'getItem'> | null): boolean {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    return s?.getItem(PHONE_SENSOR_KEY) === '1';
  } catch { return false; }
}
function writePhoneSensor(on: boolean, storage?: Pick<Storage, 'setItem' | 'removeItem'> | null): void {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (on) s?.setItem(PHONE_SENSOR_KEY, '1'); else s?.removeItem(PHONE_SENSOR_KEY);
  } catch { /* private mode */ }
}

export function createPhoneSensor(deps: PhoneSensorDeps): PhoneSensor {
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const want = new Set<SenseReason>();
  let pill: HTMLButtonElement | null = null;
  /** She turned sensing off from the pill: automatic reasons stay ignored. */
  let userOff = false;

  const running = (): boolean => want.size > 0 && deps.camera.status() === 'live';
  function paint(): void {
    if (!pill) return;
    // Pressed = really sensing (or starting), not merely "the pill reason".
    const active = want.size > 0 && deps.camera.status() !== 'off' && deps.camera.status() !== 'error';
    pill.setAttribute('aria-pressed', String(active));
    pill.textContent = running() ? 'Track ✓' : 'Track';
    pill.title = running() ? SENSOR_ON_LINE : 'Track your hands for the gimbal and pointing (camera)';
  }
  function changed(): void { paint(); deps.onChange?.(); }

  async function request(reason: SenseReason, on: boolean): Promise<void> {
    if (on && reason === 'docked' && userOff) return;
    if (on && reason !== 'docked') userOff = false;
    const had = want.size > 0;
    if (on) want.add(reason); else want.delete(reason);
    if (reason === 'pill') writePhoneSensor(on, deps.storage);
    changed();
    const has = want.size > 0;
    // A new reason also retries a camera that failed earlier.
    if (has !== had || on) await deps.camera.setUse('sense', has);
    changed();
  }

  function frame(f: PresenceFrame): void {
    if (!want.size || !f.hands.length) return;
    // Presence hands are selfie-mirrored; the gimbal and the crop need RAW
    // camera space (what the <video> frame holds). No facing gate here.
    const cam = cameraHandsFromSelfie(f.hands.map((h) => stampHandLabel(h.points.slice(), h.label)));
    deps.onHands(cam as Pt[][], now());
  }

  /** The pill: running (or starting) → everything off; else Track on. */
  async function tap(): Promise<void> {
    if (want.size > 0) {
      want.clear();
      userOff = true;
      writePhoneSensor(false, deps.storage);
      changed();
      await deps.camera.setUse('sense', false);
      changed();
      deps.onUserStop?.();
      return;
    }
    await request('pill', true);
  }

  const offFrame = deps.camera.onFrame(frame);
  const offStatus = deps.camera.onStatus(() => changed());

  if (deps.pill !== false && deps.root) {
    const doc = deps.root.ownerDocument;
    pill = doc.createElement('button');
    pill.type = 'button';
    pill.className = 'mc-btn mc-phone-track-pill';
    pill.dataset.cmd = 'phone-track';
    pill.addEventListener('click', () => { void tap(); });
    deps.root.append(pill);
    paint();
  }
  if (readPhoneSensor(deps.storage)) void request('pill', true);

  return {
    request,
    tap,
    reasons: () => [...want],
    running,
    statusLine() {
      if (!want.size) return SENSOR_OFF_LINE;
      const s = deps.camera.status();
      if (s === 'live') return SENSOR_ON_LINE;
      if (s === 'starting') return SENSOR_STARTING_LINE;
      return 'Hand tracking is not running — the iPhone camera is off or unavailable';
    },
    get pill() { return pill; },
    frame,
    destroy() {
      offFrame(); offStatus();
      if (want.size) void deps.camera.setUse('sense', false);
      want.clear();
      pill?.remove();
    },
  };
}
