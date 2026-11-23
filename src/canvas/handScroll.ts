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
