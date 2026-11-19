// A single device control, sized to clear 44pt (iOS) / 48dp (Android) touch
// targets on every platform (mobile.css sets min-height via --mc-m-target).
import { esc } from '../htmlEsc';
import type { MobileDeviceTile } from '../mockState';

export function deviceTileHtml(d: MobileDeviceTile): string {
  // No custom aria-label: the accessible name comes straight from the visible
  // label + detail text, and aria-pressed already announces on/off state.
  return `
    <button type="button" class="mc-m-tile" data-device="${esc(d.id)}" data-kind="${esc(d.kind)}"
      aria-pressed="${d.on ? 'true' : 'false'}">
      <span class="mc-m-tile-dot" aria-hidden="true"></span>
      <span class="mc-m-tile-text">
        <span class="mc-m-tile-label">${esc(d.label)}</span>
        <span class="mc-m-tile-detail">${esc(d.detail)}</span>
      </span>
    </button>`;
}

export function deviceTilesHtml(devices: readonly MobileDeviceTile[]): string {
  // role="group" (not "list"): a toggle-button grid, not list content, so
  // there is no aria-required-children expectation of <li>/role=listitem.
  return `<div class="mc-m-tiles" role="group" aria-label="Devices">${devices.map((d) => deviceTileHtml(d)).join('')}</div>`;
}
