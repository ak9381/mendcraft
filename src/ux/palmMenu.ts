// Six fixed slices around an open palm. Direction picks, not position.

export const PALM_HOLD_MS = 800;
export const PALM_HOME_RADIUS = 0.08; // fraction of the shorter screen side

export type PalmSliceId =
  | 'review'
  | 'view'
  | 'devices'
  | 'site'
  | 'settings'
  | 'here';

export interface PalmSlice {
  id: PalmSliceId;
  /** Clock degrees: 0 = up, clockwise. */
  centerDeg: number;
  label: string;
  spoken: string[];
}

export const PALM_SLICES: readonly PalmSlice[] = [
  { id: 'review', centerDeg: 0, label: 'Review & History', spoken: ['review', 'history', 'review and history', 'go to history'] },
  { id: 'view', centerDeg: 60, label: 'Plan / Walk', spoken: ['plan or walk', 'go to the plan', 'go to walk', 'switch to walk'] },
  { id: 'devices', centerDeg: 120, label: 'Devices', spoken: ['go to devices', 'open devices'] },
  { id: 'site', centerDeg: 180, label: 'Site visit', spoken: ['site visit', 'site', 'go to site'] },
  { id: 'settings', centerDeg: 240, label: 'Settings', spoken: ['go to settings', 'open settings'] },
  { id: 'here', centerDeg: 300, label: 'What can I do', spoken: ['what can i do', 'what can i do here', 'help', 'here'] },
] as const;

export type PalmPick = { kind: 'slice'; slice: PalmSlice } | { kind: 'studio' };

/** Angle in degrees, 0 = up (negative screen Y), clockwise, 0..360. */
export function directionDeg(dx: number, dy: number): number {
  const rad = Math.atan2(dx, -dy);
  const deg = rad * (180 / Math.PI);
  return (deg + 360) % 360;
}

function angleDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function sliceForAngle(deg: number): PalmSlice {
  let best = PALM_SLICES[0];
  let bestD = angleDelta(deg, best.centerDeg);
  for (const s of PALM_SLICES) {
    const d = angleDelta(deg, s.centerDeg);
    if (d < bestD) { best = s; bestD = d; }
  }
  return best;
}

/**
 * Pick a slice from a glide starting at the palm, in screen pixels.
 * A short glide (or a pinch without moving) returns to Studio.
 */
export function pickPalmSlice(dx: number, dy: number, shortSidePx: number): PalmPick {
  const dist = Math.hypot(dx, dy);
  const threshold = Math.max(16, PALM_HOME_RADIUS * shortSidePx);
  if (dist < threshold) return { kind: 'studio' };
  return { kind: 'slice', slice: sliceForAngle(directionDeg(dx, dy)) };
}

export function sliceFromSpeech(utterance: string): PalmSlice | null {
  const t = utterance.trim().toLowerCase().replace(/[?.!]+$/g, '');
  for (const s of PALM_SLICES) {
    if (s.spoken.some((p) => t === p || t.endsWith(p))) return s;
  }
  return null;
}
