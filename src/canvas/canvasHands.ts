// Canvas hands adapter: maps the on-device hand gesture stream to canvas events:
// 'keep' on pinch, 'drop' on brush/swipe, 'point' with normalised fingertip,
// and 'palm' for open palm. Includes 600 ms refractory debounce for 'keep'.
import { classifyGesture, type Pt } from '../input/gestures';
import { INDEX_TIP } from '../input/handLogic';
import { createMotionRecognizer } from '../input/motionGestures';
import { createPresenceTracker, type PresenceTracker } from '../input/presence';
import { findLiveCameraStream } from '../input/cameraShare';
import { createHandOverlay, type HandOverlay } from '../ui/handOverlay';

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

    for (const h of rawHands) {
      if (!h || h.length < 21) continue;
      const gesture = classifyGesture(h as Pt[]);
      if (gesture === 'pinch') {
        fire({ type: 'keep' }, now);
      } else if (gesture === 'point') {
        const tip = h[INDEX_TIP];
        if (tip) fire({ type: 'point', point: { x: tip.x, y: tip.y } }, now);
      } else if (gesture === 'open-palm') {
        fire({ type: 'palm' }, now);
      }
    }
  }

  return {
    update,
    feedGesture,
    reset() {
      lastKeepAt = -Infinity;
      motion.reset();
    },
  };
}

export type CanvasHandsStop = (() => void) & { stop: () => void };

/**
 * Mount camera and hand tracking onto root.
 * Starts tracking exactly like main.ts, renders handOverlay,
 * and returns a stop function. Never throws; returns null if camera unavailable.
 */
export async function mountCanvasHands(
  root: HTMLElement,
  onEvent: (event: CanvasHandEvent) => void,
): Promise<CanvasHandsStop | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return null;
  }

  let tracker: PresenceTracker | null = null;
  let overlay: HandOverlay | null = null;

  try {
    const adapter = createCanvasHandsAdapter(onEvent);
    overlay = createHandOverlay(root);
    tracker = createPresenceTracker(
      () => {},
      (presenceFrame) => {
        overlay?.draw(presenceFrame.hands);
        adapter.update({
          hands: presenceFrame.hands.map((h) => h.points),
          now: typeof performance !== 'undefined' ? performance.now() : Date.now(),
        });
      },
    );

    const live = findLiveCameraStream();
    await tracker.start(live ?? undefined);
  } catch {
    try {
      tracker?.stop();
      overlay?.clear();
    } catch {
      // safe cleanup
    }
    return null;
  }

  const stop = () => {
    try {
      tracker?.stop();
      overlay?.clear();
    } catch {
      // safe cleanup
    }
  };
  (stop as CanvasHandsStop).stop = stop;
  return stop as CanvasHandsStop;
}
