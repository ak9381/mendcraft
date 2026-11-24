// The pinned dashboard, full-screen: device tiles at comfortable touch sizes, a
// "Pin on this device" button (pinch-clicks — pins the board so it keeps working
// if the hub/network drops), an honest "Stays on this phone / Goes to the cloud"
// split, a sync status line, and edge-glow / enter-from-edge hooks for tiles that
// arrive from the laptop or the other phone.
import { esc } from '../htmlEsc';
import type { SimMobileState } from '../mockState';
import type { Platform } from '../platform';
import { deviceTilesHtml } from '../components/deviceTile';
import { privacyChipHtml } from '../components/privacyChip';
import { sayBarHtml, wireSayBar } from '../components/sayBar';
import { deviceSplit, splitSummary, type DevicePlatform } from '../../deviceSplit';
import { wirePinButton } from '../pinButton';

const SYNC_TEXT: Record<SimMobileState['sync']['reason'], string> = {
  face: 'Synced when you looked at this phone',
  focus: 'Synced when you opened this phone',
  idle: 'Waiting — open or look at this phone to sync',
};

export function renderDashboardScreen(main: HTMLElement, state: SimMobileState, platform: Platform, onSay: (t: string) => void): void {
  const { boards, devices, privacy, arrangement, pinned, hasAppleAI, sync } = state;
  const active = boards.find((b) => b.active) ?? boards[0];
  const plat: DevicePlatform = platform.os === 'ios' ? 'ios' : platform.os === 'android' ? 'android' : 'laptop';
  const split = deviceSplit(plat, hasAppleAI);
  // The INNER edge (toward the laptop) is where a tile both enters from and
  // exits toward: phone on the left → inner is its right edge, and vice versa.
  const innerEdge = arrangement.side === 'left' ? 'right' : 'left';

  const list = (items: string[]): string => items.map((t) => `<li>${esc(t)}</li>`).join('');

  main.innerHTML = `
    <div class="mc-m-screen mc-m-dashboard" data-side="${esc(arrangement.side ?? '')}" data-inner-edge="${innerEdge}">
      <div class="mc-m-edge-glow mc-m-edge-left" data-mc-edge="left" aria-hidden="true"></div>
      <div class="mc-m-edge-glow mc-m-edge-right" data-mc-edge="right" aria-hidden="true"></div>
      <header class="mc-m-dash-head">
        <button type="button" class="mc-m-btn mc-m-btn-secondary mc-m-back">Back to canvas</button>
        <h1 class="mc-m-title">${esc(active.title)} dashboard</h1>
        ${privacyChipHtml(privacy)}
      </header>

      <div class="mc-m-dash-actions">
        <button type="button" class="mc-m-btn mc-m-pin ${pinned ? 'is-pinned' : ''}" data-mc-pin
          aria-pressed="${pinned ? 'true' : 'false'}">${pinned ? 'Pinned on this device' : 'Pin on this device'}</button>
        <span class="mc-m-sync" role="status">${esc(SYNC_TEXT[sync.reason])} · ${esc(sync.at)}</span>
      </div>

      <section class="mc-m-split" aria-label="What stays on this phone and what goes to the cloud">
        <span class="mc-m-split-badge">${esc(split.badge)}</span>
        <p class="mc-m-split-sum">${esc(splitSummary(split))}</p>
        <div class="mc-m-split-cols">
          <div class="mc-m-split-col mc-m-split-stays">
            <h2>Stays on this phone</h2>
            <ul>${list(split.stays)}</ul>
          </div>
          <div class="mc-m-split-col mc-m-split-goes">
            <h2>Goes to the cloud</h2>
            <ul>${list(split.goes)}</ul>
          </div>
        </div>
      </section>

      ${deviceTilesHtml(devices)}
      ${sayBarHtml('Say a device by name')}
    </div>`;

  // Pin on this device: a normal button that pinch-clicks (handPointer turns a
  // pinch-tap into a click). Flips aria-pressed + label — the real persistence is
  // wired by mobileMain against localStorage.
  const pinBtn = main.querySelector<HTMLButtonElement>('[data-mc-pin]');
  if (pinBtn) wirePinButton(pinBtn);

  main.querySelectorAll<HTMLButtonElement>('.mc-m-tile').forEach((tile) => {
    tile.addEventListener('click', () => {
      const on = tile.getAttribute('aria-pressed') === 'true';
      tile.setAttribute('aria-pressed', String(!on));
    });
  });

  wireSayBar(main, onSay);
}
