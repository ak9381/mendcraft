// Canvas input composer: bridges hand tracking (canvasHands) and gimbalCanvas.
// Pinch -> keep, brush -> drop, palm -> palm, point events go to gimbal point
// mode (which only holds the stand). Hand frames reach the gimbal in CAMERA
// space (the presence hands are selfie-mirrored). Also handles the gimbal
// voice commands and reports what is really enabled on the status line.

import {
  mountCanvasHands,
  type CanvasHandEvent,
  type CanvasHandsStop,
} from './canvasHands';
import {
  createGimbalCanvasController,
  parseGimbalSpeech,
  NO_GIMBAL_WHY,
  type GimbalCanvasController,
} from './gimbalCanvas';
import { cameraHandsFromSelfie } from './handSpace';
import type { Pt } from '../input/handLogic';

export interface CanvasInputsCallbacks {
  keep?: () => void;
  drop?: () => void;
  palm?: () => void;
  status?: (text: string) => void;
  /** Every hand-tracking frame (raw landmarks) — e.g. the always-on
   *  custom-gesture matcher. Fires alongside the gimbal follow below. */
  frame?: (hands: readonly (readonly Pt[])[], now: number) => void;
}

export type MountHandsFn = (
  root: HTMLElement,
  onEvent: (event: CanvasHandEvent) => void,
) => Promise<CanvasHandsStop | null | undefined> | CanvasHandsStop | null | undefined;

export interface CanvasInputsOptions {
  root?: HTMLElement;
  hands?: MountHandsFn;
  gimbal?: GimbalCanvasController;
  /** Opt-in native camera keep-alive for DockKit face tracking (test option). */
  gimbalKeepAlive?: boolean;
  /** Another hand tracker is feeding the gimbal (the iPhone's sensing layer). */
  sensing?: () => boolean;
  on?: CanvasInputsCallbacks;
}

export interface CanvasInputs {
  start(root?: HTMLElement): Promise<void>;
  stop(): void;
  handleSpeech(text: string): boolean;
  handEvent(ev: CanvasHandEvent): void;
  readonly gimbal: GimbalCanvasController;
}

export function createCanvasInputs(opts: CanvasInputsOptions = {}): CanvasInputs {
  const on = opts.on ?? {};
  let activeHandsStop: CanvasHandsStop | null = null;
  const gimbal =
    opts.gimbal ??
    createGimbalCanvasController({
      handsRunning: () => activeHandsStop !== null || !!opts.sensing?.(),
      keepAlive: opts.gimbalKeepAlive,
    });
  const handsMount = opts.hands ?? mountCanvasHands;
  const report = (p: Promise<{ ok: boolean; why?: string; status?: string }>): void => {
    p.then((res) => {
      const text = res.ok ? res.status : res.why ?? NO_GIMBAL_WHY;
      if (text) on.status?.(text);
    }).catch(() => { on.status?.(NO_GIMBAL_WHY); });
  };

  function onHandEvent(ev: CanvasHandEvent): void {
    if (ev.type === 'keep') {
      on.keep?.();
    } else if (ev.type === 'drop') {
      on.drop?.();
    } else if (ev.type === 'palm') {
      on.palm?.();
    } else if (ev.type === 'point') {
      void gimbal.onPoint(ev.point).catch(() => {});
    } else if (ev.type === 'frame') {
      // Empty frames (hands gone) still reach on.frame — button gestures
      // cancel on them — but the gimbal follow only gets real hands.
      if (gimbal.mode() === 'hands' && ev.hands.length) {
        void gimbal.onHandsFrame(cameraHandsFromSelfie(ev.hands).map((points) => ({ points })), ev.now).catch(() => {});
      }
      on.frame?.(ev.hands, ev.now);
    }
  }

  async function start(root?: HTMLElement): Promise<void> {
    const target = root ?? opts.root ?? (typeof document !== 'undefined' ? document.body : undefined);
    if (target) {
      try {
        const stopFn = await handsMount(target, onHandEvent);
        activeHandsStop = stopFn ?? null;
      } catch {
        activeHandsStop = null;
      }
    }
  }

  function stop(): void {
    if (activeHandsStop) {
      try {
        if (typeof activeHandsStop.stop === 'function') {
          activeHandsStop.stop();
        } else if (typeof activeHandsStop === 'function') {
          (activeHandsStop as () => void)();
        }
      } catch {
        // safe cleanup
      }
      activeHandsStop = null;
    }
    // No hand frames any more: hands mode would silently stop following.
    if (gimbal.mode() === 'hands') report(gimbal.setMode('face'));
    else void gimbal.release().catch(() => {});
  }

  function handleSpeech(text: string): boolean {
    const cmd = parseGimbalSpeech(text);
    if (!cmd) return false;

    const action =
      cmd === 'keepAliveOn' || cmd === 'keepAliveOff'
        ? (gimbal.setKeepAlive?.(cmd === 'keepAliveOn') ?? Promise.resolve({ ok: false, why: NO_GIMBAL_WHY }))
        : cmd === 'scan'
        ? gimbal.scan()
        : gimbal.setMode(cmd, { explicit: true });
    report(action);
    return true;
  }

  return {
    start,
    stop,
    handleSpeech,
    /** The same dispatcher camera hands feed — the sim hook drives it so a
     *  headless walk can fire keep/drop/palm exactly as a real hand would. */
    handEvent: onHandEvent,
    get gimbal() {
      return gimbal;
    },
  };
}
