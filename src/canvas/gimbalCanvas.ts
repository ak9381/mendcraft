// Canvas-level gimbal behaviour built on src/devices/gimbalFollow.ts and native.ts.
// Controller with modes: hands | point | hold | scan.
// Pure parser for gimbal voice commands.
// Web environment fallback: { ok: false, why: "The gimbal works in the iPhone app" }.
import { aimAngles, getGimbalPlugin, type GimbalPlugin } from '../devices/native';
import { boxAround, createGimbalFollow, type GimbalFollow } from '../devices/gimbalFollow';
import type { Pt } from '../input/handLogic';

export type GimbalCanvasMode = 'hands' | 'point' | 'hold' | 'scan';
export type GimbalSpeechCommand = 'hands' | 'hold' | 'point' | 'scan';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GimbalResult {
  ok: boolean;
  why?: string;
}

export interface GimbalCanvasOptions {
  plugin?: GimbalPlugin | null;
  onPointTarget?: (box: Box) => void;
  onScanFrame?: (stepIndex: number) => void;
  steadyTolerance?: number;
  steadyHoldMs?: number;
}

export interface GimbalCanvasController {
  mode(): GimbalCanvasMode;
  setMode(mode: GimbalCanvasMode): Promise<GimbalResult>;
  onPoint(pt: { x: number; y: number }, now?: number): Promise<GimbalResult>;
  onHandsFrame(hands: readonly { points: readonly Pt[] }[], now?: number): Promise<GimbalResult>;
  scan(): Promise<GimbalResult>;
  release(): Promise<GimbalResult>;
}

export const NO_GIMBAL_WHY = 'The gimbal works in the iPhone app';

export function parseGimbalSpeech(utterance: string): GimbalSpeechCommand | null {
  if (!utterance) return null;
  const t = utterance
    .trim()
    .toLowerCase()
    .replace(/[,;:.!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;

  if (
    /^(?:please\s+)?(?:follow\s+my\s+hands|track\s+my\s+hands|follow\s+hands)$/.test(t)
  ) {
    return 'hands';
  }
  if (
    /^(?:please\s+)?(?:stop\s+following|stop\s+tracking|hold\s+still|stop)$/.test(t)
  ) {
    return 'hold';
  }
  if (
    /^(?:please\s+)?(?:connect\s+to\s+what\s+i(?:'m|\s+am)\s+pointing\s+at|connect\s+this|connect\s+what\s+i(?:'m|\s+am)\s+pointing\s+at|add\s+what\s+i(?:'m|\s+am)\s+pointing\s+at)$/.test(
      t,
    )
  ) {
    return 'point';
  }
  if (/^(?:please\s+)?(?:scan\s+the\s+room|scan\s+room|scan)$/.test(t)) {
    return 'scan';
  }

  return null;
}

export function createGimbalCanvasController(opts: GimbalCanvasOptions = {}): GimbalCanvasController {
  const plugin = opts.plugin !== undefined ? opts.plugin : getGimbalPlugin();
  const steadyTolerance = opts.steadyTolerance ?? 0.06;
  const steadyHoldMs = opts.steadyHoldMs ?? 2000;

  let currentMode: GimbalCanvasMode = 'hands';
  let steadySince = 0;
  let lastPoint: { x: number; y: number } | null = null;
  let targetFired = false;

  async function checkPlugin(): Promise<boolean> {
    if (!plugin) return false;
    try {
      const a = await plugin.isAvailable();
      return !!a.available;
    } catch {
      return false;
    }
  }

  const gimbalFollow: GimbalFollow = createGimbalFollow({
    aim: async (box) => {
      if (!plugin) return false;
      const { yaw, pitch } = aimAngles(box);
      if (yaw === 0 && pitch === 0) return true;
      try {
        const res = await plugin.aim({ yaw, pitch, seconds: 0.5 });
        return res.ok;
      } catch {
        return false;
      }
    },
  });

  return {
    mode: () => currentMode,
    async setMode(mode: GimbalCanvasMode): Promise<GimbalResult> {
      if (!(await checkPlugin())) {
        return { ok: false, why: NO_GIMBAL_WHY };
      }
      currentMode = mode;
      if (mode === 'hands') {
        gimbalFollow.setMode('hands');
      } else if (mode === 'hold') {
        gimbalFollow.setMode('hold');
      } else {
        gimbalFollow.setMode('hold');
      }
      steadySince = 0;
      lastPoint = null;
      targetFired = false;
      return { ok: true };
    },

    async onPoint(pt: { x: number; y: number }, now?: number): Promise<GimbalResult> {
      if (!(await checkPlugin())) {
        return { ok: false, why: NO_GIMBAL_WHY };
      }
      if (currentMode !== 'point') {
        currentMode = 'point';
        gimbalFollow.setMode('hold');
      }

      const t = now ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const box = boxAround(pt, 0.08);
      const { yaw, pitch } = aimAngles(box);
      if (yaw !== 0 || pitch !== 0) {
        try {
          await plugin!.aim({ yaw, pitch, seconds: 0.4 });
        } catch {
          // optional gimbal
        }
      }

      if (!lastPoint) {
        lastPoint = pt;
        steadySince = t;
        targetFired = false;
      } else {
        const dist = Math.hypot(pt.x - lastPoint.x, pt.y - lastPoint.y);
        if (dist > steadyTolerance) {
          lastPoint = pt;
          steadySince = t;
          targetFired = false;
        } else {
          lastPoint = pt;
          if (!targetFired && t - steadySince >= steadyHoldMs) {
            targetFired = true;
            opts.onPointTarget?.(boxAround(pt, 0.1));
          }
        }
      }

      return { ok: true };
    },

    async onHandsFrame(hands: readonly { points: readonly Pt[] }[], now?: number): Promise<GimbalResult> {
      if (!(await checkPlugin())) {
        return { ok: false, why: NO_GIMBAL_WHY };
      }
      if (currentMode === 'hands') {
        const t = now ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
        gimbalFollow.onFrame(hands, t);
      }
      return { ok: true };
    },

    async scan(): Promise<GimbalResult> {
      if (!(await checkPlugin())) {
        return { ok: false, why: NO_GIMBAL_WHY };
      }
      currentMode = 'scan';
      gimbalFollow.setMode('hold');

      // 5 steps across ±60 degrees (-60, -30, 0, 30, 60)
      const degSteps = [-60, -30, 0, 30, 60];
      for (let i = 0; i < degSteps.length; i++) {
        const yaw = (degSteps[i] * Math.PI) / 180;
        try {
          await plugin!.aim({ yaw, pitch: 0, seconds: 0.2 });
        } catch {
          // ignore
        }
        await new Promise((r) => setTimeout(r, 600));
        opts.onScanFrame?.(i);
      }
      return { ok: true };
    },

    async release(): Promise<GimbalResult> {
      if (!plugin) return { ok: false, why: NO_GIMBAL_WHY };
      try {
        await plugin.release();
        return { ok: true };
      } catch {
        return { ok: false, why: NO_GIMBAL_WHY };
      }
    },
  };
}
