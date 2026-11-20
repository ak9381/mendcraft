// Canvas hands adapter: maps the on-device hand gesture stream to canvas events:
// 'keep' on pinch, 'drop' on brush/swipe, 'point' with normalised fingertip,
// and 'palm' for open palm. Includes 600 ms refractory debounce for 'keep'.
import { classifyGesture, type Pt } from '../input/gestures';
import { INDEX_TIP } from '../input/handLogic';
import { createMotionRecognizer } from '../input/motionGestures';
import { createPresenceTracker, type PresenceFrame, type PresenceTracker } from '../input/presence';
import { findLiveCameraStream } from '../input/cameraShare';
import { describeCameraError, INSECURE_CONTEXT_MESSAGE } from '../input/cameraError';
import { createHandOverlay, type HandOverlay } from '../ui/handOverlay';
import { createFaceOverlay, type FaceOverlay } from '../ui/faceOverlay';
import { HAND_FEEL, createHoldGesture } from './handFeel';

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
  // 'keep' needs N consecutive pinch-pose frames, so a 1-frame tracking dip
  // over the canvas can never keep a proposal.
  let pinchFrames = 0;

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

  function extractPoints(h: { points?: readonly Pt[] } | readonly Pt[]): readonly Pt[] {
    if ('points' in h && Array.isArray(h.points)) return h.points;
    return h as readonly Pt[];
  }

  function update(frame: { hands?: Array<{ points?: readonly Pt[] } | readonly Pt[]>; now: number }): void {
    const now = frame.now;
    const handList = frame.hands ?? [];
    if (!handList.length) return;

    const rawHands = handList.map(extractPoints);
    onEvent({ type: 'frame', hands: rawHands, now });
    const motionEvents = motion.update({ hands: rawHands as Pt[][], now });
    for (const mev of motionEvents) {
      if (mev.id === 'palm-swipe-left' || mev.id === 'palm-swipe-right') {
        fire({ type: 'drop' }, now);
      }
    }

    let anyPinch = false;
    let anyPalm = false;
    for (const h of rawHands) {
      if (!h || h.length < 21) continue;
      const gesture = classifyGesture(h as Pt[]);
      if (gesture === 'pinch') {
        anyPinch = true;
      } else if (gesture === 'point') {
        const tip = h[INDEX_TIP];
        if (tip) fire({ type: 'point', point: { x: tip.x, y: tip.y } }, now);
      } else if (gesture === 'open-palm') {
        anyPalm = true;
      }
    }
    pinchFrames = anyPinch ? pinchFrames + 1 : 0;
    if (pinchFrames === HAND_FEEL.keepFrames) fire({ type: 'keep' }, now);
    if (palmHold.update(anyPalm, now)) fire({ type: 'palm' }, now);
  }

  return {
    update,
    feedGesture,
    reset() {
      lastKeepAt = -Infinity;
      motion.reset();
      palmHold.reset();
      pinchFrames = 0;
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
  let faces: FaceOverlay | null = null;

  try {
    const adapter = createCanvasHandsAdapter(onEvent);
    overlay = createHandOverlay(root);
    // Faces are part of the same presence stream and must be VISIBLE: a soft
    // bracket per face (glowing for the operator, dim for others) in the warm
    // paper palette, under the hand skeletons.
    faces = createFaceOverlay(root, {
      operatorColor: '#6B8F71',
      dimColor: '#A8A396',
    });
    tracker = createPresenceTracker(
      () => {},
      (presenceFrame) => {
        overlay?.draw(presenceFrame.hands);
        faces?.draw(presenceFrame.faces, presenceFrame.rejectedHands);
        opts.onPresence?.(presenceFrame);
        adapter.update({
          hands: presenceFrame.hands.map((h) => h.points),
          now: typeof performance !== 'undefined' ? performance.now() : Date.now(),
        });
      },
    );

    const live = findLiveCameraStream();
    await tracker.start(live ?? undefined);
  } catch (err) {
    try {
      tracker?.stop();
      overlay?.clear();
      faces?.clear();
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
