// HAND POINTER: every on-screen control is reachable with a hand.
//
// The cursor is anchored to the PALM CENTRE (handFeel.palmCenter: mean of
// landmarks 0/5/9/13/17) of the same hand — never a fingertip — so curling a
// finger or closing a fist does not move it. The palm is mapped from the
// active box in the camera frame (HAND_FEEL.reach) to the whole screen, then
// smoothed with a One-Euro filter in screen px and a small dead zone.
// Hit-testing is deep: elementFromPoint walks into open shadow roots (A2UI /
// Lit tiles), and when the hand is near but not on a control, a magnet
// captures the nearest one (within HAND_FEEL.magnetCapturePx) that is
// actually on top at its centre, and keeps it until the hand is more than
// HAND_FEEL.magnetReleasePx away or lands directly on another control.
// Popovers, sheets and dialogs are covered because candidates are
// re-collected live; a visible aria-modal dialog limits targets to itself.
//
// The click is a FIST TAP: close the hand and re-open it within
// HAND_FEEL.fistTapMs (300 ms) without moving — the target the palm was on
// is clicked (magnet included; confirm actions need a direct hit). A board is
// focused by tapping its title (a button); a tap on a board's body or bare
// canvas does nothing.
//
// Hover-to-click (opt-in fallback, `dwellClick`): a TARGET-LOCKED DWELL. Once
// a control has captured the cursor, the .mc-hand-dwell ring fills for
// HAND_FEEL.dwellMs (800 ms) while the cursor stays within dwellAccruePx of
// it (pausing further out) — jitter never restarts it — then clicks. After a
// click there is a short cooldown and the cursor must leave to re-arm.
//
// Fist grabs are handled by the plural createHandPointer() below: ONE fist
// held past the tap window (or moved) grabs — over a board it moves the
// board, over a panel's drag/resize handle (DRAG_HANDLE) it drags that
// handle, over bare canvas it pans the world, over any other button or chrome
// it does nothing; TWO fists zoom the world about their midpoint.
// Pinch does nothing in the live pipeline: no pinch-click, no pinch-drag, no
// pinch-zoom, no pinch-to-keep, and no two-finger scroll.
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
import { classifyHandShape, isFixedShape, stampedShape } from './handShape';
import { fieldCaretAt } from '../input/caretAt';
import { INDEX_TIP } from '../input/handLogic';
import { classifyGesture, createPointFistGate, type Pt as GesturePt } from '../input/gestures';
import {
  HAND_FEEL,
  createDeadZone,
  palmCenter,
  curlState,
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
 *  In the live pipeline a held fist on one drags it (createHandPointer's
 *  'handle' grab): it dispatches the pointerdown/move/up that dragPanel.ts,
 *  editBoard.ts and reviewDialog.ts listen for. (The slot's pinch-drag path
 *  dispatches the same events, but pinch is not wired live — see the top.) */
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
  /** HAND EDIT (the live fist pipeline): while armed, a held fist over the
   *  surface draws / moves on it instead of moving the board or panning, and
   *  a fist tap acts on it. See docs/plan/2026-11-26-plan-hands-design.md. */
  handEdit?: HandSurfaceEdit;
}
export interface HandSurfaceEdit {
  /** Hand edit is on and (x, y) is on the drawing area itself. */
  armed(x: number, y: number): boolean;
  /** A drawing or placing tool is active: a fist tap belongs to the surface,
   *  so only a button right next to the palm may take the highlight. */
  drawing(): boolean;
  tap(x: number, y: number): void;
  /** A held fist closed here. False = nothing to grab (the fist is spent). */
  fistStart(x: number, y: number): boolean;
  fistMove(x: number, y: number): void;
  /** The hand opened: commit. */
  fistEnd(): void;
  /** Hand lost, looked away, or a second fist took over: apply nothing. */
  fistCancel(): void;
  /** Two fists that both closed on this surface: zoom / pan the surface's
   *  own view (the plan), not the canvas. Absent = the canvas zooms. */
  zoom2?(phase: 'start' | 'move' | 'end', a: { x: number; y: number }, b: { x: number; y: number }): void;
}
/** Marks a surface's element handle (a pointer-events:none proxy button the
 *  palm highlight can snap to): it is exempt from the on-top-at-centre clip. */
export const HAND_HOT = 'data-hand-hot';
export function handSurfaceAt(el: Element | null): HandSurface | null {
  const host = (el as HTMLElement | null)?.closest?.('[data-hand-surface]') as (HTMLElement & { __mcHandSurface?: HandSurface }) | null;
  return host?.__mcHandSurface ?? null;
}

/** The ARMED hand-edit surface at a screen point. First the surface under the
 *  hit-test; failing that, any surface whose rect holds the point and that
 *  says it is armed there — a board that is not the focused one has an inert
 *  body that hit-testing skips, and the plan's 3D view still takes a fist
 *  there (its armed() checks the point itself). */
export function armedSurfaceAt(doc: Document, x: number, y: number): HandSurfaceEdit | null {
  const edit = handSurfaceAt(deepElementFromPoint(doc, x, y))?.handEdit;
  if (edit) return edit.armed(x, y) ? edit : null;
  const hosts = (doc.querySelectorAll?.('[data-hand-surface]') ?? []) as ArrayLike<HTMLElement & { __mcHandSurface?: HandSurface }>;
  for (let i = hosts.length - 1; i >= 0; i--) {
    const e = hosts[i].__mcHandSurface?.handEdit;
    if (!e) continue;
    const r = hosts[i].getBoundingClientRect();
    if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height && e.armed(x, y)) return e;
  }
  return null;
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

/** Active box: this part of the camera frame (where the palm travels) maps
 *  to the full screen, so the edges of the UI (top toolbar included) don't
 *  need an arm at full stretch. Single source of truth: HAND_FEEL.reach. */
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
    const under = deepElementFromPoint(doc, cx, cy);
    const top = interactiveAncestor(under);
    // A surface's element handle never receives the hit itself: it counts
    // when its own surface (and no real control) is on top at its centre.
    if (el.hasAttribute?.(HAND_HOT)) {
      const host = el.closest?.('[data-hand-surface]');
      return !top && !!host && !!under && host.contains(under);
    }
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
  /** Live activity feed: dwell clicks (with target) and one-fist board grabs. */
  onHandEvent?: (ev: { type: 'click' | 'grab'; target?: string | null }) => void;
  /** One-fist board move (see createHandPointer): 'start' once a fist held
   *  GRAB_HOLD_MS starts over a board (hit by frame rects), 'move' with the
   *  fist's screen-space delta (CSS px) each frame after, 'end' when the
   *  fist opens, the hand is lost, or a second fist takes over (zoom).
   *  `x`/`y` is the fist's current screen point (CSS px), for edge transfer. */
  /** 'cancel': the move is abandoned (looked away mid-drag) — put the board
   *  back where the drag began; nothing is handed off. */
  onBoardMove?: (ev: { phase: 'start' | 'move' | 'end' | 'cancel'; frameId: string; dx: number; dy: number; x?: number; y?: number }) => void;
  /** One fist over empty canvas: "grab the world" — screen-px deltas, 1:1. */
  onWorldPan?: (ev: { phase: 'start' | 'move' | 'end'; dx: number; dy: number }) => void;
  /** Two fists: anchored zoom. `a`/`b` are the two fists' screen points
   *  (CSS px); the caller zooms by |b−a| / |b0−a0| about their midpoint. */
  onWorldZoom?: (ev: { phase: 'start' | 'move' | 'end'; a: P; b: P }) => void;
  /** The board in focus mode (if any): one fist on THAT board pans instead
   *  of moving it. */
  focusedFrameId?: () => string | null;
  /** Slot hook (plural createHandPointer only): true while ANY grab (board
   *  move, pan, zoom) is running, on any slot. While true every slot's
   *  dwell/ring/click/hover stays off, so dragging a board across the
   *  right-side buttons never glitches a hover or fires a stray click. */
  isGrabActive?: () => boolean;
  /** Slot hook (plural createHandPointer only): true while the hands are
   *  locked because the user is not facing the screen — no target, dwell or
   *  click, and the cursor is dimmed. */
  handsLocked?: () => boolean;
  /** Camera frame height ÷ width (for 3D finger angles). Default 9/16. */
  cameraAspect?: () => number;
  /** Hover-to-click (dwell) on/off, read every frame. The fist tap is the
   *  primary click; the app turns dwell on only as an opt-in fallback.
   *  Default (option absent): on. When off there is no ring, but the magnet
   *  target is still outlined so the user sees what a tap will click. */
  dwellClick?: () => boolean;
  /** Is this element (the top element under a fist, or null) the bare canvas
   *  — the world/viewport background? A fist that starts over anything else
   *  that isn't inside a board (review dialog, dock, engine bar…) is spent.
   *  Default: null, or `.mc-viewport` / `.mc-world`. */
  isCanvasBackground?: (el: Element | null) => boolean;
  /** Reach box (camera units → the full screen), read every frame. Default
   *  HAND_FEEL.reach (laptop); the phone shell passes phoneReach(aspect). */
  reach?: () => typeof REACH;
  /** The open-palm highlight (palmHighlight.ts), given the frame time: while
   *  it returns a control (it does only shortly after the palm last drove
   *  it), that control is the target — no magnet, no own frame drawn — so a
   *  fist tap (the backup click) presses what is highlighted. A control
   *  directly under the raw point still wins over it. */
  targetOverride?: (now: number) => HTMLElement | null;
  /** Fixed button shapes (thumbs up / down…) veto fist starts and taps —
   *  only while button gestures are on. Default: on. */
  fixedShapeVeto?: () => boolean;
}

/** A fist closed this long (or moved HAND_FEEL.fistMovePx while closed)
 *  becomes a grab; opening it sooner is a TAP (click). */
export const GRAB_HOLD_MS = HAND_FEEL.fistTapMs;
/** A fist over one of these (a board's title) moves the board, even though it
 *  is a control. A fist over a DRAG_HANDLE drags that handle (see below); a
 *  fist over any other control does nothing. */
const BOARD_HANDLE = '.mc-frame-title, [data-mc-board-handle]';
/* A fist over a DRAG_HANDLE ([data-mc-drag-handle] / [data-mc-resize-handle])
   grabs that handle too — the one other control a fist may start on. */

/** Magnetic focus: capture radius (a control within this many px of the
 *  cursor captures it) and the ease of the drawn cursor toward its centre.
 *  A captured control is released only past HAND_FEEL.magnetReleasePx. */
export const MAGNET_SNAP_PX = HAND_FEEL.magnetCapturePx;
export const MAGNET_PULL = 0.35;
/** A held pinch via the manual pinch() API still needs this; CONFIRM_DWELL_MS
 *  is the live dwell-to-click time for Approve/Reject, same as everything
 *  else (HAND_FEEL.dwellMs — one constant, not a copy). */
export const CONFIRM_PINCH_MS = 300;
export const CONFIRM_DWELL_MS = HAND_FEEL.dwellMs;
export const CONFIRM_ACTION =
  '.mc-review-approve, .mc-review-reject, .mc-review-ask-else, .mc-trash, [data-act="drop"], [data-act="delete"]';

export function isConfirmAction(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  try { if (el.matches?.(CONFIRM_ACTION)) return true; } catch { /* ignore */ }
  const name = `${el.getAttribute?.('aria-label') || ''} ${el.textContent || ''}`.toLowerCase();
  return /\b(approve|reject|ask for something else|something else|delete|trash)\b/.test(name);
}

export function confirmLabelFor(el: HTMLElement): string {
  return (el.getAttribute?.('aria-label') || el.textContent || 'this').replace(/\s+/g, ' ').trim().slice(0, 48);
}

/** A dropped hand stays assigned this long so a 1-frame dropout does not reset it. */
const SLOT_LOST_MS = 400;
/** Facing must hold this long, continuously, before locked hands act again
 *  (on top of the face gate's own pose debounce) — turning the head back to
 *  the screen can't fire something mid-swing. */
export const FACING_RESUME_MS = 300;
/** The locked-hands hint by the cursor. */
export const LOOK_HINT = 'Look at the screen to use hands';
/** Wrist + finger MCPs: the landmarks the camera-edge test watches. */
const PALM_IDS = [0, 5, 9, 13, 17] as const;

interface SlotPointer extends HandPointer {
  isFisted(): boolean;
  /** The screen-space cursor point (CSS px; {x:-1,y:-1} when lost) — the
   *  plural createHandPointer() reads grab positions and deltas from it. */
  rawPoint(): P;
  /** The control directly under a point (no magnet) — a fist over one never grabs. */
  controlAt(p: P): HTMLElement | null;
  /** The current fist has shown a fixed button shape: it never taps or grabs. */
  fixedInFist(): boolean;
  /** The plural pointer marks a slot that drives a running grab: its fist
   *  then only opens after the release grace (HAND_FEEL.releaseGrace*). */
  setGrabbing(on: boolean): void;
  /** True on a grabbing slot's frames inside that grace (no deltas sent). */
  isReleasing(): boolean;
  /** First fist frame of the current/last close, first non-fist frame of
   *  the current open run (-1 when none), and that run's length. */
  fistTiming(): { fistStart: number; openSince: number; openRun: number };
  /** This frame's palm mapped to the screen, before smoothing. */
  mappedPalm(): P;
  /** How long the current target has been the target — or, with no target,
   *  how long the palm has rested on an armed hand-edit surface (0 if none). */
  lockAge(t: number): number;
  /** The armed hand-edit surface under a point (null: none, or a dry run). */
  editSurfaceAt(p: P): HandSurfaceEdit | null;
  /** A fist tap on a hand-edit surface (the edge guard can veto). */
  surfaceTap(edit: HandSurfaceEdit, p: P, t: number): boolean;
  /** The drawn cursor point (magnet-eased), client px. */
  cursorPoint(): P;
  /** Click `el` as a tap (fist tap / face click). Confirm actions need a
   *  direct hit; the edge guard can veto. True if it clicked. */
  tapClick(el: HTMLElement | null, t: number): boolean;
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
  /** True while a one-fist board move is active (see createHandPointer). */
  isBoardGrabbed(): boolean;
  /** True while any grab — board move, world pan, two-fist zoom — is active. */
  isGrabActive(): boolean;
  /** Click whatever the cursor currently targets, as a fist tap would (the
   *  hook for other click triggers, e.g. a face click). True if it clicked. */
  clickTarget(): boolean;
  /** The facing gate: false = NOT facing this screen — locks the hands at
   *  once (any grab is cancelled, nothing acts or moves); true / null (no
   *  face tracking at all, e.g. the sim) = allowed, but a lock only lifts
   *  after FACING_RESUME_MS of continuous non-false. The laptop canvas feeds
   *  it a strict boolean (handFacing.presenceHandFacing: no face = false). */
  setFacing?(facing: boolean | null, now: number): void;
  /** True while the hands are locked for "not facing". */
  handsLocked?(): boolean;
  /** The locked-hands hint text (null = the default "Look at the screen to
   *  use hands"; the router swaps in "I can't see your face…"). */
  setLockHint?(text: string | null): void;
  /** Each tracked hand's palm mapped to the screen (unsmoothed) and its
   *  drawn cursor point (client px) — the glass-hand overlay anchors to it. */
  cursors?(): { palm: P; cursor: P }[];
  /** The control directly under a tracked hand's raw point (no magnet) —
   *  the hand nearest `near` (screen px) when two are tracked. */
  directHit?(near?: P): HTMLElement | null;
}

function createOneHandPointer(doc: Document = document, opts: HandPointerOptions = {}): HandPointer {
  const snapPx = opts.snapPx ?? MAGNET_SNAP_PX;
  // Release radius keeps the same capture→release hysteresis if a caller
  // overrides the capture radius.
  const releasePx = snapPx + (HAND_FEEL.magnetReleasePx - HAND_FEEL.magnetCapturePx);
  let dryRun = !!opts.dryRun;
  // One-Euro runs on SCREEN px (after mapToScreen), so HAND_FEEL.cursorFilter
  // is in Hz and per-px/s — the units the One-Euro paper's defaults assume.
  const euro = createOneEuroFilter(HAND_FEEL.cursorFilter);
  const deadZone = createDeadZone(HAND_FEEL.deadZonePx);
  const edge = createEdgeGuard();

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
  // plural createHandPointer() gives it meaning (grab / pan / two-fist zoom).
  let fisted = false;
  let lastActivated: HTMLElement | null = null;
  let clickTraceId: string | null = null;
  let consumedUntil = -Infinity;
  let suppressRelease = false;
  let pt: P = { x: -1, y: -1 };
  let lostTimer: ReturnType<typeof setTimeout> | null = null;
  // Target-locked dwell: the clock starts when a target captures the cursor
  // and keeps running while the lock holds (jitter never restarts it).
  let dwellAccrued = 0;
  let dwellLastT = -1;
  let dwellTarget: HTMLElement | null = null;
  let dwellFiredFor: HTMLElement | null = null;
  let dwellProgress = 0;
  let dwellCooldownUntil = -Infinity;
  // Fist open/close hysteresis (frame counted; see HAND_FEEL.fist*).
  let fistRun = 0;
  let openRun = 0;
  let openSince = -1;
  let grabbing = false;
  let releasing = false;
  let fistStartT = -1;
  let geoClosed = false;
  let looseSince = -1;
  let targetSince = 0;
  // Since when the palm has rested on an armed hand-edit surface (-1: it isn't).
  let surfaceSince = -1;
  let lastMapped: P = { x: -1, y: -1 };
  let lastHandedness: string | null = null;
  // The open-palm highlight owns the target this frame (opts.targetOverride).
  let overridden = false;
  /** This fist (closed or grabbing) has shown a fixed button shape. */
  let fixedInFist = false;
  let lastDirect: HTMLElement | null = null;
  // The gate only relabels (a fist needs a curled index); its point↔fist
  // time debounce is 0 here because the frame-counted fist hysteresis below
  // (fistCloseFrames / fistOpenFrames / release grace) replaces it — a quick
  // close must register fast enough to be a tap.
  const pointFist = createPointFistGate(0);
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

  /** The magnet lock holds while the raw point stays within releasePx of the
   *  locked control's rect (much tighter over a hand surface, so the floor
   *  plan still gets its hover) and the control is still in the document. */
  function lockHolds(el: HTMLElement, p: P): boolean {
    if ((el as { isConnected?: boolean }).isConnected === false) return false;
    const raw = deepElementFromPoint(doc, p.x, p.y);
    const r = raw && handSurfaceAt(raw) ? Math.min(releasePx, SURFACE_SNAP_PX) : releasePx;
    return distToRect(p, el.getBoundingClientRect()) <= r;
  }

  function editSurfaceAt(p: P): HandSurfaceEdit | null {
    if (p.x < 0 || dryRun) return null;
    return armedSurfaceAt(doc, p.x, p.y);
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
  /** The cursor has been placed since the hand (re)appeared. */
  let cursorShown = false;
  function paint() {
    if (target && !isDismiss(target) && !overridden) {
      const r = target.getBoundingClientRect();
      frame.hidden = false;
      frame.style.transform = `translate(${r.left - 4}px, ${r.top - 4}px)`;
      frame.style.width = `${r.width + 8}px`; frame.style.height = `${r.height + 8}px`;
      frame.classList.toggle('is-pressed', pinched);
    } else {
      frame.hidden = true;
    }
    cursor.hidden = pt.x < 0;
    if (pt.x < 0) cursorShown = false;
    cursor.classList.toggle('is-pinched', pinched);
    cursor.classList.toggle('is-fist', fisted);
    cursor.classList.toggle('is-away', !!opts.handsLocked?.());
    if (dwellRing) {
      dwellRing.hidden = dwellProgress <= 0;
      const style = dwellRing.style as CSSStyleDeclaration & { setProperty?: (k: string, v: string) => void };
      if (typeof style.setProperty === 'function') style.setProperty('--mc-dwell', String(dwellProgress));
      else (style as unknown as Record<string, string>)['--mc-dwell'] = String(dwellProgress);
    }
    // Visual cursor eases toward the focused target centre (the magnet).
    // Hit-testing and dwell still use the un-eased palm point `pt` + magnet.
    paintConfirm(target, !!(pinched || (dwellProgress > 0 && isConfirmAction(target))));
    // Not facing the screen: the cursor stays frozen where the hands locked.
    if (opts.handsLocked?.() && pt.x >= 0 && cursorShown) return;
    const shown = displayPoint(pt);
    cursorShown = true;
    cursor.style.transform = fisted
      ? `translate(${shown.x}px, ${shown.y}px) translate(-50%, -50%)`
      : `translate(${shown.x}px, ${shown.y}px)`;
  }

  function displayPoint(p: P): P {
    if (fisted || !target || isDismiss(target) || overridden) return p;
    const r = target.getBoundingClientRect();
    return magnetPull(p, { x: r.left, y: r.top, width: r.width, height: r.height }, MAGNET_PULL);
  }

  function setTarget(el: HTMLElement | null) {
    if (el === target) return;
    target?.classList.remove('hand-hover');
    target = el;
    targetSince = clock;
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
        // on empty space does the same.
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
    dwellAccrued = 0; dwellLastT = -1; dwellTarget = null; dwellProgress = 0;
  }

  /** Target-locked dwell-click (opt-in fallback; the fist tap is the main
   *  click). The ring fills while the current target stays locked and the
   *  cursor is within HAND_FEEL.dwellAccruePx of its rect — outside that it
   *  PAUSES (never resets) — and clicks at HAND_FEEL.dwellMs. A confirm
   *  action (Approve / Reject / delete…) only fires on a direct hit, so
   *  easing toward a neighbour can't finish the one being left. After a
   *  click: clickCooldownMs, and the cursor must LEAVE the target before it
   *  can arm again. A fist, any drag, or the camera edge restart it. */
  function tickDwell(t: number, allowed: boolean): void {
    const el = target;
    const dt = dwellLastT < 0 ? 0 : Math.min(100, Math.max(0, t - dwellLastT));
    dwellLastT = t;
    if (el !== dwellTarget) {
      // A new lock (or none): one click per visit — leaving re-arms.
      if (el !== dwellFiredFor) dwellFiredFor = null;
      dwellTarget = el;
      dwellAccrued = 0;
    }
    const enabled = opts.dwellClick?.() ?? true;
    if (!enabled || !el || isDismiss(el)) {
      dwellAccrued = 0;
      dwellProgress = 0;
      return;
    }
    // A fist, a drag or the camera edge PAUSES the ring (like leaving the
    // accrual band) — it keeps what it had and resumes after.
    const busy = pinched || fisted || !!dragging || !!draggingHandle || surfaceDragging || textSelecting || scrolled || edge.blockClicks(t);
    if (!allowed || busy) return;
    if (dwellFiredFor === el) { dwellProgress = 0; return; }
    if (t >= dwellCooldownUntil && distToRect(pt, el.getBoundingClientRect()) <= HAND_FEEL.dwellAccruePx) {
      dwellAccrued += dt;
    }
    dwellProgress = Math.max(0, Math.min(1, dwellAccrued / HAND_FEEL.dwellMs));
    if (dwellProgress >= 1) {
      if (isConfirmAction(el) && rawInteractiveHit(pt) !== el) return; // full ring, waits for a direct hit
      fireClick(el, t);
      dwellProgress = 0;
    }
  }

  /** One click (dwell or tap) on `el`, with the shared one-click-per-visit
   *  bookkeeping and cooldown. */
  function fireClick(el: HTMLElement, t: number): void {
    activate(el);
    opts.onHandEvent?.({ type: 'click', target: targetIdOf(el) });
    dwellFiredFor = el;
    dwellAccrued = 0;
    dwellCooldownUntil = t + HAND_FEEL.clickCooldownMs;
  }

  function tapClick(el: HTMLElement | null, t: number): boolean {
    if (!el || edge.blockClicks(t)) return false;
    // A dismiss scrim or a confirm action only clicks on a direct hit on an
    // interactive element — a scrim is a plain [data-hand-dismiss] area, so a
    // tap near a dialog never dismisses it (use its close button).
    if ((isDismiss(el) || isConfirmAction(el)) && rawInteractiveHit(pt) !== el) return false;
    fireClick(el, t);
    paint();
    return true;
  }

  function aim(p: P, dwellAt?: number, dwellOn = true): HTMLElement | null {
    pt = p;
    const live = dwellAt !== undefined;
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
    // A fist grab (board move, pan or zoom) is active on any slot, not just
    // this hand's own fist: no hover, no ring, no dwell, no click, while the
    // board drags under the cursor — across the right-side buttons, to the
    // edge, or onto another device.
    if (opts.isGrabActive?.() || opts.handsLocked?.()) {
      surfaceSince = -1;
      if (target) setTarget(null);
      if (tipEl) { tipEl = null; opts.onTooltip?.(null, null); }
      resetDwell();
      paint();
      return null;
    }
    // Target resolution (magnet with hysteresis):
    //  1. a control directly under the raw point always wins — the magnet
    //     must never keep a neighbour (Approve vs Reject);
    //  2. else the locked target holds until the point is > release px away;
    //  3. else the nearest control within the capture radius.
    // A board BODY is never a target (resting on a board must not fly it
    // into focus); its title is a <button> and so a control like any other.
    // `live` is false for the pointAt() sim path: no lock there.
    const direct = rawInteractiveHit(p);
    lastDirect = direct;
    const offered = opts.targetOverride?.(clock || now()) ?? null;
    const forced = offered && (!direct || direct === offered) ? offered : null;
    overridden = !!forced;
    let next: HTMLElement | null;
    if (forced) next = forced;
    else if (direct) next = direct;
    else if (live && target && !isDismiss(target) && lockHolds(target, p)) next = target;
    else next = snapNear(p);
    setTarget(next);
    if (live) {
      if (!target && editSurfaceAt(p)) { if (surfaceSince < 0) surfaceSince = clock; }
      else surfaceSince = -1;
    }
    if (!target && !pinched && !dryRun) handSurfaceAt(deepElementFromPoint(doc, p.x, p.y))?.hover?.(p.x, p.y);
    emitTooltip(target);
    if (dwellAt !== undefined) tickDwell(dwellAt, dwellOn);
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
    setTarget(null); pt = { x: -1, y: -1 }; surfaceSince = -1;
    resetDwell(); dwellFiredFor = null;
    fisted = false; fistRun = 0; openRun = 0; openSince = -1; fistStartT = -1; geoClosed = false; looseSince = -1; releasing = false;
    if (tipEl) { tipEl = null; opts.onTooltip?.(null, null); }
    euro.reset(); deadZone.reset(); pointFist.reset(); clickTraceId = null;
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

      // The cursor is anchored to the PALM CENTRE (landmarks 0/5/9/13/17),
      // never a fingertip: curling a finger or closing a fist barely moves
      // it, so a grab starts exactly where the hand was pointing.
      const palm = palmCenter(h);

      // `handedness` is a trace label only (see gestures.ts) — classifyGesture
      // and the point/fist gate use the same raw-landmark math for both hands.
      lastHandedness = handLabelOf(h) ?? lastHandedness;
      const rawClass = classifyGesture(h as unknown as GesturePt[]);
      const rawPose = pointFist.update(rawClass, h as unknown as GesturePt[], t, lastHandedness);
      lastRatio = pinchRatio(h);

      // Active box → screen px, THEN One-Euro (screen-px units), THEN the
      // dead zone. Only CAMERA-frame clipping is an edge: the palm cursor is
      // clamped to the screen anyway, so overshooting the top bar (or
      // dragging a board to the screen edge) must not pin the cursor, start
      // a click cooldown or reset anything.
      const mappedLive = mapToScreen(palm, innerWidth, innerHeight, true, opts.reach?.() ?? REACH);
      const smoothed = euro.filter(mappedLive.x, mappedLive.y, t);
      // Only the PALM landmarks count: raised fingertips near the top of the
      // frame (palm high in the active box) are not an edge.
      const nearEdge = isEdgeFrame(PALM_IDS.map((i) => h[i]), undefined, innerWidth, innerHeight, true);
      const wasEdge = edge.atEdge;
      // Hold the cursor where it last WAS (not this frame's possibly
      // distorted palm) when the palm starts to clip.
      edge.observe(nearEdge, rawPose, pt.x >= 0 ? pt : mappedLive, t);
      const pose = edge.pose(rawPose);
      lastClass = pose;
      lastMapped = mappedLive;

      // Fisted: shown as the move cursor; never dwells. Decided from finger
      // GEOMETRY (all four fingers curled; thumb ignored), not the classifier
      // label — a natural quick fist with the thumb out reads thumbs-up /
      // pinch for a frame and used to break the fist run. A loose,
      // half-curled hand ('between') keeps the previous state. Frame-counted
      // hysteresis on top: closed after fistCloseFrames closed frames; open
      // after fistOpenFrames — or, while this hand drives a grab, only after
      // the release grace (releaseGraceMs AND releaseGraceFrames). At the
      // camera edge a grabbing hand stays closed (distorted landmarks).
      const aspect = opts.cameraAspect?.() ?? HAND_FEEL.cameraAspect;
      // A held button gesture (thumbs up / down — four fingers curled, thumb
      // out) never STARTS a fist: no grab, no pan, no two-fist zoom. Once a
      // fist is closed (or grabbing) a fixed shape is a HOLD state
      // ('between'): it never opens the fist — so it is never the "open" end
      // of a tap, and a thumb popping up mid-drag never drops the board — and
      // a fist that shows a fixed shape is spent (fixedInFist: no tap, no
      // grab). The frame's shared shape read is used when stamped.
      // Only while button gestures are on (fixedShapeVeto).
      const veto = opts.fixedShapeVeto?.() ?? true;
      const shape = veto ? (stampedShape(h) ?? classifyHandShape(h as readonly { x: number; y: number; z?: number }[], undefined, null, { mirrored: false, cameraAspect: aspect }).shape) : undefined;
      const fixed = veto && isFixedShape(shape);
      const closedNow = fisted || grabbing || geoClosed;
      if (fixed && closedNow) fixedInFist = true;
      const cs = fixed ? (closedNow ? 'between' : 'open') : curlState(h as readonly { x: number; y: number; z?: number }[], { ...HAND_FEEL, cameraAspect: aspect });
      if (cs !== 'between') { geoClosed = cs === 'closed'; looseSince = -1; }
      else {
        // A loosened fist held half-open while grabbing counts as open
        // after grabLooseOpenMs — the board drops instead of sticking.
        if (looseSince < 0) looseSince = t;
        if (grabbing && geoClosed && t - looseSince >= HAND_FEEL.grabLooseOpenMs) geoClosed = false;
      }
      const rawFist = edge.atEdge ? grabbing && fisted : geoClosed;
      if (rawFist) { if (fistRun === 0) fistStartT = t; fistRun += 1; openRun = 0; openSince = -1; }
      else { openRun += 1; fistRun = 0; if (openSince < 0) openSince = t; }
      releasing = false;
      if (!fisted) {
        if (fistRun >= HAND_FEEL.fistCloseFrames) fisted = true;
      } else if (!rawFist) {
        const open = grabbing
          ? openRun >= HAND_FEEL.releaseGraceFrames && t - openSince >= HAND_FEEL.releaseGraceMs
          : openRun >= HAND_FEEL.fistOpenFrames;
        if (open) fisted = false; else releasing = grabbing;
      }
      if (!fisted && !geoClosed) fixedInFist = false;

      let live: P;
      if (edge.atEdge || (edge.blockClicks(t) && wasEdge)) {
        live = edge.applyCursor(mappedLive, t);
      } else {
        live = edge.applyCursor(deadZone.apply(smoothed), t);
      }

      aim(live, t, !fisted);
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
    isGrabActive: () => false,
    clickTarget: () => tapClick(target, clock || now()),
    isFisted: () => fisted,
    rawPoint: () => ({ ...pt }),
    controlAt: (p: P) => rawInteractiveHit(p),
    directHit: () => (pt.x < 0 ? null : lastDirect),
    fixedInFist: () => fixedInFist,
    cursorPoint: () => (pt.x < 0 ? { ...pt } : displayPoint(pt)),
    setGrabbing(on: boolean) { grabbing = on; if (!on) releasing = false; },
    fistTiming: () => ({ fistStart: fistStartT, openSince, openRun }),
    mappedPalm: () => ({ ...lastMapped }),
    lockAge: (t: number) => (target ? t - targetSince : surfaceSince >= 0 ? t - surfaceSince : 0),
    editSurfaceAt,
    surfaceTap(edit: HandSurfaceEdit, p: P, t: number) {
      if (edge.blockClicks(t)) return false;
      edit.tap(p.x, p.y);
      opts.onHandEvent?.({ type: 'click', target: 'plan' });
      return true;
    },
    isReleasing: () => releasing,
    tapClick,
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

type GrabMode =
  | { kind: 'board'; slot: number; frameId: string; last: P }
  | { kind: 'pan'; slot: number; last: P }
  /** A held fist on a panel's drag/resize handle (the review window's title
   *  bar or corner, a terminal grip): forwarded as pointerdown/move/up, the
   *  same events a mouse drag fires, so dragPanel/reviewDialog need nothing new. */
  | { kind: 'handle'; slot: number; el: HTMLElement; last: P }
  /** A held fist on an armed hand-edit surface (the floor plan): pen down. */
  | { kind: 'surface'; slot: number; edit: HandSurfaceEdit; last: P }
  /** Two fists. `edit`: both closed on one hand-edit surface, which zooms itself. */
  | { kind: 'zoom'; a: P; b: P; edit?: HandSurfaceEdit };

/** Per-slot fist bookkeeping for tap vs grab. */
interface FistState {
  closedAt: number | null;
  closeP: P;
  closeTarget: HTMLElement | null;
  /** No target, but the fist closed on an armed hand-edit surface. */
  closeSurface: HandSurfaceEdit | null;
  /** Closed ≥ fistTapMs or moved ≥ fistMovePx: no longer a tap; may grab. */
  holding: boolean;
  /** Started over a control / chrome: a one-fist grab never starts (a
   *  two-fist zoom still can). Cleared when the fist opens. */
  blocked: boolean;
  /** Its grab ended while still closed (a zoom partner opened): nothing
   *  until it opens. */
  spent: boolean;
  wasFisted: boolean;
  /** Tap pre-conditions met when the fist started (see HAND_FEEL.tap*). */
  tapArmed: boolean;
  /** Unfiltered mapped palm where the fist registered (the move test). */
  closeRaw: P;
  /** Length / start of the open (non-fist) run right before this close. */
  openRun: number;
  openSince: number;
  /** Palm speed (unfiltered, px/ms) and target lock age at the first fist frame. */
  startSpeed: number;
  startLock: number;
  prevMapped: P | null;
  prevT: number;
  speed: number;
  speeds: number[];
  /** The previous close was a hold / grab (not a tap). */
  lastWasHold: boolean;
}

const defaultCanvasBackground = (el: Element | null): boolean =>
  !el || !!(el as HTMLElement).matches?.('.mc-viewport, .mc-world');

/** Public pointer: one coral cursor per foreground hand (max two), each with
 *  its own target/dwell state, plus the fist gestures that need both slots:
 *
 *  - FIST TAP = click: a fist that closes and re-opens within
 *    HAND_FEEL.fistTapMs, moving less than fistMovePx, clicks the target
 *    the palm was on when it closed (magnet included; a confirm action needs
 *    a direct hit). tapCooldownMs between taps. Nothing on bare canvas.
 *  - ONE fist closed ≥ fistTapMs (or moved ≥ fistMovePx): a grab, decided
 *    once at the point where the fist closed — a control under it, or
 *    anything that is neither inside a board nor the bare canvas (review
 *    dialog, dock, engine bar) → nothing; a board (by frame RECT; the focused
 *    board in focus mode pans instead) → move it; bare canvas → pan. While a
 *    grab runs there are no hit-tests, and its fist only opens after the
 *    release grace.
 *  - TWO fists holding → anchored zoom. A second fist arriving ends a
 *    running board move / pan ('end') before the zoom starts.
 *  Tests and the sim hook still use pointAt/pinch on slot 0. */
export function createHandPointer(doc: Document = document, opts: HandPointerOptions = {}): HandPointer {
  getGestureTrace();
  const active = [false, false];
  const prevTips: (P | null)[] = [null, null];
  const lastSeen = [-Infinity, -Infinity];
  const freshFist = (): FistState => ({
    closedAt: null, closeP: { x: -1, y: -1 }, closeTarget: null, closeSurface: null, holding: false, blocked: false, spent: false, wasFisted: false,
    tapArmed: false, closeRaw: { x: -1, y: -1 }, openRun: 0, openSince: -1, startSpeed: Infinity, startLock: 0, prevMapped: null, prevT: 0, speed: 0, speeds: [], lastWasHold: false,
  });
  const fist: FistState[] = [freshFist(), freshFist()];
  let lastTapAt = -Infinity;
  let grab: GrabMode | null = null;
  const handleEvent = opts.createDragEvent ?? ((type: string, p: P) =>
    new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'pen' }));
  const fireHandle = (el: HTMLElement, type: string, p: P): void => { if (!opts.dryRun) el.dispatchEvent(handleEvent(type, p)); };
  // Facing gate (the ONE gate every hand path reads, via handsLocked()):
  // "not facing" locks at once — the upstream face gate already debounced
  // it — and a running grab is cancelled, never committed. The lock lifts
  // only after FACING_RESUME_MS of continuous facing (or no signal at all).
  let away = false;
  let okSince = -Infinity;
  let locked = false;
  let resumeAt = -Infinity;
  // "Look at the screen to use hands": created the first time it's needed.
  let hint: HTMLElement | null = null;
  let hintAt: P | null = null;
  let lockHint: string | null = null;
  function evalFacing(t: number): void {
    const next = away || (locked && t - okSince < FACING_RESUME_MS);
    if (next && !locked) {
      locked = true;
      // Nothing in progress survives a look away: a grab is cancelled (a
      // board goes back, a plan stroke is dropped, a panel drag is a
      // pointercancel) and any closed fist is spent until it opens.
      cancelGrab();
      for (let i = 0; i < 2; i++) { if (fist[i].wasFisted) fist[i].spent = true; fist[i].tapArmed = false; }
      const i = active[0] ? 0 : active[1] ? 1 : -1;
      hintAt = i >= 0 ? slots[i].cursorPoint() : null;
    } else if (!next && locked) {
      // Resume with the tap guards (open-before, target lock) restarted and
      // any fist that is closed right now spent until it opens.
      locked = false;
      resumeAt = t;
      hintAt = null;
      for (let i = 0; i < 2; i++) if (fist[i].wasFisted) fist[i].spent = true;
    }
  }
  function paintHint(): void {
    const i = active[0] ? 0 : active[1] ? 1 : -1;
    const show = locked && i >= 0;
    if (!hint && show) {
      hint = doc.createElement('div');
      hint.className = 'mc-hand-away-hint';
      hint.setAttribute('aria-hidden', 'true');
      doc.body?.append?.(hint);
    }
    if (!hint) return;
    const want = lockHint ?? LOOK_HINT;
    if (hint.textContent !== want) hint.textContent = want;
    hint.hidden = !show;
    if (show) {
      // Frozen where the cursor was when the hands locked: nothing moves.
      if (!hintAt || hintAt.x < 0) hintAt = slots[i].cursorPoint();
      const p = hintAt;
      hint.style.transform = `translate(${p.x + 18}px, ${p.y + 22}px)`;
    }
  }
  const isBackground = opts.isCanvasBackground ?? defaultCanvasBackground;
  const slots: SlotPointer[] = [0, 1].map((i) =>
    createOneHandPointer(doc, {
      ...opts,
      // Read fresh each call: true from the frame a grab starts until it ends.
      isGrabActive: () => !!grab,
      handsLocked: () => locked,
      onLost() {
        active[i] = false;
        prevTips[i] = null;
        lastSeen[i] = -Infinity;
        // The hand left (the 400 ms lost timer, or no frame for SLOT_LOST_MS):
        // its fist state goes with it, so a hand that comes back open can
        // never fire a late tap on the old target; and a grab it held ends
        // cleanly (a handle grab gets its pointerup) instead of hanging on.
        fist[i] = freshFist();
        if (grab && (grab.kind === 'zoom' || grab.slot === i)) endGrab();
        opts.onLost?.();
      },
    }) as SlotPointer,
  );
  const tipOf = (h: readonly LM[]): P | null => {
    const p = h[INDEX_TIP] ?? h[0];
    return p ? { x: p.x, y: p.y } : null;
  };
  const inside = (p: P, r: Rect) => p.x >= r.left && p.x <= r.left + r.width && p.y >= r.top && p.y <= r.top + r.height;
  /** The board under a point by its RECT (topmost: the focused board, then
   *  later in document order) — never elementFromPoint, so a tile or chip
   *  drawn on the board doesn't hide it. */
  const frameIdAt = (p: P): string | null => {
    if (p.x < 0) return null;
    const els = Array.from(doc.querySelectorAll?.('.mc-frame') ?? []) as HTMLElement[];
    const focused = opts.focusedFrameId?.() ?? null;
    if (focused) {
      const f = els.find((el) => el.dataset?.frame === focused);
      if (f && inside(p, f.getBoundingClientRect())) return focused;
    }
    for (let i = els.length - 1; i >= 0; i--) {
      const id = els[i].dataset?.frame;
      if (id && inside(p, els[i].getBoundingClientRect())) return id;
    }
    return null;
  };
  function setGrab(g: GrabMode | null): void {
    grab = g;
    const on = (i: number) => !!g && (g.kind === 'zoom' || g.slot === i);
    slots[0].setGrabbing(on(0));
    slots[1].setGrabbing(on(1));
  }
  /** `opened`: the grabbing hand opened (a hand-edit stroke commits). Any
   *  other end — hand lost, looked away, a second fist — cancels a stroke. */
  function endGrab(opened = false): void {
    const g = grab;
    if (!g) return;
    setGrab(null);
    if (g.kind === 'surface') { if (opened) g.edit.fistEnd(); else g.edit.fistCancel(); }
    else if (g.kind === 'board') opts.onBoardMove?.({ phase: 'end', frameId: g.frameId, dx: 0, dy: 0, x: g.last.x, y: g.last.y });
    else if (g.kind === 'pan') opts.onWorldPan?.({ phase: 'end', dx: 0, dy: 0 });
    else if (g.kind === 'handle') fireHandle(g.el, 'pointerup', g.last);
    else zoomEv('end', g.a, g.b, g.edit);
  }
  /** Abandon a running grab without committing it (looked away). */
  function cancelGrab(): void {
    const g = grab;
    if (!g) return;
    setGrab(null);
    if (g.kind === 'surface') g.edit.fistCancel();
    else if (g.kind === 'board') opts.onBoardMove?.({ phase: 'cancel', frameId: g.frameId, dx: 0, dy: 0, x: g.last.x, y: g.last.y });
    else if (g.kind === 'pan') opts.onWorldPan?.({ phase: 'end', dx: 0, dy: 0 });
    else if (g.kind === 'handle') fireHandle(g.el, 'pointercancel', g.last);
    else zoomEv('end', g.a, g.b, g.edit);
  }
  function zoomEv(phase: 'start' | 'move' | 'end', a: P, b: P, edit?: HandSurfaceEdit): void {
    if (edit?.zoom2) edit.zoom2(phase, a, b);
    else opts.onWorldZoom?.({ phase, a, b });
  }
  /** One holding fist on slot i starts its grab, judged where it closed. */
  function startOneFist(i: number): void {
    const s = fist[i];
    const p = s.closeP;
    if (p.x < 0) { s.blocked = true; return; }
    const control = slots[i].controlAt(p);
    const onHandle = !!control && !!control.matches?.(BOARD_HANDLE);
    if (control && !onHandle && control.matches?.(DRAG_HANDLE)) {
      // A panel's title bar / resize corner: the fist drags it like a mouse.
      setGrab({ kind: 'handle', slot: i, el: control, last: p });
      opts.onHandEvent?.({ type: 'grab', target: control.getAttribute?.('aria-label') ?? 'handle' });
      fireHandle(control, 'pointerdown', p);
      stepGrab(slots[i].rawPoint());
      return;
    }
    if (control && !onHandle) { s.blocked = true; return; } // a fist on any other button never grabs
    if (!control) {
      // An armed hand-edit surface (the floor plan in hand edit) takes the
      // fist before the board it sits on, or the canvas, can.
      const edit = slots[i].editSurfaceAt(p);
      if (edit) {
        if (!edit.fistStart(p.x, p.y)) { s.blocked = true; return; }
        setGrab({ kind: 'surface', slot: i, edit, last: p });
        opts.onHandEvent?.({ type: 'grab', target: 'plan' });
        stepGrab(slots[i].rawPoint());
        return;
      }
    }
    let frameId: string | null = null;
    if (onHandle) {
      frameId = ((control!.closest?.('.mc-frame') as HTMLElement | null)?.dataset?.frame) ?? frameIdAt(p);
    } else {
      // Only the world layer counts: inside a board, or the bare canvas.
      const hit = doc.elementFromPoint?.(p.x, p.y) ?? null;
      const inFrame = (hit as HTMLElement | null)?.closest?.('.mc-frame') as HTMLElement | null;
      if (!inFrame && !isBackground(hit)) { s.blocked = true; return; }
      frameId = inFrame?.dataset?.frame ?? frameIdAt(p);
    }
    const focused = opts.focusedFrameId?.() ?? null;
    const now = slots[i].rawPoint();
    if (frameId && frameId !== focused) {
      setGrab({ kind: 'board', slot: i, frameId, last: p });
      opts.onHandEvent?.({ type: 'grab', target: frameId });
      opts.onBoardMove?.({ phase: 'start', frameId, dx: 0, dy: 0, x: p.x, y: p.y });
    } else {
      setGrab({ kind: 'pan', slot: i, last: p });
      opts.onWorldPan?.({ phase: 'start', dx: 0, dy: 0 });
    }
    // The fist may already have moved up to fistMovePx: follow from where it closed.
    stepGrab(now);
  }
  function stepGrab(p: P): void {
    const g = grab;
    if (!g || g.kind === 'zoom') return;
    const dx = p.x - g.last.x, dy = p.y - g.last.y;
    g.last = p;
    if (!dx && !dy) return;
    if (g.kind === 'board') opts.onBoardMove?.({ phase: 'move', frameId: g.frameId, dx, dy, x: p.x, y: p.y });
    else if (g.kind === 'handle') fireHandle(g.el, 'pointermove', p);
    else if (g.kind === 'surface') g.edit.fistMove(p.x, p.y);
    else opts.onWorldPan?.({ phase: 'move', dx, dy });
  }
  function updateFists(t: number): void {
    for (let i = 0; i < 2; i++) {
      const s = fist[i];
      const fisted = active[i] && slots[i].isFisted();
      if (!active[i]) { s.prevMapped = null; s.speeds.length = 0; s.openRun = 0; s.openSince = -1; }
      else {
        // Unfiltered palm speed, averaged over the last 3 frames (px/ms).
        const m = slots[i].mappedPalm();
        const v = s.prevMapped && t > s.prevT ? Math.hypot(m.x - s.prevMapped.x, m.y - s.prevMapped.y) / (t - s.prevT) : 0;
        s.speeds.push(v); if (s.speeds.length > 3) s.speeds.shift();
        s.speed = s.speeds.reduce((a, b) => a + b, 0) / s.speeds.length;
        s.prevMapped = m; s.prevT = t;
        const ft = slots[i].fistTiming();
        if (ft.openRun > 0) { s.openRun = ft.openRun; s.openSince = ft.openSince; }
        if (ft.fistStart === t) { s.startSpeed = s.speed; s.startLock = slots[i].lockAge(t); }
      }
      if (fisted && !s.wasFisted) {
        const ft = slots[i].fistTiming();
        s.closedAt = t; s.closeP = slots[i].rawPoint(); s.closeRaw = slots[i].mappedPalm(); s.closeTarget = slots[i].target;
        s.closeSurface = s.closeTarget ? null : slots[i].editSurfaceAt(s.closeP);
        s.holding = false; s.blocked = false; s.spent = false;
        // A tap only arms from a deliberately open, still hand on a target it
        // has rested on — a relaxed hand drifting through a fist shape never clicks.
        // Both guards restart when hands resume after "not facing".
        const openFrom = Math.max(s.openSince, resumeAt);
        const needOpen = s.lastWasHold ? HAND_FEEL.tapAfterHoldOpenMs : HAND_FEEL.tapMinOpenBeforeMs;
        s.tapArmed = !locked
          && s.openSince >= 0 && ft.fistStart - openFrom >= needOpen
          && s.startSpeed < HAND_FEEL.tapMaxPalmSpeed
          && Math.min(s.startLock, ft.fistStart - resumeAt) >= HAND_FEEL.tapMinLockMs;
      } else if (!fisted && s.wasFisted) {
        // Opened: a short, still, deliberate fist is a TAP.
        const ft = slots[i].fistTiming();
        const closedMs = ft.openSince - ft.fistStart;
        if (s.tapArmed && !locked && !s.holding && !s.spent && !grab && closedMs >= HAND_FEEL.tapMinClosedMs
          && closedMs <= HAND_FEEL.fistTapMs + 100 && t - lastTapAt >= HAND_FEEL.tapCooldownMs) {
          if (s.closeTarget ? slots[i].tapClick(s.closeTarget, t) : !!s.closeSurface && slots[i].surfaceTap(s.closeSurface, s.closeP, t)) lastTapAt = t;
        }
        s.lastWasHold = s.holding || s.spent;
        s.closedAt = null; s.closeTarget = null; s.closeSurface = null; s.holding = false; s.blocked = false; s.spent = false; s.tapArmed = false;
      } else if (fisted && !s.holding && s.closedAt !== null) {
        const m = slots[i].mappedPalm();
        if (t - s.closedAt >= HAND_FEEL.fistTapMs || Math.hypot(m.x - s.closeRaw.x, m.y - s.closeRaw.y) >= HAND_FEEL.fistMovePx) s.holding = true;
      }
      // A fist that turned into a button gesture (thumbs up after closing)
      // is spent: it never taps and never starts a grab. A grab it already
      // drives keeps going.
      const drives = !!grab && (grab.kind === 'zoom' || grab.slot === i);
      if (fisted && slots[i].fixedInFist() && !drives) { s.spent = true; s.tapArmed = false; }
      s.wasFisted = fisted;
    }
  }
  function updateGrabs(t: number): void {
    updateFists(t);
    if (locked) {
      // Not facing the screen: nothing starts, nothing runs (the lock
      // already cancelled any grab).
      if (grab) cancelGrab();
      return;
    }
    const fisted = [0, 1].map((i) => fist[i].wasFisted);
    const ready = [0, 1].map((i) => fisted[i] && fist[i].holding && !fist[i].spent);

    if (grab?.kind === 'zoom') {
      if (fisted[0] && fisted[1]) {
        if (slots[0].isReleasing() || slots[1].isReleasing()) return; // inside the release grace: hold still
        const a = slots[0].rawPoint(), b = slots[1].rawPoint();
        const edit = grab.edit;
        setGrab({ kind: 'zoom', a, b, edit });
        zoomEv('move', a, b, edit);
        return;
      }
      endGrab();
      for (let i = 0; i < 2; i++) if (fisted[i]) fist[i].spent = true;
      return;
    }
    if (grab) {
      const g = grab;
      // Opening the hand commits a hand-edit stroke — but never while the user
      // is not facing the screen: then it ends as a cancel.
      if (!fisted[g.slot]) { endGrab(!locked); return; }
      if (ready[1 - g.slot]) {
        endGrab(); // a second fist takes over: finish the move/pan, then zoom below
      } else {
        const p = slots[g.slot].rawPoint();
        if (slots[g.slot].isReleasing()) { g.last = p; return; } // grace: no deltas
        stepGrab(p);
        return;
      }
    }
    if (ready[0] && ready[1]) {
      const a = slots[0].rawPoint(), b = slots[1].rawPoint();
      // Both fists closed on the same hand-edit surface: it zooms its own view.
      const ea = slots[0].editSurfaceAt(fist[0].closeP), eb = slots[1].editSurfaceAt(fist[1].closeP);
      const edit = ea && ea === eb && ea.zoom2 ? ea : undefined;
      setGrab({ kind: 'zoom', a, b, edit });
      zoomEv('start', a, b, edit);
      return;
    }
    // One fist ready while the other hand is still closing: wait for it,
    // never start a pan the second fist would cut off a moment later.
    const closing = (i: number) => fisted[i] && !fist[i].holding && !fist[i].spent;
    for (const i of [0, 1]) {
      if (ready[i] && !fist[i].blocked && !closing(1 - i)) { startOneFist(i); return; }
    }
  }
  return {
    update(hands, t) {
      evalFacing(t); // before the slots aim, so a lock silences this very frame
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
          // A snapshot per frame only while the debug trace is on.
          const trace = getGestureTrace();
          if (trace.enabled) trace.push({ t, hand: i, ...slots[i].snapshot() });
        } else if (active[i] && t - lastSeen[i] >= SLOT_LOST_MS) {
          slots[i].lost();
        }
      }
      updateGrabs(t);
      paintHint();
    },
    pointAt(x, y) { return slots[0].pointAt(x, y); },
    pinch: (down) => slots[0].pinch(down),
    get target() { return slots[0].target ?? slots[1].target; },
    get lastActivated() { return slots[0].lastActivated ?? slots[1].lastActivated; },
    consumedPinch: () => slots[0].consumedPinch() || slots[1].consumedPinch(),
    surfaceBusy: () => slots[0].surfaceBusy() || slots[1].surfaceBusy(),
    suppressNextRelease() { slots[0].suppressNextRelease(); slots[1].suppressNextRelease(); },
    setDryRun(on) { slots[0].setDryRun(on); slots[1].setDryRun(on); },
    lost() {
      endGrab();
      slots[0].lost(); slots[1].lost();
      active[0] = active[1] = false; prevTips[0] = prevTips[1] = null; lastSeen[0] = lastSeen[1] = -Infinity;
      fist[0] = freshFist(); fist[1] = freshFist();
    },
    destroy() { endGrab(); slots[0].destroy(); slots[1].destroy(); hint?.remove?.(); },
    isBoardGrabbed: () => grab?.kind === 'board',
    isGrabActive: () => !!grab,
    setFacing(f: boolean | null, t: number) {
      if (f === false) away = true;
      else if (away) { away = false; okSince = t; }
      evalFacing(t);
      paintHint();
    },
    handsLocked: () => locked,
    setLockHint(text: string | null) { lockHint = text; paintHint(); },
    cursors: () => [0, 1].filter((i) => active[i]).map((i) => ({ palm: slots[i].mappedPalm(), cursor: slots[i].cursorPoint() })),
    directHit: (near?: P) => {
      const live = [0, 1].filter((i) => active[i]);
      if (!live.length) return null;
      let i = live[0];
      if (near && live.length === 2) {
        const d = (k: number) => { const r = slots[k].rawPoint(); return Math.hypot(r.x - near.x, r.y - near.y); };
        i = d(0) <= d(1) ? 0 : 1;
      }
      return slots[i].directHit?.() ?? null;
    },
    clickTarget: () => locked ? false : (grab ? false : (slots[0].target ? slots[0].clickTarget() : slots[1].clickTarget())),
  };
}
