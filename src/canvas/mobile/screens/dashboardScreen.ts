// The pinned dashboard, full-screen: every device tile at a comfortable
// touch-target size, with the privacy-route chip for the board it belongs to.
import { esc } from '../htmlEsc';
import type { SimMobileState } from '../mockState';
import type { Platform } from '../platform';
import { deviceTilesHtml } from '../components/deviceTile';
import { privacyChipHtml } from '../components/privacyChip';
import { sayBarHtml, wireSayBar } from '../components/sayBar';

export function renderDashboardScreen(main: HTMLElement, state: SimMobileState, _platform: Platform, onSay: (t: string) => void): void {
  const { boards, devices, privacy } = state;
  const active = boards.find((b) => b.active) ?? boards[0];

  main.innerHTML = `
    <div class="mc-m-screen mc-m-dashboard">
      <header class="mc-m-dash-head">
        <button type="button" class="mc-m-btn mc-m-btn-secondary mc-m-back">Back to canvas</button>
        <h1 class="mc-m-title">${esc(active.title)} dashboard</h1>
        ${privacyChipHtml(privacy)}
      </header>
      ${deviceTilesHtml(devices)}
      ${sayBarHtml('Say a device by name')}
    </div>`;

  main.querySelectorAll<HTMLButtonElement>('.mc-m-tile').forEach((tile) => {
    tile.addEventListener('click', () => {
      const on = tile.getAttribute('aria-pressed') === 'true';
      tile.setAttribute('aria-pressed', String(!on));
    });
  });

  wireSayBar(main, onSay);
}
