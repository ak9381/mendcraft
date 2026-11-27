// Canvas-level gimbal behaviour built on src/devices/gimbalFollow.ts and native.ts.
// Modes (iPhone docked on a DockKit stand only):
//   face  — DockKit's own subject tracking (system tracking ON). We never aim.
//   hands — system tracking OFF (and kept off: re-asserted whenever the
//           iPhone reads it back on). NATIVE first (plugin.startHandTracking,
//           iOS 18 app builds that have it): the WKWebView camera is turned
//           OFF (yieldCamera) — DockKit follows the WebKit process's capture,
//           so a running web camera meant the face got followed — and the
//           app's own front-camera hand tracker drives DockAccessory.track().
//           Fallback (older builds / the native start failed): we aim at her
//           hands from the web hand tracker's frames, smoothed (gimbalFollow
//           smooth), YAW ONLY (the stand refuses pitch: DockKit error 16).
//           No hand seen / no tracker → the stand holds still. NEVER the face.
//   hold  — both off: the stand stays put.
//   point — hold while a point is captured (no aiming during the steady hold).
// The status text only claims following when the plugin reports DockKit
// tracking really enabled; native error text is passed through as-is.
// Room scan is not available on live runs (SIM keeps its scripted flow in canvasApp).
// Web fallback: { ok: false, why: NO_GIMBAL_WHY }.
import { aimAngles, getGimbalPlugin, type GimbalPlugin } from '../devices/native';
import { createGimbalFollow, FOLLOW_INTERVAL_MS, type GimbalFollow } from '../devices/gimbalFollow';
import type { Pt } from '../input/handLogic';
import { createCueLimiter, GIMBAL_CUE_MIN_GAP_MS, isGimbalCue, type GimbalCueKind } from '../relay/protocol';

export type { GimbalCueKind };

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
  /** Hands-follow move spacing (ms); never below FOLLOW_INTERVAL_MS. */
  followIntervalMs?: number;
  /** How long one isAvailable() answer is reused (ms). Default 5000. */
  availabilityTtlMs?: number;
  /** Turn the WebView camera off (true) / back to what it was (false) while
   *  the native hand tracker owns the lens. Without it there is no native
   *  hands follow (the web camera would keep DockKit on her face). */
  yieldCamera?: (on: boolean) => Promise<void>;
  /** Start / stop the web hand tracker the fallback aim loop feeds on. */
  fallbackTracker?: (on: boolean) => Promise<void>;
  /** The native tracker's state changed (re-announce, repaint the tile). */
  onChange?: () => void;
  /** Status lines the controller says on its own (native tracker lost). */
  say?: (text: string) => void;
  /** How long a lost native tracker may stay lost before the fallback (ms). */
  nativeLostMs?: number;
  /** Native start options (live test): see GimbalPlugin.startHandTracking. */
  nativeHandsOptions?: () => { corrected?: boolean; mirrored?: boolean } | undefined;
  now?: () => number;
}

export interface GimbalCanvasController {
  mode(): GimbalCanvasMode;
  setMode(mode: GimbalCanvasMode, o?: { explicit?: boolean }): Promise<GimbalResult>;
  /** A pointing fingertip (point mode only). Holds the stand; never aims. */
  onPoint(pt: { x: number; y: number }, now?: number): Promise<GimbalResult>;
  /** Hand frames in CAMERA space (un-mirrored). Only used in hands mode. */
  onHandsFrame(hands: readonly { points: readonly Pt[] }[], now?: number): Promise<GimbalResult>;
  /** Live room scan — not available yet (see SCAN_LIVE_WHY). */
  scan(): Promise<GimbalResult>;
  release(): Promise<GimbalResult>;
  /** Toggle the opt-in camera keep-alive; re-applies face mode if active. */
  setKeepAlive?(on: boolean): Promise<GimbalResult>;
  /** The native app saw the stand dock/undock. false→true re-applies face
   *  (unless she chose hold/hands); returns that result, else null. */
  noteDocked?(docked: boolean): Promise<GimbalResult | null>;
  /** What the iPhone really reports, for the announce diagnostics:
   *  systemTracking = DockKit read-back (null = not known yet);
   *  aimingAtHands = hands mode, tracking read back OFF, and a hand seen in
   *  the last AIMING_HAND_MS. */
  diag?(now?: number): GimbalDiag;
  /** Re-assert "tracking off" (hands / hold / point) — e.g. after the camera
   *  session (re)started, which can make DockKit track again. */
  reassertOff?(): Promise<void>;
  /** Re-read the plugin (isAvailable, TTL-bounded) so systemTracking is fresh;
   *  in native hands mode also the native tracker status (every call). */
  refresh?(): Promise<void>;
  /** Hands mode runs on the native tracker (the web camera is off). */
  nativeHands?(): boolean;
  /** Body language: nod yes / shake no / wake up (DockKit animate). Silent
   *  no-op (ok:false, no status) when there is no docked stand, an old build,
   *  or within GIMBAL_CUE_MIN_GAP_MS of the last cue. `status` is set only
   *  after the native call reported success. */
  gimbalCue(kind: GimbalCueKind): Promise<GimbalResult>;
}

export interface GimbalDiag {
  systemTracking: boolean | null;
  /** Native tracker: a hand observation sent in the last NATIVE_AIM_MS.
   *  Fallback: a hand seen in the last AIMING_HAND_MS. */
  aimingAtHands: boolean;
  /** Hands mode runs on the native tracker. */
  nativeHands?: boolean;
  /** The native hand-tracking session really runs (as last reported). */
  handTracker?: boolean;
  /** Axes the hands aim stopped because the error grew after its moves
   *  ('' none, 'yaw', 'pitch', 'yaw+pitch') — the axis sign looks wrong. */
  signSuspect: string;
}
/** A hand seen this recently counts as "aiming at hands". */
export const AIMING_HAND_MS = 1500;
/** Native tracker: a hand observation SENT this recently = aiming at hands. */
export const NATIVE_AIM_MS = 500;
/** JS-side re-assert of "tracking off" at most this often. */
export const REASSERT_MIN_MS = 1000;

export const NO_GIMBAL_WHY = 'The gimbal works in the iPhone app';
/** Inside the native app, when the plugin gives no reason. */
export const NO_STAND_WHY = 'No DockKit stand docked';
export const FACE_ON_STATUS = 'DockKit tracking on — needs a camera app/camera running';
export const FACE_ON_KEEPALIVE_STATUS = 'DockKit tracking on — camera keep-alive running (test option)';
export const HANDS_NEED_TRACKER = 'Hand following needs the hand tracker — the gimbal holds still until it sees your hands';
export const HANDS_ON_STATUS = 'Gimbal follows your hands (DockKit tracking off)';
/** The native hand tracker runs (the WebView camera is off). */
export const HANDS_NATIVE_STATUS = 'Following your hands — the gimbal holds still when it can’t see them';
/** The native tracker stopped and did not come back: the web tracker took over. */
export const HANDS_FALLBACK_STATUS = 'The iPhone’s own hand tracker stopped — following your hands with the web tracker (pan only)';
/** A lost native tracker gets this long to come back before the fallback. */
export const NATIVE_LOST_MS = 3000;
/** Hand frames stopped in hands mode: the stand holds still (never the face). */
export const HANDS_PAUSED = 'Hand tracking off — the gimbal holds still until it sees your hands again';
export const HOLD_STATUS = 'Gimbal holding still (DockKit tracking off)';
export const POINT_STATUS = 'Gimbal holding still while you point';
export const SCAN_LIVE_WHY = 'Room scan isn’t available yet — point at a device or name it.';
export const POINT_NEEDS_LAPTOP = 'Pointing needs the laptop camera — turn on Hands on the laptop and say it there.';
export const OLD_BUILD_WHY = 'This iPhone app build can’t switch DockKit tracking — update the app';
/** Status lines for a cue — only ever shown after DockKit reported success. */
export const CUE_STATUS: Record<GimbalCueKind, string> = {
  yes: 'Gimbal nodded',
  no: 'Gimbal shook its head',
  wakeup: 'Gimbal woke up',
};
export const CUE_OLD_BUILD_WHY = 'This iPhone app build can’t animate the gimbal — update the app';
export const CUE_RATE_WHY = 'Gimbal cue skipped (one every 2 s)';

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
    // Only put back what the build changed: a mode she picked meanwhile
    // ("follow my hands" while it built) stays, and so does the tile (D3).
    const now = controller.mode();
    if (now === 'face' || now === prevMode) void controller.setMode(prevMode).catch(() => {});
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
  /** The plugin's own "why not" (e.g. "No DockKit stand docked"). */
  let lastReason = '';
  /** She explicitly chose this mode by voice (hold / hands are respected on redock). */
  let explicit: GimbalCanvasMode | null = null;
  let lastDocked: boolean | null = null;
  /** Inside the native app the plugin's reason; on the web the generic line. */
  const why = (): string => (plugin ? lastReason || NO_STAND_WHY : NO_GIMBAL_WHY);
  let availInflight: Promise<boolean> | null = null;
  const cueLimiter = createCueLimiter(GIMBAL_CUE_MIN_GAP_MS, clock);
  /** DockKit system tracking as the iPhone last read it back (null = unknown). */
  let systemTracking: boolean | null = null;
  let lastHandAt = -Infinity;
  let lastReassertAt = -Infinity;
  /** Hands mode runs on the native tracker (camera yielded to it). */
  let nativeOn = false;
  /** The native session really runs, as last reported. */
  let nativeRunning = false;
  /** Aiming is claimed until this time (events: ±Infinity; polls: age-based). */
  let nativeAimUntil = -Infinity;
  /** The fallback web tracker was started by us (stop it on leaving hands). */
  let fallbackOn = false;
  let lastNativeError = '';
  const canNative = (): boolean => !!plugin?.startHandTracking && !!opts.yieldCamera;
  let nativeEvents = false;
  /** Bumped by every setMode: an older request that awaited gives up. */
  let modeGen = 0;
  /** The mode the LATEST setMode asked for (currentMode lags behind its awaits). */
  let requestedMode: GimbalCanvasMode | null = null;
  let lostTimer: ReturnType<typeof setTimeout> | null = null;
  const clearLost = (): void => { if (lostTimer !== null) { clearTimeout(lostTimer); lostTimer = null; } };
  /** The native session went away in hands mode (runtime error, camera
   *  taken…). Say so; if it is not back within NATIVE_LOST_MS, fall back
   *  to the web tracker (yaw-only) and say that. Undocked / hidden: wait. */
  function nativeLost(): void {
    if (lostTimer !== null || !nativeOn || currentMode !== 'hands') return;
    opts.say?.(HANDS_PAUSED);
    const gen = modeGen;
    const arm = (): void => {
      lostTimer = setTimeout(() => {
        lostTimer = null;
        void (async () => {
          if (gen !== modeGen || !nativeOn || currentMode !== 'hands' || nativeRunning) return;
          const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
          let docked = true;
          try { docked = !!(await plugin?.isAvailable())?.available; } catch { docked = false; }
          if (gen !== modeGen || !nativeOn || currentMode !== 'hands' || nativeRunning) return;
          if (hidden || !docked) { arm(); return; }
          try {
            const st = await plugin?.handTrackingStatus?.();
            if (st?.handTracking === true) { nativeRunning = true; return; }
          } catch { /* keep */ }
          if (gen !== modeGen || !nativeOn || currentMode !== 'hands' || nativeRunning) return;
          await stopNative();
          if (gen !== modeGen || currentMode !== 'hands') return;
          if (opts.fallbackTracker && !fallbackOn) {
            fallbackOn = true;
            try { await opts.fallbackTracker(true); } catch { /* the status says so */ }
          }
          opts.say?.(HANDS_FALLBACK_STATUS);
          opts.onChange?.();
        })();
      }, opts.nativeLostMs ?? NATIVE_LOST_MS);
    };
    arm();
  }
  function nativeState(running: boolean): void {
    const was = nativeRunning;
    nativeRunning = running;
    if (running) clearLost();
    else if (was || nativeOn) nativeLost();
  }
  if (plugin?.addListener) {
    try {
      void Promise.resolve(plugin.addListener('handTracking', (e) => {
        nativeEvents = true;
        nativeState(!!e?.running);
        nativeAimUntil = e?.aimingAtHands && nativeRunning ? Infinity : -Infinity;
        opts.onChange?.();
      })).catch(() => {});
    } catch { /* old build: polling only */ }
  }
  // A fresh page never wants a tracker a previous page left running.
  if (plugin?.stopHandTracking) void Promise.resolve().then(() => plugin.stopHandTracking?.({ reason: 'page load' })).catch(() => {});
  function noteNative(st: { handTracking?: boolean; aimingAtHands?: boolean; lastHandMs?: number } | undefined): void {
    if (!st) return;
    if (typeof st.handTracking === 'boolean' && nativeOn) nativeState(st.handTracking);
    else if (typeof st.handTracking === 'boolean') nativeRunning = st.handTracking;
    if (!nativeRunning || st.aimingAtHands === false) nativeAimUntil = -Infinity;
    else if (nativeEvents) { if (st.aimingAtHands) nativeAimUntil = Infinity; }
    else if (typeof st.lastHandMs === 'number' && st.lastHandMs >= 0) nativeAimUntil = clock() + (NATIVE_AIM_MS - st.lastHandMs);
  }
  /** Leave native hands: stop the native session FIRST, then give the lens back. */
  async function stopNative(): Promise<void> {
    clearLost();
    if (!nativeOn) return;
    nativeOn = false;
    nativeRunning = false;
    nativeAimUntil = -Infinity;
    try { await plugin?.stopHandTracking?.({ reason: 'mode change' }); } catch { /* best effort */ }
    try { await opts.yieldCamera?.(false); } catch { /* best effort */ }
    opts.onChange?.();
  }
  async function stopFallback(): Promise<void> {
    if (!fallbackOn) return;
    fallbackOn = false;
    try { await opts.fallbackTracker?.(false); } catch { /* best effort */ }
  }
  /** A newer setMode overtook this hands request. */
  const superseded = (gen: number): boolean => gen !== modeGen || requestedMode !== 'hands';
  /** Undo a superseded start. A newer HANDS request owns the native tracker
   *  and the camera hand-off, so then nothing is undone here. */
  async function abandonNative(): Promise<GimbalResult> {
    if (requestedMode !== 'hands') {
      try { await plugin?.stopHandTracking?.({ reason: 'superseded' }); } catch { /* ignore */ }
      try { await opts.yieldCamera?.(false); } catch { /* ignore */ }
    }
    return { ok: true };
  }
  /** Try the native tracker. null = not possible here (use the fallback). */
  async function startNative(gen: number): Promise<GimbalResult | null> {
    if (!canNative() || !plugin?.startHandTracking) return null;
    await stopFallback();
    if (superseded(gen)) return abandonNative();
    // The WebView camera off first: while it runs, DockKit keeps following her face.
    try { await opts.yieldCamera?.(true); } catch { /* still try */ }
    if (superseded(gen)) return abandonNative();
    let r: Awaited<ReturnType<NonNullable<GimbalPlugin['startHandTracking']>>>;
    try {
      r = await plugin.startHandTracking(opts.nativeHandsOptions?.() ?? {});
    } catch (e) {
      r = { ok: false, running: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (superseded(gen)) return abandonNative();
    noteTracking(r.enabled);
    if (r.ok && r.running) {
      nativeOn = true;
      nativeRunning = true;
      lastNativeError = '';
      opts.onChange?.();
      return { ok: true, status: HANDS_NATIVE_STATUS };
    }
    // Native didn't start: give the lens back; the caller falls back.
    try { await plugin.stopHandTracking?.({ reason: 'start failed' }); } catch { /* ignore */ }
    if (superseded(gen)) return abandonNative();
    try { await opts.yieldCamera?.(false); } catch { /* ignore */ }
    if (superseded(gen)) return abandonNative();
    lastNativeError = r.error || 'the native hand tracker didn’t start';
    return null;
  }
  const offMode = (): boolean => currentMode === 'hands' || currentMode === 'hold' || currentMode === 'point';
  const noteTracking = (v: unknown): void => { if (typeof v === 'boolean') systemTracking = v; };
  /** Tracking read back ON while we want it off: turn it off again (rate-limited). */
  function maybeReassert(): void {
    if (!offMode() || systemTracking !== true) return;
    const t = clock();
    if (t - lastReassertAt < REASSERT_MIN_MS) return;
    lastReassertAt = t;
    void setTracking(false).catch(() => {});
  }

  /** isAvailable() at most once per TTL (it crosses the native bridge). */
  async function checkPlugin(): Promise<boolean> {
    if (!plugin) return false;
    const t = clock();
    if (avail && t - avail.at < ttl) return avail.value;
    if (availInflight) return availInflight;
    availInflight = (async () => {
      let value = false;
      try {
        const a = await plugin.isAvailable();
        value = !!a.available;
        noteTracking(a.systemTracking);
        lastReason = value ? '' : (a.reason || NO_STAND_WHY);
      } catch (e) { value = false; lastReason = e instanceof Error ? e.message : NO_STAND_WHY; }
      avail = { value, at: clock() };
      availInflight = null;
      maybeReassert();
      return value;
    })();
    return availInflight;
  }

  const gimbalFollow: GimbalFollow = createGimbalFollow({
    intervalMs: Math.max(FOLLOW_INTERVAL_MS, opts.followIntervalMs ?? FOLLOW_INTERVAL_MS),
    // Hands mode: smoothed target, dead zone, eased moves (gimbalFollow.ts).
    smooth: {
      // Fallback only (no native tracker). YAW ONLY: the stand refuses any
      // pitch in a relative move (DockKit error 16, live). A pitch-only step
      // is not a move (false: proves nothing about the sign).
      move: async (yaw) => {
        if (!plugin || currentMode !== 'hands' || nativeOn) return false;
        if (yaw === 0) return false;
        try {
          const res = await plugin.aim({ yaw, pitch: 0, seconds: 0.5 });
          noteTracking(res.systemTracking);
          maybeReassert();
          return res.ok;
        } catch {
          return false;
        }
      },
    },
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
      noteTracking(r.enabled);
      return { ok: r.ok !== false, enabled: r.enabled === true, keepAlive: r.keepAlive === true, error: r.error };
    } catch (e) {
      return { ok: false, enabled: false, keepAlive: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function enterFace(prefix?: string, gen?: number): Promise<GimbalResult> {
    await stopNative();
    await stopFallback();
    const r = await setTracking(true);
    // A newer setMode won meanwhile: it owns the mode (never overwrite it).
    if (gen !== undefined && gen !== modeGen) return { ok: true };
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

  async function enterOff(mode: 'hands' | 'hold' | 'point', gen?: number): Promise<GimbalResult> {
    if (mode !== 'hands') { await stopNative(); await stopFallback(); }
    const r = await setTracking(false);
    if (gen !== undefined && gen !== modeGen) return { ok: true };
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
    async setMode(mode: GimbalCanvasMode, o?: { explicit?: boolean }): Promise<GimbalResult> {
      if (o?.explicit) explicit = mode;
      const gen = ++modeGen;
      requestedMode = mode;
      if (!(await checkPlugin())) {
        return { ok: false, why: why() };
      }
      if (mode === 'face') return enterFace(undefined, gen);
      if (mode === 'hands') {
        // Never the face: without a tracker the stand holds still (tracking
        // off) and starts following as soon as hand frames arrive.
        const r = await enterOff('hands', gen);
        if (gen !== modeGen) return { ok: true };
        if (!r.ok) return r;
        if (nativeOn && nativeRunning) return { ok: true, status: HANDS_NATIVE_STATUS };
        const n = await startNative(gen);
        if (n) return n;
        if (superseded(gen)) return { ok: true };
        // Fallback: the web hand tracker + our yaw-only aim.
        if (opts.fallbackTracker && !fallbackOn) {
          fallbackOn = true;
          try { await opts.fallbackTracker(true); } catch { /* reported below */ }
        }
        if (!opts.handsRunning?.()) return { ok: false, why: lastNativeError ? `${HANDS_NEED_TRACKER} (${lastNativeError})` : HANDS_NEED_TRACKER };
        return r;
      }
      return enterOff(mode, gen);
    },

    async onPoint(): Promise<GimbalResult> {
      if (!(await checkPlugin())) {
        return { ok: false, why: why() };
      }
      // Point mode holds the stand still so the captured frame matches what
      // she pointed at. The steady hold + capture belong to canvasApp's
      // pointTurn (one hold, not two).
      return { ok: true };
    },

    async onHandsFrame(hands: readonly { points: readonly Pt[] }[], now?: number): Promise<GimbalResult> {
      if (currentMode !== 'hands' || nativeOn) return { ok: true };
      if (!(await checkPlugin())) {
        return { ok: false, why: why() };
      }
      const t = now ?? clock();
      if (hands.some((h) => h.points.length >= 21)) lastHandAt = t;
      gimbalFollow.onFrame(hands, t);
      return { ok: true };
    },

    async scan(): Promise<GimbalResult> {
      if (!(await checkPlugin())) {
        return { ok: false, why: why() };
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

    async noteDocked(docked: boolean): Promise<GimbalResult | null> {
      if (!plugin) return null;
      const was = lastDocked;
      lastDocked = docked;
      avail = { value: docked, at: clock() };
      if (!docked) { lastReason = lastReason || NO_STAND_WHY; return null; }
      lastReason = '';
      // Launch race / redock: the stand appeared after the first setMode.
      // Follow the face again unless she explicitly chose hold or hands.
      if (was === true) return null;
      if (explicit === 'hold' || explicit === 'hands') return null;
      if (currentMode === 'face') return null;
      return this.setMode('face');
    },

    async gimbalCue(kind: GimbalCueKind): Promise<GimbalResult> {
      if (!isGimbalCue(kind)) return { ok: false, why: 'Unknown gimbal cue' };
      if (!plugin) return { ok: false, why: NO_GIMBAL_WHY };
      if (!plugin.cue) return { ok: false, why: CUE_OLD_BUILD_WHY };
      if (!(await checkPlugin())) return { ok: false, why: why() };
      if (!cueLimiter.allow(kind)) return { ok: false, why: CUE_RATE_WHY };
      try {
        const r = await plugin.cue({ kind });
        if (r?.ok === true) return { ok: true, status: CUE_STATUS[kind] };
        return { ok: false, why: r?.reason || NO_STAND_WHY };
      } catch (e) {
        return { ok: false, why: e instanceof Error ? e.message : String(e) };
      }
    },

    diag(now?: number): GimbalDiag {
      const t = now ?? clock();
      const sus = gimbalFollow.diag().signSuspect;
      const signSuspect = [sus.yaw ? 'yaw' : '', sus.pitch ? 'pitch' : ''].filter(Boolean).join('+');
      if (nativeOn) {
        return {
          systemTracking,
          aimingAtHands: currentMode === 'hands' && systemTracking !== true && nativeRunning && t < nativeAimUntil,
          nativeHands: true,
          handTracker: nativeRunning,
          signSuspect,
        };
      }
      return {
        systemTracking,
        aimingAtHands: currentMode === 'hands' && systemTracking === false && t - lastHandAt < AIMING_HAND_MS,
        signSuspect,
      };
    },

    async refresh(): Promise<void> {
      if (!plugin) return;
      await checkPlugin();
      if (nativeOn && plugin.handTrackingStatus) {
        try { noteNative(await plugin.handTrackingStatus()); } catch { /* keep the last state */ }
      }
    },

    nativeHands: () => nativeOn,

    async reassertOff(): Promise<void> {
      if (!plugin || !offMode()) return;
      lastReassertAt = clock();
      await setTracking(false);
    },

    async setKeepAlive(on: boolean): Promise<GimbalResult> {
      keepAlive = on;
      if (!(await checkPlugin())) return { ok: false, why: why() };
      if (currentMode === 'face') return enterFace();
      return { ok: true, status: `Camera keep-alive ${on ? 'on' : 'off'} — it runs only while face tracking is on` };
    },
  };
}
