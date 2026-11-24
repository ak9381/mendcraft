// HAND POINTER: every on-screen control is reachable with a hand.
//
// The cursor and click always sit on the INDEX FINGERTIP (landmark 8) of the
// same hand — never the thumb, never the middle tip (12), never a midpoint.
// On pinch close the point FREEZES at the smoothed landmark-8 position from
// just before the fingers started closing (~100 ms lookback), so a tracker
// swap of 8↔12 mid-pinch cannot drag the click onto the middle finger. The
// fingertip is smoothed with a one-euro filter and mapped from a
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
import { createDragVelocity, createMomentum, scrollableAncestor, pickPalmScroller, SCROLL_ENTER_MS, SCROLL_EXIT_MS, palmCentroid, createPalmScroll } from './handScroll';
import { magnetPull, tooltipTextFor } from '../ui/handHover';
import { getGestureTrace, targetIdOf } from './gestureTrace';
import { createEdgeGuard, isEdgeFrame, SCREEN_MARGIN_PX } from './handEdge';
import { handLabelOf } from './handSpace';
import { fieldCaretAt } from '../input/caretAt';
import { INDEX_TIP, PINCH_LIVE } from '../input/handLogic';
import { createPinchBaseline } from '../input/pinchBaseline';
import { classifyGesture, createPointFistGate, isClosingToFist, isTwoFingerScrollPose, type Pt as GesturePt } from '../input/gestures';
import {
  HAND_FEEL,
  createDeadZone,
  createPinchMachine,
  createPositionHistory,
  createScalarEuro,
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
  /** Live activity feed: pinch clicks (with target), two-finger scrolls, fist grabs. */
  onHandEvent?: (ev: { type: 'pinch-click' | 'scroll' | 'grab'; target?: string | null }) => void;
}

/** Both hands' pinch-down times must fall in this window to start two-hand zoom. */
export const TWO_HAND_ZOOM_MS = 250;
/** Magnetic focus: snap radius and ease toward the target centre. */
export const MAGNET_SNAP_PX = 60;
export const MAGNET_PULL = 0.35;
/** Destructive / decision actions need a held pinch or a dwell before they fire. */
export const CONFIRM_PINCH_MS = 300;
export const CONFIRM_DWELL_MS = 400;
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
  isPinchHeld(): boolean;
  isFisted(): boolean;
  pinchDownAt(): number | null;
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
  update(hands: readonly (readonly LM[])[], now: number, flags?: { interact?: boolean }): void;
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
  /** True while both hands are in a two-hand pinch-zoom (clicks cancelled). */
  isTwoHandZooming(): boolean;
}

function createOneHandPointer(doc: Document = document, opts: HandPointerOptions = {}): HandPointer {
  const snapPx = opts.snapPx ?? MAGNET_SNAP_PX;
  let dryRun = !!opts.dryRun;
  const euro = createOneEuroFilter(HAND_FEEL.cursorFilter);
  const ratioEuro = createScalarEuro(HAND_FEEL.pinchFilter);
  const deadZone = createDeadZone(HAND_FEEL.deadZonePx);
  const pinchFsm = createPinchMachine(HAND_FEEL);
  const edge = createEdgeGuard();
  const pinchBase = createPinchBaseline();
  const history = createPositionHistory(HAND_FEEL.freezeLookbackMs + 300);
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
  // Fist (grab/move): a separate gesture from pinch — tracked on its own so
  // a fist's naturally-low thumb/index ratio never also engages pinchFsm and
  // fires a click. Reuses draggingHandle/surface (and their *Start state) for
  // the live drag itself, same as pinch, but never taps on release.
  let fisted = false;
  let liftedEl: HTMLElement | null = null;
  let lastActivated: HTMLElement | null = null;
  let clickTraceId: string | null = null;
  let consumedUntil = -Infinity;
  let suppressRelease = false;
  let pt: P = { x: -1, y: -1 };
  let lostTimer: ReturnType<typeof setTimeout> | null = null;
  // Pre-pinch lock: last clearly-open landmark-8 screen point, and the frozen
  // click/cursor point once a pinch engages. Never updated from live tips
  // while the hand is closing (MediaPipe often swaps 8 with 12).
  let lastOpenTip: P | null = null;
  let frozen: P | null = null;
  // Last camera-space index tip while the thumb–index gap was still inside
  // the off-threshold — a mid-pinch 8 jump does not overwrite this.
  let pinchAnchor: P | null = null;
  let dwellStart = 0;
  let dwellOrigin: P | null = null;
  let dwellTarget: HTMLElement | null = null;
  let dwellFiredFor: HTMLElement | null = null;
  let dwellProgress = 0;
  let pinchHeld = false;
  let pinchDownTs: number | null = null;
  let palmSince = -1;
  let palmExitSince = -1;
  let palmScrolling = false;
  let lastHandedness: string | null = null;
  const pointFist = createPointFistGate();
  const palmMotion = createPalmScroll();
  let pinchFocus: HTMLElement | null = null;
  let confirmStarted = 0;
  let fistScrolling = false;
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

  function resolve(p: P): HTMLElement | null {
    return rawInteractiveHit(p) ?? snapNear(p);
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
    cursor.classList.toggle('is-palm-scroll', palmScrolling);
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
    if (fisted || palmScrolling || !target || isDismiss(target)) return p;
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

  function ensurePalmRaf() {
    if (flingRaf || dryRun || !rafAvailable || !scrollEl) return;
    let last = now();
    const step = (ts: number) => {
      const dt = Math.min(48, Math.max(0, ts - last));
      last = ts;
      if (palmScrolling && scrollEl) {
        scrollEl.scrollTop -= palmMotion.tick(dt);
        flingRaf = requestAnimationFrame(step);
        return;
      }
      flingRaf = 0;
    };
    flingRaf = requestAnimationFrame(step);
  }

  function endPalmScroll() {
    if (!palmScrolling) return;
    const vy = palmMotion.release();
    palmScrolling = false;
    palmSince = -1;
    palmExitSince = -1;
    if (flingRaf && typeof cancelAnimationFrame === 'function') { cancelAnimationFrame(flingRaf); flingRaf = 0; }
    startFling({ vx: 0, vy });
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
          // Decision buttons need a ~300 ms held pinch (or a 400 ms dwell).
        } else {
          activate(pressedOn);
          opts.onHandEvent?.({ type: 'pinch-click', target: targetIdOf(pressedOn) });
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

  /** Fist "down": arm a drag handle or hand surface exactly like a pinch-down
   *  would, but WITHOUT the tap-on-release behaviour pinch has — a fist that
   *  never moves must do nothing, never click. Sliders are excluded: those
   *  stay pinch-only. */
  function fistDown(p: P): void {
    const resolved = resolve(p);
    const handle = closestTileHandle(resolved, p);
    if (handle) {
      draggingHandle = handle;
      dragHandleStart = p;
      dragHandleMoved = false;
      dispatchDragEvent(handle, 'pointerdown', p);
      liftTile(handle, true);
      const grabRoot = handle.closest?.('.mc-review-dialog, .mc-edit-item, .mc-terminal, .mc-ai') as HTMLElement | null;
      opts.onHandEvent?.({ type: 'grab', target: grabRoot?.classList?.contains('mc-review-dialog') ? 'Review' : targetIdOf(grabRoot ?? handle) });
    } else {
      const hit = deepElementFromPoint(doc, p.x, p.y);
      const scroller = pickPalmScroller(hit, [
        (hit as HTMLElement | null)?.closest?.('.mc-review-body'),
        (hit as HTMLElement | null)?.closest?.('.mc-ai-body'),
        (hit as HTMLElement | null)?.closest?.('.mc-term-body'),
        (hit as HTMLElement | null)?.closest?.('.mc-frame-body'),
        ...palmFallbacks(),
      ]);
      if (scroller) {
        cancelFling();
        dragVel.reset();
        scrollEl = scroller;
        scrollAxes = { x: false, y: true };
        scrollStart = p; scrollLast = p; scrolled = false;
        fistScrolling = true;
        dragVel.push(p.x, p.y, now());
      } else if (!resolved) {
        // Empty board: pan the hand surface.
        surface = handSurfaceAt(hit);
        if (surface) { surfaceStart = p; surfaceDragging = false; surfaceHeld = false; }
      }
    }
  }

  /** Fist "up": end whatever drag was running — never a tap, never a click. */
  function fistUp(p: P): void {
    if (draggingHandle) {
      dispatchDragEvent(draggingHandle, 'pointerup', p);
      liftTile(draggingHandle, false);
      draggingHandle = null;
      dragHandleMoved = false;
    }
    if (surface) {
      if (surfaceDragging) surface.endDrag();
      surface = null; surfaceDragging = false; surfaceHeld = false;
    }
    if (fistScrolling) {
      if (scrolled) startFling();
      fistScrolling = false;
      scrollEl = null; scrolled = false;
    }
    liftTile(null, false);
    paint();
  }

  function closestTileHandle(resolved: HTMLElement | null, p: P): HTMLElement | null {
    if (resolved?.matches?.(DRAG_HANDLE)) return resolved;
    const raw = (deepElementFromPoint(doc, p.x, p.y) as HTMLElement | null) ?? resolved;
    if (!raw) return null;
    if (raw.matches?.(DRAG_HANDLE)) return raw;
    const handle = raw.closest?.(DRAG_HANDLE) as HTMLElement | null;
    if (handle) return handle;
    const item = raw.closest?.('.mc-edit-item') as HTMLElement | null;
    return (item?.querySelector?.('[data-mc-drag-handle]') as HTMLElement | null) ?? null;
  }

  function liftTile(from: HTMLElement | null, on: boolean): void {
    if (liftedEl && liftedEl !== from) liftedEl.classList.remove('is-hand-lift');
    const item = from?.closest?.('.mc-edit-item') as HTMLElement | null;
    liftedEl = on ? item : null;
    if (item) item.classList.toggle('is-hand-lift', on);
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
    // Tremor-proof: once this control is focused, jitter of the raw
    // fingertip must not restart the dwell — pinch/dwell click the focus.
    if (el !== dwellTarget && Math.hypot(p.x - dwellOrigin.x, p.y - dwellOrigin.y) > HAND_FEEL.dwellSlopPx) {
      dwellStart = t;
      dwellOrigin = { x: p.x, y: p.y };
      dwellProgress = 0;
      return;
    }
    const need = isConfirmAction(el) ? CONFIRM_DWELL_MS : HAND_FEEL.dwellMs;
    dwellProgress = Math.min(1, (t - dwellStart) / need);
    if (dwellProgress >= 1) {
      activate(el);
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
    if (pinchFocus && (pinched || pinchHeld)) {
      setTarget(pinchFocus);
      pt = p;
      emitTooltip(target);
      if (dwellAt !== undefined) tickDwell(p, dwellAt, dwellOn);
      paint();
      return target;
    }
    const direct = rawInteractiveHit(p);
    const resolved = direct ?? snapNear(p);
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
      suppressRelease = false;
      pinchHeld = false; pinchDownTs = null;
      palmScrolling = false; palmSince = -1; palmExitSince = -1; palmMotion.reset(); palmMotion.reset();
      pinchFocus = null; confirmStarted = 0; fistScrolling = false;
      paintConfirm(null, false);
      liftTile(null, false);
      opts.onPinch?.({ phase: 'cancel', p: pt, now: now() });
      if (!dryRun) (doc as Document & { dispatchEvent?: (e: Event) => boolean }).dispatchEvent?.(new CustomEvent(HAND_RELEASE));
    }
    setTarget(null); pt = { x: -1, y: -1 };
    lastOpenTip = null; frozen = null; pinchAnchor = null;
    dwellStart = 0; dwellOrigin = null; dwellTarget = null; dwellFiredFor = null; dwellProgress = 0;
    if (tipEl) { tipEl = null; opts.onTooltip?.(null, null); }
    euro.reset(); ratioEuro.reset(); deadZone.reset(); pinchFsm.reset(); pinchBase.reset(); history.reset(); sticky.reset(); pointFist.reset(); clickTraceId = null;
    edge.markLeave(clock || now(), pt.x >= 0 ? pt : null);
    pinchHeld = false; pinchDownTs = null;
    palmScrolling = false; palmSince = -1; palmExitSince = -1; palmMotion.reset();
    paint();
    opts.onLost?.();
  }

  function cancelPressWithoutClick() {
    if (!pinched) return;
    suppressRelease = true;
    press(false);
  }

  function palmFallbacks(): Array<Element | null> {
    try {
      const q = doc.querySelector?.bind(doc);
      if (!q) return [];
      return [q('.mc-review-body'), q('.mc-ai-body'), q('.mc-term-body'), q('.mc-frame-body')];
    } catch {
      return [];
    }
  }

  return {
    update(hands, t, flags) {
      // Only a real foreground hand drives this slot; small background hands
      // (someone behind you) are ignored outright.
      const interact = flags?.interact !== false;
      clock = t;
      const h = pickPrimaryHand(hands as readonly (readonly { x: number; y: number }[])[]);
      if (!h) return;
      if (lostTimer) clearTimeout(lostTimer);
      lostTimer = setTimeout(lost, 400);

      // Hotspot is ALWAYS this hand's INDEX FINGERTIP (landmark 8) — never
      // the thumb, never the middle tip (12), never a pinch midpoint, never
      // the MCP/palm-centre blend (that's for gesture stability only).
      const tip = h[INDEX_TIP];
      if (!tip) return;

      // Fist is a distinct gesture from pinch: a fist's curled fingers also
      // read as a low thumb/index ratio, so it must never reach pinchFsm (it
      // would otherwise fire a click on every fist). It drags live — no
      // freeze — and never taps on release.
      lastHandedness = handLabelOf(h) ?? lastHandedness;
      const rawClass = classifyGesture(h as unknown as GesturePt[], lastHandedness);
      const rawPose = pointFist.update(rawClass, h as unknown as GesturePt[], t, lastHandedness);
      lastRatio = pinchRatio(h);
      const rawRatio = pinchRatio(h);
      if (rawRatio < PINCH_LIVE.off) pinchAnchor = { x: h[INDEX_TIP].x, y: h[INDEX_TIP].y };

      // Provisional screen point (may be held/eased by the edge guard below).
      const mappedLive = deadZone.apply(mapToScreen(tip, innerWidth, innerHeight));
      const nearEdge = isEdgeFrame(h, tip, innerWidth, innerHeight, true);
      const wasEdge = edge.atEdge;
      edge.observe(nearEdge, rawPose, mappedLive, t);
      const pose = edge.pose(rawPose);
      lastClass = pose;
      if (nearEdge && !wasEdge) {
        // Entering the edge: drop any in-flight pinch/scroll/dwell so a
        // distorted landmark cannot click, grab, or start a palm swipe.
        cancelPressWithoutClick();
        pinchFsm.reset();
        pinchHeld = false; pinchDownTs = null;
        if (palmScrolling) endPalmScroll();
        resetDwell();
      }

      const isFist = pose === 'fist' && !edge.atEdge;
      const closingToFist = !edge.atEdge && (isFist || isClosingToFist(h as unknown as GesturePt[]));
      const fsmRatio = (frozen || pinchHeld) && pinchAnchor
        ? Math.min(rawRatio, pinchRatioTo(h, pinchAnchor))
        : rawRatio;
      const closing = !isFist && !closingToFist && fsmRatio < PINCH_LIVE.off;
      // While the hand is closing or already pinched, do not feed live tips
      // into the 1-Euro filter — MediaPipe often swaps landmark 8 with 12
      // (middle) mid-pinch, which would drag the cursor and the click.
      const feedFilter = isFist || (!closing && !frozen);
      let live: P;
      if (edge.atEdge || edge.blockClicks(t) && wasEdge) {
        // Hold the clamped cursor; do not track mangled edge landmarks.
        live = edge.applyCursor(mappedLive, t);
      } else if (feedFilter) {
        const s = euro.filter(tip.x, tip.y, t);
        live = edge.applyCursor(deadZone.apply(mapToScreen(s, innerWidth, innerHeight)), t);
      } else {
        live = edge.applyCursor(frozen ?? lastOpenTip ?? mappedLive, t);
      }

      // A fist (or a hand mid-curl into one) must never start or finish a
      // pinch click. If we were already pinched, promote to a fist: cancel
      // the pinch without a click, and keep any in-flight surface/handle drag.
      const cancelPinchWithoutClick = () => {
        if (!pinched) return;
        suppressRelease = true;
        pinched = false;
        opts.onPinch?.({ phase: 'cancel', p: live, now: t });
      };

      if (isFist) {
        frozen = null;
        lastOpenTip = live;
        history.push(live, t);
        pinchHeld = false; pinchDownTs = null;
        if (palmScrolling) endPalmScroll();
        palmSince = -1;
        palmExitSince = -1;
        cancelPinchWithoutClick();
        if (interact) {
          if (!fisted) {
            fisted = true;
            if (!surface && !draggingHandle) fistDown(live);
          }
        } else if (fisted) {
          fisted = false;
          fistUp(live);
        }
        if (fistScrolling) scrollDrag(live);
        aim(live, t, t, false); // fist: no dwell click
        return;
      }

      // Two-finger SCROLL (index + middle out, ring + pinky in, thumb tucked):
      // ~100 ms enter and ~100 ms exit debounce, then the wrist+MCP centroid
      // drives a 3×-gained, slightly tighter spring-smoothed scroll on
      // animation frames. Open palm no longer scrolls. Fist already returned
      // above so it always wins. Cursor keeps tracking landmark 8 (never
      // latches `frozen`). No pinch or dwell clicks while in this pose.
      const gp = h as unknown as GesturePt[];
      const scrollPose = (pose === 'scroll' || isTwoFingerScrollPose(gp, lastHandedness)) && !edge.atEdge;
      if (scrollPose) {
        palmExitSince = -1;
        if (palmSince < 0) palmSince = t;
        cancelPressWithoutClick();
        if (fisted) { fisted = false; fistUp(live); }
        pinchHeld = false; pinchDownTs = null;
        lastOpenTip = live;
        if (t - palmSince >= SCROLL_ENTER_MS) {
          const c = mapToScreen(palmCentroid(h), innerWidth, innerHeight);
          if (!palmScrolling) {
            palmScrolling = true;
            opts.onHandEvent?.({ type: 'scroll', target: null });
            cancelFling();
            palmMotion.reset();
            {
              const hit = deepElementFromPoint(doc, live.x, live.y);
              scrollEl = pickPalmScroller(hit, [
                (hit as HTMLElement | null)?.closest?.('.mc-review-body'),
                (hit as HTMLElement | null)?.closest?.('.mc-ai-body'),
                (hit as HTMLElement | null)?.closest?.('.mc-term-body'),
                (hit as HTMLElement | null)?.closest?.('.mc-frame-body'),
                ...palmFallbacks(),
              ]);
            }
            scrollAxes = { x: false, y: true };
            palmMotion.sample(c.y, t);
            if (scrollEl && !dryRun) ensurePalmRaf();
          } else {
            palmMotion.sample(c.y, t);
            if (!rafAvailable && scrollEl && !dryRun) {
              scrollEl.scrollTop -= palmMotion.tick(33);
            }
          }
        }
        aim(live, t, t, false);
        return;
      } else if (palmScrolling) {
        if (palmExitSince < 0) palmExitSince = t;
        if (t - palmExitSince >= SCROLL_EXIT_MS) {
          endPalmScroll();
        } else {
          lastOpenTip = live;
          aim(live, t, t, false);
          return;
        }
      } else {
        palmSince = -1;
        palmExitSince = -1;
      }

      // Only a confirmed curl (and only when the thumb–index gap is not already
      // a pinch) may skip the pinch FSM — a live pinch must still click.
      if (closingToFist && fsmRatio >= PINCH_LIVE.off) {
        cancelPinchWithoutClick();
        frozen = null;
        lastOpenTip = live;
        history.push(live, t);
        pinchHeld = false; pinchDownTs = null;
        aim(live, t, t, false);
        return;
      }
      if (fisted) { fisted = false; fistUp(live); return; }

      // Pinch ratio is smoothed too, then debounced with hysteresis +
      // refractory: hover can NEVER activate anything — only this machine's
      // justDown/justUp edges press and release.
      // Trace pinchDistance is this same ratio (thumb–index / hand size).
      // The FSM must use those units, with a rolling per-hand min/open baseline
      // (enter = min + 0.35*(open-min)) once it has seen a close and an open.
      const band = pinchBase.push(rawRatio, t);
      const pinchOn = band.ready ? band.pinchOn : PINCH_LIVE.on;
      const pinchOff = band.ready ? band.pinchOff : PINCH_LIVE.off;
      ratioEuro.filter(fsmRatio, t);
      const st = pinchFsm.update(fsmRatio, t, pinchOn, pinchOff);
      const wasHeld = pinchHeld;
      pinchHeld = !!(st.pinched || st.justDown);
      if (pinchHeld && !wasHeld) pinchDownTs = t;
      if (!pinchHeld) pinchDownTs = null;

      if (!st.pinched && !st.justDown && !closing) {
        lastOpenTip = live;
        history.push(live, t);
      }

      // Locked click/cursor point: last clearly-open landmark-8, else the
      // ~100 ms lookback, else the current (already-open) tip. Never a
      // mid-pinch 8/12 swap.
      const locked = (): P => lastOpenTip ?? history.at(t - HAND_FEEL.freezeLookbackMs) ?? live;

      if (st.justDown) {
        if (edge.blockClicks(t)) {
          pinchFsm.reset();
          pinchHeld = false; pinchDownTs = null;
          frozen = null;
        } else {
        frozen = locked();
        // Click the target under the RAW locked fingertip when one is there;
        // snap only if that point is empty. Freeze for the whole pinch.
        pinchFocus = rawInteractiveHit(frozen) ?? snapNear(frozen);
        setTarget(pinchFocus);
        aim(frozen, t, t, false); // pinch down: no dwell (pinch is the click)
        if (interact) press(true);
        }
      } else if (st.pinched) {
        const hold = frozen ?? locked();
        if (!interact) {
          // Two-hand zoom owns this pinch — don't also click on release.
          if (pinched) { suppressRelease = true; press(false); }
          aim(hold, t, t, false);
        } else if (dragging || draggingHandle || textEl) aim(live, t, t, false);
        else if (scrollEl) scrollDrag(hold);
        else aim(hold, t, t, false);
        // The cursor stays frozen, but the morph hold's slop check needs the
        // LIVE hand position — drifting past slop must cancel the hold.
        if (interact) opts.onPinch?.({ phase: 'move', p: live, now: t });
      } else if (closing && lastOpenTip) {
        // Pre-engage close: keep showing the last open index tip so a
        // mid-close landmark swap can't walk the cursor onto the middle finger.
        // Dwell is off — a coming pinch must not also fire a dwell click.
        aim(lastOpenTip, t, t, false);
      } else {
        if (st.justUp) { press(false); frozen = null; pinchAnchor = null; pinchFocus = null; confirmStarted = 0; paintConfirm(null, false); }
        aim(live, t, t, interact);
      }
    },
    // Mirrors update(): a held pinch over a scroll list drags it (the sim /
    // audit hook used to skip this, so hand scrolling was untestable).
    pointAt(x, y) {
      if (pinched && scrollEl && !dragging && !draggingHandle && !surface && !textEl) { scrollDrag({ x, y }); return target; }
      return aim({ x, y });
    },
    pinch: press,
    get target() { return target; },
    get lastActivated() { return lastActivated; },
    consumedPinch: () => now() < consumedUntil || !!target || !!surface,
    surfaceBusy: () => !!surface && (surfaceHeld || surfaceDragging),
    suppressNextRelease() { if (pinched) suppressRelease = true; },
    setDryRun(on) { dryRun = on; },
    lost,
    destroy() { lost(); if (lostTimer) clearTimeout(lostTimer); frame.remove(); cursor.remove(); confirmEl.remove(); },
    isTwoHandZooming: () => false,
    isPinchHeld: () => pinchHeld,
    isFisted: () => fisted,
    pinchDownAt: () => pinchDownTs,
    cancelPressWithoutClick,
    snapshot: () => {
      const clickTarget = clickTraceId;
      clickTraceId = null;
      return {
        classification: lastClass,
        pinchDistance: lastRatio,
        raw: { ...pt },
        eased: displayPoint(pt),
        focusedTargetId: targetIdOf(target ?? pinchFocus),
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
  let zooming = false;
  const slots: SlotPointer[] = [0, 1].map((i) =>
    createOneHandPointer(doc, {
      ...opts,
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
  return {
    update(hands, t) {
      // Each slot is an independent FSM. Feed every present hand with its
      // own pinch/dwell/fist/palm state; never reset or steal the other.
      const fg = pickForegroundHands(hands as readonly (readonly { x: number; y: number }[])[], 2);
      const assigned = assignHandSlots(fg, prevTips);
      for (let i = 0; i < slots.length; i++) {
        const h = assigned[i];
        if (h) {
          slots[i].update([h], t, { interact: !zooming });
          active[i] = true;
          prevTips[i] = tipOf(h);
          lastSeen[i] = t;
          const snap = slots[i].snapshot();
          getGestureTrace().push({ t, hand: i, ...snap });
        } else if (active[i] && t - lastSeen[i] >= SLOT_LOST_MS) {
          slots[i].lost();
        }
      }
      if (zooming) {
        if (!slots[0].isPinchHeld() || !slots[1].isPinchHeld()) zooming = false;
      } else {
        const t0 = slots[0].isPinchHeld() ? slots[0].pinchDownAt() : null;
        const t1 = slots[1].isPinchHeld() ? slots[1].pinchDownAt() : null;
        if (t0 != null && t1 != null && Math.abs(t0 - t1) <= TWO_HAND_ZOOM_MS) {
          zooming = true;
          slots[0].cancelPressWithoutClick();
          slots[1].cancelPressWithoutClick();
        }
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
    lost() { zooming = false; slots[0].lost(); slots[1].lost(); active[0] = active[1] = false; prevTips[0] = prevTips[1] = null; lastSeen[0] = lastSeen[1] = -Infinity; },
    destroy() { slots[0].destroy(); slots[1].destroy(); },
    isTwoHandZooming: () => zooming,
  };
}
