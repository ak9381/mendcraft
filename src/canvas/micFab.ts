// BIG FLOATING MIC. One large button (72px) that toggles listening, so it
// works the same by tap, keyboard (Enter / Space) and hand (pinch = click via
// handPointer.ts). Listening shows as a filled button, a pulsing ring (static
// under reduced motion), a changed label and aria-pressed="true". It stops on
// a second press or after a safety timeout.

export interface MicVoice {
  readonly supported: boolean;
  pushToTalkStart(): void;
  pushToTalkStop(): void;
}

export interface MicFab {
  readonly el: HTMLButtonElement;
  readonly listening: boolean;
  toggle(): void;
  stop(): void;
  destroy(): void;
}

export const MIC_IDLE_LABEL = 'Talk';
export const LISTENING_STATUS = 'Listening…';
export const MIC_LISTENING_LABEL = 'Listening… press to stop';

/** The one mic icon, shared by the canvas floating mic and the mobile say bar. */
export const MIC_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>';

export function micFabState(listening: boolean): { pressed: 'true' | 'false'; label: string } {
  return { pressed: listening ? 'true' : 'false', label: listening ? MIC_LISTENING_LABEL : MIC_IDLE_LABEL };
}

export function mountMicFab(
  root: HTMLElement,
  voice: MicVoice | null,
  say: (text: string) => void,
  opts: { maxMs?: number; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout; getStatus?: () => string } = {},
): MicFab {
  const doc = root.ownerDocument;
  const maxMs = opts.maxMs ?? 15000;
  const setT = opts.setTimer ?? setTimeout; const clearT = opts.clearTimer ?? clearTimeout;
  const el = doc.createElement('button');
  el.type = 'button';
  el.className = 'mc-fab-mic';
  el.innerHTML = `${MIC_ICON_SVG}<span class="mc-fab-mic-label"></span>`;
  const label = el.querySelector<HTMLElement>('.mc-fab-mic-label')!;
  root.append(el);

  let listening = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function render() {
    const s = micFabState(listening);
    el.setAttribute('aria-pressed', s.pressed);
    // Named even when the visible label is hidden on phones.
    el.setAttribute('aria-label', listening ? 'Stop listening' : 'Talk: start listening');
    label.textContent = s.label;
    el.classList.toggle('is-listening', listening);
  }
  function stop(timedOut = false) {
    if (!listening) return;
    listening = false;
    if (timer) { clearT(timer); timer = null; }
    try { voice?.pushToTalkStop(); } catch { /* recogniser already stopped */ }
    render();
    // Nothing was heard (no turn replaced the line): don't leave "Listening…"
    // up after the mic is off. A turn's own status is never overwritten.
    if (opts.getStatus?.() === LISTENING_STATUS) say(timedOut ? 'Stopped listening — nothing heard.' : 'Stopped listening.');
  }
  function toggle() {
    if (listening) { stop(); return; }
    if (!voice?.supported) { say('Voice needs Chrome or the phone app here. You can type in the say box.'); return; }
    listening = true;
    try { voice.pushToTalkStart(); } catch { listening = false; say('The mic could not start.'); render(); return; }
    say(LISTENING_STATUS);
    timer = setT(() => stop(true), maxMs);
    render();
  }
  el.addEventListener('click', toggle);
  render();

  return {
    el,
    get listening() { return listening; },
    toggle, stop: () => stop(),
    destroy() { stop(); el.remove(); },
  };
}
