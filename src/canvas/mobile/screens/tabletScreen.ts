// Tablet split view (>=744px): the board on the left, a side panel with the
// dashboard and recent changes on the right. One say bar spans the bottom.
import { esc } from '../htmlEsc';
import type { SimMobileState } from '../mockState';
import type { Platform } from '../platform';
import { deviceTilesHtml } from '../components/deviceTile';
import { privacyChipHtml } from '../components/privacyChip';
import { recentChangesHtml } from '../components/recentChanges';
import { sayBarHtml, wireSayBar } from '../components/sayBar';

export function renderTabletScreen(main: HTMLElement, state: SimMobileState, _platform: Platform, onSay: (t: string) => void): void {
  const { boards, devices, recent, privacy } = state;
  const active = boards.find((b) => b.active) ?? boards[0];

  main.innerHTML = `
    <div class="mc-m-screen mc-m-tablet">
      <section class="mc-m-tablet-board" aria-label="${esc(active.title)} board">
        <nav class="mc-m-boardstrip" aria-label="Boards" role="list">
          ${boards
            .map(
              (b) => `<button type="button" class="mc-m-boardchip" role="listitem"
                aria-current="${b.id === active.id ? 'true' : 'false'}">${esc(b.title)}</button>`,
            )
            .join('')}
        </nav>
        <h1 class="mc-m-board-title">${esc(active.title)}</h1>
        <p class="mc-m-board-hint">Pinch to zoom.</p>
      </section>

      <aside class="mc-m-tablet-panel" aria-label="Dashboard and activity">
        <h2 class="mc-m-panel-h">Dashboard ${privacyChipHtml(privacy)}</h2>
        ${deviceTilesHtml(devices)}
        ${recentChangesHtml(recent)}
      </aside>

      ${sayBarHtml('Say what to change')}
    </div>`;

  main.querySelectorAll<HTMLButtonElement>('.mc-m-boardchip').forEach((chip) => {
    chip.addEventListener('click', () => {
      main.querySelectorAll('.mc-m-boardchip').forEach((c) => c.setAttribute('aria-current', 'false'));
      chip.setAttribute('aria-current', 'true');
    });
  });
  main.querySelectorAll<HTMLButtonElement>('.mc-m-tile').forEach((tile) => {
    tile.addEventListener('click', () => {
      const on = tile.getAttribute('aria-pressed') === 'true';
      tile.setAttribute('aria-pressed', String(!on));
    });
  });

  wireSayBar(main, onSay);
}
