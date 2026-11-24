// Hand scroll + fling for scrollable containers (A2-025 / C156): a pinch-drag
// inside a scroll region scrolls it, and on release a momentum fling carries it
// on. Two pure pieces — velocity tracking at release and friction decay — so
// the physics is testable without DOM; the DOM wiring (find the scrollable
// ancestor, apply scrollTop/scrollLeft) lives in handPointer.

export interface DragVelocity {
  /** Record a drag sample (scroll-space position, timestamp ms). */
  push(x: number, y: number, now: number): void;
  /** px/ms over the recent window, the fling's launch speed. */
  velocity(now: number): { vx: number; vy: number };
  reset(): void;
}

/** Tracks the last few drag samples and reports the release velocity measured
 *  over `windowMs`, so a pause before letting go flings slowly (stale samples
 *  age out) rather than inheriting an early fast flick. */
export function createDragVelocity(opts: { windowMs?: number } = {}): DragVelocity {
  const windowMs = opts.windowMs ?? 80;
  let samples: Array<{ x: number; y: number; t: number }> = [];
  return {
    push(x, y, now) {
      samples.push({ x, y, t: now });
      const cutoff = now - windowMs;
      samples = samples.filter((s) => s.t >= cutoff);
    },
    velocity(now) {
      const cutoff = now - windowMs;
      const win = samples.filter((s) => s.t >= cutoff);
      if (win.length < 2) return { vx: 0, vy: 0 };
      const a = win[0];
      const b = win[win.length - 1];
      const dt = b.t - a.t;
      if (dt <= 0) return { vx: 0, vy: 0 };
      return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
    },
    reset() { samples = []; },
  };
}

/** Walk up from the pinch target to the nearest ancestor that can actually
 *  scroll on an axis (content overflows AND its overflow style allows it), so a
 *  pinch-drag inside a terminal/list/dock scrolls that container — not the page.
 *  Returns the element and which axes it scrolls, or null when nothing scrolls. */
export function scrollableAncestor(start: Element | null): { el: HTMLElement; x: boolean; y: boolean } | null {
  // Duck-typed on the few layout props we read, so the node-env test suite can
  // exercise it with a plain fake element (no jsdom).
  let el = start as (HTMLElement & { ownerDocument?: Document }) | null;
  const scrolls = (o: string) => o === 'auto' || o === 'scroll' || o === 'overlay';
  while (el) {
    const cs = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
    const oy = cs?.overflowY ?? 'visible';
    const ox = cs?.overflowX ?? 'visible';
    const y = el.scrollHeight - el.clientHeight > 1 && scrolls(oy);
    const x = el.scrollWidth - el.clientWidth > 1 && scrolls(ox);
    if (y || x) return { el, x, y };
    el = el.parentElement as (HTMLElement & { ownerDocument?: Document }) | null;
  }
  return null;
}

export interface Momentum {
  /** Launch a fling at vx/vy px/ms. */
  start(vx: number, vy: number): void;
  /** Advance by `dtMs`; returns the scroll delta to apply this tick (0,0 when stopped). */
  tick(dtMs: number): { dx: number; dy: number };
  readonly active: boolean;
  /** Halt immediately — a fresh pinch grabbing the list cancels the glide. */
  stop(): void;
}

/** Exponential-friction momentum: velocity multiplies by `friction` each ms, so
 *  the glide decays smoothly and stops once the speed drops under `minSpeed`. */
export function createMomentum(opts: { friction?: number; minSpeed?: number } = {}): Momentum {
  const friction = opts.friction ?? 0.94;
  const minSpeed = opts.minSpeed ?? 0.02;
  let vx = 0;
  let vy = 0;
  let active = false;
  return {
    start(x, y) { vx = x; vy = y; active = Math.hypot(x, y) >= minSpeed; },
    tick(dtMs) {
      if (!active) return { dx: 0, dy: 0 };
      const dx = vx * dtMs;
      const dy = vy * dtMs;
      const decay = Math.pow(friction, dtMs);
      vx *= decay;
      vy *= decay;
      if (Math.hypot(vx, vy) < minSpeed) active = false;
      return { dx, dy };
    },
    get active() { return active; },
    stop() { active = false; vx = 0; vy = 0; },
  };
}

/** Vertical wrist velocity must stay above PALM_INTENT_VY for this long to
 *  count as a scroll (intent by motion, not pose alone). */
export const PALM_INTENT_MS = 80;
/** Keep the old name as an alias so existing imports stay valid. */
export const PALM_HOLD_MS = PALM_INTENT_MS;
/** Disengage palm scroll after the wrist has been still this long. */
export const PALM_STILL_MS = 250;
/** Min |vy| (screen px/ms) to count as a vertical scroll intent. */
export const PALM_INTENT_VY = 0.08;
/** Ignore small wrist jitter on the palm centroid (screen px). */
export const PALM_DEADZONE_PX = 2;
/** Ignore wrist velocity under this (px/ms) — ~2 px per 50 ms. */
export const PALM_DEADZONE_VY = 0.04;
/** Small wrist motion maps to a larger scroll. */
export const PALM_GAIN = 3;
/** Critically-damped spring frequency for scroll velocity (Hz). */
export const PALM_SPRING_HZ = 7;

/** Wrist + middle-MCP centroid (the palm), in the same space as the landmarks. */
export function palmCentroid(h: readonly { x: number; y: number }[]): { x: number; y: number } {
  const w = h[0] ?? { x: 0, y: 0 };
  const m = h[9] ?? w;
  return { x: (w.x + m.x) / 2, y: (w.y + m.y) / 2 };
}

/** Nearest overflow-y auto/scroll ancestor under the cursor, else the first
 *  provided fallback that can actually scroll vertically (review / AI / term). */
export function pickPalmScroller(
  hit: Element | null,
  fallbacks: Array<Element | null | undefined> = [],
): HTMLElement | null {
  const near = scrollableAncestor(hit);
  if (near?.y) return near.el;
  for (const f of fallbacks) {
    if (!f) continue;
    const el = f as HTMLElement;
    const cs = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
    const oy = cs?.overflowY ?? (el as HTMLElement & { overflowY?: string }).overflowY ?? 'visible';
    const canY = (el.scrollHeight - el.clientHeight > 1) && (oy === 'auto' || oy === 'scroll' || oy === 'overlay');
    if (canY) return el;
  }
  return near?.el ?? null;
}

/**
 * Critically damped spring (ζ = 1) toward a target value. Used to smooth
 * palm-scroll velocity so camera-frame jitter does not jerk the list.
 * Analytic integration — no overshoot from rest, testable without DOM.
 */
export function createCriticalSpring(opts?: { freqHz?: number }): {
  tick(target: number, dtMs: number): number;
  value(): number;
  reset(): void;
} {
  const w = 2 * Math.PI * (opts?.freqHz ?? PALM_SPRING_HZ);
  let v = 0;
  let vDot = 0;
  return {
    tick(target, dtMs) {
      const dt = Math.max(0, Math.min(0.05, dtMs / 1000));
      if (dt === 0) return v;
      const e0 = v - target;
      const eDot0 = vDot;
      const A = e0;
      const B = eDot0 + w * e0;
      const exp = Math.exp(-w * dt);
      const e = (A + B * dt) * exp;
      vDot = (B - w * (A + B * dt)) * exp;
      v = target + e;
      return v;
    },
    value: () => v,
    reset() { v = 0; vDot = 0; },
  };
}

export interface PalmScroll {
  /** Camera-frame sample of the palm centroid (screen px, timestamp ms). */
  sample(y: number, t: number): void;
  /** Scroll delta (px) to apply on this animation frame. */
  tick(dtMs: number): number;
  /** Stop driving; returns the launch velocity (px/ms) for a gentle fling. */
  release(): number;
  reset(): void;
}

/** 3×-gained, deadzoned wrist motion → smoothed velocity, applied per rAF. */
export function createPalmScroll(opts?: {
  gain?: number;
  deadzonePx?: number;
  freqHz?: number;
}): PalmScroll {
  const gain = opts?.gain ?? PALM_GAIN;
  const minVy = (opts?.deadzonePx ?? PALM_DEADZONE_PX) / 50; // px/ms
  const spring = createCriticalSpring({ freqHz: opts?.freqHz ?? PALM_SPRING_HZ });
  let lastY: number | null = null;
  let lastT: number | null = null;
  let targetVy = 0;
  return {
    sample(y, t) {
      if (lastY == null || lastT == null || t <= lastT) {
        lastY = y;
        lastT = t;
        targetVy = 0;
        return;
      }
      const dy = y - lastY;
      const dt = t - lastT;
      lastY = y;
      lastT = t;
      if (dt <= 0) return;
      // Velocity deadzone so jitter is ignored, but a slow 1 px / 10 ms
      // swipe (well above 0.04 px/ms) still counts — a per-frame 4 px gate
      // was swallowing those and making scroll feel strained.
      const vyRaw = dy / dt;
      targetVy = Math.abs(vyRaw) < minVy ? 0 : vyRaw * gain;
    },
    tick(dtMs) {
      return spring.tick(targetVy, dtMs) * dtMs;
    },
    release() {
      const vy = spring.value();
      targetVy = 0;
      spring.reset();
      lastY = null;
      lastT = null;
      return vy;
    },
    reset() {
      spring.reset();
      lastY = null;
      lastT = null;
      targetVy = 0;
    },
  };
}
