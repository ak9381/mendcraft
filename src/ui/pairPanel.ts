// "Pair phone" panel: QR + short code for the phone to join, live pairing
// status, and the incoming phone-camera preview. DOM only — session wiring
// (transport pick, command handling) stays in main.ts. Pinned over the canvas
// like the other float panels; buttons work for mouse AND pinch pointer.

import { groupCode } from '../relay/protocol';

export interface PairPanel {
  readonly element: HTMLElement;
  toggle(): void;
  open(): void;
  isOpen(): boolean;
  /** Show the join QR + typable code once the host session exists. */
  setRoom(joinUrl: string, code: string): void;
  setStatus(text: string): void;
  setTransportNote(text: string): void;
  /** Latest phone-camera still (shown here only; never sent anywhere). */
  setFrame(mimeType: string, dataBase64: string): void;
  clearFrame(): void;
  setPaired(paired: boolean): void;
}

export function createPairPanel(opts: {
  /** Called on every open; the caller dedupes live sessions. */
  onOpen: () => void;
  onDisconnect: () => void;
}): PairPanel {
  const root = document.createElement('section');
  root.className = 'mc-pair-panel';
  root.hidden = true;
  root.setAttribute('aria-label', 'Pair a phone');

  root.innerHTML = `
    <div class="mc-pair-head">
      <span class="mc-pair-title">Pair phone</span>
      <button type="button" class="mc-pair-x" aria-label="Close pair panel">✕</button>
    </div>
    <p class="mc-pair-status" role="status" aria-live="polite">Starting…</p>
    <canvas class="mc-pair-qr" width="220" height="220" role="img" aria-label="QR code to pair a phone" hidden></canvas>
    <p class="mc-pair-code-row" hidden>or type this code on <span class="mc-pair-host"></span>/remote:
      <strong class="mc-pair-code"></strong></p>
    <figure class="mc-pair-cam" hidden>
      <img class="mc-pair-frame" alt="Live still from the paired phone camera" />
      <figcaption>Phone camera — stays between your two devices, never sent to AI.</figcaption>
    </figure>
    <p class="mc-pair-note"></p>
    <button type="button" class="mc-pair-disconnect" hidden>Disconnect phone</button>
  `;

  const statusEl = root.querySelector<HTMLParagraphElement>('.mc-pair-status')!;
  const qrCanvas = root.querySelector<HTMLCanvasElement>('.mc-pair-qr')!;
  const codeRow = root.querySelector<HTMLParagraphElement>('.mc-pair-code-row')!;
  const codeEl = root.querySelector<HTMLElement>('.mc-pair-code')!;
  const hostEl = root.querySelector<HTMLElement>('.mc-pair-host')!;
  const camFig = root.querySelector<HTMLElement>('.mc-pair-cam')!;
  const frameImg = root.querySelector<HTMLImageElement>('.mc-pair-frame')!;
  const noteEl = root.querySelector<HTMLParagraphElement>('.mc-pair-note')!;
  const disconnectBtn = root.querySelector<HTMLButtonElement>('.mc-pair-disconnect')!;

  root.querySelector('.mc-pair-x')!.addEventListener('click', () => {
    root.hidden = true;
  });
  disconnectBtn.addEventListener('click', () => opts.onDisconnect());

  return {
    element: root,
    open() {
      root.hidden = false;
      opts.onOpen();
    },
    toggle() {
      if (root.hidden) this.open();
      else root.hidden = true;
    },
    isOpen: () => !root.hidden,
    setRoom(joinUrl, code) {
      codeEl.textContent = groupCode(code);
      hostEl.textContent = new URL(joinUrl).host;
      codeRow.hidden = false;
      qrCanvas.hidden = false;
      // qrcode is lazy-loaded so the phone page / tests never pull it in.
      void import('qrcode').then((QRCode) =>
        QRCode.toCanvas(qrCanvas, joinUrl, { width: 220, margin: 1 }),
      ).catch(() => {
        qrCanvas.hidden = true; // code row still shows the typable fallback
      });
    },
    setStatus(text) {
      statusEl.textContent = text;
    },
    setTransportNote(text) {
      noteEl.textContent = text;
    },
    setFrame(mimeType, dataBase64) {
      frameImg.src = `data:${mimeType};base64,${dataBase64}`;
      camFig.hidden = false;
    },
    clearFrame() {
      frameImg.removeAttribute('src');
      camFig.hidden = true;
    },
    setPaired(paired) {
      disconnectBtn.hidden = !paired;
      if (!paired) this.clearFrame();
    },
  };
}
