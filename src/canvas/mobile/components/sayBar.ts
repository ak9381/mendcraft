// Fixed bottom thumb-zone say bar: a single toggle mic (tap starts/stops
// listening, same as the canvas floating mic) plus a text fallback. Shared by
// every mobile screen so the primary action never moves.
import { MIC_ICON_SVG, MIC_IDLE_LABEL, micFabState } from '../../micFab';

export function sayBarHtml(placeholder = 'Say what to change'): string {
  return `
    <form class="mc-m-saybar" role="search">
      <label class="mc-sr" for="mc-m-say-in">Say or type a command</label>
      <input id="mc-m-say-in" class="mc-m-say-in" type="text" autocomplete="off" placeholder="${placeholder}" />
      <button type="button" class="mc-m-talk" aria-pressed="false" aria-label="Talk: start listening">${MIC_ICON_SVG}<span class="mc-m-talk-label">${MIC_IDLE_LABEL}</span></button>
    </form>`;
}

export function wireSayBar(host: ParentNode, onSay: (text: string) => void): void {
  const form = host.querySelector<HTMLFormElement>('.mc-m-saybar');
  const input = host.querySelector<HTMLInputElement>('.mc-m-say-in');
  const talk = host.querySelector<HTMLButtonElement>('.mc-m-talk');
  const label = talk?.querySelector<HTMLElement>('.mc-m-talk-label');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input?.value.trim();
    if (v) { onSay(v); if (input) input.value = ''; }
  });
  let listening = false;
  function render() {
    if (!talk) return;
    const s = micFabState(listening);
    talk.setAttribute('aria-pressed', s.pressed);
    talk.setAttribute('aria-label', listening ? 'Stop listening' : 'Talk: start listening');
    if (label) label.textContent = s.label;
  }
  talk?.addEventListener('click', () => { listening = !listening; render(); });
}
