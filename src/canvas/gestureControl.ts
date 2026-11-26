// BUTTON GESTURES on screen: hand frames → shape classifier → 2 s hold engine →
// the bound button (gestureBindings) lights up while the hold runs and is
// pressed (a real click, the same path as the mouse) when it completes.
// Also draws the yellow hand badges on the bound buttons while Hands is on.
//
// Laptop canvas and phone shells both use this; each passes its own binding
// table. Nothing here acts on its own: every press is `el.click()` on a real
// button, or a line for the app's run() router where no button exists.

import type { Pt } from '../input/handLogic';
import { classifyHandShape, createHandPolarity, isFixedShape, stampShape, type HandShape, type HandSide, type LabelPolarity } from './handShape';
import { createHoldEngine, type FixedShape, type GestureHand, type GestureKey, type HoldState } from './gestureHold';
import {
  CLOSER_SELECTORS, gestureName, resolveGesture,
  type GestureAction, type GestureBinding, type GestureEnv,
} from './gestureBindings';
import { handIconSvg, sideMark } from './gestureIcons';
import { handScale, palmCenter, type ReachBox } from './handFeel';
import { mapToScreen } from './handPointer';
import { createPeaceScroll, type ScrollHand } from './peaceScroll';
import { createScrollDriver } from './gestureScroll';

export interface GestureFrameContext {
  /** The hand gate: false = not facing (no gestures), null = unknown (allowed). */
  facing: boolean | null;
  /** Operator face centre x in the same (selfie) space as the hands. */
  faceX?: number | null;
  /** A fist grab / pan / zoom is running, or the hands are locked. */
  blocked?: boolean;
  cameraAspect?: number;
  /** Finger counts (1 / 2 / 3) are off: a point-at-device step is armed or
   *  just ended — a natural pointing hand must never press a chip. */
  suppressCounts?: boolean;
  /** The control directly under the hand pointer's raw point (if any): the
   *  highlight adopts it so the ring and the cursor never disagree. */
  direct?: HTMLElement | null;
}

/** The open-palm highlight (palmHighlight.ts) as the controller sees it. */
export interface HighlightHook {
  /** Feed the open palm (selfie-space landmarks) or null (no open palm this frame). */
  update(palm: readonly Pt[] | null, now: number, ctx: { blocked: boolean; anyHand: boolean; open: boolean; direct?: HTMLElement | null }): void;
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
  /** Reach box (camera → screen) for the peace-scroll hand point; default laptop. */
  reach?: () => ReachBox;
  /** Peace-and-move over nothing scrollable: pan the canvas (screen px). */
  onCanvasScroll?: (dx: number, dy: number) => void;
  onCanvasScrollEnd?: () => void;
  /** A level control stepped by the peace gesture. */
  onLevel?: (el: HTMLElement, dir: 1 | -1, readout: string) => void;
  /** Tick sound on level steps (off by default). */
  levelTick?: () => boolean;
}

export interface GestureControl {
  /** The frame's ONE shape read: classifies each selfie-space hand and
   *  stamps `.shape` / `.side` on its array (the hand pointer reuses it, so a
   *  thumbs-up is never also a fist). frame() reads it again if not stamped. */
  read(hands: readonly (readonly Pt[])[], ctx: Pick<GestureFrameContext, 'faceX' | 'cameraAspect'>): void;
  /** Selfie-space hands (each array may carry MediaPipe's `.label`). Empty
   *  frames matter: they cancel holds and clear the overlays. */
  frame(hands: readonly (readonly Pt[])[], now: number, ctx: GestureFrameContext): HoldState;
  /** A fixed hold is running, or a hand shows a fixed shape right now (the
   *  taught-gesture matcher stands down). */
  busy(): boolean;
  debug(): { polarity: LabelPolarity; polarityScore: number; shapes: { shape: HandShape; hand: HandSide }[]; key: GestureKey | null; progress: number };
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
/** No frame for this long (wall clock) = the hands are gone. */
export const GESTURE_STALE_MS = 500;
/** While a review is open (it is modal) only these act. */
const REVIEW_KEYS: readonly GestureKey[] = ['R:thumbsUp', 'R:thumbsDown', 'L:thumbsDown'];
const COUNT_SHAPES: readonly HandShape[] = ['one', 'peace', 'three'];
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
  // Peace-and-move: scroll what is under the hand, or step a level control.
  const scroll = createPeaceScroll();
  const scroller = createScrollDriver({
    root, onCanvasScroll: opts.onCanvasScroll, onCanvasScrollEnd: opts.onCanvasScrollEnd,
    onLevel: opts.onLevel, tickSound: opts.levelTick,
  });
  const byKey = new Map<GestureKey, GestureBinding>(bindings.map((b) => [b.key, b]));
  const env = createDomGestureEnv(root, () => opts.highlight?.current() ?? null);
  let active = false;
  let shapes: { shape: HandShape; hand: HandSide }[] = [];
  const polarity = createHandPolarity();
  let staleTimer: ReturnType<typeof setTimeout> | null = null;

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
      if (!el || !onTop(el)) { badge.hidden = true; continue; }
      const r = el.getBoundingClientRect();
      badge.hidden = false;
      // 24px circle at the button's top-right corner, 8px outside it.
      badge.style.transform = `translate(${Math.round(r.right - 16)}px, ${Math.round(r.top - 8)}px)`;
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

  /** Covered by a dialog (a chip behind the review): no badge on it. */
  function onTop(el: HTMLElement): boolean {
    if (typeof doc.elementFromPoint !== 'function') return true;
    const r = el.getBoundingClientRect();
    const hit = doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !hit || el === hit || el.contains(hit) || hit.contains(el);
  }
  /** The review is modal: while it is open only Approve / Reject (close) /
   *  Undo act — Save, New, Tools, chips, Register… wait behind it. */
  function resolve(b: GestureBinding): GestureAction {
    if (!REVIEW_KEYS.includes(b.key) && env.visible('.mc-review-approve')) {
      return { kind: 'none', label: b.label, why: 'Finish the review first: thumbs up to approve, thumbs down to reject.' };
    }
    return resolveGesture(b, env);
  }

  function act(key: GestureKey): void {
    const b = byKey.get(key);
    if (!b) return;
    const a = resolve(b);
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

  type Read = { shape: HandShape; side: HandSide };
  /** The frame's shape read: one polarity observation for the frame, then
   *  each hand classified with the corrected label. */
  function readAll(hands: readonly (readonly Pt[])[], ctx: Pick<GestureFrameContext, 'faceX' | 'cameraAspect'>): (Read | null)[] {
    const label = (h: readonly Pt[]) => (h as { label?: string }).label;
    polarity.observeFrame(hands.filter((h) => h && h.length >= 21).map((h) => ({ lm: h, label: label(h) })), ctx.faceX ?? null, true);
    return hands.map((h) => {
      if (!h || h.length < 21) return null;
      const r = classifyHandShape(h, polarity.correct(label(h)), ctx.faceX ?? null, { mirrored: true, cameraAspect: ctx.cameraAspect });
      return { shape: r.shape, side: r.hand };
    });
  }
  function read(hands: readonly (readonly Pt[])[], ctx: Pick<GestureFrameContext, 'faceX' | 'cameraAspect'>): void {
    readAll(hands, ctx).forEach((r, i) => {
      if (!r) return;
      stampShape(hands[i] as Pt[], r.shape);
      (hands[i] as { side?: HandSide }).side = r.side;
    });
  }
  /** Stamped reads (from read()), or read now when the caller skipped read(). */
  function readsFor(hands: readonly (readonly Pt[])[], ctx: GestureFrameContext): (Read | null)[] {
    const all = hands.every((h) => !h || h.length < 21 || ((h as { shape?: HandShape }).shape && (h as { side?: HandSide }).side));
    if (all) return hands.map((h) => (!h || h.length < 21 ? null : { shape: (h as { shape?: HandShape }).shape!, side: (h as { side?: HandSide }).side! }));
    return readAll(hands, ctx);
  }

  function clearOverlays(): void {
    light(null, 0);
    hudShow(null, null, 0);
  }
  function armStale(): void {
    if (staleTimer) clearTimeout(staleTimer);
    // Belt and braces: if frames simply stop (camera stall, tab hidden), the
    // hold cancels and the overlays clear on their own.
    staleTimer = setTimeout(() => { staleTimer = null; if (active) api.lost(); }, GESTURE_STALE_MS);
  }

  function frame(hands: readonly (readonly Pt[])[], now: number, ctx: GestureFrameContext): HoldState {
    if (!active) return engine.state;
    armStale();
    const handsRead: GestureHand[] = [];
    shapes = [];
    let palm: readonly Pt[] | null = null;
    let palmOpen = false;
    let palmRank = -1;
    const reads = readsFor(hands, ctx);
    for (let k = 0; k < hands.length; k++) {
      const h = hands[k];
      const rd = reads[k];
      if (!h || !rd) continue;
      let { shape } = rd;
      const { side } = rd;
      if (ctx.suppressCounts && COUNT_SHAPES.includes(shape)) shape = 'other';
      shapes.push({ shape, hand: side });
      handsRead.push({ shape, hand: side, palm: palmCenter(h), scale: handScale(h) });
      // The highlight follows an open palm (or a loose, unclassified hand);
      // only a fixed shape or a fist freezes it. Open beats other; R beats L.
      if (shape === 'open' || shape === 'other') {
        const rank = (shape === 'open' ? 2 : 0) + (side === 'R' ? 1 : 0);
        if (rank > palmRank) { palm = h; palmOpen = shape === 'open'; palmRank = rank; }
      }
    }
    const blocked = !!ctx.blocked || ctx.facing === false;
    // Peace-and-move first: a peace that started scrolling (or stepping a
    // level) can't also fire its hold (R chip 2 / L Tools) until it changes shape.
    const scrollHands: ScrollHand[] = [];
    for (let k = 0; k < hands.length; k++) {
      const rd = reads[k];
      if (!rd || !hands[k]) continue;
      const pc = palmCenter(hands[k]);
      scrollHands.push({ side: rd.side, shape: rd.shape, point: mapToScreen({ x: 1 - pc.x, y: pc.y }, innerWidth, innerHeight, true, opts.reach?.()) });
    }
    const sc = scroll.update(scrollHands, now, blocked);
    scroller.frame(sc);
    for (const h of handsRead) if (h.shape === 'peace' && scroll.suppressed(h.hand)) h.shape = 'other';
    for (const x of shapes) if (x.shape === 'peace' && scroll.suppressed(x.hand)) x.shape = 'other';
    opts.highlight?.update(blocked ? null : palm, now, { blocked, anyHand: handsRead.length > 0, open: palmOpen, direct: ctx.direct ?? null });
    const s = engine.update({ hands: handsRead, facing: ctx.facing, now, blocked: ctx.blocked });
    if (s.fired) {
      clearOverlays();
      act(s.fired);
    } else if (s.key) {
      const b = byKey.get(s.key);
      const a = b ? resolve(b) : null;
      light(a?.kind === 'click' ? a.el : null, s.progress);
      hudShow(b ? s.key : null, a, s.progress);
    } else {
      clearOverlays();
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
    scroller.setActive(on);
    if (on) {
      placeBadges(null);
      badgeTimer = setInterval(() => placeBadges(engine.state.key), BADGE_REFRESH_MS);
    } else {
      if (badgeTimer) clearInterval(badgeTimer);
      badgeTimer = null;
      engine.reset();
      scroll.reset();
      shapes = [];
      clearOverlays();
      if (staleTimer) { clearTimeout(staleTimer); staleTimer = null; }
      for (const b of badges.values()) b.hidden = true;
    }
  }

  const api: GestureControl = {
    read,
    frame,
    busy: () => !!engine.state.key || shapes.some((x) => isFixedShape(x.shape)) || scroller.busy(),
    debug: () => ({ polarity: polarity.polarity, polarityScore: polarity.score, shapes: shapes.slice(), key: engine.state.key, progress: engine.state.progress }),
    setActive,
    isActive: () => active,
    refresh: () => placeBadges(engine.state.key),
    lost() {
      engine.reset();
      scroll.reset();
      scroller.stop();
      shapes = [];
      clearOverlays();
      opts.highlight?.lost();
    },
    env,
    lastShapes: () => shapes.slice(),
    destroy() {
      setActive(false);
      opts.highlight?.destroy();
      scroller.destroy();
      layer.remove();
    },
  };
  return api;
}

/** A button's visible name, short. */
export function nameOf(el: Element | null): string {
  if (!el) return '';
  const h = el as HTMLElement;
  const t = (h.getAttribute?.('aria-label') || h.textContent || '').trim().replace(/\s+/g, ' ');
  return t.slice(0, 40);
}
