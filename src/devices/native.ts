// Webview side of the iOS native plugins (Capacitor). Same pattern as
// assist/bridge.ts: read the runtime `window.Capacitor.Plugins` registry, so
// the hosted web bundle doesn't change and the web reports "no native shell".
//
//   MendcraftLan    ios/plugins/MendcraftLanPlugin.swift    — UDP/HTTP on the LAN,
//                   WiZ broadcast discovery, Bonjour browse (the web can't).
//   MendcraftGimbal ios/plugins/MendcraftGimbalPlugin.swift — Apple DockKit:
//                   manual pan/tilt of a DockKit stand (Insta360 Flow 2 Pro),
//                   with system face tracking switched OFF.

import type { JsonTemplate } from './connector';
import type { FoundDevice } from './addDeviceFlow';

export interface LanPlugin {
  sendUdp(opts: { host: string; port: number; payload: string; waitMs?: number }): Promise<{ reply?: string }>;
  http(opts: { method: string; url: string; body?: string }): Promise<{ status: number; body?: string }>;
  discover(opts: { method: string; port?: number; service?: string; waitMs?: number }): Promise<{ devices: FoundDevice[] }>;
}

export interface GimbalPlugin {
  /** DockKit present, iOS 18+, and a stand is docked. */
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  /** Relative move in radians: yaw = pan (+ right), pitch = tilt (+ up). */
  aim(opts: { yaw: number; pitch: number; seconds?: number }): Promise<{ ok: boolean }>;
  /** Hand control back to DockKit's own face tracking. */
  release(): Promise<void>;
}

interface CapacitorGlobal {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
    Plugins?: { MendcraftLan?: LanPlugin; MendcraftGimbal?: GimbalPlugin };
  };
}

export function isIosShell(w: unknown = globalThis): boolean {
  const c = (w as CapacitorGlobal).Capacitor;
  return Boolean(c?.isNativePlatform?.()) && c?.getPlatform?.() === 'ios';
}

export function getLanPlugin(w: unknown = globalThis): LanPlugin | null {
  if (!isIosShell(w)) return null;
  return (w as CapacitorGlobal).Capacitor?.Plugins?.MendcraftLan ?? null;
}

export function getGimbalPlugin(w: unknown = globalThis): GimbalPlugin | null {
  if (!isIosShell(w)) return null;
  return (w as CapacitorGlobal).Capacitor?.Plugins?.MendcraftGimbal ?? null;
}

/** iPhone main camera, 1x, landscape-ish field of view (radians). */
export const DEFAULT_FOV = { h: (70 * Math.PI) / 180, v: (54 * Math.PI) / 180 };
/** Never swing further than this in one move (gentle; she may be holding it). */
export const MAX_STEP_RAD = (30 * Math.PI) / 180;
/** Inside this many radians of centre we don't move at all (no jitter). */
export const DEADBAND_RAD = (2 * Math.PI) / 180;

/**
 * Pure: how far to pan/tilt so the device's box centre lands mid-frame.
 * box is normalised 0–1 with y down; returns yaw (+ right) and pitch (+ up).
 */
export function aimAngles(box: { x: number; y: number; w: number; h: number }, fov = DEFAULT_FOV): { yaw: number; pitch: number } {
  const cx = box.x + box.w / 2 - 0.5;
  const cy = box.y + box.h / 2 - 0.5;
  const yaw = Math.atan(2 * cx * Math.tan(fov.h / 2));
  const pitch = -Math.atan(2 * cy * Math.tan(fov.v / 2));
  const clampStep = (a: number): number => (Math.abs(a) < DEADBAND_RAD ? 0 : Math.max(-MAX_STEP_RAD, Math.min(MAX_STEP_RAD, a)));
  return { yaw: clampStep(yaw), pitch: clampStep(pitch) };
}

/** Aim the gimbal at a box. False when there's no iOS shell / DockKit stand. */
export async function aimGimbalAt(box: { x: number; y: number; w: number; h: number }, w: unknown = globalThis): Promise<boolean> {
  const g = getGimbalPlugin(w);
  if (!g) return false;
  try {
    const a = await g.isAvailable();
    if (!a.available) return false;
    const { yaw, pitch } = aimAngles(box);
    if (yaw === 0 && pitch === 0) return true;
    return (await g.aim({ yaw, pitch, seconds: 1.2 })).ok;
  } catch {
    return false;
  }
}

export const jsonOrUndefined = (t: JsonTemplate | undefined): string | undefined => (t === undefined ? undefined : JSON.stringify(t));
