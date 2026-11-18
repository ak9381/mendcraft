// DOM module for the CONNECT sheet on smart canvas.
// Presents three big options: "Point at it", "Say its name" (input + Go), "Join a phone".
// Also provides showPairing for the phone join flow and pure helper functions.

import { groupCode, normalizeCode } from '../relay/protocol';

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
  qrDataUrl?: string;
  note?: string;
  onClose?: () => void;
}

export interface PairingView {
  readonly element: HTMLElement;
  setStatus(text: string): void;
  setNote(text: string): void;
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
    { id: 'phone', label: 'Join a phone', desc: 'Connect phone remote via Relay room' },
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
          <span class="mc-chip">Relay room & QR</span>
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

export function showPairing(
  host: HTMLElement,
  opts: PairingOptions,
): PairingView {
  const codeFormatted = formatPairingCode(opts.code);
  const qrHtml = opts.qrDataUrl
    ? `<div class="mc-pair-qr-wrap"><img class="mc-pair-qr" src="${opts.qrDataUrl}" alt="QR code to pair a phone" width="220" height="220" /></div>`
    : '';
  const noteHtml = opts.note ? `<p class="mc-pair-note">${opts.note}</p>` : '<p class="mc-pair-note"></p>';

  const html = `
    <section class="mc-pairing-card" role="region" aria-label="Pair phone to canvas">
      <div class="mc-pairing-head">
        <h3 class="mc-prop-title">Pair phone</h3>
        <button type="button" class="mc-btn mc-pairing-close" aria-label="Close pairing view">✕</button>
      </div>
      <p class="mc-pair-status" role="status" aria-live="polite">Waiting for phone to join…</p>
      ${qrHtml}
      <p class="mc-pair-code-row">Type this code on your phone: <strong class="mc-pair-code">${codeFormatted}</strong></p>
      ${noteHtml}
    </section>
  `.trim();

  host.innerHTML = html;
  const element = host.querySelector<HTMLElement>('.mc-pairing-card') ?? host;
  const statusEl = host.querySelector<HTMLElement>('.mc-pair-status');
  const noteEl = host.querySelector<HTMLElement>('.mc-pair-note');

  const closeBtn = host.querySelector<HTMLElement>('.mc-pairing-close');
  closeBtn?.addEventListener('click', () => {
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
    clear() {
      host.innerHTML = '';
    },
  };
}
