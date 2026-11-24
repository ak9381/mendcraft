// The small top-centre banner while ?replay=demo plays the journey:
// "Replay · step N/M · <label>", a note line ("Replay · approving …"), and
// Stop. Stop ends the replay and leaves the canvas as it is, usable.

export interface ReplayBanner {
  step(index: number, total: number, label: string): void;
  note(text: string): void;
  /** Final line; the banner fades after `ms` (kept when ms is 0). */
  finish(text: string, ms?: number): void;
  readonly el: HTMLElement;
  destroy(): void;
}

const CSS = `
.mc-replay { position: fixed; z-index: 70; top: 72px; left: 50%; translate: -50% 0; max-width: calc(100vw - 32px);
  display: flex; align-items: center; gap: 10px; padding: 6px 8px 6px 14px; border-radius: 999px;
  background: #2B2B2B; color: #F7F5F0; font-size: 14px; line-height: 1.3; box-shadow: 0 6px 18px rgb(0 0 0 / 0.18); }
.mc-replay-text { display: flex; flex-direction: column; min-width: 0; }
.mc-replay-step, .mc-replay-note { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mc-replay-note { font-size: 12px; color: #D8D3C8; }
.mc-replay-note:empty { display: none; }
.mc-replay-sim { font-size: 11px; border: 1px solid #8E897F; border-radius: 999px; padding: 1px 7px; color: #D8D3C8; }
.mc-replay-stop { min-height: 32px; padding: 0 14px; border-radius: 999px; border: 0; background: #F7F5F0; color: #2B2B2B;
  font: inherit; font-weight: 600; cursor: pointer; }
.mc-replay-stop:focus-visible { outline: 2px solid #5A7BA6; outline-offset: 2px; }
.mc-replay.is-done .mc-replay-stop { display: none; }
`;

export function mountReplayBanner(root: HTMLElement, onStop: () => void): ReplayBanner {
  const doc = root.ownerDocument;
  if (!doc.getElementById('mc-replay-css')) {
    const style = doc.createElement('style');
    style.id = 'mc-replay-css';
    style.textContent = CSS;
    doc.head.append(style);
  }
  const el = doc.createElement('div');
  el.className = 'mc-replay';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `<span class="mc-replay-sim">SIM</span>
    <span class="mc-replay-text"><span class="mc-replay-step">Replay · starting</span><span class="mc-replay-note"></span></span>
    <button type="button" class="mc-replay-stop">Stop</button>`;
  const stepEl = el.querySelector<HTMLElement>('.mc-replay-step')!;
  const noteEl = el.querySelector<HTMLElement>('.mc-replay-note')!;
  el.querySelector('.mc-replay-stop')!.addEventListener('click', (e) => { e.stopPropagation(); onStop(); });
  root.append(el);
  let fade: ReturnType<typeof setTimeout> | null = null;
  return {
    el,
    step(index, total, label) { stepEl.textContent = `Replay · step ${index}/${total} · ${label}`; noteEl.textContent = ''; },
    note(text) { noteEl.textContent = text; },
    finish(text, ms = 6000) {
      el.classList.add('is-done');
      stepEl.textContent = text;
      noteEl.textContent = '';
      if (ms > 0) fade = setTimeout(() => el.remove(), ms);
    },
    destroy() { if (fade) clearTimeout(fade); el.remove(); },
  };
}
