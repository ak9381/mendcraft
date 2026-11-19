// Single-board focus with a swipeable board strip, a pinch-zoom-friendly board
// area, and the pinned dashboard as a collapsible bottom card.
import { esc } from '../htmlEsc';
import type { SimMobileState } from '../mockState';
import type { Platform } from '../platform';
import { deviceTilesHtml } from '../components/deviceTile';
import { privacyChipHtml } from '../components/privacyChip';
import { sayBarHtml, wireSayBar } from '../components/sayBar';

export function renderCanvasScreen(main: HTMLElement, state: SimMobileState, _platform: Platform, onSay: (t: string) => void): void {
  const { boards, devices, privacy } = state;
  const active = boards.find((b) => b.active) ?? boards[0];

  main.innerHTML = `
    <div class="mc-m-screen mc-m-canvas">
      <nav class="mc-m-boardstrip" aria-label="Boards" role="list">
        ${boards
          .map(
            (b) => `<button type="button" class="mc-m-boardchip" role="listitem" data-board="${esc(b.id)}"
              aria-current="${b.id === active.id ? 'true' : 'false'}">${esc(b.title)}</button>`,
          )
          .join('')}
      </nav>

      <section class="mc-m-board" aria-label="${esc(active.title)} board" tabindex="0">
        <h1 class="mc-m-board-title">${esc(active.title)}</h1>
        <p class="mc-m-board-hint">Pinch to zoom. Swipe the board strip to switch rooms.</p>
        ${deviceTilesHtml(devices)}
      </section>

      <section class="mc-m-dockcard" aria-label="Pinned dashboard">
        <button type="button" class="mc-m-dockcard-handle" aria-expanded="false" aria-controls="mc-m-dockcard-body">
          <span class="mc-m-dockcard-grabber" aria-hidden="true"></span>
          <span>Dashboard · ${devices.length} device${devices.length === 1 ? '' : 's'}</span>
          ${privacyChipHtml(privacy)}
        </button>
        <div id="mc-m-dockcard-body" class="mc-m-dockcard-body" hidden>
          ${deviceTilesHtml(devices)}
        </div>
      </section>

      ${sayBarHtml('Say "connect everything in this room"')}
    </div>`;

  const handle = main.querySelector<HTMLButtonElement>('.mc-m-dockcard-handle')!;
  const body = main.querySelector<HTMLElement>('.mc-m-dockcard-body')!;
  handle.addEventListener('click', () => {
    const open = handle.getAttribute('aria-expanded') === 'true';
    handle.setAttribute('aria-expanded', String(!open));
    body.hidden = open;
  });

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
