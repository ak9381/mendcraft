// HAND POINTER: every on-screen control is reachable with a hand.
//
// The cursor always sits on the INDEX FINGERTIP (landmark 8) of the same
// hand — never the thumb, never the middle tip (12), never a midpoint. The
// fingertip is smoothed with a one-euro filter and mapped from a
// comfortable "reach box" in the camera frame to the whole screen. Hit-testing
// is deep: elementFromPoint walks into open shadow roots (A2UI / Lit tiles),
// and when the hand is near but not on a control, a snap radius picks the
// nearest one that is actually on top at its centre. Popovers, sheets and
// dialogs are covered because candidates are re-collected live; a visible
// aria-modal dialog limits targets to itself.
//
// There is exactly one way to activate anything: HOVER-TO-SELECT. Resting
// the cursor still on a control or a board (.mc-frame) for ~1.5s (HAND_FEEL.
// dwellMs) fills the .mc-hand-dwell ring, then clicks it (a button) or
// focuses it (a board). No pinch-click, no pinch-drag, no two-hand
// pinch-zoom, no one-fist drag, no two-finger scroll — those gestures do
// not exist in this pipeline. The only other gesture is a two-fist BOARD
// MOVE, handled by the plural createHandPointer() below: both hands fisted
// with both cursors over the SAME board drags that board by the fists'
// midpoint until either hand opens.
//
// `pinch()`/`pointAt()` remain as a direct, non-gesture "simulate a press"
// API for tests and selfCheck.ts's reachability replay — unrelated to the
// live camera pipeline, which never calls them itself.

import { createOneEuroFilter } from '../input/oneEuro';
import { createDragVelocity, createMomentum, scrollableAncestor } from './handScroll';
import { magnetPull, tooltipTextFor } from '../ui/handHover';
import { getGestureTrace, targetIdOf } from './gestureTrace';
import { createEdgeGuard, isEdgeFrame, SCREEN_MARGIN_PX } from './handEdge';
import { handLabelOf } from './handSpace';
import { fieldCaretAt } from '../input/caretAt';
import { INDEX_TIP } from '../input/handLogic';
import { classifyGesture, createPointFistGate, type Pt as GesturePt } from '../input/gestures';
import {
  HAND_FEEL,
  createDeadZone,
  createStickyTarget,
  pickPrimaryHand,
  pickForegroundHands,
  assignHandSlots,
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
/** A drawing area that takes the hand directly (the floor-plan board): no
 *  controls inside, so the pointer hands it hover, tap and drag in client px.
 *  Found via `[data-hand-surface]` + the element's `__mcHandSurface`. */
/** Fired (bubbling, composed) where a real hand pinch lands — the hand's
 *  stand-in for the pointerdown a mouse press would fire there. */
export const HAND_PRESS = 'mc-hand-press';
/** The pinch that a HAND_PRESS started has ended (released or hand lost). */
export const HAND_RELEASE = 'mc-hand-release';

export interface HandSurface {
  hover?(x: number, y: number): void;
  /** true if something was grabbed (a tool started, a selection moves). */
  beginDrag(x: number, y: number): boolean;
  drag(x: number, y: number): void;
  endDrag(): void;
  tap(x: number, y: number): void;
  /** A still pinch held SURFACE_HOLD_MS (the Shift+click twin: add to the
   *  selection). true = consumed — the release then does not tap. */
  hold?(x: number, y: number): boolean;
  /** Two-hand pinch over the surface (client px): anchored zoom + pan, so the
   *  plan under each finger follows that finger. */
  /** Two-hand pinch over the surface. 'move' may carry the RAW pinch points
   *  (`raw`, un-smoothed, rotation kept) for edits that must follow each hand;
   *  'cancel' = a hand was lost mid-gesture (roll back, apply nothing). */
  pinch2?(phase: 'start' | 'move' | 'end' | 'cancel', a?: { x: number; y: number }, b?: { x: number; y: number }, raw?: { a: { x: number; y: number }; b: { x: number; y: number } }): void;
}
export function handSurfaceAt(el: Element | null): HandSurface | null {
  const host = (el as HTMLElement | null)?.closest?.('[data-hand-surface]') as (HTMLElement & { __mcHandSurface?: HandSurface }) | null;
  return host?.__mcHandSurface ?? null;
}

export const DRAG_HANDLE = '[data-mc-drag-handle], [data-mc-resize-handle]';
const DRAG_MOVE_THRESHOLD_PX = 6;
/** Sideways travel that turns a pinch on a text field into a drag-select (bigger than pinch wobble). */
const TEXT_SELECT_PX = 14;
/** Single-line-ish text fields a pinch-drag can select text in (C023). */
const TEXT_SELECTABLE = 'input:not([type]), input[type=text], input[type=search], input[type=url], input[type=email], textarea';
export const SURFACE_SNAP_PX = 12;
/** Under the morph hold (900ms) so the add-to-selection hold wins on an object. */
export const SURFACE_HOLD_MS = 500;

/** Reach box: this part of the camera frame maps to the full screen, so the
 *  edges of the UI (top toolbar included) don't need an arm at full stretch.
 *  Single source of truth: HAND_FEEL.reach (central ~70% → full screen). */
export const REACH = HAND_FEEL.reach;
export { SCREEN_MARGIN_PX, EDGE_CLICK_COOLDOWN_MS } from './handEdge';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function clampToScreenMargin(p: P, w: number, h: number, margin = SCREEN_MARGIN_PX): P {
  const mx = Math.min(margin, w / 2);
  const my = Math.min(margin, h / 2);
  return { x: clamp(p.x, mx, Math.max(mx, w - mx)), y: clamp(p.y, my, Math.max(my, h - my)) };
}

/** Pure: normalised camera point -> screen px (selfie view is mirrored).
 *  The reach box maps to the full screen, then the result is clamped into
 *  the screen margin so the cursor never sits on the literal edge. */
export function mapToScreen(pt: P, w: number, h: number, mirror = true, box = REACH, marginPx = SCREEN_MARGIN_PX): P {
  const nx = mirror ? 1 - pt.x : pt.x;
  return clampToScreenMargin({
    x: clamp((nx - box.x0) / (box.x1 - box.x0), 0, 1) * w,
    y: clamp((pt.y - box.y0) / (box.y1 - box.y0), 0, 1) * h,
  }, w, h, marginPx);
}

/** Pure: thumb-index gap relative to hand size (wrist -> middle knuckle). */
export function pinchRatio(lm: readonly LM[]): number {
  const d = (a: LM, b: LM) => Math.hypot(a.x - b.x, a.y - b.y);
  const size = d(lm[0], lm[9]) || 1e-6;
  return d(lm[4], lm[8]) / size;
}

/** Thumb–index gap against a stored index tip (camera space). Used so a
 *  mid-pinch MediaPipe 8↔12 swap does not pop the live pinch band. */
export function pinchRatioTo(lm: readonly LM[], tip: P): number {
  const d = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
  const size = d(lm[0], lm[9]) || 1e-6;
  return d(lm[4], tip) / size;
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
  const scoped = modal ? out.filter((el) => modal.contains(el) || !!el.closest('[data-hand-always]')) : out;
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

/** A2-030: a control the pointer is directly over is on top at THIS point
 *  (the hit test proved it), even when another tile covers its centre — the
 *  mouse can click its visible part, so the hand must too. Same usability and
 *  modal scoping as {@link collectControls}, minus the centre-occlusion clip. */
export function usableDirectHit(doc: Document, el: HTMLElement): boolean {
  if (!isUsable(el)) return false;
  const modal = Array.from(doc.querySelectorAll<HTMLElement>('[aria-modal=true]')).find((m) => !m.hidden && m.getBoundingClientRect().height > 0);
  return !modal || modal.contains(el) || !!el.closest('[data-hand-always]');
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
  /** Slot hook: the hand was lost (camera stop or sticky timeout). */
  onLost?: () => void;
  /** Live activity feed: dwell clicks (with target) and two-fist board grabs. */
  onHandEvent?: (ev: { type: 'click' | 'grab'; target?: string | null }) => void;
  /** Two-fist board move (see createHandPointer): 'start' fires once when
   *  both fists land on the same board, 'move' with the screen-space delta
   *  (CSS px) of the fists' midpoint each frame after, 'end' when either
   *  fist opens or the fists part onto different boards. */
  onBoardMove?: (ev: { phase: 'start' | 'move' | 'end'; frameId: string; dx: number; dy: number }) => void;
  /** Slot hook (plural createHandPointer only): true while a two-fist board
   *  grab is active, on ANY slot — not just this hand's own fist pose. While
   *  true this slot's dwell/ring/click/hover all stay off, so dragging a
   *  board across the right-side buttons (or to the edge, onto another
   *  device) never glitches a hover or fires a stray click underneath. */
  isGrabActive?: () => boolean;
}

/** Magnetic focus: snap radius and ease toward the target centre. */
export const MAGNET_SNAP_PX = 60;
export const MAGNET_PULL = 0.35;
/** A held pinch via the manual pinch() API still needs this; CONFIRM_DWELL_MS
 *  is the live dwell-to-click time for Approve/Reject, same as everything
 *  else (HAND_FEEL.dwellMs). */
export const CONFIRM_PINCH_MS = 300;
export const CONFIRM_DWELL_MS = 1500;
export const CONFIRM_ACTION =
  '.mc-review-approve, .mc-review-reject, .mc-review-ask-else, .mc-trash, [data-act="drop"], [data-act="delete"]';

export function isConfirmAction(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  try { if (el.matches?.(CONFIRM_ACTION)) return true; } catch { /* ignore */ }
  const name = `${el.getAttribute?.('aria-label') || ''} ${el.textContent || ''}`.toLowerCase();
  return /\b(approve|reject|ask for something else|delete|trash)\b/.test(name);
}

export function confirmLabelFor(el: HTMLElement): string {
  return (el.getAttribute?.('aria-label') || el.textContent || 'this').replace(/\s+/g, ' ').trim().slice(0, 48);
}

/** A dropped hand stays assigned this long so a 1-frame dropout does not reset it. */
const SLOT_LOST_MS = 400;

interface SlotPointer extends HandPointer {
  isFisted(): boolean;
  /** The raw screen-space cursor point (CSS px; {x:-1,y:-1} when lost) — used
   *  by the plural createHandPointer() to hit-test both fists against the
   *  same board for a two-fist move. */
  rawPoint(): P;
  cancelPressWithoutClick(): void;
  snapshot(): {
    classification: string;
    pinchDistance: number;
    raw: P;
    eased: P;
    focusedTargetId: string | null;
    clickTarget: string | null;
    handedness?: string | null;
  };
}

export interface HandPointer {
  /** Feed a tracking frame. Up to two foreground hands each get a cursor. */
  update(hands: readonly (readonly LM[])[], now: number): void;
  /** Simulation / tests: aim at a screen point, then press / release. */
  pointAt(x: number, y: number): HTMLElement | null;
  pinch(down: boolean): void;
  readonly target: HTMLElement | null;
  readonly lastActivated: HTMLElement | null;
  /** True briefly after a pinch was used on a control (so it isn't also "keep"). */
  consumedPinch(): boolean;
  /** This pinch is doing plan work (an add-to-selection hold fired, or a
   *  drag): the 1200ms pinch-hold-still (Talk) must not also fire. */
  surfaceBusy(): boolean;
  /** The current pinch's release must NOT activate what it pressed on — a
   *  morph hold fired mid-pinch, so letting go is "done holding", not a tap
   *  on the control under the finger. One-shot; cleared on release. */
  suppressNextRelease(): void;
  setDryRun(on: boolean): void;
  lost(): void;
  destroy(): void;
  /** True while a two-fist board move is active (see createHandPointer). */
  isBoardGrabbed(): boolean;
}

function createOneHandPointer(doc: Document = document, opts: HandPointerOptions = {}): HandPointer {
  const snapPx = opts.snapPx ?? MAGNET_SNAP_PX;
  let dryRun = !!opts.dryRun;
  const euro = createOneEuroFilter(HAND_FEEL.cursorFilter);
  const deadZone = createDeadZone(HAND_FEEL.deadZonePx);
  const edge = createEdgeGuard();
  const sticky = createStickyTarget<HTMLElement>((el) => el.getBoundingClientRect(), HAND_FEEL);

  const frame = doc.createElement('div');
  frame.className = 'mc-hand-frame'; frame.setAttribute('aria-hidden', 'true'); frame.hidden = true;
  // Small macOS-style coral arrow (default) / 4-arrow move cursor (fist) —
  // replaces the old 56px shadow + press ring. Hotspot is the SVG's own
  // drawn tip (arrow) or its centre (fist, via a CSS -50%/-50% transform),
  // so no per-frame hotspot math is needed here.
  const cursor = doc.createElement('div');
  cursor.className = 'mc-hand-cursor'; cursor.setAttribute('aria-hidden', 'true'); cursor.hidden = true;
  const dwellRing = doc.createElement('div');
  dwellRing.className = 'mc-hand-dwell';
  dwellRing.setAttribute('aria-hidden', 'true');
  dwellRing.hidden = true;
  if (typeof cursor.append === 'function') cursor.append(dwellRing);
  const confirmEl = doc.createElement('div');
  confirmEl.className = 'mc-hand-confirm';
  confirmEl.setAttribute('aria-hidden', 'true');
  confirmEl.hidden = true;
  doc.body.append(frame, cursor, confirmEl);

  let controls: HTMLElement[] = []; let controlsAt = -Infinity;
  let target: HTMLElement | null = null;
  let pressedOn: HTMLElement | null = null;
  let dragging: HTMLInputElement | null = null;
  let draggingHandle: HTMLElement | null = null;
  // Pinch on a hand surface (floor plan): tap if still, drag once it moves.
  let surface: HandSurface | null = null;
  let surfaceStart: P = { x: 0, y: 0 };
  let surfaceDragging = false;
  let surfaceHeld = false;
  let surfaceHoldTimer: ReturnType<typeof setTimeout> | null = null;
  const clearSurfaceHold = () => { if (surfaceHoldTimer) { clearTimeout(surfaceHoldTimer); surfaceHoldTimer = null; } };
  let dragHandleStart: P = { x: 0, y: 0 };
  let dragHandleMoved = false;
  // C023: a pinch that starts on a text field and drags across it selects text.
  let textEl: HTMLInputElement | HTMLTextAreaElement | null = null;
  let textStart: P = { x: 0, y: 0 };
  let textSelecting = false;
  let pinched = false;
  // Fisted hand: shown as the move cursor, never clicks or dwells. Only the
  // plural createHandPointer() gives it meaning (a two-fist board move).
  let fisted = false;
  let lastActivated: HTMLElement | null = null;
  let clickTraceId: string | null = null;
  let consumedUntil = -Infinity;
  let suppressRelease = false;
  let pt: P = { x: -1, y: -1 };
  let lostTimer: ReturnType<typeof setTimeout> | null = null;
  let dwellStart = 0;
  let dwellOrigin: P | null = null;
  let dwellTarget: HTMLElement | null = null;
  let dwellFiredFor: HTMLElement | null = null;
  let dwellProgress = 0;
  let lastHandedness: string | null = null;
  const pointFist = createPointFistGate();
  let confirmStarted = 0;
  let lastClass = 'none';
  let lastRatio = 0;
  let clock = 0;

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

  /** Target under the RAW fingertip — never a magnet/snap neighbour. */
  function rawInteractiveHit(p: P): HTMLElement | null {
    refreshControls();
    const raw = deepElementFromPoint(doc, p.x, p.y);
    const direct = interactiveAncestor(raw);
    if (direct && (controls.includes(direct) || usableDirectHit(doc, direct))) return direct;
    return null;
  }

  /** Snap only when the raw point is over empty space near a control. */
  function snapNear(p: P): HTMLElement | null {
    refreshControls();
    const raw = deepElementFromPoint(doc, p.x, p.y);
    const r = raw && handSurfaceAt(raw) ? Math.min(snapPx, SURFACE_SNAP_PX) : snapPx;
    const near = pickNearest(p, controls.map((el) => ({ item: el, rect: el.getBoundingClientRect() })), r);
    if (near) return near;
    const dismiss = (raw as HTMLElement | null)?.closest?.('[data-hand-dismiss]') as HTMLElement | null;
    return dismiss ?? null;
  }

  /** A board (.mc-frame) under the raw point — the fallback dwell target
   *  when nothing more specific (a button, a snap neighbour) is there, so
   *  dwelling on an otherwise-empty board still selects/focuses it. */
  function boardAt(p: P): HTMLElement | null {
    const raw = deepElementFromPoint(doc, p.x, p.y);
    return ((raw as HTMLElement | null)?.closest?.('.mc-frame') as HTMLElement | null) ?? null;
  }

  function paintConfirm(el: HTMLElement | null, on: boolean): void {
    if (!on || !el || !isConfirmAction(el)) { confirmEl.hidden = true; return; }
    confirmEl.hidden = false;
    confirmEl.textContent = confirmLabelFor(el);
    const r = el.getBoundingClientRect();
    confirmEl.style.left = `${r.left + r.width / 2}px`;
    confirmEl.style.top = `${r.top}px`;
  }

  // A dismiss scrim is a target but not a "thing": keep the plain cursor at
  // the fingertip instead of framing the whole screen.
  const isDismiss = (el: HTMLElement | null) => !!el && el.getAttribute?.('data-hand-dismiss') != null;
  function paint() {
    if (target && !isDismiss(target)) {
      const r = target.getBoundingClientRect();
      frame.hidden = false;
      frame.style.transform = `translate(${r.left - 4}px, ${r.top - 4}px)`;
      frame.style.width = `${r.width + 8}px`; frame.style.height = `${r.height + 8}px`;
      frame.classList.toggle('is-pressed', pinched);
    } else {
      frame.hidden = true;
    }
    cursor.hidden = pt.x < 0;
    cursor.classList.toggle('is-pinched', pinched);
    cursor.classList.toggle('is-fist', fisted);
    if (dwellRing) {
      dwellRing.hidden = dwellProgress <= 0;
      const style = dwellRing.style as CSSStyleDeclaration & { setProperty?: (k: string, v: string) => void };
      if (typeof style.setProperty === 'function') style.setProperty('--mc-dwell', String(dwellProgress));
      else (style as unknown as Record<string, string>)['--mc-dwell'] = String(dwellProgress);
    }
    // Visual cursor eases toward the focused target centre (the magnet).
    // Hit-testing and pinch/dwell still use the raw fingertip `pt` + snap.
    paintConfirm(target, !!(pinched || (dwellProgress > 0 && isConfirmAction(target))));
    const shown = displayPoint(pt);
    cursor.style.transform = fisted
      ? `translate(${shown.x}px, ${shown.y}px) translate(-50%, -50%)`
      : `translate(${shown.x}px, ${shown.y}px)`;
  }

  function displayPoint(p: P): P {
    if (fisted || !target || isDismiss(target)) return p;
    const r = target.getBoundingClientRect();
    return magnetPull(p, { x: r.left, y: r.top, width: r.width, height: r.height }, MAGNET_PULL);
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
    if (edge.blockClicks(clock || now())) return;
    lastActivated = el;
    clickTraceId = targetIdOf(el);
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
      // Tell the canvas a HAND focused this field (mouse focus never fires
      // this) so it can dock the on-screen keyboard — see handKeyboard.ts.
      el.dispatchEvent(new CustomEvent('mc-hand-text-focus', { bubbles: true, composed: true }));
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
  function startFling(vel?: { vx: number; vy: number }) {
    const el = scrollEl;
    const { vx, vy } = vel ?? dragVel.velocity(now());
    momentum.start(scrollAxes.x ? vx : 0, scrollAxes.y ? vy : 0);
    if (!el || dryRun || !rafAvailable || !momentum.active) return;
    let last = now();
    const step = (ts?: number) => {
      const t = typeof ts === 'number' ? ts : now(); const dt = Math.min(48, Math.max(0, t - last)); last = t;
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
    if (!down && !dryRun) (doc as Document & { dispatchEvent?: (e: Event) => boolean }).dispatchEvent?.(new CustomEvent(HAND_RELEASE));
    if (down) {
      pressedOn = target;
      confirmStarted = (target && isConfirmAction(target)) ? clock || now() : 0;
      paintConfirm(target, !!(target && isConfirmAction(target)));
      // A mouse press fires pointerdown wherever it lands, which "click away"
      // dismissers listen for (swarmDock's mini terminal). The hand's clicks
      // carry no pointerdown, so announce the press itself.
      if (!dryRun) {
        const under = target ?? deepElementFromPoint(doc, pt.x, pt.y) ?? doc.documentElement;
        under?.dispatchEvent?.(new CustomEvent(HAND_PRESS, { bubbles: true, composed: true, detail: { x: pt.x, y: pt.y } }));
      }
      if (target && !dryRun && target.matches(TEXT_SELECTABLE)) {
        textEl = target as HTMLInputElement | HTMLTextAreaElement; textStart = pt; textSelecting = false;
      }
      if (target && target.matches('input[type=range]')) { dragging = target as HTMLInputElement; dragTo(pt.x); consumedUntil = now() + 700; }
      else if (target && target.matches(DRAG_HANDLE)) {
        draggingHandle = target; dragHandleStart = pt; dragHandleMoved = false;
        dispatchDragEvent(target, 'pointerdown', pt);
        consumedUntil = now() + 700;
      }
      else if (!target && !dryRun && (surface = handSurfaceAt(deepElementFromPoint(doc, pt.x, pt.y)))) {
        surfaceStart = pt; surfaceDragging = false; surfaceHeld = false;
        consumedUntil = now() + 700;
        clearSurfaceHold();
        const s0 = surface;
        if (s0.hold) surfaceHoldTimer = setTimeout(() => {
          surfaceHoldTimer = null;
          if (surface !== s0 || !pinched || surfaceDragging) return;
          if (s0.hold?.(surfaceStart.x, surfaceStart.y)) {
            surfaceHeld = true;
            // The hold was ours: stop the morph hold arming on the same pinch.
            opts.onPinch?.({ phase: 'cancel', p: pt, now: now() });
            cursor.classList.add('mc-hand-ring-held');
            setTimeout(() => cursor.classList.remove('mc-hand-ring-held'), 300);
          }
        }, SURFACE_HOLD_MS);
      }
      else if (!target) {
        // A mouse press on empty space blurs the focused text field; a pinch
        // on empty space does the same (and so closes the hand keyboard).
        if (!dryRun) {
          const a = doc.activeElement as HTMLElement | null;
          if (a?.matches?.('input, textarea, [contenteditable=true]')) a.blur();
        }
        opts.onEmptyPinch?.();
      }
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
      if (textEl && textSelecting) {
        // A drag-select ends with the range in place — no click to collapse it.
        lastActivated = textEl; textEl = null; textSelecting = false;
        suppressRelease = false; pressedOn = null; scrollEl = null; scrolled = false;
        refreshControls(true); paint();
        return;
      }
      const tapText = textEl; textEl = null;
      if (surface) {
        clearSurfaceHold();
        if (surfaceDragging) surface.endDrag();
        else if (!suppressRelease && !surfaceHeld) surface.tap(surfaceStart.x, surfaceStart.y);
        surface = null; surfaceDragging = false; surfaceHeld = false;
        suppressRelease = false; pressedOn = null;
        paint();
        return;
      }
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
      } else if (pressedOn && pressedOn === target) {
        if (isConfirmAction(pressedOn) && ((clock || now()) - confirmStarted) < CONFIRM_PINCH_MS) {
          // Decision buttons need a ~300 ms held press (or the live dwell).
        } else {
          activate(pressedOn);
        }
        // A tap on a text field puts the caret where it landed, as a click does.
        if (tapText && pressedOn === tapText && !dryRun) {
          const i = fieldCaretAt(tapText, textStart.x);
          try { tapText.setSelectionRange(i, i); } catch { /* type=number etc. */ }
        }
      }
      scrollEl = null; scrolled = false;
      suppressRelease = false;
      pressedOn = null;
      refreshControls(true);
    }
    paint();
  }

  function resetDwell(): void {
    dwellStart = 0; dwellOrigin = null; dwellTarget = null; dwellProgress = 0;
  }

  /** Dwell-click: resting the index-tip cursor on a control for dwellMs,
   *  within dwellSlopPx, fills a ring then clicks once. Disabled during a
   *  fist or any drag. Does not re-fire until the cursor leaves the control. */
  function tickDwell(p: P, t: number, allowed: boolean): void {
    const busy = pinched || fisted || !!dragging || !!draggingHandle || surfaceDragging || textSelecting || scrolled || edge.blockClicks(t);
    const el = target;
    if (!allowed || busy || !el || isDismiss(el)) {
      if (!el || el !== dwellFiredFor) dwellFiredFor = el ? dwellFiredFor : null;
      if (!el) dwellFiredFor = null;
      resetDwell();
      return;
    }
    if (dwellFiredFor === el) { dwellProgress = 0; return; }
    if (dwellTarget !== el || !dwellOrigin) {
      dwellTarget = el;
      dwellStart = t;
      dwellOrigin = { x: p.x, y: p.y };
      dwellProgress = 0;
      return;
    }
    // Moving past the slop while still on the same target restarts the dwell
    // — a deliberate move, not tremor.
    if (Math.hypot(p.x - dwellOrigin.x, p.y - dwellOrigin.y) > HAND_FEEL.dwellSlopPx) {
      dwellStart = t;
      dwellOrigin = { x: p.x, y: p.y };
      dwellProgress = 0;
      return;
    }
    dwellProgress = Math.min(1, (t - dwellStart) / HAND_FEEL.dwellMs);
    if (dwellProgress >= 1) {
      activate(el);
      opts.onHandEvent?.({ type: 'click', target: targetIdOf(el) });
      dwellFiredFor = el;
      resetDwell();
    }
  }

  function aim(p: P, stickyNow?: number, dwellAt?: number, dwellOn = true): HTMLElement | null {
    pt = p;
    if (dragging) { dragTo(p.x); paint(); return dragging; }
    if (surface) {
      if (!surfaceDragging && !surfaceHeld && Math.hypot(p.x - surfaceStart.x, p.y - surfaceStart.y) > DRAG_MOVE_THRESHOLD_PX) {
        clearSurfaceHold();
        surfaceDragging = true;
        // A plan drag is never a tile morph: drop the morph hold for this pinch.
        opts.onPinch?.({ phase: 'cancel', p, now: now() });
        surface.beginDrag(surfaceStart.x, surfaceStart.y);
      }
      if (surfaceDragging) surface.drag(p.x, p.y);
      paint();
      return null;
    }
    if (textEl && pinched && !suppressRelease) {
      const dx = p.x - textStart.x; const dy = p.y - textStart.y;
      if (!textSelecting) {
        if (Math.abs(dx) > TEXT_SELECT_PX && Math.abs(dx) >= Math.abs(dy)) {
          textSelecting = true;
          scrollEl = null; scrolled = false;
          opts.onPinch?.({ phase: 'cancel', p, now: now() }); // a text drag is never a morph hold
          if (doc.activeElement !== textEl) activate(textEl);
        } else if (Math.abs(dy) > TEXT_SELECT_PX && scrollEl) {
          // Mostly vertical over a field in a scroll list: that's a scroll.
          textEl = null; scrollDrag(p); return target;
        } else { paint(); return target; } // pinch wobble: stay a tap on the field
      }
      const a = fieldCaretAt(textEl, textStart.x); const b = fieldCaretAt(textEl, p.x);
      try { textEl.setSelectionRange(Math.min(a, b), Math.max(a, b), b < a ? 'backward' : 'forward'); } catch { /* type=number etc. */ }
      paint();
      return textEl;
    }
    if (draggingHandle) {
      if (Math.hypot(p.x - dragHandleStart.x, p.y - dragHandleStart.y) > DRAG_MOVE_THRESHOLD_PX) dragHandleMoved = true;
      dispatchDragEvent(draggingHandle, 'pointermove', p);
      paint();
      return draggingHandle;
    }
    // A two-fist board grab is active (on any slot, not just this hand's own
    // fist): no hover, no ring, no dwell, no click, while the board drags
    // under the cursor — across the right-side buttons, to the edge, or onto
    // another device.
    if (opts.isGrabActive?.()) {
      if (target) setTarget(null);
      if (tipEl) { tipEl = null; opts.onTooltip?.(null, null); }
      resetDwell();
      paint();
      return null;
    }
    const direct = rawInteractiveHit(p);
    // A board with no more specific control under the point is still a valid
    // dwell target — dwelling on it selects/focuses it (world's click
    // handler does the focusing once `activate()` clicks the frame).
    const resolved = direct ?? snapNear(p) ?? boardAt(p);
    // A raw hit always wins — sticky/magnet must never keep a neighbour
    // (Approve vs Reject). Sticky only applies to empty-space snaps.
    if (direct) {
      sticky.update(direct, p, stickyNow ?? 0);
      setTarget(direct);
    } else {
      setTarget(stickyNow !== undefined ? sticky.update(resolved, p, stickyNow) : resolved);
    }
    if (!target && !pinched && !dryRun) handSurfaceAt(deepElementFromPoint(doc, p.x, p.y))?.hover?.(p.x, p.y);
    emitTooltip(target);
    if (dwellAt !== undefined) tickDwell(p, dwellAt, dwellOn);
    paint();
    return target;
  }

  function lost() {
    if (pinched || fisted) {
      if (draggingHandle) dispatchDragEvent(draggingHandle, 'pointercancel', pt);
      // C169: a slider keeps the value it reached (no snap back, no fling) — so
      // finish it like a release does, or 'change' listeners never see it.
      if (dragging && !dryRun) dragging.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      if (surface && surfaceDragging) surface.endDrag(); // hand left mid-drag: finish, never leave it stuck
      surface = null; surfaceDragging = false; surfaceHeld = false; clearSurfaceHold();
      textEl = null; textSelecting = false; // a hand lost mid-select keeps the range it made
      pinched = false; fisted = false; dragging = null; pressedOn = null; draggingHandle = null;
      scrollEl = null; scrolled = false; cancelFling(); dragVel.reset();
      suppressRelease = false; confirmStarted = 0;
      paintConfirm(null, false);
      opts.onPinch?.({ phase: 'cancel', p: pt, now: now() });
      if (!dryRun) (doc as Document & { dispatchEvent?: (e: Event) => boolean }).dispatchEvent?.(new CustomEvent(HAND_RELEASE));
    }
    setTarget(null); pt = { x: -1, y: -1 };
    dwellStart = 0; dwellOrigin = null; dwellTarget = null; dwellFiredFor = null; dwellProgress = 0;
    if (tipEl) { tipEl = null; opts.onTooltip?.(null, null); }
    euro.reset(); deadZone.reset(); sticky.reset(); pointFist.reset(); clickTraceId = null;
    edge.markLeave(clock || now(), pt.x >= 0 ? pt : null);
    paint();
    opts.onLost?.();
  }

  function cancelPressWithoutClick() {
    if (!pinched) return;
    suppressRelease = true;
    press(false);
  }

  return {
    update(hands, t) {
      clock = t;
      const h = pickPrimaryHand(hands as readonly (readonly { x: number; y: number }[])[]);
      if (!h) return;
      if (lostTimer) clearTimeout(lostTimer);
      lostTimer = setTimeout(lost, 400);

      // Hotspot is ALWAYS this hand's INDEX FINGERTIP (landmark 8) — never
      // the thumb, never the middle tip (12), never a midpoint.
      const tip = h[INDEX_TIP];
      if (!tip) return;

      // `handedness` is a trace label only (see gestures.ts) — classifyGesture
      // and the point/fist gate use the same raw-landmark math for both hands.
      lastHandedness = handLabelOf(h) ?? lastHandedness;
      const rawClass = classifyGesture(h as unknown as GesturePt[]);
      const rawPose = pointFist.update(rawClass, h as unknown as GesturePt[], t, lastHandedness);
      lastRatio = pinchRatio(h);

      const mappedLive = deadZone.apply(mapToScreen(tip, innerWidth, innerHeight));
      const nearEdge = isEdgeFrame(h, tip, innerWidth, innerHeight, true);
      const wasEdge = edge.atEdge;
      edge.observe(nearEdge, rawPose, mappedLive, t);
      const pose = edge.pose(rawPose);
      lastClass = pose;
      if (nearEdge && !wasEdge) resetDwell(); // distorted edge landmarks must not finish a dwell

      // A fist is the ONLY other gesture (a two-fist board move — see the
      // plural createHandPointer below). It never clicks or drags by itself:
      // dwell is simply disabled while fisted.
      fisted = pose === 'fist' && !edge.atEdge;

      let live: P;
      if (edge.atEdge || (edge.blockClicks(t) && wasEdge)) {
        live = edge.applyCursor(mappedLive, t);
      } else {
        const s = euro.filter(tip.x, tip.y, t);
        live = edge.applyCursor(deadZone.apply(mapToScreen(s, innerWidth, innerHeight)), t);
      }

      aim(live, t, t, !fisted);
    },
    pointAt(x, y) { return aim({ x, y }); },
    pinch: press,
    get target() { return target; },
    get lastActivated() { return lastActivated; },
    consumedPinch: () => now() < consumedUntil || !!target || !!surface,
    surfaceBusy: () => !!surface && (surfaceHeld || surfaceDragging),
    suppressNextRelease() { if (pinched) suppressRelease = true; },
    setDryRun(on) { dryRun = on; },
    lost,
    destroy() { lost(); if (lostTimer) clearTimeout(lostTimer); frame.remove(); cursor.remove(); confirmEl.remove(); },
    isBoardGrabbed: () => false,
    isFisted: () => fisted,
    rawPoint: () => ({ ...pt }),
    cancelPressWithoutClick,
    snapshot: () => {
      const clickTarget = clickTraceId;
      clickTraceId = null;
      return {
        classification: lastClass,
        pinchDistance: lastRatio,
        raw: { ...pt },
        eased: displayPoint(pt),
        focusedTargetId: targetIdOf(target),
        clickTarget,
        handedness: lastHandedness,
      };
    },
  } as SlotPointer;
}

/** Public pointer: one coral cursor per foreground hand (max two), each with
 *  its own pinch-click and fist-drag state. Tests and the sim hook still use
 *  pointAt/pinch on the first slot. */
export function createHandPointer(doc: Document = document, opts: HandPointerOptions = {}): HandPointer {
  getGestureTrace();
  const active = [false, false];
  const prevTips: (P | null)[] = [null, null];
  const lastSeen = [-Infinity, -Infinity];
  // Two-fist board move: both fists' raw cursors over the SAME board. The
  // grabbed frame id and the fists' last midpoint (screen px) while active.
  let grabFrameId: string | null = null;
  let grabMid: P | null = null;
  const slots: SlotPointer[] = [0, 1].map((i) =>
    createOneHandPointer(doc, {
      ...opts,
      // Read fresh each call: true from the moment both fists land on the
      // same board (set at the bottom of update() below) until either opens
      // or they part — one frame behind the grab's own start/end, same as
      // every other cross-slot signal here (bothFisted, sameBoard).
      isGrabActive: () => !!grabFrameId,
      onLost() {
        active[i] = false;
        prevTips[i] = null;
        lastSeen[i] = -Infinity;
        opts.onLost?.();
      },
    }) as SlotPointer,
  );
  const tipOf = (h: readonly LM[]): P | null => {
    const p = h[INDEX_TIP] ?? h[0];
    return p ? { x: p.x, y: p.y } : null;
  };
  const frameIdAt = (p: P): string | null => {
    if (p.x < 0) return null;
    const raw = deepElementFromPoint(doc, p.x, p.y);
    return ((raw as HTMLElement | null)?.closest?.('.mc-frame') as HTMLElement | null)?.dataset.frame ?? null;
  };
  function endGrab(): void {
    if (!grabFrameId) return;
    opts.onBoardMove?.({ phase: 'end', frameId: grabFrameId, dx: 0, dy: 0 });
    grabFrameId = null;
    grabMid = null;
  }
  return {
    update(hands, t) {
      // Each slot is an independent FSM. Feed every present hand with its
      // own pose/dwell state; never reset or steal the other.
      const fg = pickForegroundHands(hands as readonly (readonly { x: number; y: number }[])[], 2);
      const assigned = assignHandSlots(fg, prevTips);
      for (let i = 0; i < slots.length; i++) {
        const h = assigned[i];
        if (h) {
          slots[i].update([h], t);
          active[i] = true;
          prevTips[i] = tipOf(h);
          lastSeen[i] = t;
          const snap = slots[i].snapshot();
          getGestureTrace().push({ t, hand: i, ...snap });
        } else if (active[i] && t - lastSeen[i] >= SLOT_LOST_MS) {
          slots[i].lost();
        }
      }

      const bothFisted = slots[0].isFisted() && slots[1].isFisted();
      const p0 = slots[0].rawPoint();
      const p1 = slots[1].rawPoint();
      const sameBoard = bothFisted ? frameIdAt(p0) : null;
      const onSameBoard = bothFisted && sameBoard && sameBoard === frameIdAt(p1) ? sameBoard : null;
      if (onSameBoard) {
        const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        if (grabFrameId !== onSameBoard) {
          grabFrameId = onSameBoard;
          grabMid = mid;
          opts.onHandEvent?.({ type: 'grab', target: onSameBoard });
          opts.onBoardMove?.({ phase: 'start', frameId: onSameBoard, dx: 0, dy: 0 });
        } else if (grabMid) {
          const dx = mid.x - grabMid.x, dy = mid.y - grabMid.y;
          grabMid = mid;
          if (dx || dy) opts.onBoardMove?.({ phase: 'move', frameId: onSameBoard, dx, dy });
        }
      } else {
        endGrab();
      }
    },
    pointAt(x, y) { return slots[0].pointAt(x, y); },
    pinch: (down) => slots[0].pinch(down),
    get target() { return slots[0].target ?? slots[1].target; },
    get lastActivated() { return slots[0].lastActivated ?? slots[1].lastActivated; },
    consumedPinch: () => slots[0].consumedPinch() || slots[1].consumedPinch(),
    surfaceBusy: () => slots[0].surfaceBusy() || slots[1].surfaceBusy(),
    suppressNextRelease() { slots[0].suppressNextRelease(); slots[1].suppressNextRelease(); },
    setDryRun(on) { slots[0].setDryRun(on); slots[1].setDryRun(on); },
    lost() { endGrab(); slots[0].lost(); slots[1].lost(); active[0] = active[1] = false; prevTips[0] = prevTips[1] = null; lastSeen[0] = lastSeen[1] = -Infinity; },
    destroy() { slots[0].destroy(); slots[1].destroy(); },
    isBoardGrabbed: () => !!grabFrameId,
  };
}
