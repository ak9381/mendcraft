// Pairing screen: first-time join listens for the laptop chime — no typing
// and no scanning as the main path. After the first pair the phone remembers
// the room, so a remembered phone auto-reconnects when you look at it.
import { esc } from '../htmlEsc';
import type { SimMobileState } from '../mockState';
import type { Platform } from '../platform';
import { recentChangesHtml } from '../components/recentChanges';
import { sayBarHtml, wireSayBar } from '../components/sayBar';
import { wireListenAgainButton } from '../listenAgain';

export function renderPairScreen(main: HTMLElement, state: SimMobileState, _platform: Platform, onSay: (t: string) => void): void {
  const { pair, recent } = state;
  main.innerHTML = pair.paired
    ? `
      <div class="mc-m-screen mc-m-pair">
        <section class="mc-m-pair-card mc-m-pair-card-paired">
          <p class="mc-m-eyebrow">Paired</p>
          <h1 class="mc-m-title">${esc(pair.hubName)}</h1>
          <p class="mc-m-sub">Remembered on this phone. It rejoins on its own when you pick it up and look at it — no chime, no code, no scan.</p>
          <button type="button" class="mc-m-btn mc-m-btn-secondary mc-m-reconnect">Reconnect now</button>
        </section>
        ${recentChangesHtml(recent)}
        ${sayBarHtml('Say what to change')}
      </div>`
    : `
      <div class="mc-m-screen mc-m-pair">
        <section class="mc-m-pair-card">
          <p class="mc-m-eyebrow">Pair this phone</p>
          <h1 class="mc-m-title">Listening for laptop chime…</h1>
          <p class="mc-m-sub">Hold this phone near the laptop. No typing, no scanning. After the first pair, this phone joins by itself when you look at it.</p>
          <button type="button" class="mc-m-btn mc-m-btn-primary mc-m-listen-again" data-mc-listen-again>Listen again</button>
          <p class="mc-m-listen-status" role="status" aria-live="polite"></p>
          <details class="mc-m-code-fallback">
            <summary>Can't hear the chime?</summary>
            <form class="mc-m-code-form">
              <label class="mc-m-code-label" for="mc-m-code-in">Pairing code (last resort)</label>
              <input id="mc-m-code-in" class="mc-m-code-in" type="text" inputmode="text" autocapitalize="characters"
                autocomplete="off" maxlength="9" placeholder="${esc(pair.code)}" value="" aria-describedby="mc-m-code-help" />
              <p id="mc-m-code-help" class="mc-m-code-help">Looks like <code>${esc(pair.code)}</code></p>
              <button type="submit" class="mc-m-btn mc-m-btn-secondary">Pair with code</button>
            </form>
          </details>
        </section>
      </div>`;

  main.querySelector('.mc-m-reconnect')?.addEventListener('click', () => {
    const btn = main.querySelector<HTMLButtonElement>('.mc-m-reconnect')!;
    btn.disabled = true;
    btn.textContent = 'Reconnecting…';
    window.setTimeout(() => { btn.disabled = false; btn.textContent = 'Reconnect now'; }, 600);
  });
  const listenBtn = main.querySelector<HTMLButtonElement>('[data-mc-listen-again]');
  const statusEl = main.querySelector<HTMLElement>('.mc-m-listen-status');
  if (listenBtn) {
    wireListenAgainButton(listenBtn, {
      onListen: () => {
        listenBtn.dispatchEvent(new CustomEvent('mc-listen-again', { bubbles: true }));
        if (statusEl) statusEl.textContent = 'Listening for laptop chime…';
      },
    });
  }
  main.querySelector('.mc-m-code-form')?.addEventListener('submit', (e) => e.preventDefault());
  if (pair.paired) wireSayBar(main, onSay);
}
