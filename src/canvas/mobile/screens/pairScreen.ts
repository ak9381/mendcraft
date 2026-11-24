// Pairing screen: a TYPABLE 8-character code — no QR, no scanning. After the
// first pair the phone remembers the room, so a remembered phone auto-reconnects
// and later just joins when you look at it (gaze) — nothing to type again.
import { esc } from '../htmlEsc';
import type { SimMobileState } from '../mockState';
import type { Platform } from '../platform';
import { recentChangesHtml } from '../components/recentChanges';
import { sayBarHtml, wireSayBar } from '../components/sayBar';

export function renderPairScreen(main: HTMLElement, state: SimMobileState, _platform: Platform, onSay: (t: string) => void): void {
  const { pair, recent } = state;
  main.innerHTML = pair.paired
    ? `
      <div class="mc-m-screen mc-m-pair">
        <section class="mc-m-pair-card mc-m-pair-card-paired">
          <p class="mc-m-eyebrow">Paired</p>
          <h1 class="mc-m-title">${esc(pair.hubName)}</h1>
          <p class="mc-m-sub">Remembered on this phone. It rejoins on its own when you pick it up and look at it — no code, no scan.</p>
          <button type="button" class="mc-m-btn mc-m-btn-secondary mc-m-reconnect">Reconnect now</button>
        </section>
        ${recentChangesHtml(recent)}
        ${sayBarHtml('Say what to change')}
      </div>`
    : `
      <div class="mc-m-screen mc-m-pair">
        <section class="mc-m-pair-card">
          <p class="mc-m-eyebrow">Pair this phone</p>
          <h1 class="mc-m-title">Type the hub's 8-character code</h1>
          <p class="mc-m-sub">No scanning. Read the code off the laptop once. After that this phone joins by itself when you look at it.</p>
          <form class="mc-m-code-form">
            <label class="mc-m-code-label" for="mc-m-code-in">Pairing code</label>
            <input id="mc-m-code-in" class="mc-m-code-in" type="text" inputmode="text" autocapitalize="characters"
              autocomplete="off" maxlength="9" placeholder="${esc(pair.code)}" value="" aria-describedby="mc-m-code-help" />
            <p id="mc-m-code-help" class="mc-m-code-help">Looks like <code>${esc(pair.code)}</code></p>
            <button type="submit" class="mc-m-btn mc-m-btn-primary">Pair</button>
          </form>
        </section>
      </div>`;

  main.querySelector('.mc-m-reconnect')?.addEventListener('click', () => {
    const btn = main.querySelector<HTMLButtonElement>('.mc-m-reconnect')!;
    btn.disabled = true;
    btn.textContent = 'Reconnecting…';
    window.setTimeout(() => { btn.disabled = false; btn.textContent = 'Reconnect now'; }, 600);
  });
  main.querySelector('.mc-m-code-form')?.addEventListener('submit', (e) => e.preventDefault());
  if (pair.paired) wireSayBar(main, onSay);
}
