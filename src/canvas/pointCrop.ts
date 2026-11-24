// Point-to-connect geometry (pure, DOM-free). She points at a real device;
// we crop the camera frame along the pointing ray — index knuckle (MediaPipe
// landmark 5) → index fingertip (8) — so only the patch ahead of her finger
// goes to identifyDevice, not the whole room. No hand → the full frame.
//
// Landmarks are normalised 0–1 in RAW camera space (what the <video> frame
// holds). Selfie-mirrored landmarks (presence / overlay space) pass
// { mirrored: true } and are flipped back first.

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

/** Crop side as a fraction of the frame's long side (capped at the short side). */
export const POINT_CROP_FRACTION = 0.38;
/** Longest side of the JPEG that is sent to identify. */
export const POINT_CROP_MAX_PX = 512;
/** How long the palm must hold still before the frame is taken. */
export const POINT_HOLD_MS = 600;

const INDEX_MCP = 5;
const INDEX_TIP = 8;

const finite = (p: Pt | undefined): p is Pt => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** iPhone (docked, she looks into the camera and points at a lamp beside her
 *  head, ~0.5–1 m away): the crop is ~42 % of the frame WIDTH, 45 % when the
 *  5→8 ray is short (finger foreshortened toward/away from the lens, so its
 *  direction is least reliable). At 0.75 m a 70° front camera sees ~1.05 m
 *  across, so 42–45 % ≈ 44–47 cm — a lamp within ~40 cm of the face fits. */
export const PHONE_CROP_WIDTH_FRACTION = 0.42;
export const PHONE_CROP_WIDTH_FRACTION_SHORT = 0.45;
/** A 5→8 ray shorter than this (fraction of frame width) counts as short. */
export const SHORT_RAY = 0.05;

function sideFor(frameW: number, frameH: number, fraction = POINT_CROP_FRACTION): number {
  return Math.min(frameW, frameH, Math.round(fraction * Math.max(frameW, frameH)));
}

function squareAt(cx: number, cy: number, frameW: number, frameH: number, fraction?: number): Rect {
  const side = sideFor(frameW, frameH, fraction);
  const x = Math.round(Math.min(Math.max(cx - side / 2, 0), frameW - side));
  const y = Math.round(Math.min(Math.max(cy - side / 2, 0), frameH - side));
  return { x, y, w: side, h: side };
}

/** The point (normalised, raw camera space) the crop is aimed at: half a crop
 *  ahead of the fingertip along MCP → tip. Null when there is no usable hand. */
export function rayTarget(
  landmarks: readonly Pt[] | null | undefined,
  frameW: number,
  frameH: number,
  opts: { mirrored?: boolean; fraction?: number } = {},
): Pt | null {
  if (!landmarks || landmarks.length <= INDEX_TIP) return null;
  const mcp = landmarks[INDEX_MCP], tip = landmarks[INDEX_TIP];
  if (!finite(mcp) || !finite(tip) || frameW <= 0 || frameH <= 0) return null;
  const fx = (p: Pt) => (opts.mirrored ? 1 - p.x : p.x) * frameW;
  const tx = fx(tip), ty = tip.y * frameH;
  const dx = tx - fx(mcp), dy = ty - mcp.y * frameH;
  const len = Math.hypot(dx, dy);
  const side = sideFor(frameW, frameH, opts.fraction);
  const ahead = len > 1e-6 ? side / 2 : 0;
  const cx = tx + (len > 1e-6 ? (dx / len) * ahead : 0);
  const cy = ty + (len > 1e-6 ? (dy / len) * ahead : 0);
  return { x: cx / frameW, y: cy / frameH };
}

/** A square crop (~38 % of the frame) just ahead of the fingertip, clamped
 *  inside the frame. Full frame when there is no hand. Pixel units. */
export function cropAlongRay(
  landmarks: readonly Pt[] | null | undefined,
  frameW: number,
  frameH: number,
  opts: { mirrored?: boolean; fraction?: number } = {},
): Rect {
  const t = rayTarget(landmarks, frameW, frameH, opts);
  if (!t) return { x: 0, y: 0, w: frameW, h: frameH };
  return squareAt(t.x * frameW, t.y * frameH, frameW, frameH, opts.fraction);
}

/** The crop fraction (of the LONG side, as cropAlongRay takes it) that gives
 *  the iPhone's 42 % / 45 %-of-width crop for this frame and hand. */
export function phoneCropFraction(landmarks: readonly Pt[] | null | undefined, frameW: number, frameH: number): number {
  const long = Math.max(frameW, frameH) || 1;
  const mcp = landmarks?.[INDEX_MCP], tip = landmarks?.[INDEX_TIP];
  const short = !finite(mcp) || !finite(tip) || Math.hypot(tip.x - mcp.x, (tip.y - mcp.y) * (frameH / (frameW || 1))) < SHORT_RAY;
  return ((short ? PHONE_CROP_WIDTH_FRACTION_SHORT : PHONE_CROP_WIDTH_FRACTION) * frameW) / long;
}

/** True when the ray's target (fingertip + half a crop along 5→8) lies past
 *  the frame edge by more than a quarter crop: the device she points at is
 *  not in the camera's view, so we must not guess from whatever patch the
 *  clamped crop would show. (A device right at the edge still counts.) */
export function rayOutOfFrame(
  landmarks: readonly Pt[] | null | undefined,
  frameW: number,
  frameH: number,
  opts: { mirrored?: boolean; fraction?: number } = {},
): boolean {
  const t = rayTarget(landmarks, frameW, frameH, opts);
  if (!t) return true;
  const side = sideFor(frameW, frameH, opts.fraction);
  const mx = (side / 4) / frameW, my = (side / 4) / frameH;
  return t.x < -mx || t.x > 1 + mx || t.y < -my || t.y > 1 + my;
}

/** Hands off: a click picked a point (normalised, raw camera space). */
export function cropAroundPoint(pt: Pt | null | undefined, frameW: number, frameH: number): Rect {
  if (!finite(pt ?? undefined) || frameW <= 0 || frameH <= 0) return { x: 0, y: 0, w: frameW, h: frameH };
  return squareAt(pt!.x * frameW, pt!.y * frameH, frameW, frameH);
}

/** A frame point (normalised) in the crop's own 0–1 coordinates, clamped —
 *  the `pointer` hint identifyDevice gets alongside the cropped photo. */
export function pointerInCrop(pt: Pt, crop: Rect, frameW: number, frameH: number): Pt {
  const c = (n: number) => Math.min(1, Math.max(0, n));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    x: r2(c((pt.x * frameW - crop.x) / Math.max(1, crop.w))),
    y: r2(c((pt.y * frameH - crop.y) / Math.max(1, crop.h))),
  };
}

/** Downscale (never up) so the long side is ≤ max. */
export function fitWithin(w: number, h: number, max = POINT_CROP_MAX_PX): { w: number; h: number } {
  const s = Math.min(1, max / Math.max(w, h, 1));
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

/** Decoded size of a base64 payload — the bytes a photo really costs on the wire
 *  (the SDK sends them as inline data). */
export function base64ByteLength(b64: string): number {
  if (!b64) return 0;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** A point, not a fist or a flat hand curling: the index tip (8) is farther
 *  from the wrist (0) than its PIP joint (6). Only then does a hold count. */
export function isIndexExtended(lm: readonly Pt[] | null | undefined): boolean {
  if (!lm || lm.length <= INDEX_TIP) return false;
  const w = lm[0], pip = lm[6], tip = lm[INDEX_TIP];
  if (!finite(w) || !finite(pip) || !finite(tip)) return false;
  return Math.hypot(tip.x - w.x, tip.y - w.y) > Math.hypot(pip.x - w.x, pip.y - w.y);
}

export interface SteadyHold {
  /** Feed the palm (normalised) each frame; true exactly once, when it has
   *  stayed within `tolerance` of where it settled for ≥ holdMs. */
  update(palm: Pt | null, now: number): boolean;
  reset(): void;
}

export function createSteadyHold(o: { holdMs?: number; tolerance?: number } = {}): SteadyHold {
  const holdMs = o.holdMs ?? POINT_HOLD_MS;
  const tol = o.tolerance ?? 0.03;
  let anchor: Pt | null = null;
  let since = 0;
  let fired = false;
  return {
    update(palm, now) {
      if (fired) return false;
      if (!palm || !finite(palm)) { anchor = null; return false; }
      if (!anchor || Math.hypot(palm.x - anchor.x, palm.y - anchor.y) > tol) {
        anchor = { x: palm.x, y: palm.y };
        since = now;
        return false;
      }
      if (now - since >= holdMs) { fired = true; return true; }
      return false;
    },
    reset() { anchor = null; since = 0; fired = false; },
  };
}
