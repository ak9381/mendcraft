// The board itself lights up when it crosses devices (the live test: a band
// at the screen edge was not noticed). Laptop: while a board is dragged into
// a paired phone's edge zone it gets a green outline + outer glow that follows
// the edge glow (0→1) and a pill "Hold to send to iPhone"; on send it flashes
// green once. Phone: a board that really arrived from the laptop glows green
// for a few seconds with a "Moved from laptop" pill. Routine republishes,
// replays on re-pair and an app reload never re-trigger it (arrival gate).

import type { PhonePlatform } from './screenLayout';
import { PHONE_NAME } from './edgeTransfer';

/** Below this the board is not "near" the edge (same cut as the edge strip). */
export const SEND_GLOW_MIN = 0.05;
export const SENT_FLASH_MS = 900;
export const ARRIVED_MS = 4000;

export interface SendGlowView { on: boolean; intensity: number; label: string }

export function sendGlowView(glow: number, target: PhonePlatform | null | undefined): SendGlowView {
  const g = Number.isFinite(glow) ? Math.max(0, Math.min(1, glow)) : 0;
  if (!target || g <= SEND_GLOW_MIN) return { on: false, intensity: 0, label: '' };
  // A board goes on a HOLD at the edge; releasing early sends nothing.
  return { on: true, intensity: g, label: `Hold to send to ${PHONE_NAME[target]}` };
}

/** What boardGlow needs of a frame element (a real <section>, or a test fake). */
export interface GlowFrame {
  classList: { toggle(c: string, on?: boolean): boolean; add(c: string): void; remove(c: string): void };
  style: { setProperty(k: string, v: string): void; removeProperty(k: string): string };
  querySelector(sel: string): (GlowPill & { appendChild?(n: unknown): unknown }) | null;
  appendChild(n: unknown): unknown;
  ownerDocument: { createElement(tag: string): GlowPill } | null;
  /** False once the element left the DOM (absent on test fakes). */
  isConnected?: boolean;
}
export interface GlowPill {
  className: string;
  textContent: string | null;
  hidden: boolean;
  dataset: Record<string, string | undefined>;
  setAttribute(k: string, v: string): void;
}

function pillOf(el: GlowFrame, kind: 'send' | 'arrived'): GlowPill | null {
  let pill = el.querySelector(`.mc-frame-pill[data-pill="${kind}"]`);
  if (pill || !el.ownerDocument) return pill;
  pill = el.ownerDocument.createElement('span');
  pill.className = 'mc-frame-pill';
  pill.dataset.pill = kind;
  pill.setAttribute('aria-hidden', 'true'); // the status line says it for screen readers
  const head = el.querySelector('.mc-frame-head');
  if (head?.appendChild) head.appendChild(pill); else el.appendChild(pill);
  return pill;
}

/** Light (or clear) the dragged board for this glow value. */
export function applySendGlow(el: GlowFrame, view: SendGlowView): void {
  el.classList.toggle('mc-frame-sending', view.on);
  if (view.on) el.style.setProperty('--mc-send-glow', view.intensity.toFixed(3));
  else el.style.removeProperty('--mc-send-glow');
  const pill = view.on ? pillOf(el, 'send') : el.querySelector('.mc-frame-pill[data-pill="send"]');
  if (pill) { pill.textContent = view.label; pill.hidden = !view.on; }
}

/** `[data-frame="…"]` for a frame id, escaped (an id never breaks the selector). */
export function frameSelector(id: string): string {
  const esc = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(id)
    : id.replace(/["\\]/g, (c) => `\\${c}`);
  return `[data-frame="${esc}"]`;
}

/** Paints the send glow on the dragged board during a drag: the frame element
 *  and its pill are looked up once per frame, and the class + pill are only
 *  rewritten when on / label / frame change; otherwise only --mc-send-glow. */
export interface SendGlowPainter { paint(frameId: string | null, view: SendGlowView): void }

export function createSendGlowPainter(find: (frameId: string) => GlowFrame | null): SendGlowPainter {
  let cur: { id: string; el: GlowFrame | null; pill: GlowPill | null; on: boolean; label: string } | null = null;
  const clear = (): void => {
    if (cur?.el && cur.on) {
      cur.el.classList.toggle('mc-frame-sending', false);
      cur.el.style.removeProperty('--mc-send-glow');
      if (cur.pill) cur.pill.hidden = true;
    }
    cur = null;
  };
  return {
    paint(frameId, view) {
      const next = view.on && frameId ? frameId : null;
      if (cur && cur.id !== next) clear();
      if (!next) return;
      cur ??= { id: next, el: null, pill: null, on: false, label: '' };
      const c = cur;
      // The frame element was rebuilt mid-drag (a re-render): find the new one.
      if (c.el && c.el.isConnected === false) { c.el = null; c.pill = null; c.on = false; }
      c.el ??= find(next);
      if (!c.el) return;
      if (!c.on || c.label !== view.label) {
        c.el.classList.toggle('mc-frame-sending', true);
        c.pill ??= pillOf(c.el, 'send');
        if (c.pill) { c.pill.textContent = view.label; c.pill.hidden = false; }
        c.on = true;
        c.label = view.label;
      }
      c.el.style.setProperty('--mc-send-glow', view.intensity.toFixed(3));
    },
  };
}

/** One green flash on the board that was just sent. */
export function flashSent(el: GlowFrame, later: (fn: () => void, ms: number) => unknown = setTimeout): void {
  applySendGlow(el, { on: false, intensity: 0, label: '' });
  el.classList.remove('mc-frame-sent');
  el.classList.add('mc-frame-sent');
  later(() => el.classList.remove('mc-frame-sent'), SENT_FLASH_MS);
}

/** Phone: the arrived board glows with "Moved from laptop", then fades. */
export function flagArrived(el: GlowFrame, later: (fn: () => void, ms: number) => unknown = setTimeout): void {
  const pill = pillOf(el, 'arrived');
  if (pill) { pill.textContent = 'Moved from laptop'; pill.hidden = false; pill.setAttribute('role', 'status'); }
  el.classList.add('mc-frame-arrived');
  later(() => {
    el.classList.remove('mc-frame-arrived');
    if (pill) pill.hidden = true;
  }, ARRIVED_MS);
}

// ---- arrival gate (phone) ---------------------------------------------------

/** The laptop stamps a real board send (never a republish) with this. */
export interface BoardSendMark { id: string; at: number; replay?: true }

export interface ArrivalStore { getItem(k: string): string | null; setItem(k: string, v: string): void }

export const ARRIVAL_KEY = 'mc.board.arrived.v1';
/** A REPLAYED stamp older than this (a stale state replayed to a fresh phone)
 *  is not news. A live send lights whatever its age: the laptop's clock may
 *  be off from the phone's, and a skew must never hide "Moved from laptop". */
export const ARRIVAL_MAX_AGE_MS = 10 * 60_000;

export interface ArrivalGate {
  /** True once per real transfer of a board to THIS phone. */
  isNew(snap: { board?: unknown; boardFor?: PhonePlatform; boardSend?: BoardSendMark }, platform: PhonePlatform | undefined, now: number, opts?: { replayed?: boolean }): boolean;
}

export function createArrivalGate(storage: ArrivalStore | null): ArrivalGate {
  let last: string | null = null;
  try { last = storage?.getItem(ARRIVAL_KEY) ?? null; } catch { last = null; }
  return {
    isNew(snap, platform, now, opts) {
      const mark = snap.boardSend;
      if (!snap.board || !mark || typeof mark.id !== 'string' || !mark.id) return false;
      if (snap.boardFor && snap.boardFor !== platform) return false;
      if (mark.id === last) return false; // a replay / republish of the same send
      last = mark.id; // seen: even a stale one never lights later
      try { storage?.setItem(ARRIVAL_KEY, mark.id); } catch { /* memory only */ }
      // Replayed (the session's buffered snapshot, or the host's re-publish on
      // a hello): only a recent one is news. Live: always.
      if (!opts?.replayed && mark.replay !== true) return true;
      return Number.isFinite(mark.at) && Math.abs(now - mark.at) <= ARRIVAL_MAX_AGE_MS;
    },
  };
}
