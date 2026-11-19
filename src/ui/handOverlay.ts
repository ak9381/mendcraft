// Canvas overlay that draws every tracked hand over the viewport: a thin,
// low-opacity skeleton with soft fingertip glows (no per-joint dots, no
// persistent pinch-point dot — see Akash's "that dot" note). Landmarks are
// smoothed with a One-Euro filter so a shaky hold doesn't jitter the line.
// Behind ?debugHands=1 (or an explicit `debug` option) every joint and the
// raw pinch point are drawn too, for diagnosing tracking quality.
import { HAND_CONNECTIONS, INDEX_TIP, THUMB_TIP, type HandFrame, type Pt } from '../input/handLogic';
import { createOneEuroFilter, type OneEuroFilter } from '../input/oneEuro';

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
}

const NUM_POINTS = 21;
const MAX_SLOTS = 2;
const MAX_DPR = 2;
const FADE_MS = 180;
const PINCH_RING_MS = 240;
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
  opacity: number;
  wasPresent: boolean;
  pinchRingAt: number;
  color: string;
  pinching: boolean;
}

function makeSlot(): SlotState {
  return {
    filters: Array.from({ length: NUM_POINTS }, () => createOneEuroFilter(HAND_FILTER_PARAMS)),
    smoothed: Array.from({ length: NUM_POINTS }, () => ({ x: 0, y: 0 })),
    opacity: 0,
    wasPresent: false,
    pinchRingAt: -Infinity,
    color: '#38bdf8',
    pinching: false,
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

  /** Smooth a hand's 21 points into `st.smoothed`, in place. */
  function smoothInto(st: SlotState, points: readonly Pt[], w: number, h: number, now: number): void {
    const n = Math.min(points.length, NUM_POINTS);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const f = st.filters[i].filter(p.x * w, p.y * h, now);
      st.smoothed[i].x = f.x;
      st.smoothed[i].y = f.y;
    }
  }

  function drawSkeleton(st: SlotState, dpr: number, now: number): void {
    const P = st.smoothed;
    ctx.globalAlpha = 0.4 * st.opacity;
    ctx.strokeStyle = st.color;
    ctx.lineWidth = 1.5 * dpr;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.moveTo(P[a].x, P[a].y);
      ctx.lineTo(P[b].x, P[b].y);
    }
    ctx.stroke();

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

    let anyVisible = false;
    for (let slot = 0; slot < MAX_SLOTS; slot++) {
      const st = slots[slot];
      const hand = hands.find((hh) => hh.slot === slot);
      const target = hand ? 1 : 0;
      if (reducedMotion) st.opacity = target;
      else st.opacity += (target - st.opacity) * Math.min(1, (1000 / FADE_MS) * (1 / 60));
      if (st.opacity < 0.01 && !hand) { st.opacity = 0; continue; }

      if (hand) {
        st.wasPresent = true;
        st.color = hand.color;
        if (hand.pinching && !st.pinching) st.pinchRingAt = now; // rising edge only
        st.pinching = hand.pinching;
        smoothInto(st, hand.points, w, h, now);
      }
      anyVisible = true;
      drawSkeleton(st, dpr, now);
      if (debug) drawDebug(st, dpr);
    }
    ctx.globalAlpha = 1;
    wasIdle = !anyVisible;
  }

  return { draw, clear };
}
