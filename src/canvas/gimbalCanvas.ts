// Canvas-level gimbal behaviour built on src/devices/gimbalFollow.ts and native.ts.
// Modes (iPhone docked on a DockKit stand only):
//   face  — DockKit's own subject tracking (system tracking ON). We never aim.
//   hands — system tracking OFF; we aim at her hands, only while a hand
//           tracker is producing frames. Without one we say so and use face.
//   hold  — both off: the stand stays put.
//   point — hold while a point is captured (no aiming during the steady hold).
// The status text only claims following when the plugin reports DockKit
// tracking really enabled; native error text is passed through as-is.
// Room scan is not available on live runs (SIM keeps its scripted flow in canvasApp).
// Web fallback: { ok: false, why: NO_GIMBAL_WHY }.
import { aimAngles, getGimbalPlugin, type GimbalPlugin } from '../devices/native';
import { createGimbalFollow, type GimbalFollow } from '../devices/gimbalFollow';
import type { Pt } from '../input/handLogic';

export type GimbalCanvasMode = 'face' | 'hands' | 'hold' | 'point';
export type GimbalSpeechCommand = 'face' | 'hands' | 'hold' | 'point' | 'scan' | 'keepAliveOn' | 'keepAliveOff';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GimbalResult {
  ok: boolean;
  /** Why it failed (or the honest caveat). */
  why?: string;
  /** What is actually enabled now, for the status line. */
  status?: string;
}

export interface GimbalCanvasOptions {
  plugin?: GimbalPlugin | null;
  /** True while a hand tracker is running (hand frames can arrive). */
  handsRunning?: () => boolean;
  /** Opt-in native camera keep-alive while face tracking is on (test option). */
  keepAlive?: boolean;
  /** How long one isAvailable() answer is reused (ms). Default 5000. */
  availabilityTtlMs?: number;
  now?: () => number;
}

export interface GimbalCanvasController {
  mode(): GimbalCanvasMode;
  setMode(mode: GimbalCanvasMode): Promise<GimbalResult>;
  /** A pointing fingertip (point mode only). Holds the stand; never aims. */
  onPoint(pt: { x: number; y: number }, now?: number): Promise<GimbalResult>;
  /** Hand frames in CAMERA space (un-mirrored). Only used in hands mode. */
  onHandsFrame(hands: readonly { points: readonly Pt[] }[], now?: number): Promise<GimbalResult>;
  /** Live room scan — not available yet (see SCAN_LIVE_WHY). */
  scan(): Promise<GimbalResult>;
  release(): Promise<GimbalResult>;
  /** Toggle the opt-in camera keep-alive; re-applies face mode if active. */
  setKeepAlive?(on: boolean): Promise<GimbalResult>;
}

export const NO_GIMBAL_WHY = 'The gimbal works in the iPhone app';
export const FACE_ON_STATUS = 'DockKit tracking on — needs a camera app/camera running';
export const FACE_ON_KEEPALIVE_STATUS = 'DockKit tracking on — camera keep-alive running (test option)';
export const HANDS_NEED_TRACKER = 'Hand following needs a hand tracker — following your face instead';
export const HANDS_ON_STATUS = 'Gimbal follows your hands (DockKit tracking off)';
export const HOLD_STATUS = 'Gimbal holding still (DockKit tracking off)';
export const POINT_STATUS = 'Gimbal holding still while you point';
export const SCAN_LIVE_WHY = 'Room scan isn’t available yet — point at a device or name it.';
export const POINT_NEEDS_LAPTOP = 'Pointing needs the laptop camera — turn on Hands on the laptop and say it there.';
export const OLD_BUILD_WHY = 'This iPhone app build can’t switch DockKit tracking — update the app';

/**
 * Follows the user (native only) for exactly as long as `run` is in flight —
 * a board being built while Gemini/Nano works — then restores whatever mode
 * the gimbal was in before. Already following (face / hands)? Leaves it be.
 * Soft-fails to a no-op on the web, where `setMode` resolves `{ ok: false }`.
 */
export async function followWhileBuilding<T>(
  controller: Pick<GimbalCanvasController, 'mode' | 'setMode'>,
  run: () => Promise<T>,
): Promise<T> {
  const prevMode = controller.mode();
  if (prevMode === 'face' || prevMode === 'hands') return run();
  void controller.setMode('face').catch(() => {});
  try {
    return await run();
  } finally {
    void controller.setMode(prevMode).catch(() => {});
  }
}

export function parseGimbalSpeech(utterance: string): GimbalSpeechCommand | null {
  if (!utterance) return null;
  const t = utterance
    .trim()
    .toLowerCase()
    .replace(/[,;:.!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;

  if (/^(?:please\s+)?(?:follow\s+my\s+hands|track\s+my\s+hands|follow\s+hands)$/.test(t)) {
    return 'hands';
  }
  if (/^(?:please\s+)?(?:follow\s+me|follow\s+my\s+face|track\s+me|track\s+my\s+face)$/.test(t)) {
    return 'face';
  }
  if (/^(?:please\s+)?(?:stop\s+following|stop\s+tracking|hold\s+still|stop)$/.test(t)) {
    return 'hold';
  }
  if (/^(?:gimbal\s+|camera\s+)?keep[\s-]?alive\s+on$/.test(t)) return 'keepAliveOn';
  if (/^(?:gimbal\s+|camera\s+)?keep[\s-]?alive\s+off$/.test(t)) return 'keepAliveOff';
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
  const ttl = opts.availabilityTtlMs ?? 5000;
  const clock = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  let keepAlive = !!opts.keepAlive;

  // Nothing is claimed until the plugin confirms it.
  let currentMode: GimbalCanvasMode = 'hold';
  let avail: { value: boolean; at: number } | null = null;
  let availInflight: Promise<boolean> | null = null;

  /** isAvailable() at most once per TTL (it crosses the native bridge). */
  async function checkPlugin(): Promise<boolean> {
    if (!plugin) return false;
    const t = clock();
    if (avail && t - avail.at < ttl) return avail.value;
    if (availInflight) return availInflight;
    availInflight = (async () => {
      let value = false;
      try { value = !!(await plugin.isAvailable()).available; } catch { value = false; }
      avail = { value, at: clock() };
      availInflight = null;
      return value;
    })();
    return availInflight;
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
  gimbalFollow.setMode('hold');

  async function setTracking(enabled: boolean): Promise<{ ok: boolean; enabled: boolean; keepAlive: boolean; error?: string }> {
    if (!plugin?.setSystemTrackingEnabled) return { ok: false, enabled: false, keepAlive: false, error: OLD_BUILD_WHY };
    try {
      const r = await plugin.setSystemTrackingEnabled({ enabled, keepAlive: enabled && keepAlive });
      return { ok: r.ok !== false, enabled: r.enabled === true, keepAlive: r.keepAlive === true, error: r.error };
    } catch (e) {
      return { ok: false, enabled: false, keepAlive: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function enterFace(prefix?: string): Promise<GimbalResult> {
    const r = await setTracking(true);
    if (!r.enabled) {
      // Not following — do not claim it. Custom follow stays in hold.
      currentMode = 'hold';
      gimbalFollow.setMode('hold');
      const err = r.error ? `: ${r.error}` : '';
      return { ok: false, why: `${prefix ? `${prefix}. ` : ''}DockKit tracking didn’t turn on${err}` };
    }
    currentMode = 'face';
    gimbalFollow.setMode('hold');
    let status = r.keepAlive ? FACE_ON_KEEPALIVE_STATUS : FACE_ON_STATUS;
    if (keepAlive && !r.keepAlive) status += ` (keep-alive failed${r.error ? `: ${r.error}` : ''})`;
    return { ok: true, status: prefix ? `${prefix}. ${status}` : status };
  }

  async function enterOff(mode: 'hands' | 'hold' | 'point'): Promise<GimbalResult> {
    const r = await setTracking(false);
    currentMode = mode;
    gimbalFollow.setMode(mode === 'hands' ? 'hands' : 'hold');
    const status = mode === 'hands' ? HANDS_ON_STATUS : mode === 'point' ? POINT_STATUS : HOLD_STATUS;
    if (!r.ok || r.enabled) {
      const err = r.error ? `: ${r.error}` : '';
      return { ok: false, why: `Couldn’t turn DockKit tracking off${err}` };
    }
    return { ok: true, status };
  }

  return {
    mode: () => currentMode,
    async setMode(mode: GimbalCanvasMode): Promise<GimbalResult> {
      if (!(await checkPlugin())) {
        return { ok: false, why: NO_GIMBAL_WHY };
      }
      if (mode === 'face') return enterFace();
      if (mode === 'hands') {
        if (!opts.handsRunning?.()) return enterFace(HANDS_NEED_TRACKER);
        return enterOff('hands');
      }
      return enterOff(mode);
    },

    async onPoint(): Promise<GimbalResult> {
      if (!(await checkPlugin())) {
        return { ok: false, why: NO_GIMBAL_WHY };
      }
      // Point mode holds the stand still so the captured frame matches what
      // she pointed at. The steady hold + capture belong to canvasApp's
      // pointTurn (one hold, not two).
      return { ok: true };
    },

    async onHandsFrame(hands: readonly { points: readonly Pt[] }[], now?: number): Promise<GimbalResult> {
      if (currentMode !== 'hands') return { ok: true };
      if (!(await checkPlugin())) {
        return { ok: false, why: NO_GIMBAL_WHY };
      }
      gimbalFollow.onFrame(hands, now ?? clock());
      return { ok: true };
    },

    async scan(): Promise<GimbalResult> {
      if (!(await checkPlugin())) {
        return { ok: false, why: NO_GIMBAL_WHY };
      }
      return { ok: false, why: SCAN_LIVE_WHY };
    },

    async release(): Promise<GimbalResult> {
      if (!plugin) return { ok: false, why: NO_GIMBAL_WHY };
      try {
        await plugin.release();
        return { ok: true };
      } catch (e) {
        return { ok: false, why: e instanceof Error ? e.message : NO_GIMBAL_WHY };
      }
    },

    async setKeepAlive(on: boolean): Promise<GimbalResult> {
      keepAlive = on;
      if (!(await checkPlugin())) return { ok: false, why: NO_GIMBAL_WHY };
      if (currentMode === 'face') return enterFace();
      return { ok: true, status: `Camera keep-alive ${on ? 'on' : 'off'} — it runs only while face tracking is on` };
    },
  };
}
