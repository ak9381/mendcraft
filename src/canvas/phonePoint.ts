// iPhone sensing across the relay (pure): what the iPhone tells the laptop
// about its gimbal / sensing / hand control (riding its 'announce'), the row
// sub-state the laptop shows for it, and the 'pointResult' the iPhone sends
// back after taking a point-to-connect photo with its own camera. The photo
// never rides the relay — only the identity (or why there is none).

import { DEVICE_KINDS, type DeviceIdentity } from '../devices/identify';

/** none = no stand docked / no plugin; ready = docked, not following;
 *  tracking = docked AND the plugin read back DockKit system tracking ON
 *  (the only state that may claim the stand follows); hands = docked and our
 *  own aim follows her hands from live sensing frames. */
export type GimbalState = 'none' | 'ready' | 'tracking' | 'hands';

export interface PhoneSenseStatus {
  gimbal: GimbalState;
  /** The hand-sensing layer is really running (camera live). */
  sensor: boolean;
  /** The facing-gated hand CONTROL layer (Hands pill) is on. */
  hands: boolean;
  /** This phone can take the point photo: sensing exists and its camera is
   *  not in error (denied, lost). */
  canPoint: boolean;
  /** Diagnostics (iPhone with a docked stand): DockKit system tracking as the
   *  plugin read it back, and whether our aim is following a hand right now. */
  systemTracking?: boolean;
  aimingAtHands?: boolean;
}

export const NO_GIMBAL_ROW = 'No gimbal — pointing uses the laptop camera';
export const NO_GIMBAL_CAN_POINT_ROW = 'No gimbal — the iPhone camera can still point';
export const CAMERA_UNAVAILABLE_ROW = 'iPhone camera unavailable — pointing uses the laptop camera';
export const GIMBAL_READY_ROW = 'Gimbal tracking ready';
/** Docked and DockKit system tracking confirmed on by the plugin. */
export const TRACKING_ROW = 'Tracking you';
export const FOLLOWING_HANDS_ROW = 'Following your hands';
/** Sensing only: the iPhone camera sees her; the stand is not claimed. */
export const CAMERA_TRACKING_ROW = 'Camera tracking you';
export const HANDS_ON_ROW = 'Hands: on';
export const DIAG_TRACKING_ON = 'DockKit tracking: on';
export const DIAG_TRACKING_OFF = 'DockKit tracking: off';
export const DIAG_AIMING_YES = 'aiming at hands: yes';
export const DIAG_AIMING_NO = 'aiming at hands: no';
export const POINT_OUT_OF_FRAME = 'I can’t see what you’re pointing at — move the device into the camera’s view.';
export const PHONE_POINT_LINE = 'Point at it and hold still — the iPhone camera takes one photo.';
export const PHONE_POINT_FALLBACK = 'The iPhone camera isn’t available for this — using the laptop camera.';

/** Coerce the sensing fields of an untrusted announce body. Null when absent
 *  (an older phone build, or Android). */
export function coerceSenseStatus(o: unknown): PhoneSenseStatus | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const g = r.gimbal;
  if (g !== 'none' && g !== 'ready' && g !== 'tracking' && g !== 'hands') return null;
  const out: PhoneSenseStatus = { gimbal: g, sensor: r.sensor === true, hands: r.hands === true, canPoint: r.canPoint === true };
  if (typeof r.systemTracking === 'boolean') out.systemTracking = r.systemTracking;
  if (typeof r.aimingAtHands === 'boolean') out.aimingAtHands = r.aimingAtHands;
  return out;
}

/** The connect-devices row sub-state for one phone ('' = nothing to add). */
export function phoneSubState(s: PhoneSenseStatus | null | undefined, opts: { sim?: boolean; ios?: boolean } = {}): string {
  const sim = opts.sim ? 'SIM · ' : '';
  if (opts.sim && opts.ios) return `${sim}${GIMBAL_READY_ROW}`;
  if (!s) return opts.ios ? NO_GIMBAL_ROW : '';
  const parts: string[] = [];
  if (s.gimbal === 'tracking') parts.push(TRACKING_ROW);
  else if (s.gimbal === 'hands' && s.sensor) parts.push(FOLLOWING_HANDS_ROW);
  else if (s.sensor) parts.push(CAMERA_TRACKING_ROW);
  else if (s.gimbal === 'ready' || s.gimbal === 'hands') parts.push(GIMBAL_READY_ROW);
  else if (opts.ios) parts.push(s.canPoint ? NO_GIMBAL_CAN_POINT_ROW : NO_GIMBAL_ROW);
  if (s.gimbal !== 'none' && !s.canPoint && opts.ios) parts.push(CAMERA_UNAVAILABLE_ROW);
  if (s.hands) parts.push(HANDS_ON_ROW);
  // Live-test diagnostics: what the iPhone really reads back.
  if (s.gimbal !== 'none' && typeof s.systemTracking === 'boolean') parts.push(s.systemTracking ? DIAG_TRACKING_ON : DIAG_TRACKING_OFF);
  if (s.gimbal !== 'none' && typeof s.aimingAtHands === 'boolean') parts.push(s.aimingAtHands ? DIAG_AIMING_YES : DIAG_AIMING_NO);
  return parts.length ? sim + parts.join(' · ') : '';
}

export type PhonePointResult =
  | { ok: true; identity: DeviceIdentity; source: string; ms?: number; cropBytes: number; cloudSends: number }
  | { ok: false; reason: 'out-of-frame' | 'no-frame' | 'no-camera' | 'unidentified' | 'timeout'; message: string };


export function encodePointResult(r: PhonePointResult): string {
  return JSON.stringify(r);
}

/** Coerce a 'pointResult' from the wire (untrusted). */
export function coercePointResult(text: string): PhonePointResult | null {
  let o: unknown;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  if (r.ok === false) {
    const reason = r.reason;
    if (reason !== 'out-of-frame' && reason !== 'no-frame' && reason !== 'no-camera' && reason !== 'unidentified' && reason !== 'timeout') return null;
    return { ok: false, reason, message: typeof r.message === 'string' ? r.message.slice(0, 200) : '' };
  }
  if (r.ok !== true) return null;
  const id = r.identity as Record<string, unknown> | undefined;
  if (!id || typeof id.label !== 'string' || typeof id.kind !== 'string' || !(DEVICE_KINDS as readonly string[]).includes(id.kind)) return null;
  const confidence = typeof id.confidence === 'number' && Number.isFinite(id.confidence) ? Math.max(0, Math.min(1, id.confidence)) : 0;
  const box = id.box as Record<string, unknown> | undefined;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const identity: DeviceIdentity = {
    kind: id.kind,
    brand: typeof id.brand === 'string' ? id.brand.slice(0, 60) : '',
    model: typeof id.model === 'string' ? id.model.slice(0, 60) : '',
    label: id.label.slice(0, 80),
    confidence,
    ...(box && num(box.x) && num(box.y) && num(box.w) && num(box.h) ? { box: { x: box.x, y: box.y, w: box.w, h: box.h } } : {}),
  };
  return {
    ok: true,
    identity,
    source: r.source === 'cloud' ? 'cloud' : 'on-device',
    ms: typeof r.ms === 'number' && Number.isFinite(r.ms) ? Math.max(0, Math.round(r.ms)) : undefined,
    cropBytes: typeof r.cropBytes === 'number' && Number.isFinite(r.cropBytes) ? Math.max(0, Math.round(r.cropBytes)) : 0,
    cloudSends: typeof r.cloudSends === 'number' && Number.isFinite(r.cloudSends) ? Math.max(0, Math.round(r.cloudSends)) : 0,
  };
}
