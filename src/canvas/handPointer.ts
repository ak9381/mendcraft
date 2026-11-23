// HAND POINTER: every on-screen control is reachable with a hand.
//
// The fingertip (midpoint of thumb and index tips, so the point holds still
// while you pinch) is smoothed with a one-euro filter and mapped from a
// comfortable "reach box" in the camera frame to the whole screen. Hit-testing
// is deep: elementFromPoint walks into open shadow roots (A2UI / Lit tiles),
// and when the hand is near but not on a control, a snap radius picks the
// nearest one that is actually on top at its centre. Popovers, sheets and
// dialogs are covered because candidates are re-collected live; a visible
// aria-modal dialog limits targets to itself.
//
// Feedback follows the visionOS / HoloLens / Ultraleap norm: no dot. The
// targeted control gets a frame (outline + glow, drawn as a fixed overlay so it
// also works for shadow-DOM controls); over empty space only a faint soft
// shadow shows; a short ring appears only while pinching. Pinch-and-release on
// a control activates it (click / focus); pinch on a range slider drags it.

import { createOneEuroFilter } from '../input/oneEuro';
import { createDragVelocity, createMomentum, scrollableAncestor } from './handScroll';
import { tooltipTextFor } from '../ui/handHover';
import {
  HAND_FEEL,
  createDeadZone,
  createPinchMachine,
  createPositionHistory,
  createScalarEuro,
  createStickyTarget,
  cursorAnchor,
  pickPrimaryHand,
} from './handFeel';

type P = { x: number; y: number };
type LM = { x: number; y: number; z?: number };
export interface Rect { left: number; top: number; width: number; height: number }

/** Interactive selector shared by the hand pointer and the reach audit. */
export const INTERACTIVE =
  'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=slider], [role=switch], [role=checkbox], [role=tab], [role=menuitem], [role=option], [contenteditable=true]';

/** A panel's drag handle (its title bar) or a board item's move/resize
 *  handle (editBoard.ts) — also plain `button`s, so they're reachable
 *  through the same INTERACTIVE/collectControls path as any other control.
 *  A pinch-hold that moves drags it (see dragPanel.ts and editBoard.ts,
 *  which listen for the pointerdown/move/up this dispatches); a
 *  pinch-release with no real movement activates it like a tap instead. */
export const DRAG_HANDLE = '[data-mc-drag-handle], [data-mc-resize-handle]';
const DRAG_MOVE_THRESHOLD_PX = 6;

/** Reach box: this part of the camera frame maps to the full screen, so the
 *  edges of the UI (top toolbar included) don't need an arm at full stretch.
 *  Single source of truth: HAND_FEEL.reach (12%–88%). */
export const REACH = HAND_FEEL.reach;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Pure: normalised camera point -> screen px (selfie view is mirrored). */
export function mapToScreen(pt: P, w: number, h: number, mirror = true, box = REACH): P {
  const nx = mirror ? 1 - pt.x : pt.x;
  return {
    x: clamp((nx - box.x0) / (box.x1 - box.x0), 0, 1) * w,
    y: clamp((pt.y - box.y0) / (box.y1 - box.y0), 0, 1) * h,
  };
}

/** Pure: thumb-index gap relative to hand size (wrist -> middle knuckle). */
export function pinchRatio(lm: readonly LM[]): number {
  const d = (a: LM, b: LM) => Math.hypot(a.x - b.x, a.y - b.y);
  const size = d(lm[0], lm[9]) || 1e-6;
  return d(lm[4], lm[8]) / size;
}

/** Pure: pinch with hysteresis so the edge doesn't chatter. Thresholds come
 *  from HAND_FEEL so every pinch in the app (pointer, keep, classify) agrees. */
export function nextPinch(wasPinched: boolean, ratio: number, on = HAND_FEEL.pinchOn, off = HAND_FEEL.pinchOff): boolean {
  return wasPinched ? ratio < off : ratio < on;
}

/** Pure: distance from a point to a rect (0 inside). */
export function distToRect(p: P, r: Rect): number {
  const dx = Math.max(r.left - p.x, 0, p.x - (r.left + r.width));
  const dy = Math.max(r.top - p.y, 0, p.y - (r.top + r.height));
  return Math.hypot(dx, dy);
}

/** Pure: pick the target for a point. Inside wins (smallest area); otherwise
 *  the nearest within `snapPx`. */
export function pickNearest<T>(p: P, items: readonly { item: T; rect: Rect }[], snapPx: number): T | null {
  let best: T | null = null; let bestD = Infinity; let bestArea = Infinity;
  for (const { item, rect } of items) {
    const d = distToRect(p, rect);
    const area = rect.width * rect.height;
    if (d < bestD - 0.5 || (Math.abs(d - bestD) <= 0.5 && area < bestArea)) { best = item; bestD = d; bestArea = area; }
  }
  return bestD <= snapPx ? best : null;
}

/** Pure: slider value for a pointer x over the slider's rect. */
export function sliderValueAt(x: number, r: Rect, min: number, max: number, step: number): number {
  const t = clamp((x - r.left) / Math.max(1, r.width), 0, 1);
  const raw = min + t * (max - min);
  const s = step > 0 ? step : 1;
  return clamp(Math.round((raw - min) / s) * s + min, min, max);
}

// ---------------------------------------------------------------- DOM side

/** Deepest element at a point, walking into open shadow roots. */
export function deepElementFromPoint(doc: Document, x: number, y: number): Element | null {
  let el: Element | null = doc.elementFromPoint(x, y);
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

/** Nearest interactive ancestor, crossing shadow boundaries. */
export function interactiveAncestor(el: Element | null): HTMLElement | null {
  let cur: Element | null = el;
  while (cur) {
    if (cur.matches?.(INTERACTIVE)) return cur as HTMLElement;
    cur = cur.parentElement ?? ((cur.getRootNode() as ShadowRoot).host ?? null);
  }
  return null;
}

export interface CollectControlsOpts {
  /** Include controls that are currently off-screen (below the fold).
   *  Self-check uses this so a sound tile that just hasn't been scrolled
   *  into view isn't reported as "missing every button". Hands still
   *  drop them — they aren't reachable by a pinch until they are. */
  ignoreViewport?: boolean;
}

function isUsable(el: HTMLElement, opts?: CollectControlsOpts): boolean {
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return false;
  if (el.closest('[inert]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const cv = (el as HTMLElement & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (cv && !cv.call(el, { checkOpacity: true, checkVisibilityCSS: true })) return false;
  if (!opts?.ignoreViewport && (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth)) return false;
  return true;
}

/** Every usable interactive control in the document, including open shadow
 *  roots, limited to a visible modal dialog when one is open. */
export function collectControls(doc: Document = document, opts?: CollectControlsOpts): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (scope: Document | ShadowRoot) => {
    scope.querySelectorAll<HTMLElement>(INTERACTIVE).forEach((el) => { if (isUsable(el, opts)) out.push(el); });
    scope.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot); });
  };
  walk(doc);
  const modal = Array.from(doc.querySelectorAll<HTMLElement>('[aria-modal=true]')).find((m) => !m.hidden && m.getBoundingClientRect().height > 0);
  const scoped = modal ? out.filter((el) => modal.contains(el)) : out;
  // Only controls that are on top at their centre (not covered by a sheet).
  // Off-screen centres make elementFromPoint return null — skip this clip
  // when the caller asked to include below-the-fold controls.
  if (opts?.ignoreViewport) return scoped;
  return scoped.filter((el) => {
    const r = el.getBoundingClientRect();
    const cx = clamp(r.left + r.width / 2, 0, innerWidth - 1), cy = clamp(r.top + r.height / 2, 0, innerHeight - 1);
    const top = interactiveAncestor(deepElementFromPoint(doc, cx, cy));
    return top === el || (!!top && el.contains(top)) || (!!top && top.contains(el));
  });
}

export function controlLabel(el: HTMLElement): string {
  return (el.getAttribute('aria-label') || el.textContent || (el as HTMLInputElement).placeholder || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 60);
}

export interface HandPointerOptions {
  /** Snap radius in CSS px (generous: hands are imprecise). */
  snapPx?: number;
  /** A pinch that started over nothing (e.g. the canvas "pinch to keep"). */
  onEmptyPinch?: () => void;
  /** Test hook: deliver a click event but stop it before app handlers run. */
  dryRun?: boolean;
  /** Test hook: builds the event dispatched to a DRAG_HANDLE element on
   *  pinch down/move/up. Defaults to a real PointerEvent. */
  createDragEvent?: (type: string, p: P) => Event;
  /** Observer on the debounced pinch edges (the morph hold classifier's hand
   *  adapter). 'down' carries the FROZEN aim point (pre-pinch position);
   *  'move' carries the live point every pinched frame; fires for both real
   *  tracking frames and the sim pinch() path. Purely additive — it never
   *  changes what the pointer itself does. */
  onPinch?: (ev: { phase: 'down' | 'move' | 'up' | 'cancel'; p: P; now: number }) => void;
  /** A hand user has no mouseover, so native `title` tooltips never fire.
   *  Fires with the hint text (title → aria-label → data-tooltip) for whatever
   *  the cursor is over — a hovered control, or any `[title]`/`[data-tooltip]`
   *  element under the raw point (so a hint-only, non-clickable element like
   *  the swarm pill is reachable too). null hides the bubble. */
  onTooltip?: (text: string | null, el: HTMLElement | null) => void;
}

export interface HandPointer {
  /** Feed a tracking frame (first hand used). */
  update(hands: readonly (readonly LM[])[], now: number): void;
  /** Simulation / tests: aim at a screen point, then press / release. */
  pointAt(x: number, y: number): HTMLElement | null;
  pinch(down: boolean): void;
  readonly target: HTMLElement | null;
  readonly lastActivated: HTMLElement | null;
  /** True briefly after a pinch was used on a control (so it isn't also "keep"). */
  consumedPinch(): boolean;
  /** The current pinch's release must NOT activate what it pressed on — a
   *  morph hold fired mid-pinch, so letting go is "done holding", not a tap
   *  on the control under the finger. One-shot; cleared on release. */
  suppressNextRelease(): void;
  setDryRun(on: boolean): void;
  lost(): void;
  destroy(): void;
}

export function createHandPointer(doc: Document = document, opts: HandPointerOptions = {}): HandPointer {
  const snapPx = opts.snapPx ?? 56;
  let dryRun = !!opts.dryRun;
  const euro = createOneEuroFilter(HAND_FEEL.cursorFilter);
  const ratioEuro = createScalarEuro(HAND_FEEL.pinchFilter);
  const deadZone = createDeadZone(HAND_FEEL.deadZonePx);
  const pinchFsm = createPinchMachine(HAND_FEEL);
  const history = createPositionHistory(HAND_FEEL.freezeLookbackMs + 300);
  const sticky = createStickyTarget<HTMLElement>((el) => el.getBoundingClientRect(), HAND_FEEL);

  const frame = doc.createElement('div');
  frame.className = 'mc-hand-frame'; frame.setAttribute('aria-hidden', 'true'); frame.hidden = true;
  const shadow = doc.createElement('div');
  shadow.className = 'mc-hand-shadow'; shadow.setAttribute('aria-hidden', 'true'); shadow.hidden = true;
  const ring = doc.createElement('div');
  ring.className = 'mc-hand-ring'; ring.setAttribute('aria-hidden', 'true'); ring.hidden = true;
  doc.body.append(shadow, frame, ring);

  let controls: HTMLElement[] = []; let controlsAt = -Infinity;
  let target: HTMLElement | null = null;
  let pressedOn: HTMLElement | null = null;
  let dragging: HTMLInputElement | null = null;
  let draggingHandle: HTMLElement | null = null;
  let dragHandleStart: P = { x: 0, y: 0 };
  let dragHandleMoved = false;
  let pinched = false;
  let lastActivated: HTMLElement | null = null;
  let consumedUntil = -Infinity;
  let suppressRelease = false;
  let pt: P = { x: -1, y: -1 };
  let lostTimer: ReturnType<typeof setTimeout> | null = null;

  // Hand scroll + fling (A2-025 / C156): a pinch-drag inside a scrollable
  // container scrolls it with release momentum; a still/short pinch stays a tap.
  const dragVel = createDragVelocity();
  const momentum = createMomentum();
  let scrollEl: HTMLElement | null = null;
  let scrollAxes = { x: false, y: false };
  let scrollStart: P = { x: 0, y: 0 };
  let scrollLast: P = { x: 0, y: 0 };
  let scrolled = false;
  let flingRaf = 0;

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const createDragEvent = opts.createDragEvent ?? ((type: string, p: P) =>
    new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'pen' }));

  function refreshControls(force = false) {
    const t = now();
    if (force || t - controlsAt > 250) { controls = collectControls(doc); controlsAt = t; }
  }

  /** Forwards the pinch-hold as a plain pointer event to a drag handle —
   *  never during a dry-run probe, which must never actually move anything. */
  function dispatchDragEvent(el: HTMLElement, type: string, p: P): void {
    if (dryRun) return;
    el.dispatchEvent(createDragEvent(type, p));
  }

  function resolve(p: P): HTMLElement | null {
    refreshControls();
    const raw = deepElementFromPoint(doc, p.x, p.y);
    const direct = interactiveAncestor(raw);
    if (direct && controls.includes(direct)) return direct;
    const near = pickNearest(p, controls.map((el) => ({ item: el, rect: el.getBoundingClientRect() })), snapPx);
    if (near) return near;
    // C114: a dismiss scrim (tap-away-to-close) is not a control, so a hand
    // could never close a sheet the way a finger does. Target it only on a
    // direct hit with no control in snap range, so it never steals a snap.
    const dismiss = (raw as HTMLElement | null)?.closest?.('[data-hand-dismiss]') as HTMLElement | null;
    return dismiss ?? null;
  }

  function paint() {
    if (target) {
      const r = target.getBoundingClientRect();
      frame.hidden = false; shadow.hidden = true;
      frame.style.transform = `translate(${r.left - 4}px, ${r.top - 4}px)`;
      frame.style.width = `${r.width + 8}px`; frame.style.height = `${r.height + 8}px`;
      frame.classList.toggle('is-pressed', pinched);
    } else {
      frame.hidden = true;
      // Over empty space: a soft low-contrast ring (no dot) that tightens
      // while pinching — see .mc-hand-shadow in canvas.css.
      shadow.hidden = pt.x < 0;
      shadow.style.transform = `translate(${pt.x - 28}px, ${pt.y - 28}px)`;
      shadow.classList.toggle('is-pinched', pinched);
    }
    ring.hidden = !pinched;
    if (pinched) {
      const c = target ? (() => { const r = target!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })() : pt;
      ring.style.transform = `translate(${c.x - 14}px, ${c.y - 14}px)`;
    }
  }

  function setTarget(el: HTMLElement | null) {
    if (el === target) return;
    target?.classList.remove('hand-hover');
    target = el;
    target?.classList.add('hand-hover');
  }

  // Hand-user dwell tooltip (A1-047 / A5-017): the hint for the hovered control,
  // or — when the cursor isn't on a control — the nearest `[title]`/
  // `[data-tooltip]`/`[aria-label]` element under the raw point, so a hint-only
  // element (the swarm pill) surfaces its note too. Deduped so the bubble isn't
  // re-emitted every frame.
  let tipEl: HTMLElement | null = null;
  function isControlish(el: HTMLElement): boolean {
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'SUMMARY') return true;
    const role = el.getAttribute?.('role') ?? '';
    return /^(button|tab|switch|menuitem|checkbox|radio|slider|link|option)$/.test(role);
  }
  function hintUnder(p: P): HTMLElement | null {
    let cur = deepElementFromPoint(doc, p.x, p.y) as HTMLElement | null;
    // Only explicit hints here — an aria-label on a landmark/region (the whole
    // "Smart canvas" root) is a screen-reader name, not a tooltip.
    while (cur) {
      if (cur.getAttribute?.('title')?.trim() || cur.getAttribute?.('data-tooltip')?.trim()) return cur;
      if (cur.getAttribute?.('aria-label')?.trim() && isControlish(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  function emitTooltip(controlTarget: HTMLElement | null): void {
    if (!opts.onTooltip) return;
    const el = (controlTarget && tooltipTextFor(controlTarget)) ? controlTarget : hintUnder(pt);
    if (el === tipEl) return;
    tipEl = el;
    opts.onTooltip(tooltipTextFor(el), el);
  }

  function activate(el: HTMLElement) {
    lastActivated = el;
    consumedUntil = now() + 700;
    if (dryRun) {
      const stop = (e: Event) => { e.stopImmediatePropagation(); e.preventDefault(); };
      // Capture on `doc`, not `el`: a listener added to the target itself
      // fires in REGISTRATION ORDER regardless of its capture flag (the DOM
      // spec only gives capture priority over ancestors, not over earlier
      // listeners on the same node) — so stopping on `el` ran AFTER
      // whatever real @click handler the app (e.g. a Lit tile) already
      // bound at render time, letting the "dry run" fire it for real. A
      // capture listener on an ancestor runs during the capturing phase,
      // strictly before the event ever reaches the target's own listeners.
      doc.addEventListener('click', stop, { capture: true, once: true });
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
      doc.removeEventListener('click', stop, { capture: true });
      return;
    }
    if (el.matches('input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=true]')) {
      el.focus({ preventScroll: true });
      return;
    }
    // SVGElement (VisualTile's promoted [data-action] zones) has no .click().
    // Dispatch the same bubbling, composed click the dry-run path already uses
    // so a pinch on a room-zone <rect> fires the listener visualMount wired.
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
  }

  function dragTo(x: number) {
    if (!dragging) return;
    const r = dragging.getBoundingClientRect();
    const v = sliderValueAt(x, r, Number(dragging.min || 0), Number(dragging.max || 100), Number(dragging.step || 1));
    if (String(v) !== dragging.value) {
      dragging.value = String(v);
      if (!dryRun) dragging.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
  }

  const rafAvailable = typeof requestAnimationFrame === 'function';
  function cancelFling() {
    if (flingRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(flingRaf);
    flingRaf = 0;
    momentum.stop();
  }
  /** Live pinch-drag over a scroll container: once past the move threshold,
   *  translate the drag into scrollTop/scrollLeft and feed the fling tracker. */
  function scrollDrag(p: P) {
    if (!scrollEl) return;
    dragVel.push(p.x, p.y, now());
    if (!scrolled && Math.hypot(p.x - scrollStart.x, p.y - scrollStart.y) <= DRAG_MOVE_THRESHOLD_PX) { scrollLast = p; return; }
    scrolled = true;
    const dx = p.x - scrollLast.x, dy = p.y - scrollLast.y;
    if (!dryRun) {
      if (scrollAxes.y) scrollEl.scrollTop -= dy;
      if (scrollAxes.x) scrollEl.scrollLeft -= dx;
    }
    scrollLast = p;
  }
  function startFling() {
    const el = scrollEl;
    const { vx, vy } = dragVel.velocity(now());
    momentum.start(scrollAxes.x ? vx : 0, scrollAxes.y ? vy : 0);
    if (!el || dryRun || !rafAvailable || !momentum.active) return;
    let last = now();
    const step = () => {
      const t = now(); const dt = t - last; last = t;
      const { dx, dy } = momentum.tick(dt);
      if (scrollAxes.y) el.scrollTop -= dy;
      if (scrollAxes.x) el.scrollLeft -= dx;
      flingRaf = momentum.active ? requestAnimationFrame(step) : 0;
    };
    flingRaf = requestAnimationFrame(step);
  }

  function press(down: boolean) {
    if (down === pinched) return;
    pinched = down;
    opts.onPinch?.({ phase: down ? 'down' : 'up', p: pt, now: now() });
    if (down) {
      pressedOn = target;
      if (target && target.matches('input[type=range]')) { dragging = target as HTMLInputElement; dragTo(pt.x); consumedUntil = now() + 700; }
      else if (target && target.matches(DRAG_HANDLE)) {
        draggingHandle = target; dragHandleStart = pt; dragHandleMoved = false;
        dispatchDragEvent(target, 'pointerdown', pt);
        consumedUntil = now() + 700;
      }
      else if (!target) opts.onEmptyPinch?.();
      else {
        // A pinch over a scroll container (or a control inside one) arms a
        // drag-to-scroll; a still/short pinch still taps (see press-up).
        const hit = scrollableAncestor(target);
        if (hit) {
          cancelFling(); dragVel.reset();
          scrollEl = hit.el; scrollAxes = { x: hit.x, y: hit.y };
          scrollStart = pt; scrollLast = pt; scrolled = false;
          dragVel.push(pt.x, pt.y, now());
        }
        consumedUntil = now() + 700;
      }
    } else {
      if (suppressRelease) {
        // A morph hold fired during this pinch: tear the press down without
        // activating anything — no click, no slider change, no handle tap.
        if (draggingHandle) dispatchDragEvent(draggingHandle, 'pointerup', pt);
        dragging = null; draggingHandle = null;
      } else if (dragging) {
        if (!dryRun) dragging.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        lastActivated = dragging; dragging = null;
      } else if (draggingHandle) {
        dispatchDragEvent(draggingHandle, 'pointerup', pt);
        // A pinch that never really moved reads as a tap, same as any other
        // control — only a genuine drag skips the click.
        if (!dragHandleMoved) activate(draggingHandle); else lastActivated = draggingHandle;
        draggingHandle = null;
      } else if (scrollEl && scrolled) {
        // A real drag scrolled the container — fling it, never a tap-click.
        startFling();
      } else if (pressedOn && pressedOn === target) activate(pressedOn);
      scrollEl = null; scrolled = false;
      suppressRelease = false;
      pressedOn = null;
      refreshControls(true);
    }
    paint();
  }

  function aim(p: P, stickyNow?: number): HTMLElement | null {
    pt = p;
    if (dragging) { dragTo(p.x); paint(); return dragging; }
    if (draggingHandle) {
      if (Math.hypot(p.x - dragHandleStart.x, p.y - dragHandleStart.y) > DRAG_MOVE_THRESHOLD_PX) dragHandleMoved = true;
      dispatchDragEvent(draggingHandle, 'pointermove', p);
      paint();
      return draggingHandle;
    }
    const resolved = resolve(p);
    // Sticky hysteresis runs on the TRACKING clock (the frame timestamps the
    // camera loop feeds update()), never the wall clock — pointAt() (sim /
    // audits) bypasses it entirely for determinism.
    setTarget(stickyNow !== undefined ? sticky.update(resolved, p, stickyNow) : resolved);
    emitTooltip(target);
    paint();
    return target;
  }

  function lost() {
    if (pinched) {
      if (draggingHandle) dispatchDragEvent(draggingHandle, 'pointercancel', pt);
      pinched = false; dragging = null; pressedOn = null; draggingHandle = null;
      scrollEl = null; scrolled = false; cancelFling(); dragVel.reset();
      suppressRelease = false;
      opts.onPinch?.({ phase: 'cancel', p: pt, now: now() });
    }
    setTarget(null); pt = { x: -1, y: -1 };
    if (tipEl) { tipEl = null; opts.onTooltip?.(null, null); }
    euro.reset(); ratioEuro.reset(); deadZone.reset(); pinchFsm.reset(); history.reset(); sticky.reset();
    paint();
  }

  return {
    update(hands, t) {
      // Only a real foreground hand drives the cursor; small background hands
      // (someone behind you) are ignored outright.
      const h = pickPrimaryHand(hands as readonly (readonly { x: number; y: number }[])[]);
      if (!h) return;
      if (lostTimer) clearTimeout(lostTimer);
      lostTimer = setTimeout(lost, 400);

      // Anchor on the index-MCP/palm-centre blend (not the fingertips, which
      // jump the moment you pinch), 1-Euro-smoothed, with a micro dead-zone.
      const anchor = cursorAnchor(h);
      const s = euro.filter(anchor.x, anchor.y, t);
      const p = deadZone.apply(mapToScreen(s, innerWidth, innerHeight));
      history.push(p, t);

      // Pinch ratio is smoothed too, then debounced with hysteresis +
      // refractory: hover can NEVER activate anything — only this machine's
      // justDown/justUp edges press and release.
      const ratio = ratioEuro.filter(pinchRatio(h), t);
      const st = pinchFsm.update(ratio, t);

      if (st.justDown) {
        // CURSOR FREEZE: the click target is where the cursor was BEFORE the
        // fingers started closing, so the pinch motion can't drag it off a
        // small button. The cursor then stays locked for the whole pinch
        // (sliders and drag handles excepted — they need live motion).
        const pre = history.at(t - HAND_FEEL.freezeLookbackMs) ?? p;
        aim(pre, t);
        press(true);
      } else if (st.pinched) {
        if (dragging || draggingHandle) aim(p, t);
        else if (scrollEl) scrollDrag(p);
        // The cursor stays frozen, but the morph hold's slop check needs the
        // LIVE hand position — drifting past slop must cancel the hold.
        opts.onPinch?.({ phase: 'move', p, now: t });
      } else {
        if (st.justUp) press(false);
        aim(p, t);
      }
    },
    pointAt(x, y) { return aim({ x, y }); },
    pinch: press,
    get target() { return target; },
    get lastActivated() { return lastActivated; },
    consumedPinch: () => now() < consumedUntil || !!target,
    suppressNextRelease() { if (pinched) suppressRelease = true; },
    setDryRun(on) { dryRun = on; },
    lost,
    destroy() { lost(); if (lostTimer) clearTimeout(lostTimer); frame.remove(); shadow.remove(); ring.remove(); },
  };
}
