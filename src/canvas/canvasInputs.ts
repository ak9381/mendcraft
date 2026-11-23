// Canvas input composer: bridges hand tracking (canvasHands) and gimbalCanvas.
// Pinch -> keep, brush -> drop, palm -> palm, point events feed gimbal point mode.
// Also parses and handles voice commands for gimbal modes, with web status fallback.

import {
  mountCanvasHands,
  type CanvasHandEvent,
  type CanvasHandsStop,
} from './canvasHands';
import {
  createGimbalCanvasController,
  parseGimbalSpeech,
  NO_GIMBAL_WHY,
  type Box,
  type GimbalCanvasController,
} from './gimbalCanvas';
import type { Pt } from '../input/handLogic';

export interface CanvasInputsCallbacks {
  keep?: () => void;
  drop?: () => void;
  palm?: () => void;
  pointTarget?: (box: Box) => void;
  scanFrame?: (i: number) => void;
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
  const gimbal =
    opts.gimbal ??
    createGimbalCanvasController({
      onPointTarget: on.pointTarget,
      onScanFrame: on.scanFrame,
    });
  const handsMount = opts.hands ?? mountCanvasHands;
  let activeHandsStop: CanvasHandsStop | null = null;

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
      void gimbal.onHandsFrame(ev.hands.map((points) => ({ points })), ev.now).catch(() => {});
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
    void gimbal.release().catch(() => {});
  }

  function handleSpeech(text: string): boolean {
    const cmd = parseGimbalSpeech(text);
    if (!cmd) return false;

    const action =
      cmd === 'hands'
        ? gimbal.setMode('hands')
        : cmd === 'hold'
        ? gimbal.setMode('hold')
        : cmd === 'point'
        ? gimbal.setMode('point')
        : gimbal.scan();

    action
      .then((res) => {
        if (!res.ok) {
          on.status?.(res.why ?? NO_GIMBAL_WHY);
        }
      })
      .catch(() => {
        on.status?.(NO_GIMBAL_WHY);
      });

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
