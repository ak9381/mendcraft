// The DOM side of the peace-and-move gesture (peaceScroll.ts decides WHEN):
//  - over a level control (levelControl.ts) it steps the level — one step per
//    LEVEL_STEP_PX of hand travel (hysteresis, rate-limited), a big
//    "Volume 60 %" readout by the hand;
//  - else over a scrollable element (board body, review plan list, AI
//    drawer, menus) it scrolls that element in SCROLL_STYLE's direction
//    (wheel: hand down = show below), with a short glide on release;
//  - else it pans the canvas (onCanvasScroll).
// While it runs: a small "Scrolling" hint by the hand and an outline on the
// target. While Hands is on, every area that actually overflows shows a
// small yellow "✌ move to scroll" hint.

import type { Pt } from '../input/handLogic';
import { deepElementFromPoint } from './handPointer';
import { createMomentum, scrollableAncestor } from './handScroll';
import { handIconSvg } from './gestureIcons';
import type { PeaceScrollState } from './peaceScroll';
import { adjustLevel, createLevelStepper, levelControlAt, levelReadout, type LevelStepper } from './levelControl';

/** The scroll areas the "move to scroll" hint looks at (cheap: no page scan). */
export const KNOWN_SCROLLERS = [
  '.mc-frame-body', '.mc-review-plan', '.mc-ai-body', '.mc-menu-sheet', '.mc-dock',
  '.mc-teach-card', '.mc-connect-sheet', '.mc-scan-panel', '[data-scrollable]',
].join(', ');

export interface ScrollDriverOptions {
  root: HTMLElement;
  /** Nothing scrollable under the hand: pan the canvas by (dx, dy) screen px. */
  onCanvasScroll?: (dx: number, dy: number) => void;
  onCanvasScrollEnd?: () => void;
  /** A level stepped (activity line). */
  onLevel?: (el: HTMLElement, dir: 1 | -1, readout: string) => void;
  /** Areas that scroll by panning the canvas (no scroller of their own) but
   *  run past the screen: a tall focused room board. They get the hint too. */
  canvasScrollAreas?: () => HTMLElement[];
  /** Tick sound on each level step (off by default). */
  tickSound?: () => boolean;
}

export interface ScrollDriver {
  /** `blocked`: not facing / a fist grab / a point capture — stops any glide. */
  frame(s: PeaceScrollState, now: number, blocked?: boolean): void;
  setActive(on: boolean): void;
  /** Stop at once (hand lost, gestures off): no glide. */
  stop(): void;
  busy(): boolean;
  destroy(): void;
}

type Target = { kind: 'element'; el: HTMLElement; x: boolean; y: boolean }
  | { kind: 'level'; el: HTMLElement; stepper: LevelStepper }
  | { kind: 'canvas' };

const BADGE_REFRESH_MS = 1000;
const MAX_BADGES = 6;

export function createScrollDriver(opts: ScrollDriverOptions): ScrollDriver {
  const { root } = opts;
  const doc = root.ownerDocument;
  let active = false;
  let target: Target | null = null;
  const glide = createMomentum({ friction: 0.992, minSpeed: 0.02 });
  let glideRaf = 0;
  let glideTarget: Target | null = null;
  let lastDir: 'up' | 'down' = 'down';

  const layer = doc.createElement('div');
  layer.className = 'mc-scroll-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.hidden = true;
  const hint = doc.createElement('div');
  hint.className = 'mc-scroll-hint';
  hint.hidden = true;
  const readout = doc.createElement('div');
  readout.className = 'mc-level-readout';
  readout.hidden = true;
  layer.append(hint, readout);
  root.append(layer);
  const badges: HTMLElement[] = [];
  let badgeTimer: ReturnType<typeof setInterval> | null = null;

  /** dx / dy are scroll deltas (+ = show what is below / right). */
  function apply(t: Target, dx: number, dy: number): void {
    if (t.kind === 'element') {
      if (t.y && dy) t.el.scrollTop += dy;
      if (t.x && dx) t.el.scrollLeft += dx;
    } else if (t.kind === 'canvas') {
      // The canvas camera pans by CONTENT motion: showing what is below
      // moves the content up.
      if (dx || dy) opts.onCanvasScroll?.(-dx, -dy);
    }
  }

  function resolve(p: Pt, from?: Pt | null): Target {
    const hit = deepElementFromPoint(doc, p.x, p.y);
    // A level control under the hand now, or where the peace was first held
    // (a tile's volume control is smaller than the start move).
    const level = levelControlAt(hit) ?? (from ? levelControlAt(deepElementFromPoint(doc, from.x, from.y)) : null);
    if (level) return { kind: 'level', el: level, stepper: createLevelStepper() };
    const sc = hit ? scrollableAncestor(hit) : null;
    if (sc && sc.el !== doc.documentElement && sc.el !== doc.body) return { kind: 'element', el: sc.el, x: sc.x, y: sc.y };
    return { kind: 'canvas' };
  }

  function outline(t: Target | null, on: boolean): void {
    if (t && t.kind !== 'canvas') t.el.classList.toggle(t.kind === 'level' ? 'mc-level-target' : 'mc-scroll-target', on);
  }

  function stopGlide(): void {
    if (glideRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(glideRaf);
    glideRaf = 0;
    glide.stop();
    if (glideTarget?.kind === 'canvas') opts.onCanvasScrollEnd?.();
    glideTarget = null;
  }
  function startGlide(t: Target, vx: number, vy: number): void {
    stopGlide();
    if (t.kind === 'level' || typeof requestAnimationFrame !== 'function') { if (t.kind === 'canvas') opts.onCanvasScrollEnd?.(); return; }
    glide.start(t.kind === 'element' && !t.x ? 0 : vx, t.kind === 'element' && !t.y ? 0 : vy);
    if (!glide.active) { if (t.kind === 'canvas') opts.onCanvasScrollEnd?.(); return; }
    glideTarget = t;
    let last = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const step = (ts?: number) => {
      const now = typeof ts === 'number' ? ts : Date.now();
      const dt = Math.min(48, Math.max(0, now - last)); last = now;
      const d = glide.tick(dt);
      apply(t, d.dx, d.dy);
      if (glide.active) glideRaf = requestAnimationFrame(step);
      else { glideRaf = 0; if (t.kind === 'canvas') opts.onCanvasScrollEnd?.(); glideTarget = null; }
    };
    glideRaf = requestAnimationFrame(step);
  }

  function tick(): void {
    if (!opts.tickSound?.()) return;
    try {
      const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.04;
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.03);
      setTimeout(() => { void ctx.close(); }, 120);
    } catch { /* no audio */ }
  }

  function showHint(p: Pt | null, text: string | null, t: Target | null): void {
    layer.hidden = !active;
    if (!p || !text) { hint.hidden = true; readout.hidden = true; return; }
    if (t?.kind === 'level') {
      hint.hidden = true;
      readout.hidden = false;
      readout.textContent = text;
      readout.style.transform = `translate(${Math.round(p.x + 28)}px, ${Math.round(p.y - 70)}px)`;
    } else {
      readout.hidden = true;
      hint.hidden = false;
      if (hint.dataset.text !== text) { hint.dataset.text = text; hint.innerHTML = `${handIconSvg('peace')}<span></span>`; hint.querySelector('span')!.textContent = text; }
      hint.style.transform = `translate(${Math.round(p.x + 24)}px, ${Math.round(p.y + 20)}px)`;
    }
  }

  function frame(s: PeaceScrollState, now: number, blocked = false): void {
    if (!active) return;
    if (blocked && glideRaf) stopGlide();
    if (s.started && s.point) {
      stopGlide();
      target = resolve(s.point, s.from);
      outline(target, true);
    }
    if (s.phase === 'scrolling' && target && s.point) {
      if (target.kind === 'level') {
        // Smoothed travel since the scroll started (the start travel is not
        // counted), hysteresis, ≤ 1 step / 150 ms: a wobble is never a burst
        // of lamp commands.
        const dir = target.stepper.update(-s.travel.y, now);
        if (dir && adjustLevel(target.el, dir)) {
          tick();
          try { (navigator as Navigator & { vibrate?: (ms: number) => boolean }).vibrate?.(8); } catch { /* no haptics */ }
          readout.classList.remove('is-pulse');
          void readout.offsetWidth;
          readout.classList.add('is-pulse');
          opts.onLevel?.(target.el, dir, levelReadout(target.el));
        }
        showHint(s.point, levelReadout(target.el), target);
      } else {
        apply(target, s.dx, s.dy);
        if (s.dy) lastDir = s.dy > 0 ? 'down' : 'up';
        showHint(s.point, `Scrolling ${lastDir}`, target);
      }
      return;
    }
    if (s.ended && target) {
      outline(target, false);
      if (s.ended === 'release') startGlide(target, s.vx, s.vy);
      else if (target.kind === 'canvas') opts.onCanvasScrollEnd?.();
      target = null;
    }
    showHint(null, null, null);
  }

  // ---- "✌ move to scroll" on areas that really overflow (Hands on only)
  function overflowing(): HTMLElement[] {
    const out: HTMLElement[] = [];
    const view = doc.defaultView;
    const scrolls = (o?: string) => o === 'auto' || o === 'scroll' || o === 'overlay';
    for (const el of opts.canvasScrollAreas?.() ?? []) if (out.length < MAX_BADGES && !el.closest('[hidden]')) out.push(el);
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(KNOWN_SCROLLERS))) {
      if (out.length >= MAX_BADGES) break;
      if (el.closest('[hidden]')) continue;
      const canY = el.scrollHeight - el.clientHeight > 4, canX = el.scrollWidth - el.clientWidth > 4;
      if (!canY && !canX) continue;
      const cs = view?.getComputedStyle(el);
      if (!(canY && scrolls(cs?.overflowY)) && !(canX && scrolls(cs?.overflowX))) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 120 || r.height < 60 || r.bottom <= 0 || r.top >= innerHeight) continue;
      out.push(el);
    }
    return out;
  }
  function placeBadges(): void {
    if (!active) return;
    const els = overflowing();
    while (badges.length < els.length) {
      const b = doc.createElement('div');
      b.className = 'mc-scroll-badge';
      b.innerHTML = `${handIconSvg('peace')}<span>move down to scroll</span>`;
      layer.append(b);
      badges.push(b);
    }
    badges.forEach((b, i) => {
      const el = els[i];
      if (!el || (target && target.kind !== 'canvas' && el === target.el)) { b.hidden = true; return; }
      const r = el.getBoundingClientRect();
      b.hidden = false;
      b.style.transform = `translate(${Math.round(r.right - 8)}px, ${Math.round(Math.max(r.top, 0) + 8)}px)`;
    });
    layer.hidden = false;
  }

  function stop(): void {
    stopGlide();
    outline(target, false);
    if (target?.kind === 'canvas') opts.onCanvasScrollEnd?.();
    target = null;
    showHint(null, null, null);
  }

  function setActive(on: boolean): void {
      if (on === active) return;
      active = on;
      layer.hidden = !on;
      if (on) { placeBadges(); badgeTimer = setInterval(placeBadges, BADGE_REFRESH_MS); }
      else {
        if (badgeTimer) clearInterval(badgeTimer);
        badgeTimer = null;
        stop();
        for (const b of badges) b.hidden = true;
      }
  }

  return {
    frame,
    setActive,
    stop,
    busy: () => !!target,
    destroy() { setActive(false); layer.remove(); },
  };
}
