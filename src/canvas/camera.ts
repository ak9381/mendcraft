// Infinite-canvas camera. World units equal CSS pixels at z = 1, which is the
// only scale where boards are editable (Focus). Overview zooms out to view and
// fly; board contents are inert there because the plan engine hit-tests in
// unscaled screen pixels.
export interface Camera { x: number; y: number; z: number }
export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Viewport { w: number; h: number }

export const MIN_Z = 0.1;
export const MAX_Z = 2;

const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

export function worldToScreen(c: Camera, p: Pt): Pt {
  return { x: (p.x - c.x) * c.z, y: (p.y - c.y) * c.z };
}

export function screenToWorld(c: Camera, s: Pt): Pt {
  return { x: s.x / c.z + c.x, y: s.y / c.z + c.y };
}

/** Zoom by `factor` keeping the world point under screen point `s` fixed. */
export function zoomAbout(c: Camera, s: Pt, factor: number): Camera {
  const z = clampZ(c.z * factor);
  const w = screenToWorld(c, s);
  return { x: w.x - s.x / z, y: w.y - s.y / z, z };
}

/** Drag by a screen delta: the world follows the pointer. */
export function panBy(c: Camera, dx: number, dy: number): Camera {
  return { x: c.x - dx / c.z, y: c.y - dy / c.z, z: c.z };
}

/**
 * Anchored two-finger pinch: given the two pinch points where the gesture
 * grabbed (p0,q0) and where they are now (p1,q1), return the camera that zooms
 * by the span ratio and pans so the world point that was under the pinch
 * midpoint stays under the (moving) midpoint — a touch-screen pinch. No
 * rotation: the plan engine hit-tests in screen pixels and never tilts. Zoom is
 * clamped to [MIN_Z, MAX_Z]. See twoHandTransform.ts for the pure maths and
 * grace/dead-zone/smoothing that pick the p/q points fed here.
 */
export function twoHandCamera(c: Camera, p0: Pt, q0: Pt, p1: Pt, q1: Pt): Camera {
  const span0 = Math.hypot(q0.x - p0.x, q0.y - p0.y);
  const span1 = Math.hypot(q1.x - p1.x, q1.y - p1.y);
  const factor = span0 > 1e-6 ? span1 / span0 : 1;
  const z = clampZ(c.z * factor);
  const mid0 = { x: (p0.x + q0.x) / 2, y: (p0.y + q0.y) / 2 };
  const mid1 = { x: (p1.x + q1.x) / 2, y: (p1.y + q1.y) / 2 };
  const w = screenToWorld(c, mid0); // world point under the grab midpoint
  return { x: w.x - mid1.x / z, y: w.y - mid1.y / z, z };
}

/** Centre a board at exactly 1:1 on whole pixels (editing scale). */
export function focusOn(r: Rect, vp: Viewport): Camera {
  return { x: Math.round(r.x + r.w / 2 - vp.w / 2), y: Math.round(r.y + r.h / 2 - vp.h / 2), z: 1 };
}

/** Camera that shows every rect with `pad` screen pixels of margin, never above 1:1. */
export function fitRects(rects: readonly Rect[], vp: Viewport, pad = 48): Camera {
  if (!rects.length) return { x: -vp.w / 2, y: -vp.h / 2, z: 1 };
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  const bw = x1 - x0, bh = y1 - y0;
  const z = clampZ(Math.min(1, (vp.w - 2 * pad) / bw, (vp.h - 2 * pad) / bh));
  return { x: x0 + bw / 2 - vp.w / (2 * z), y: y0 + bh / 2 - vp.h / (2 * z), z };
}

/** Lowest zoom a room dashboard is shown at so every tile is on screen at
 *  once: a 56 px control is still 45 px, above the 44 px touch floor. */
export const ROOM_MIN_Z = 0.8;

/** Focus for a room dashboard: the WHOLE board in the space the chrome leaves,
 *  so every tile is visible without scrolling inside the board. 1:1 when it
 *  fits; a taller board zooms out, never below `minZ` — past that it is pinned
 *  to the top and the canvas itself scrolls (never a nested scroll).
 *  A board only a little too tall for the space between the insets (a short
 *  window, where the top inset is mostly empty gap) is instead lifted so its
 *  foot (the next-step chip row) sits on the bottom inset, never under the
 *  bottom chrome; its head may use the top gap down to `topFloor` (where the
 *  real top chrome ends). */
export function focusWholeBoard(r: Rect, vp: Viewport, insets: { top?: number; left?: number; right?: number; bottom?: number; topFloor?: number }, margin = 16, minZ = ROOM_MIN_Z): Camera {
  const top = insets.top ?? 0, left = insets.left ?? 0, right = insets.right ?? 0, bottom = insets.bottom ?? 0;
  const topFloor = Math.min(top + margin, insets.topFloor ?? top + margin);
  const availW = Math.max(1, vp.w - left - right);
  const availH = Math.max(1, vp.h - top - bottom);
  const z = Math.max(minZ, Math.min(1, (availW - 2 * margin) / r.w, (availH - 2 * margin) / r.h));
  const sw = r.w * z, sh = r.h * z;
  // Screen = (world − camera) · z. Centre when it fits, else lift it (see above) or pin it to the top-left.
  const sx = sw <= availW ? left + (availW - sw) / 2 : left + margin;
  const footUp = top + availH - sh; // foot on the bottom inset
  const sy = sh <= availH ? top + (availH - sh) / 2 : footUp >= topFloor ? footUp : top + margin;
  return { x: r.x - sx / z, y: r.y - sy / z, z };
}

export function cameraTransform(c: Camera): string {
  const n = (v: number) => String(Object.is(v, -0) ? 0 : +v.toFixed(3));
  return `translate(${n(-c.x * c.z)}px, ${n(-c.y * c.z)}px) scale(${n(c.z)})`;
}

/** Ease between cameras (t in 0..1). Zoom moves in log space and the view
 *  centre moves linearly, so a flight does not swing off to one side. */
export function lerpCamera(a: Camera, b: Camera, t: number, vp: Viewport): Camera {
  if (t <= 0) return { ...a };
  if (t >= 1) return { ...b };
  const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  const z = Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * e);
  const ca = { x: a.x + vp.w / (2 * a.z), y: a.y + vp.h / (2 * a.z) };
  const cb = { x: b.x + vp.w / (2 * b.z), y: b.y + vp.h / (2 * b.z) };
  const cx = ca.x + (cb.x - ca.x) * e, cy = ca.y + (cb.y - ca.y) * e;
  return { x: cx - vp.w / (2 * z), y: cy - vp.h / (2 * z), z };
}

/** Focus at 1:1 centred in the space below a top bar of `insetTop` px. */
export function focusOnInset(r: Rect, vp: Viewport, insetTop: number): Camera {
  const avail = Math.max(1, vp.h - insetTop);
  return { x: Math.round(r.x + r.w / 2 - vp.w / 2), y: Math.round(r.y + r.h / 2 - (insetTop + avail / 2)), z: 1 };
}

/** Focus at 1:1 centred in the space left after a top bar and a left/right dock,
 *  so a pinned-board dock never covers the focused board. A board larger than
 *  that space (a wide dashboard on a narrow phone) is pinned top-left just inside
 *  the inset with `margin` px instead of centred, so its title and first tiles
 *  are visible and the user can one-finger-pan to the rest. */
export function focusOnInsets(r: Rect, vp: Viewport, insets: { top?: number; left?: number; right?: number; bottom?: number }, margin = 16, pinLarge = true): Camera {
  const top = insets.top ?? 0, left = insets.left ?? 0, right = insets.right ?? 0, bottom = insets.bottom ?? 0;
  const availW = Math.max(1, vp.w - left - right);
  const availH = Math.max(1, vp.h - top - bottom);
  // pinLarge=false (an empty board: its call-to-action sits in the middle) keeps centring.
  const x = pinLarge && r.w > availW ? r.x - left - margin : r.x + r.w / 2 - (left + availW / 2);
  const y = pinLarge && r.h > availH ? r.y - top - margin : r.y + r.h / 2 - (top + availH / 2);
  return { x: Math.round(x), y: Math.round(y), z: 1 };
}
