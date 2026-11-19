// Fixed bottom thumb-zone say bar: a large hold-to-talk button plus a text
// fallback. Shared by every mobile screen so the primary action never moves.
export function sayBarHtml(placeholder = 'Say what to change'): string {
  return `
    <form class="mc-m-saybar" role="search">
      <label class="mc-sr" for="mc-m-say-in">Say or type a command</label>
      <input id="mc-m-say-in" class="mc-m-say-in" type="text" autocomplete="off" placeholder="${placeholder}" />
      <button type="button" class="mc-m-talk" aria-pressed="false" aria-label="Hold to talk">Hold to talk</button>
    </form>`;
}

export function wireSayBar(host: ParentNode, onSay: (text: string) => void): void {
  const form = host.querySelector<HTMLFormElement>('.mc-m-saybar');
  const input = host.querySelector<HTMLInputElement>('.mc-m-say-in');
  const talk = host.querySelector<HTMLButtonElement>('.mc-m-talk');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input?.value.trim();
    if (v) { onSay(v); if (input) input.value = ''; }
  });
  const start = () => talk?.setAttribute('aria-pressed', 'true');
  const stop = () => talk?.setAttribute('aria-pressed', 'false');
  talk?.addEventListener('pointerdown', start);
  talk?.addEventListener('pointerup', stop);
  talk?.addEventListener('pointerleave', stop);
}
