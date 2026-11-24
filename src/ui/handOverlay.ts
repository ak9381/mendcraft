// Canvas overlay that draws every tracked hand over the viewport: a BOLD,
// high-contrast skeleton (dark halo + bright stroke + joints) so it reads
// on light paper and dark chrome. No persistent pinch-point dot — see
// Akash's "that dot" note. Landmarks are
// smoothed with a One-Euro filter so a shaky hold doesn't jitter the line.
// Behind ?debugHands=1 (or an explicit `debug` option) every joint and the
// raw pinch point are drawn too, for diagnosing tracking quality.
import { HAND_CONNECTIONS, INDEX_TIP, THUMB_TIP, type HandFrame, type Pt } from '../input/handLogic';
import { createOneEuroFilter, type OneEuroFilter } from '../input/oneEuro';
import { mapToScreen, REACH, SCREEN_MARGIN_PX } from '../canvas/handPointer';
import { isHandClipped } from '../canvas/handEdge';
export { isHandClipped, CAMERA_EDGE_EPS } from '../canvas/handEdge';
import { buildLowpolyHand, createLowpolyMesh, drawLowpolyHand, LOWPOLY_FILL_ALPHA, type LowpolyMesh } from './handLowpoly';

export interface HandOverlay {
  draw(hands: HandFrame[], now?: number): void;
  clear(): void;
}

export interface HandOverlayOptions {
  /** Show every landmark + the raw pinch point. Defaults to the
   *  `?debugHands=1` query flag so the clean view ships by default. */
  debug?: boolean;
  /** Skip fades (instant show/hide) per prefers-reduced-motion. Defaults to
   *  that media query. */
  reducedMotion?: boolean;
  /** Draw the low-poly glass hand mesh (src/ui/handLowpoly.ts) instead of the
   *  bold skeleton. Defaults to true — the skeleton only shows when this is
   *  explicitly `false` or the `?skeletonHands=1` query flag is set. */
  lowpoly?: boolean;
}

const NUM_POINTS = 21;
const MAX_SLOTS = 2;
const MAX_DPR = 2;
const FADE_MS = 180;
const PINCH_RING_MS = 240;
/** Cap the on-screen hand mesh so a hand close to the camera can't cover the UI.
 *  The index tip (landmark 8) stays put so it still lines up with the cursor. */
export const MAX_HAND_HEIGHT_PX = 220;
/** Fill opacity when the mesh sits over a UI target (tools bar, cluster, drawer). */
export const NEAR_UI_ALPHA = 0.35;
const UI_PAD_PX = 16;
const UI_SELECTORS = ['.mc-bar', '.mc-hand-cluster', '.mc-ai', '.mc-review-dialog'];
/** Smoothing tuned for a hand-sized, fast-moving signal (lower minCutoff than
 *  the cursor's pointer filter — hands are naturally jumpier than an aimed tip). */
const HAND_FILTER_PARAMS = { minCutoff: 1.4, beta: 6, dCutoff: 1 };

function readDebugFlag(): boolean {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).get('debugHands') === '1';
  } catch {
    return false;
  }
}

/** Opt BACK into the bold skeleton (low-poly is the default overlay now). */
function readSkeletonFlag(): boolean {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).get('skeletonHands') === '1';
  } catch {
    return false;
  }
}


/** Scale a 21-landmark screen-space hand around the index tip so its
 *  bounding-box height does not exceed `maxH`. Mutates `pts` in place.
 *  The tip (landmark 8, or `tipIndex`) is unchanged. */

/** Offsets of every landmark from the index tip (screen or camera px). */
export function shapeRelativeToTip<T extends { x: number; y: number }>(
  pts: readonly T[],
  tipIndex = INDEX_TIP,
): { x: number; y: number }[] {
  const tip = pts[tipIndex] ?? { x: 0, y: 0 };
  return pts.map((p) => ({ x: p.x - tip.x, y: p.y - tip.y }));
}

/** Place a previously captured shape so its tip sits at `tip`. Mutates `out`. */
export function placeShapeAtTip(
  shape: readonly { x: number; y: number }[],
  tip: { x: number; y: number },
  out: { x: number; y: number }[],
): void {
  const n = Math.min(shape.length, out.length);
  for (let i = 0; i < n; i++) {
    out[i]!.x = tip.x + shape[i]!.x;
    out[i]!.y = tip.y + shape[i]!.y;
  }
}

export function capHandAroundTip<T extends { x: number; y: number }>(
  pts: T[],
  maxH = MAX_HAND_HEIGHT_PX,
  tipIndex = INDEX_TIP,
): void {
  if (pts.length <= tipIndex) return;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const h = maxY - minY;
  if (!(h > maxH)) return;
  const s = maxH / h;
  const tip = pts[tipIndex];
  for (const p of pts) {
    p.x = tip.x + (p.x - tip.x) * s;
    p.y = tip.y + (p.y - tip.y) * s;
  }
}

function handBBox(pts: readonly { x: number; y: number }[]): { left: number; top: number; right: number; bottom: number } | null {
  if (!pts.length) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of pts) {
    if (p.x < left) left = p.x;
    if (p.y < top) top = p.y;
    if (p.x > right) right = p.x;
    if (p.y > bottom) bottom = p.y;
  }
  return { left, top, right, bottom };
}

function rectsOverlap(a: { left: number; top: number; right: number; bottom: number }, b: DOMRect, pad = UI_PAD_PX): boolean {
  return a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
}

function meshNearUi(container: HTMLElement, pts: readonly { x: number; y: number }[]): boolean {
  const box = handBBox(pts);
  if (!box) return false;
  const root = container.closest?.('.mc-canvas') ?? container.ownerDocument ?? document;
  for (const sel of UI_SELECTORS) {
    const el = (root as ParentNode).querySelector?.(sel) as HTMLElement | null;
    if (!el || el.hidden || el.getAttribute?.('hidden') != null) continue;
    const r = el.getBoundingClientRect?.();
    if (r && r.width > 0 && r.height > 0 && rectsOverlap(box, r)) return true;
  }
  return false;
}

function readReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

interface SlotState {
  /** One One-Euro filter per landmark (x,y filtered together). */
  filters: OneEuroFilter[];
  /** Preallocated smoothed-point scratch buffer — mutated in place every
   *  frame so draw() never allocates (fixes S1: handOverlay.ts used to
   *  `points.map(...)` a fresh array every frame). */
  smoothed: Pt[];
  /** Display copy of smoothed, scale-capped around the index tip. */
  drawn: Pt[];
  opacity: number;
  wasPresent: boolean;
  pinchRingAt: number;
  color: string;
  pinching: boolean;
  /** Reused low-poly mesh — rebuilt from `smoothed` in place, never reallocated. */
  lowpolyMesh: LowpolyMesh;
  /** Last unclipped mesh, as offsets from the index tip (screen px). */
  frozenShape: { x: number; y: number }[] | null;
}

function makeSlot(): SlotState {
  return {
    filters: Array.from({ length: NUM_POINTS }, () => createOneEuroFilter(HAND_FILTER_PARAMS)),
    smoothed: Array.from({ length: NUM_POINTS }, () => ({ x: 0, y: 0 })),
    drawn: Array.from({ length: NUM_POINTS }, () => ({ x: 0, y: 0 })),
    opacity: 0,
    wasPresent: false,
    pinchRingAt: -Infinity,
    color: '#38bdf8',
    pinching: false,
    lowpolyMesh: createLowpolyMesh(),
    frozenShape: null,
  };
}

export function createHandOverlay(container: HTMLElement, opts: HandOverlayOptions = {}): HandOverlay {
  const canvas = document.createElement('canvas');
  canvas.className = 'hand-overlay';
  canvas.setAttribute('aria-hidden', 'true');
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const debug = opts.debug ?? readDebugFlag();
  const reducedMotion = opts.reducedMotion ?? readReducedMotion();
  const lowpoly = opts.lowpoly ?? !readSkeletonFlag();

  const slots: SlotState[] = Array.from({ length: MAX_SLOTS }, makeSlot);
  let wasIdle = true;

  function fit(): { w: number; h: number; dpr: number } {
    const rect = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w, h, dpr };
  }

  function clear(): void {
    const { w, h } = fit();
    ctx.clearRect(0, 0, w, h);
    wasIdle = true;
    for (const st of slots) { st.opacity = 0; st.wasPresent = false; }
  }

  /** Smooth a hand's 21 points into `st.smoothed`, in place. Each point is
   *  mapped with the SAME reach-box mapping (mapToScreen) the cursor uses —
   *  not a plain `p.x * w` — so the drawn hand and the coral cursor land on
   *  the same screen point. `points` are already selfie-mirrored (presence
   *  mirrors them), so mirror=false here. */
  function smoothInto(st: SlotState, points: readonly Pt[], w: number, h: number, now: number, marginPx: number): void {
    const n = Math.min(points.length, NUM_POINTS);
    for (let i = 0; i < n; i++) {
      const mapped = mapToScreen(points[i], w, h, false, REACH, marginPx);
      const f = st.filters[i].filter(mapped.x, mapped.y, now);
      st.smoothed[i].x = f.x;
      st.smoothed[i].y = f.y;
    }
  }

  function drawSkeleton(st: SlotState, dpr: number, now: number): void {
    const P = st.smoothed;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.95 * st.opacity;
    // Dark halo so the bones stay visible on light paper AND dark chrome.
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.moveTo(P[a].x, P[a].y);
      ctx.lineTo(P[b].x, P[b].y);
    }
    ctx.strokeStyle = 'rgba(11, 15, 20, 0.9)';
    ctx.lineWidth = 9 * dpr;
    ctx.stroke();
    ctx.strokeStyle = st.color;
    ctx.lineWidth = 5 * dpr;
    ctx.stroke();
    // Joints: a dark ring and a bright fill, same high-contrast recipe.
    for (const p of P) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5.5 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(11, 15, 20, 0.9)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.6 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = st.color;
      ctx.fill();
    }

    // Contact ring: appears once, right at the pinch, then shrinks and fades
    // over PINCH_RING_MS — never a persisting dot, even through a long hold.
    const t = now - st.pinchRingAt;
    if (t >= 0 && t <= PINCH_RING_MS) {
      const k = reducedMotion ? 0 : t / PINCH_RING_MS;
      const mx = (P[THUMB_TIP].x + P[INDEX_TIP].x) / 2;
      const my = (P[THUMB_TIP].y + P[INDEX_TIP].y) / 2;
      ctx.globalAlpha = (1 - k) * st.opacity;
      ctx.beginPath();
      ctx.arc(mx, my, (18 - 8 * k) * dpr, 0, Math.PI * 2);
      ctx.strokeStyle = st.color;
      ctx.lineWidth = 2.5 * dpr;
      ctx.stroke();
    }
  }

  function drawDebug(st: SlotState, dpr: number): void {
    const P = st.smoothed;
    ctx.globalAlpha = st.opacity;
    ctx.fillStyle = st.color;
    for (const p of P) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 2.5 * dpr;
    ctx.strokeStyle = '#ffffff';
    for (const i of [THUMB_TIP, INDEX_TIP]) {
      ctx.beginPath();
      ctx.arc(P[i].x, P[i].y, 8 * dpr, 0, Math.PI * 2);
      ctx.stroke();
    }
    const mx = (P[THUMB_TIP].x + P[INDEX_TIP].x) / 2;
    const my = (P[THUMB_TIP].y + P[INDEX_TIP].y) / 2;
    ctx.beginPath();
    ctx.arc(mx, my, (st.pinching ? 14 : 10) * dpr, 0, Math.PI * 2);
    ctx.strokeStyle = st.color;
    ctx.lineWidth = 4 * dpr;
    ctx.stroke();
  }

  function draw(hands: HandFrame[], now = performance.now()): void {
    if (hands.length === 0 && wasIdle) return; // already blank — nothing to do

    const { w, h, dpr } = fit();
    ctx.clearRect(0, 0, w, h);
    const marginPx = SCREEN_MARGIN_PX * dpr;
    ctx.save();
    ctx.beginPath();
    ctx.rect(marginPx, marginPx, Math.max(0, w - 2 * marginPx), Math.max(0, h - 2 * marginPx));
    ctx.clip();

    let anyVisible = false;
    for (let slot = 0; slot < MAX_SLOTS; slot++) {
      const st = slots[slot];
      const hand = hands.find((hh) => hh.slot === slot);
      const target = hand ? 1 : 0;
      if (reducedMotion) st.opacity = target;
      else st.opacity += (target - st.opacity) * Math.min(1, (1000 / FADE_MS) * (1 / 60));
      if (st.opacity < 0.01 && !hand) { st.opacity = 0; st.frozenShape = null; continue; }

      if (hand) {
        st.wasPresent = true;
        st.color = hand.color;
        if (hand.pinching && !st.pinching) st.pinchRingAt = now; // rising edge only
        st.pinching = hand.pinching;
        const clipped = isHandClipped(hand.points);
        if (clipped && st.frozenShape) {
          // Keep the last good shape; only the tip (cursor) keeps moving.
          const mapped = mapToScreen(hand.points[INDEX_TIP] ?? { x: 0.5, y: 0.5 }, w, h, false, REACH, marginPx);
          const f = st.filters[INDEX_TIP]!.filter(mapped.x, mapped.y, now);
          placeShapeAtTip(st.frozenShape, f, st.smoothed);
        } else {
          smoothInto(st, hand.points, w, h, now, marginPx);
          if (!clipped) st.frozenShape = shapeRelativeToTip(st.smoothed);
        }
      }
      anyVisible = true;
      for (let i = 0; i < NUM_POINTS; i++) {
        st.drawn[i].x = st.smoothed[i].x;
        st.drawn[i].y = st.smoothed[i].y;
      }
      capHandAroundTip(st.drawn);
      const nearUi = meshNearUi(container, st.drawn);
      const alpha = nearUi ? Math.min(st.opacity, NEAR_UI_ALPHA / LOWPOLY_FILL_ALPHA) : st.opacity;
      if (lowpoly) {
        buildLowpolyHand(st.drawn, st.lowpolyMesh);
        drawLowpolyHand(ctx, st.lowpolyMesh, { alpha });
      } else {
        // Skeleton uses st.smoothed — swap in drawn for the same cap.
        const saved = st.smoothed;
        st.smoothed = st.drawn;
        const prev = ctx.globalAlpha;
        drawSkeleton(st, dpr, now);
        st.smoothed = saved;
        void prev;
      }
      if (debug) drawDebug(st, dpr);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    wasIdle = !anyVisible;
  }

  return { draw, clear };
}
