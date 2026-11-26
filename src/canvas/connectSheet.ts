// DOM module for the CONNECT sheet on smart canvas.
// Presents three big options: "Point at it", "Say its name" (input + Go), "Join a phone".
// Also provides showPairing for the phone join flow and pure helper functions.

import { esc } from '../core/esc';
import { groupCode, normalizeCode } from '../relay/protocol';
import { createChimeLoop, speakPairingCode, type ChimeLoop } from '../ux/pairingChime';

export interface ConnectSheetCallbacks {
  onPoint?: () => void;
  onName?: (text: string) => void;
  onJoinPhone?: () => void;
  onClose?: () => void;
}

export interface ConnectSheet {
  readonly element: HTMLElement;
  setStatus(text: string): void;
  unmount(): void;
}

export interface PairingOptions {
  code: string;
  /** Ignored: first-time pairing is a chime, not a QR. Kept so older callers type-check. */
  qrDataUrl?: string;
  note?: string;
  onClose?: () => void;
  /** Injected chime player (tests). When omitted, the in-repo FSK loop is used. */
  playChime?: () => void | Promise<void>;
  speakCode?: () => void;
  chimeEveryMs?: number;
  /** Default true in a real browser; tests leave this false / omit Audio. */
  autoPlay?: boolean;
}

export interface PairingView {
  readonly element: HTMLElement;
  setStatus(text: string): void;
  setNote(text: string): void;
  playChimeAgain(): void;
  speakCode(): void;
  stopChime(): void;
  clear(): void;
}

export function formatPairingCode(code: string): string {
  const norm = normalizeCode(code);
  if (norm.length === 8) {
    return groupCode(norm);
  }
  return code.trim();
}

export function sanitizeDeviceName(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/[!?;:#$%^*+=_{}[\]|\\/]/g, '')
    .trim()
    .slice(0, 40);
}

export function buildPairingCard(opts: {
  code: string;
  qrDataUrl?: string;
  note?: string;
}): { code: string; qrDataUrl?: string; note?: string } {
  return {
    code: formatPairingCode(opts.code),
    qrDataUrl: opts.qrDataUrl,
    note: opts.note,
  };
}

export function connectSheetOptions(): readonly { id: string; label: string; desc: string }[] {
  return [
    { id: 'point', label: 'Point at it', desc: 'Aim camera or gimbal at the device' },
    { id: 'name', label: 'Say its name', desc: 'Type or say what you want to add' },
    { id: 'phone', label: 'Join a phone', desc: 'Play a chime; the phone listens and joins' },
  ];
}

export function mountConnectSheet(
  host: HTMLElement,
  callbacks: ConnectSheetCallbacks = {},
): ConnectSheet {
  const html = `
    <section class="mc-connect-sheet" role="region" aria-label="Connect a device">
      <div class="mc-connect-head">
        <h2 class="mc-prop-title">Connect a device</h2>
        <button type="button" class="mc-btn mc-connect-close" aria-label="Close connect sheet">✕</button>
      </div>
      <p class="mc-connect-status" role="status" aria-live="polite"></p>
      <div class="mc-connect-grid mc-row">
        <div class="mc-connect-card">
          <button type="button" class="mc-btn primary mc-connect-opt mc-connect-point" data-connect="point" aria-label="Point at it">
            Point at it
          </button>
          <span class="mc-chip">Gimbal or camera</span>
        </div>
        <div class="mc-connect-card">
          <div class="mc-connect-name-wrap">
            <form class="mc-say mc-connect-name-form" data-connect="name" role="search">
              <label class="mc-sr" for="mc-connect-name-in">Say its name</label>
              <input
                id="mc-connect-name-in"
                class="mc-connect-input"
                type="text"
                placeholder="Say its name (e.g. lamp)"
                autocomplete="off"
              />
              <button type="submit" class="mc-btn primary mc-connect-go">Go</button>
            </form>
          </div>
          <span class="mc-chip">On-device Nano</span>
        </div>
        <div class="mc-connect-card">
          <button type="button" class="mc-btn primary mc-connect-opt mc-connect-phone" data-connect="phone" aria-label="Join a phone">
            Join a phone
          </button>
          <span class="mc-chip">Laptop chime</span>
        </div>
      </div>
    </section>
  `.trim();

  host.innerHTML = html;
  const element = host.querySelector<HTMLElement>('.mc-connect-sheet') ?? host;
  const statusEl = host.querySelector<HTMLElement>('.mc-connect-status');

  const pointBtn = host.querySelector<HTMLElement>('.mc-connect-point');
  pointBtn?.addEventListener('click', () => callbacks.onPoint?.());

  const phoneBtn = host.querySelector<HTMLElement>('.mc-connect-phone');
  phoneBtn?.addEventListener('click', () => callbacks.onJoinPhone?.());

  const nameForm = host.querySelector<HTMLFormElement>('.mc-connect-name-form');
  nameForm?.addEventListener('submit', (ev: Event) => {
    ev.preventDefault?.();
    const input = host.querySelector<HTMLInputElement>('.mc-connect-input');
    const raw = input?.value ?? '';
    const clean = sanitizeDeviceName(raw);
    if (clean) {
      callbacks.onName?.(clean);
    }
  });

  function unmount(): void {
    host.innerHTML = '';
  }

  const closeBtn = host.querySelector<HTMLElement>('.mc-connect-close');
  closeBtn?.addEventListener('click', () => {
    callbacks.onClose?.();
    unmount();
  });

  return {
    element,
    setStatus(text: string) {
      if (statusEl) statusEl.textContent = text;
    },
    unmount,
  };
}

export const PAIR_PLAYING = 'Playing a chime — hold your phone near this laptop. No typing, no scanning.';
export const PAIR_TAP = 'Tap “Tap to play the chime” — this browser needs a tap before it can play sound. Then hold your phone near this laptop.';

export function showPairing(
  host: HTMLElement,
  opts: PairingOptions,
): PairingView {
  const codeFormatted = formatPairingCode(opts.code);
  // The status line says what is happening; the note only adds to it — the
  // same sentence is never printed twice.
  const note = (opts.note ?? '').trim();
  const noteHtml = `<p class="mc-pair-note"${note && note !== PAIR_PLAYING ? '' : ' hidden'}>${esc(note === PAIR_PLAYING ? '' : note)}</p>`;

  const html = `
    <section class="mc-pairing-card" role="region" aria-label="Pair phone to canvas">
      <div class="mc-pairing-head">
        <h3 class="mc-prop-title">Pair phone</h3>
        <button type="button" class="mc-btn mc-pairing-close" aria-label="Close pairing view">✕</button>
      </div>
      <p class="mc-pair-status" role="status" aria-live="polite">${PAIR_PLAYING}</p>
      <div class="mc-pair-actions">
        <button type="button" class="mc-btn primary mc-pair-play" data-mc-play-chime>Play chime again</button>
        <button type="button" class="mc-btn mc-pair-speak" data-mc-speak-code>Say the code aloud</button>
      </div>
      ${noteHtml}
      <details class="mc-pair-fallback">
        <summary>Can't hear the chime?</summary>
        <p class="mc-pair-code-row">Last resort — type this code on the phone: <strong class="mc-pair-code">${codeFormatted}</strong></p>
      </details>
    </section>
  `.trim();

  host.innerHTML = html;
  const element = host.querySelector<HTMLElement>('.mc-pairing-card') ?? host;
  const statusEl = host.querySelector<HTMLElement>('.mc-pair-status');
  const noteEl = host.querySelector<HTMLElement>('.mc-pair-note');

  let loop: ChimeLoop | null = null;
  const playButton = (): HTMLElement | null => host.querySelector<HTMLElement>('.mc-pair-play');
  /** The browser only lets a page make sound after she has clicked, tapped or
   *  pressed a key on it. Until then the chime is NOT playing: say so, and
   *  make the button the way to start it. */
  const showAudible = (audible: boolean): void => {
    if (statusEl && (statusEl.textContent === PAIR_PLAYING || statusEl.textContent === PAIR_TAP)) statusEl.textContent = audible ? PAIR_PLAYING : PAIR_TAP;
    const b = playButton();
    if (b) b.textContent = audible ? 'Play chime again' : 'Tap to play the chime';
  };
  const ensureLoop = (): ChimeLoop => (loop ??= createChimeLoop({ code: normalizeCode(opts.code), everyMs: opts.chimeEveryMs, onAudible: showAudible }));
  const playOnce = async () => {
    if (opts.playChime) {
      await opts.playChime();
      return;
    }
    await ensureLoop().playOnce();
  };

  const startLoop = () => {
    if (opts.playChime) {
      void playOnce();
      return;
    }
    ensureLoop().start();
  };

  const stopChime = () => {
    loop?.stop();
  };

  const speak = () => {
    if (opts.speakCode) opts.speakCode();
    else speakPairingCode(codeFormatted);
  };

  // Auto-play in a real browser unless the caller asked us not to (tests).
  const canAuto = opts.autoPlay ?? (typeof AudioContext !== 'undefined' || typeof window !== 'undefined');
  if (opts.autoPlay === true || (opts.autoPlay !== false && opts.playChime)) {
    startLoop();
  } else if (opts.autoPlay !== false && canAuto && !opts.playChime) {
    // Only start the Web Audio loop when we are actually in a page — Node tests
    // have no AudioContext and must not leak a timer.
    if (typeof AudioContext !== 'undefined') startLoop();
  }

  const playBtn = host.querySelector<HTMLElement>('.mc-pair-play');
  // Her own click is the gesture the browser needs: start the loop from it.
  playBtn?.addEventListener('click', () => { if (opts.playChime) void playOnce(); else { const l = ensureLoop(); l.stop(); l.start(); } });
  const speakBtn = host.querySelector<HTMLElement>('.mc-pair-speak');
  speakBtn?.addEventListener('click', () => speak());

  const tearDown = () => {
    stopChime();
    host.innerHTML = '';
  };

  const closeBtn = host.querySelector<HTMLElement>('.mc-pairing-close');
  closeBtn?.addEventListener('click', () => {
    stopChime();
    opts.onClose?.();
    host.innerHTML = '';
  });

  return {
    element,
    setStatus(text: string) {
      if (statusEl) statusEl.textContent = text;
    },
    setNote(text: string) {
      if (noteEl) noteEl.textContent = text;
    },
    playChimeAgain() { void playOnce(); },
    speakCode() { speak(); },
    stopChime,
    clear() { tearDown(); },
  };
}
