// Hand control on the phone shell (iPhone / Android app). The same pointer as
// the laptop — palm cursor, fist TAP = click, held fist + move = move board /
// pan, two fists = zoom, facing gate — fed from the shared FRONT camera
// (phoneCamera.ts; look-to-edit rides the same stream and tracker).
//
//  - A "Hands" pill next to the Join laptop pill turns it on/off; persisted
//    (mc.phoneHands), off on first run. The camera is only requested when the
//    pill turns it on.
//  - A small "Camera on" indicator shows while the front camera is live.
//  - Facing gate: the operator face's handGate from the same frames; unknown
//    (no face / unsettled) never locks.
//  - Touch is never touched: nothing here listens to or cancels touch or
//    pointer input, and every drawn layer is pointer-events: none.
//  - Hand actions are not AI: nothing here reaches the AI feed / monitor.

import type { PresenceFrame } from '../input/presence';
import { describeCameraError } from '../input/cameraError';
import { createHandOverlay, matchCursors, type HandOverlay } from '../ui/handOverlay';
import type { HandPointer } from './handPointer';
import { mapToScreen } from './handPointer';
import { palmCenter, type ReachBox } from './handFeel';
import { cameraHandsFromSelfie, stampHandLabel } from './handSpace';
import { CameraLostError, readPhoneHands, writePhoneHands, type PhoneCamera } from './phoneCamera';

export const PHONE_HANDS_ON_LINE = 'Hands on: point with your palm, tap a fist to click. Hold a fist to move or pan; two fists to zoom.';
export const PHONE_HANDS_OFF_LINE = 'Hands off.';
export const PHONE_HANDS_FACE_LINE = 'Hands · face the phone';
export const PHONE_HANDS_LOST_LINE = 'Another app or a call took the camera, so Hands is off. Tap Hands to turn it back on.';

export interface PhoneHandsDeps {
  camera: PhoneCamera;
  pointer: Pick<HandPointer, 'update' | 'lost' | 'setFacing' | 'cursors' | 'handsLocked'>;
  /** Reach box for the current camera aspect (phoneReach). */
  reach: () => ReachBox;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  say?: (text: string) => void;
  /** Look-to-edit lock: while true the hands do nothing (touch is locked too). */
  locked?: () => boolean;
  /** Camera frame height ÷ width, for the pointer's 3D curl and reach box. */
  onAspect?: (aspect: number) => void;
  now?: () => number;
  /** Draw the glass-hand overlay (default true; tests pass false). */
  overlay?: boolean;
}

export interface PhoneHands {
  isOn(): boolean;
  setOn(on: boolean): Promise<void>;
  /** Feed one presence frame (normally from the camera hub; exposed for tests). */
  frame(f: PresenceFrame): void;
  readonly pill: HTMLButtonElement;
  readonly indicator: HTMLElement;
  destroy(): void;
}

export function mountPhoneHands(root: HTMLElement, deps: PhoneHandsDeps): PhoneHands {
  const doc = root.ownerDocument;
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const pill = doc.createElement('button');
  pill.type = 'button';
  pill.className = 'mc-btn mc-phone-hands-pill';
  pill.dataset.cmd = 'phone-hands';
  pill.setAttribute('aria-pressed', 'false');
  pill.title = 'Hand control with the front camera';
  pill.textContent = 'Hands';
  const indicator = doc.createElement('div');
  indicator.className = 'mc-cam-on';
  indicator.setAttribute('role', 'status');
  indicator.setAttribute('aria-label', 'Front camera on');
  indicator.innerHTML = '<span class="mc-cam-on-dot" aria-hidden="true"></span>Camera';
  indicator.hidden = true;
  root.append(pill, indicator);

  let on = false;
  let fed = false; // the pointer has hands in it (so a lock/stop calls lost())
  let overlay: HandOverlay | null = null;
  let overlayEl: Element | null = null;

  function ensureOverlay(): void {
    if (overlay || deps.overlay === false) return;
    overlay = createHandOverlay(root, {
      anchors: (hands) => matchCursors(
        hands.map((points) => mapToScreen(palmCenter(points), innerWidth, innerHeight, false, deps.reach())),
        deps.pointer.cursors?.() ?? [],
      ),
    });
    overlayEl = root.lastElementChild;
  }
  function release(): void {
    if (fed) { deps.pointer.lost(); fed = false; }
    overlay?.clear();
  }
  let gateLocked = false;
  let indicatorText = '';
  function paint(): void {
    pill.setAttribute('aria-pressed', String(on));
    // The phone hides the laptop's facing banner, so the pill itself says
    // when the facing gate has the hands locked.
    pill.textContent = !on ? 'Hands' : gateLocked ? PHONE_HANDS_FACE_LINE : 'Hands ✓';
    pill.classList.toggle('is-gated', on && gateLocked);
    root.classList.toggle('is-phone-hands', on);
    const s = deps.camera.status();
    indicator.dataset.state = s;
    indicator.hidden = !(s === 'live' || s === 'starting');
    // The first start downloads the hand model (~11 MB): say so.
    const text = s === 'starting' && on ? 'Loading hand model…' : 'Camera';
    if (text !== indicatorText) {
      indicatorText = text;
      indicator.innerHTML = `<span class="mc-cam-on-dot" aria-hidden="true"></span>${text}`;
    }
  }

  function frame(f: PresenceFrame): void {
    if (!on) return;
    const t = now();
    if (f.aspect && f.aspect > 0) deps.onAspect?.(f.aspect);
    // Facing gate: only an explicit "turned away" locks (handPointer adds the
    // hysteresis); no face / a stranger / unsettled = unknown = allowed.
    const op = f.faces.find((x) => x.isOperator);
    deps.pointer.setFacing?.(op ? (op.handGate ?? null) : null, t);
    const g = !!deps.pointer.handsLocked?.();
    if (g !== gateLocked) { gateLocked = g; paint(); }
    if (deps.locked?.()) { release(); return; }
    if (f.hands.length) {
      // Presence hands are selfie-mirrored; the pointer expects camera space
      // and mirrors once itself (the front camera's frames are un-mirrored).
      const cam = cameraHandsFromSelfie(f.hands.map((h) => stampHandLabel(h.points.slice(), h.label)));
      deps.pointer.update(cam, t);
      fed = true;
    }
    overlay?.draw(f.hands);
  }

  const offFrame = deps.camera.onFrame(frame);
  const offStatus = deps.camera.onStatus((s) => {
    paint();
    if (s !== 'live') release();
    if (s === 'error' && on) {
      const err = deps.camera.lastError();
      const reason = err instanceof CameraLostError ? PHONE_HANDS_LOST_LINE : describeCameraError(err);
      on = false;
      gateLocked = false;
      writePhoneHands(false, deps.storage);
      void deps.camera.setUse('hands', false);
      deps.pointer.setFacing?.(null, now());
      paint();
      deps.say?.(reason);
    }
  });

  // Toggling is never blocked (a tap while the models still load turns it
  // straight back off); the camera hub serialises the starts and stops.
  async function setOn(next: boolean): Promise<void> {
    if (next === on) return;
    on = next;
    gateLocked = false;
    writePhoneHands(next, deps.storage);
    paint();
    if (next) {
      ensureOverlay();
      await deps.camera.setUse('hands', true);
      if (on && deps.camera.status() === 'live') deps.say?.(PHONE_HANDS_ON_LINE);
    } else {
      release();
      deps.pointer.setFacing?.(null, now());
      await deps.camera.setUse('hands', false);
      if (!on) deps.say?.(PHONE_HANDS_OFF_LINE);
    }
    paint();
  }

  const onClick = (): void => { void setOn(!on); };
  pill.addEventListener('click', onClick);
  paint();
  // Turned on before (persisted): resume — the user already chose it.
  if (readPhoneHands(deps.storage)) void setOn(true);

  return {
    isOn: () => on,
    setOn,
    frame,
    pill,
    indicator,
    destroy() {
      pill.removeEventListener('click', onClick);
      offFrame(); offStatus();
      release();
      if (on) void deps.camera.setUse('hands', false);
      on = false;
      overlayEl?.remove();
      pill.remove(); indicator.remove();
      root.classList.remove('is-phone-hands');
    },
  };
}
