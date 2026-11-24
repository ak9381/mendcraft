// Canvas hands adapter: maps the on-device hand gesture stream to canvas events.
// From camera frames: 'frame' (raw landmarks, every frame — the hand pointer's
// dwell / fist-grab / two-fist zoom run off this), 'point' with the
// normalised fingertip, and 'palm' for a held open palm. Pinch → 'keep',
// thumbs-up → 'keep' and palm swipe → 'drop' are no longer wired from frames.
// mapGestureToCanvasEvent / feedGesture (no live caller) still map named
// gestures, with a 600 ms refractory debounce for 'keep'.
import { classifyGesture, type Pt } from '../input/gestures';
import { INDEX_TIP, THUMB_TIP } from '../input/handLogic';
import { mapToScreen } from './handPointer';
import { createMotionRecognizer } from '../input/motionGestures';
import { createPresenceTracker, type PresenceFrame, type PresenceTracker } from '../input/presence';
import { findLiveCameraStream } from '../input/cameraShare';
import { describeCameraError, INSECURE_CONTEXT_MESSAGE } from '../input/cameraError';
import { createHandOverlay, type HandOverlay } from '../ui/handOverlay';
import { createFacingBanner, type FacingBanner } from '../ui/facingBanner';
import { createFaceOverlay, type FaceOverlay } from '../ui/faceOverlay';
import { HAND_FEEL, createHoldGesture } from './handFeel';

/** FaceLandmarker is on by default. The canvas shows a compact top face
 *  preview (the original AF brackets, smaller) plus a larger "Facing this
 *  device" pill. Presence throttles the model (FACE_INTERVAL_MS). */
export const LAPTOP_DETECT_FACES = true;

export type CanvasHandEvent =
  | { type: 'keep' }
  | { type: 'drop' }
  | { type: 'point'; point: { x: number; y: number } }
  | { type: 'palm' }
  /** Every frame that has at least one hand — raw landmarks, for continuous
   *  consumers (gimbal follow, the always-on custom-gesture matcher) that
   *  need more than the discrete keep/drop/point/palm events above. */
  | { type: 'frame'; hands: readonly (readonly Pt[])[]; now: number };

export interface CanvasHandsAdapter {
  update(frame: { hands?: Array<{ points?: readonly Pt[] } | readonly Pt[]>; now: number }): void;
  feedGesture(
    gesture: string,
    details?: { point?: { x: number; y: number }; now?: number; x?: number; y?: number },
  ): void;
  reset(): void;
}

export interface CanvasHandsOptions {
  refractoryMs?: number;
  /** Drop a motion-recognizer event by id for this frame — e.g. a pinch the
   *  morph hold classifier armed on must never also emit `pinch-hold-still`
   *  (the morph opens the mic itself; firing both would double-toggle). */
  suppressMotion?: (id: string) => boolean;
}

export function mapGestureToCanvasEvent(
  gesture: string,
  details?: { x: number; y: number } | { point?: { x: number; y: number } },
): CanvasHandEvent | null {
  if (gesture === 'pinch') return { type: 'keep' };
  if (
    gesture === 'brush' ||
    gesture === 'palm-swipe-left' ||
    gesture === 'palm-swipe-right' ||
    gesture === 'drop'
  ) {
    return { type: 'drop' };
  }
  if (gesture === 'open-palm' || gesture === 'palm') return { type: 'palm' };
  if (gesture === 'point') {
    const pt = details && 'point' in details && details.point
      ? details.point
      : details && 'x' in details
      ? { x: (details as { x: number }).x, y: (details as { y: number }).y }
      : { x: 0.5, y: 0.5 };
    return { type: 'point', point: pt };
  }
  return null;
}

/**
 * Both-hands-pinch extractor for anchored two-hand zoom/pan. Given the raw hand
 * landmark frames, returns the two pinch points in SCREEN pixels (the same
 * selfie-mirrored reach-box mapping the hand cursor uses, so the zoom anchors
 * exactly where the user sees their pinches) — but only when at least two hands
 * are pinching. Returns null otherwise, so one-hand behaviour is untouched.
 * Pure (no DOM): the caller passes the viewport size.
 */
export function twoHandPinchPoints(
  hands: readonly (readonly Pt[])[],
  w: number,
  h: number,
): { p: { x: number; y: number }; q: { x: number; y: number } } | null {
  const pinching = hands.filter((hnd) => hnd && hnd.length >= 21 && classifyGesture(hnd as Pt[]) === 'pinch');
  if (pinching.length < 2) return null;
  const toScreen = (hnd: readonly Pt[]) => {
    const mid = { x: (hnd[THUMB_TIP].x + hnd[INDEX_TIP].x) / 2, y: (hnd[THUMB_TIP].y + hnd[INDEX_TIP].y) / 2 };
    return mapToScreen(mid, w, h);
  };
  return { p: toScreen(pinching[0]), q: toScreen(pinching[1]) };
}

/**
 * One-hand pinch extractor for the pinch-drag pan (A1-012). Returns the single
 * pinch point in SCREEN pixels (same selfie-mirrored reach-box mapping as the
 * hand cursor and twoHandPinchPoints), but only when EXACTLY one hand is
 * pinching — so the two-hand zoom/pan path is never disturbed. Returns null
 * otherwise. Pure (no DOM): the caller passes the viewport size.
 */
export function oneHandPinchPoint(
  hands: readonly (readonly Pt[])[],
  w: number,
  h: number,
): { x: number; y: number } | null {
  const pinching = hands.filter((hnd) => hnd && hnd.length >= 21 && classifyGesture(hnd as Pt[]) === 'pinch');
  if (pinching.length !== 1) return null;
  const hnd = pinching[0];
  const mid = { x: (hnd[THUMB_TIP].x + hnd[INDEX_TIP].x) / 2, y: (hnd[THUMB_TIP].y + hnd[INDEX_TIP].y) / 2 };
  return mapToScreen(mid, w, h);
}

export function createCanvasHandsAdapter(
  onEvent: (event: CanvasHandEvent) => void,
  opts: CanvasHandsOptions = {},
): CanvasHandsAdapter {
  const refractoryMs = opts.refractoryMs ?? 600;
  let lastKeepAt = -Infinity;
  const motion = createMotionRecognizer();
  // Open palm must be HELD (HAND_FEEL.palmHoldMs) to toggle the tools panel —
  // the old per-frame 'palm' event toggled it every single frame the pose was
  // visible, which is the "glitches when I hover" bug.
  const palmHold = createHoldGesture(HAND_FEEL.palmHoldMs, HAND_FEEL.palmRefractoryMs);
  // Live hand gestures are point (dwell), fist (grab/pan) and two fists
  // (zoom) — all in handPointer.ts. Pinch → keep, a held thumbs-up → keep
  // and a palm swipe → drop are NOT wired from camera frames any more: they
  // fired by accident while pointing and grabbing. Keep/drop stay on the
  // review card's buttons (dwell-clickable) and voice. The motion recognizer
  // still runs so suppressMotion keeps seeing its ids (taught gestures).

  function fire(ev: CanvasHandEvent, now: number): void {
    if (ev.type === 'keep') {
      if (now - lastKeepAt < refractoryMs) return;
      lastKeepAt = now;
    }
    onEvent(ev);
  }

  function feedGesture(
    gesture: string,
    details: { point?: { x: number; y: number }; now?: number; x?: number; y?: number } = {},
  ): void {
    const now = details.now ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const ev = mapGestureToCanvasEvent(gesture, details);
    if (ev) fire(ev, now);
  }

  function extractPoints(h: { points?: readonly Pt[]; label?: string } | readonly Pt[]): readonly Pt[] {
    if ('points' in h && Array.isArray(h.points)) {
      const pts = h.points.slice() as Pt[] & { label?: string };
      if (h.label === 'Left' || h.label === 'Right') pts.label = h.label;
      return pts;
    }
    return h as readonly Pt[];
  }

  function update(frame: { hands?: Array<{ points?: readonly Pt[] } | readonly Pt[]>; now: number }): void {
    const now = frame.now;
    const handList = frame.hands ?? [];
    if (!handList.length) return;

    const rawHands = handList.map(extractPoints);
    onEvent({ type: 'frame', hands: rawHands, now });
    // Consulted (so a morph hold / taught gesture can still claim an id) but
    // no motion id maps to a canvas event any more — palm swipe is unwired.
    motion
      .update({ hands: rawHands as Pt[][], now })
      .filter((mev) => !opts.suppressMotion?.(mev.id));

    let anyPalm = false;
    for (const h of rawHands) {
      if (!h || h.length < 21) continue;
      const gesture = classifyGesture(h as Pt[], (h as Pt[] & { label?: string }).label);
      if (gesture === 'point') {
        const tip = h[INDEX_TIP];
        if (tip) fire({ type: 'point', point: { x: tip.x, y: tip.y } }, now);
      } else if (gesture === 'open-palm') {
        anyPalm = true;
      }
    }
    if (palmHold.update(anyPalm, now)) fire({ type: 'palm' }, now);
  }

  return {
    update,
    feedGesture,
    reset() {
      lastKeepAt = -Infinity;
      motion.reset();
      palmHold.reset();
    },
  };
}

export type CanvasHandsStop = (() => void) & { stop: () => void };

/** Pure: ?hands=0 is the only opt-out from hands-on-by-default. */
export function autoHandsFromSearch(search: string): boolean {
  return new URLSearchParams(search).get('hands') !== '0';
}

/** Pure: auto-start only when it can possibly work — where getUserMedia does
 *  not exist (jsdom, http) the auto-start must be a silent no-op, so a page
 *  without a camera never boots into an error line nobody asked for. */
export function shouldAutoStartHands(
  autoHands: boolean | undefined,
  nav: { mediaDevices?: { getUserMedia?: unknown } } | undefined | null,
): boolean {
  if (autoHands === false) return false;
  return typeof nav?.mediaDevices?.getUserMedia === 'function';
}

export interface MountCanvasHandsOptions {
  /** Called with the human-readable reason (describeCameraError) when the
   *  camera / tracking could not start. mountCanvasHands still returns null. */
  onError?: (reason: string, err: unknown) => void;
  /** Every presence frame (hands + faces + operator state) — the owner
   *  registration flow listens here. */
  onPresence?: (frame: PresenceFrame) => void;
  /** Passed through to the gesture adapter (see CanvasHandsOptions). */
  suppressMotion?: (id: string) => boolean;
  /** Camera track ended while tracking (unplug / OS revoke) — not a start failure. */
  onCameraLost?: () => void;
  /** The glass-hand overlay's anchors: each present hand's cursor (client
   *  px), so the drawn palm sits on it (see HandOverlayOptions.anchors). */
  handAnchors?: (hands: readonly (readonly Pt[])[]) => ({ x: number; y: number } | null)[];
  /** Override FaceLandmarker. Laptop canvas defaults to off. */
  detectFaces?: boolean;
}

/** The stop function, plus the presence APIs the owner-registration flow
 *  needs (register / re-register / signature persistence). */
export type CanvasHandsHandle = CanvasHandsStop & {
  presence?: Pick<
    PresenceTracker,
    'register' | 'reregister' | 'registerSignature' | 'currentSignature' | 'setOwnerHands' | 'isRegistered'
  >;
};

/** The last reason mountCanvasHands failed, for callers without an onError. */
let lastCameraError: string | null = null;
export function getLastCameraError(): string | null {
  return lastCameraError;
}

/**
 * Mount camera and hand tracking onto root.
 * Starts tracking exactly like main.ts, renders handOverlay,
 * and returns a stop function. Never throws; returns null if camera unavailable
 * — but the REASON is always surfaced via opts.onError / getLastCameraError()
 * and console.error, never swallowed silently.
 */
export async function mountCanvasHands(
  root: HTMLElement,
  onEvent: (event: CanvasHandEvent) => void,
  opts: MountCanvasHandsOptions = {},
): Promise<CanvasHandsStop | null> {
  function fail(err: unknown): null {
    lastCameraError = describeCameraError(err);
    console.error('[mendcraft] camera/hands failed:', err);
    opts.onError?.(lastCameraError, err);
    return null;
  }

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return fail(new Error(INSECURE_CONTEXT_MESSAGE));
  }

  // Fast-fail when the camera is already denied: no point loading the models
  // (and a model failure must not hide the real "blocked" reason).
  try {
    const perm = await navigator.permissions?.query?.({ name: 'camera' as PermissionName });
    if (perm?.state === 'denied') {
      const denied = new Error('Permission denied');
      denied.name = 'NotAllowedError';
      return fail(denied);
    }
  } catch {
    // permissions.query is optional / may not know 'camera' — ignore.
  }

  let tracker: PresenceTracker | null = null;
  let overlay: HandOverlay | null = null;
  let facing: FacingBanner | null = null;
  let faces: FaceOverlay | null = null;

  try {
    const adapter = createCanvasHandsAdapter(onEvent, { suppressMotion: opts.suppressMotion });
    overlay = createHandOverlay(root, { anchors: opts.handAnchors });
    // Compact face brackets at the top + a larger facing pill. FaceLandmarker
    // stays throttled (FACE_INTERVAL_MS) so this doesn't steal the hand tracker.
    facing = createFacingBanner(root);
    faces = createFaceOverlay(root, { compact: true });
    const detectFaces = opts.detectFaces ?? LAPTOP_DETECT_FACES;
    tracker = createPresenceTracker(
      () => {},
      (presenceFrame) => {
        faces?.draw(presenceFrame.faces, presenceFrame.hands.map((h) => h.points));
        // The pill shows the canvas HAND GATE (the operator only; a stranger
        // or an unsettled face is unknown → hidden), so "Not facing" on
        // screen always means the hands are locked.
        const op = presenceFrame.faces.find((f) => f.isOperator);
        facing?.set(op?.handGate ?? null);
        opts.onPresence?.(presenceFrame);
        adapter.update({
          hands: presenceFrame.hands.map((h) => {
            const pts = h.points.slice();
            if (h.label === 'Left' || h.label === 'Right') (pts as typeof pts & { label?: string }).label = h.label;
            return pts;
          }),
          now: typeof performance !== 'undefined' ? performance.now() : Date.now(),
        });
        // Drawn AFTER the pointer update, so each glass hand anchors to this
        // frame's cursors, not last frame's.
        overlay?.draw(presenceFrame.hands);
      },
      { onCameraLost: opts.onCameraLost, detectFaces },
    );

    const live = findLiveCameraStream();
    await tracker.start(live ?? undefined);
  } catch (err) {
    try {
      tracker?.stop();
      overlay?.clear();
      faces?.clear();
      facing?.destroy();
    } catch {
      // safe cleanup
    }
    return fail(err);
  }
  lastCameraError = null;

  const live = tracker;
  const stop = () => {
    try {
      live.stop();
      overlay?.clear();
      faces?.clear();
      facing?.destroy();
    } catch {
      // safe cleanup
    }
  };
  (stop as CanvasHandsStop).stop = stop;
  (stop as CanvasHandsHandle).presence = {
    register: () => live.register(),
    reregister: () => live.reregister(),
    registerSignature: (sig) => live.registerSignature(sig),
    currentSignature: () => live.currentSignature(),
    setOwnerHands: (owner) => live.setOwnerHands(owner),
    get isRegistered() { return live.isRegistered; },
  };
  return stop as CanvasHandsHandle;
}
