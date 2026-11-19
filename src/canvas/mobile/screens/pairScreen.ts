// Pairing screen: QR scan / 8-char code entry when unpaired; hub name +
// reconnect + recent changes once paired. The large say bar only appears once
// paired — there is nothing to talk to before that.
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
          <p class="mc-m-sub">Changes you propose here still wait for a keep on the hub.</p>
          <button type="button" class="mc-m-btn mc-m-btn-secondary mc-m-reconnect">Reconnect</button>
        </section>
        ${recentChangesHtml(recent)}
        ${sayBarHtml('Say what to change')}
      </div>`
    : `
      <div class="mc-m-screen mc-m-pair">
        <section class="mc-m-pair-card">
          <p class="mc-m-eyebrow">Pair this phone</p>
          <h1 class="mc-m-title">Scan the hub's QR, or enter its code</h1>
          <div class="mc-m-qr" role="img" aria-label="QR code to pair with the hub">QR</div>
          <form class="mc-m-code-form">
            <label class="mc-m-code-label" for="mc-m-code-in">8-character code</label>
            <input id="mc-m-code-in" class="mc-m-code-in" type="text" inputmode="text" autocapitalize="characters"
              autocomplete="off" maxlength="9" placeholder="${esc(pair.code)}" value="${esc(pair.code)}" />
            <button type="submit" class="mc-m-btn mc-m-btn-primary">Pair</button>
          </form>
        </section>
      </div>`;

  main.querySelector('.mc-m-reconnect')?.addEventListener('click', () => {
    const btn = main.querySelector<HTMLButtonElement>('.mc-m-reconnect')!;
    btn.disabled = true;
    btn.textContent = 'Reconnecting…';
    window.setTimeout(() => { btn.disabled = false; btn.textContent = 'Reconnect'; }, 600);
  });
  main.querySelector('.mc-m-code-form')?.addEventListener('submit', (e) => e.preventDefault());
  if (pair.paired) wireSayBar(main, onSay);
}
