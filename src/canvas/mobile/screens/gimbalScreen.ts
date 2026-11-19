// Full-bleed camera view with a follow toggle and a small status pill.
// Soft-fails on the web (and on any phone without the iPhone's gimbal rig).
import { esc } from '../htmlEsc';
import type { SimMobileState } from '../mockState';
import type { Platform } from '../platform';

export function renderGimbalScreen(main: HTMLElement, state: SimMobileState, _platform: Platform): void {
  const { gimbal } = state;

  main.innerHTML = `
    <div class="mc-m-screen mc-m-gimbal">
      <div class="mc-m-camera" role="img" aria-label="Camera preview placeholder"></div>
      <p class="mc-m-gimbal-pill" role="status">${esc(gimbal.why)}</p>
      <button type="button" class="mc-m-btn mc-m-btn-follow" aria-pressed="${gimbal.following ? 'true' : 'false'}">
        ${gimbal.following ? 'Following your hands' : 'Hold still'}
      </button>
    </div>`;

  const follow = main.querySelector<HTMLButtonElement>('.mc-m-btn-follow')!;
  follow.addEventListener('click', () => {
    const on = follow.getAttribute('aria-pressed') === 'true';
    follow.setAttribute('aria-pressed', String(!on));
    follow.textContent = on ? 'Hold still' : 'Following your hands';
  });
}
