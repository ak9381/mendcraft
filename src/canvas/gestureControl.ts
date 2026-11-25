// BUTTON GESTURES on screen: hand frames → shape classifier → 2 s hold engine →
// the bound button (gestureBindings) lights up while the hold runs and is
// pressed (a real click, the same path as the mouse) when it completes.
// Also draws the yellow hand badges on the bound buttons while Hands is on.
//
// Laptop canvas and phone shells both use this; each passes its own binding
// table. Nothing here acts on its own: every press is `el.click()` on a real
// button, or a line for the app's run() router where no button exists.

import type { Pt } from '../input/handLogic';
import { classifyHandShape, type HandShape } from './handShape';
import { createHoldEngine, type FixedShape, type GestureHand, type GestureKey, type HoldState } from './gestureHold';
import {
  CLOSER_SELECTORS, gestureName, resolveGesture,
  type GestureAction, type GestureBinding, type GestureEnv,
} from './gestureBindings';
import { handIconSvg, sideMark } from './gestureIcons';
import { handScale, palmCenter } from './handFeel';

export interface GestureFrameContext {
  /** The hand gate: false = not facing (no gestures), null = unknown (allowed). */
  facing: boolean | null;
  /** Operator face centre x in the same (selfie) space as the hands. */
  faceX?: number | null;
  /** A fist grab / pan / zoom is running, or the hands are locked. */
  blocked?: boolean;
  cameraAspect?: number;
}

/** The open-palm highlight (palmHighlight.ts) as the controller sees it. */
export interface HighlightHook {
  /** Feed the open palm (selfie-space landmarks) or null (no open palm this frame). */
  update(openPalm: readonly Pt[] | null, now: number, ctx: { blocked: boolean; anyHand: boolean }): void;
  current(): HTMLElement | null;
  lost(): void;
  setActive(on: boolean): void;
  destroy(): void;
}

export interface GestureControlOptions {
  root: HTMLElement;
  bindings: readonly GestureBinding[];
  /** The app's command router, for bindings with no button. */
  run?: (text: string) => void;
  /** A status line ("Nothing open to close."). */
  say?: (text: string) => void;
  /** Activity line after a gesture pressed something. */
  onFire?: (ev: { key: GestureKey; name: string; label: string; target: string | null }) => void;
  highlight?: HighlightHook | null;
}

export interface GestureControl {
  /** Selfie-space hands (each array may carry MediaPipe's `.label`). */
  frame(hands: readonly (readonly Pt[])[], now: number, ctx: GestureFrameContext): HoldState;
  setActive(on: boolean): void;
  isActive(): boolean;
  /** Re-place the badges now (layout changed). */
  refresh(): void;
  /** Hands gone (camera stop): cancel any hold, clear the light-up. */
  lost(): void;
  readonly env: GestureEnv;
  /** The last shapes read (debug / tests). */
  lastShapes(): { shape: HandShape; hand: 'L' | 'R' }[];
  destroy(): void;
}

const PRESSED_MS = 220;
const BADGE_REFRESH_MS = 300;

function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected || el.closest('[hidden]')) return false;
  const c = (el as HTMLElement & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (typeof c === 'function' && !c.call(el, { visibilityProperty: true })) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const w = typeof innerWidth === 'number' ? innerWidth : Infinity;
  const h = typeof innerHeight === 'number' ? innerHeight : Infinity;
  return r.right > 0 && r.bottom > 0 && r.left < w && r.top < h;
}
const isEnabled = (el: HTMLElement) => !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true';

export function createDomGestureEnv(root: HTMLElement, highlight: () => HTMLElement | null): GestureEnv {
  const doc = root.ownerDocument;
  const all = (sel: string) => Array.from(doc.querySelectorAll<HTMLElement>(sel));
  const visible = (sel: string) => all(sel).find((el) => isEnabled(el) && isVisible(el)) ?? null;
  return {
    visible,
    any: (sel) => all(sel).find(isEnabled) ?? null,
    highlighted: () => { const h = highlight(); return h && h.isConnected && isEnabled(h) ? h : null; },
    closer: () => { for (const s of CLOSER_SELECTORS) { const el = visible(s); if (el) return el; } return null; },
  };
}

export function createGestureControl(opts: GestureControlOptions): GestureControl {
  const { root, bindings } = opts;
  const doc = root.ownerDocument;
  const engine = createHoldEngine();
  const byKey = new Map<GestureKey, GestureBinding>(bindings.map((b) => [b.key, b]));
  const env = createDomGestureEnv(root, () => opts.highlight?.current() ?? null);
  let active = false;
  let shapes: { shape: HandShape; hand: 'L' | 'R' }[] = [];

  // ---- layers: badges + the hold HUD
  const layer = doc.createElement('div');
  layer.className = 'mc-gesture-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.hidden = true;
  const hud = doc.createElement('div');
  hud.className = 'mc-gesture-hud';
  hud.hidden = true;
  hud.innerHTML = '<span class="mc-gesture-hud-icon"></span><span class="mc-gesture-hud-text"></span><span class="mc-gesture-hud-bar"><span></span></span>';
  layer.append(hud);
  root.append(layer);
  const badges = new Map<GestureKey, HTMLElement>();
  for (const b of bindings) {
    if (!b.targets.length) continue;
    const [side, shape] = b.key.split(':') as ['L' | 'R' | '2', FixedShape];
    const el = doc.createElement('div');
    el.className = 'mc-gesture-badge';
    el.dataset.key = b.key;
    el.dataset.shape = shape;
    el.title = `${gestureName(b.key)}: ${b.label}`;
    el.innerHTML = `${handIconSvg(shape)}<span class="mc-gesture-side">${sideMark(side)}</span>`;
    el.hidden = true;
    layer.append(el);
    badges.set(b.key, el);
  }

  // ---- light-up on the bound button
  let lit: HTMLElement | null = null;
  function light(el: HTMLElement | null, progress: number): void {
    if (lit && lit !== el) { lit.classList.remove('mc-gesture-target'); lit.style.removeProperty('--mc-gesture-progress'); }
    lit = el;
    if (!el) return;
    el.classList.add('mc-gesture-target');
    el.style.setProperty('--mc-gesture-progress', progress.toFixed(3));
  }
  function pressedFeedback(el: HTMLElement): void {
    el.classList.add('mc-gesture-pressed');
    setTimeout(() => el.classList.remove('mc-gesture-pressed'), PRESSED_MS);
  }

  function placeBadges(holding: GestureKey | null): void {
    if (!active) return;
    for (const b of bindings) {
      const badge = badges.get(b.key);
      if (!badge) continue;
      let el: HTMLElement | null = null;
      for (const s of b.targets) { el = env.visible(s); if (el) break; }
      if (!el) { badge.hidden = true; continue; }
      const r = el.getBoundingClientRect();
      badge.hidden = false;
      badge.style.transform = `translate(${Math.round(r.right - 16)}px, ${Math.round(r.top - 12)}px)`;
      badge.classList.toggle('is-holding', holding === b.key);
    }
  }
  let badgeTimer: ReturnType<typeof setInterval> | null = null;

  function hudShow(key: GestureKey | null, action: GestureAction | null, progress: number): void {
    if (!key || !action) { hud.hidden = true; return; }
    hud.hidden = false;
    const shape = key.split(':')[1] as FixedShape;
    const icon = hud.querySelector<HTMLElement>('.mc-gesture-hud-icon')!;
    if (icon.dataset.shape !== shape) { icon.dataset.shape = shape; icon.innerHTML = handIconSvg(shape); }
    const what = action.kind === 'click' ? `${action.label === 'Press' ? `Press ${nameOf(action.el)}` : action.label}`
      : action.kind === 'say' ? action.label : action.why;
    hud.querySelector('.mc-gesture-hud-text')!.textContent = `${gestureName(key)} · ${what}`;
    hud.classList.toggle('is-none', action.kind === 'none');
    (hud.querySelector('.mc-gesture-hud-bar > span') as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
  }

  function act(key: GestureKey): void {
    const b = byKey.get(key);
    if (!b) return;
    const a = resolveGesture(b, env);
    if (a.kind === 'none') { opts.say?.(a.why); return; }
    if (a.kind === 'say') {
      opts.run?.(a.text);
      opts.onFire?.({ key, name: gestureName(key), label: a.label, target: null });
      return;
    }
    pressedFeedback(a.el);
    const target = nameOf(a.el);
    if (typeof a.el.click === 'function') a.el.click();
    else a.el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    opts.onFire?.({ key, name: gestureName(key), label: a.label === 'Press' ? `Press ${target}` : a.label, target });
  }

  function frame(hands: readonly (readonly Pt[])[], now: number, ctx: GestureFrameContext): HoldState {
    if (!active) return engine.state;
    const read: GestureHand[] = [];
    shapes = [];
    let open: readonly Pt[] | null = null;
    for (const h of hands) {
      if (!h || h.length < 21) continue;
      const r = classifyHandShape(h, undefined, ctx.faceX ?? null, { mirrored: true, cameraAspect: ctx.cameraAspect });
      shapes.push({ shape: r.shape, hand: r.hand });
      read.push({ shape: r.shape, hand: r.hand, palm: palmCenter(h), scale: handScale(h) });
      // The open palm drives the highlight; with two open palms the right one does.
      if (r.shape === 'open' && (!open || r.hand === 'R')) open = h;
    }
    const blocked = !!ctx.blocked || ctx.facing === false;
    opts.highlight?.update(blocked ? null : open, now, { blocked, anyHand: read.length > 0 });
    const s = engine.update({ hands: read, facing: ctx.facing, now, blocked: ctx.blocked });
    if (s.fired) {
      light(null, 0);
      hudShow(null, null, 0);
      act(s.fired);
    } else if (s.key) {
      const b = byKey.get(s.key);
      const a = b ? resolveGesture(b, env) : null;
      light(a?.kind === 'click' ? a.el : null, s.progress);
      hudShow(b ? s.key : null, a, s.progress);
    } else {
      light(null, 0);
      hudShow(null, null, 0);
    }
    placeBadges(s.key);
    return s;
  }

  function setActive(on: boolean): void {
    if (on === active) return;
    active = on;
    layer.hidden = !on;
    root.classList.toggle('mc-gestures-on', on);
    opts.highlight?.setActive(on);
    if (on) {
      placeBadges(null);
      badgeTimer = setInterval(() => placeBadges(engine.state.key), BADGE_REFRESH_MS);
    } else {
      if (badgeTimer) clearInterval(badgeTimer);
      badgeTimer = null;
      engine.reset();
      light(null, 0);
      hudShow(null, null, 0);
      for (const b of badges.values()) b.hidden = true;
    }
  }

  return {
    frame,
    setActive,
    isActive: () => active,
    refresh: () => placeBadges(engine.state.key),
    lost() {
      engine.reset();
      light(null, 0);
      hudShow(null, null, 0);
      opts.highlight?.lost();
    },
    env,
    lastShapes: () => shapes.slice(),
    destroy() {
      setActive(false);
      opts.highlight?.destroy();
      layer.remove();
    },
  };
}

/** A button's visible name, short. */
export function nameOf(el: Element | null): string {
  if (!el) return '';
  const h = el as HTMLElement;
  const t = (h.getAttribute?.('aria-label') || h.textContent || '').trim().replace(/\s+/g, ' ');
  return t.slice(0, 40);
}
