// "Pair phone" panel: the laptop plays a short pairing chime so a phone can
// join without typing or scanning. Live pairing status and the incoming
// phone-camera preview still live here. DOM only — session wiring stays in
// main.ts. Pinned over the canvas like the other float panels; buttons work
// for mouse AND pinch pointer.

import { groupCode } from '../relay/protocol';
import { createChimeLoop, speakPairingCode, type ChimeLoop } from '../ux/pairingChime';

export interface PairPanel {
  readonly element: HTMLElement;
  toggle(): void;
  open(): void;
  isOpen(): boolean;
  /** Remember the room and start looping the pairing chime. */
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
    <div class="mc-pair-actions">
      <button type="button" class="mc-btn primary mc-pair-play" data-mc-play-chime hidden>Play chime again</button>
      <button type="button" class="mc-btn mc-pair-speak" data-mc-speak-code hidden>Say the code aloud</button>
    </div>
    <details class="mc-pair-fallback" hidden>
      <summary>Can't hear the chime?</summary>
      <p class="mc-pair-code-row">Last resort — type this code on the phone:
        <strong class="mc-pair-code"></strong></p>
    </details>
    <figure class="mc-pair-cam" hidden>
      <img class="mc-pair-frame" alt="Live still from the paired phone camera" />
      <figcaption>Phone camera — stays between your two devices, never sent to AI.</figcaption>
    </figure>
    <p class="mc-pair-note"></p>
    <button type="button" class="mc-pair-disconnect" hidden>Disconnect phone</button>
  `;

  const statusEl = root.querySelector<HTMLParagraphElement>('.mc-pair-status')!;
  const fallback = root.querySelector<HTMLDetailsElement>('.mc-pair-fallback')!;
  const codeEl = root.querySelector<HTMLElement>('.mc-pair-code')!;
  const playBtn = root.querySelector<HTMLButtonElement>('.mc-pair-play')!;
  const speakBtn = root.querySelector<HTMLButtonElement>('.mc-pair-speak')!;
  const camFig = root.querySelector<HTMLElement>('.mc-pair-cam')!;
  const frameImg = root.querySelector<HTMLImageElement>('.mc-pair-frame')!;
  const noteEl = root.querySelector<HTMLParagraphElement>('.mc-pair-note')!;
  const disconnectBtn = root.querySelector<HTMLButtonElement>('.mc-pair-disconnect')!;

  let loop: ChimeLoop | null = null;
  let lastCode = '';

  const stopChime = () => { loop?.stop(); };

  const hide = () => {
    stopChime();
    root.hidden = true;
  };

  root.querySelector('.mc-pair-x')!.addEventListener('click', hide);
  disconnectBtn.addEventListener('click', () => opts.onDisconnect());
  playBtn.addEventListener('click', () => { void loop?.playOnce(); });
  speakBtn.addEventListener('click', () => {
    if (lastCode) speakPairingCode(groupCode(lastCode));
  });

  return {
    element: root,
    open() {
      root.hidden = false;
      opts.onOpen();
    },
    toggle() {
      if (root.hidden) this.open();
      else hide();
    },
    isOpen: () => !root.hidden,
    setRoom(_joinUrl, code) {
      lastCode = code;
      codeEl.textContent = groupCode(code);
      fallback.hidden = false;
      playBtn.hidden = false;
      speakBtn.hidden = false;
      stopChime();
      loop = createChimeLoop({ code });
      loop.start();
      statusEl.textContent = 'Playing a chime — hold your phone near this laptop. No typing, no scanning.';
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
      if (paired) stopChime();
      if (!paired) this.clearFrame();
    },
  };
}
