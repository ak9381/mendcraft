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

function isUsable(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return false;
  if (el.closest('[inert]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const cv = (el as HTMLElement & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (cv && !cv.call(el, { checkOpacity: true, checkVisibilityCSS: true })) return false;
  if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
  return true;
}

/** Every usable interactive control in the document, including open shadow
 *  roots, limited to a visible modal dialog when one is open. */
export function collectControls(doc: Document = document): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (scope: Document | ShadowRoot) => {
    scope.querySelectorAll<HTMLElement>(INTERACTIVE).forEach((el) => { if (isUsable(el)) out.push(el); });
    scope.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot); });
  };
  walk(doc);
  const modal = Array.from(doc.querySelectorAll<HTMLElement>('[aria-modal=true]')).find((m) => !m.hidden && m.getBoundingClientRect().height > 0);
  const scoped = modal ? out.filter((el) => modal.contains(el)) : out;
  // Only controls that are on top at their centre (not covered by a sheet).
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
  let pt: P = { x: -1, y: -1 };
  let lostTimer: ReturnType<typeof setTimeout> | null = null;

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
    const direct = interactiveAncestor(deepElementFromPoint(doc, p.x, p.y));
    if (direct && controls.includes(direct)) return direct;
    return pickNearest(p, controls.map((el) => ({ item: el, rect: el.getBoundingClientRect() })), snapPx);
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

  function activate(el: HTMLElement) {
    lastActivated = el;
    consumedUntil = now() + 700;
    if (dryRun) {
      const stop = (e: Event) => { e.stopImmediatePropagation(); e.preventDefault(); };
      // Capture at the target itself: the event reaches the control, app handlers don't run.
      el.addEventListener('click', stop, { capture: true, once: true });
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
      el.removeEventListener('click', stop, { capture: true });
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

  function press(down: boolean) {
    if (down === pinched) return;
    pinched = down;
    if (down) {
      pressedOn = target;
      if (target && target.matches('input[type=range]')) { dragging = target as HTMLInputElement; dragTo(pt.x); consumedUntil = now() + 700; }
      else if (target && target.matches(DRAG_HANDLE)) {
        draggingHandle = target; dragHandleStart = pt; dragHandleMoved = false;
        dispatchDragEvent(target, 'pointerdown', pt);
        consumedUntil = now() + 700;
      }
      else if (!target) opts.onEmptyPinch?.();
      else consumedUntil = now() + 700;
    } else {
      if (dragging) {
        if (!dryRun) dragging.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        lastActivated = dragging; dragging = null;
      } else if (draggingHandle) {
        dispatchDragEvent(draggingHandle, 'pointerup', pt);
        // A pinch that never really moved reads as a tap, same as any other
        // control — only a genuine drag skips the click.
        if (!dragHandleMoved) activate(draggingHandle); else lastActivated = draggingHandle;
        draggingHandle = null;
      } else if (pressedOn && pressedOn === target) activate(pressedOn);
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
    paint();
    return target;
  }

  function lost() {
    if (pinched) {
      if (draggingHandle) dispatchDragEvent(draggingHandle, 'pointercancel', pt);
      pinched = false; dragging = null; pressedOn = null; draggingHandle = null;
    }
    setTarget(null); pt = { x: -1, y: -1 };
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
    setDryRun(on) { dryRun = on; },
    lost,
    destroy() { lost(); if (lostTimer) clearTimeout(lostTimer); frame.remove(); shadow.remove(); ring.remove(); },
  };
}
