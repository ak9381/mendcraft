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
export interface BoardSendMark { id: string; at: number }

export interface ArrivalStore { getItem(k: string): string | null; setItem(k: string, v: string): void }

export const ARRIVAL_KEY = 'mc.board.arrived.v1';
/** A stamp older than this (a stale state replayed to a fresh phone) is not news. */
export const ARRIVAL_MAX_AGE_MS = 10 * 60_000;

export interface ArrivalGate {
  /** True once per real transfer of a board to THIS phone. */
  isNew(snap: { board?: unknown; boardFor?: PhonePlatform; boardSend?: BoardSendMark }, platform: PhonePlatform | undefined, now: number): boolean;
}

export function createArrivalGate(storage: ArrivalStore | null): ArrivalGate {
  let last: string | null = null;
  try { last = storage?.getItem(ARRIVAL_KEY) ?? null; } catch { last = null; }
  return {
    isNew(snap, platform, now) {
      const mark = snap.boardSend;
      if (!snap.board || !mark || typeof mark.id !== 'string' || !mark.id) return false;
      if (snap.boardFor && snap.boardFor !== platform) return false;
      if (mark.id === last) return false; // a replay / republish of the same send
      last = mark.id; // seen: even a stale one never lights later
      try { storage?.setItem(ARRIVAL_KEY, mark.id); } catch { /* memory only */ }
      return Number.isFinite(mark.at) && Math.abs(now - mark.at) <= ARRIVAL_MAX_AGE_MS;
    },
  };
}
