// Approval card as a bottom sheet: prompt in -> engine working -> Keep/Drop,
// full-width in the thumb zone, with the privacy-route chip. No say bar here —
// a pending proposal must be kept or dropped before anything else runs.
import { esc } from '../htmlEsc';
import type { SimMobileState } from '../mockState';
import type { Platform } from '../platform';
import { privacyChipHtml } from '../components/privacyChip';

export function renderApprovalScreen(main: HTMLElement, state: SimMobileState, _platform: Platform): void {
  const { proposal, privacy } = state;
  const engineLabel = proposal.engine === 'nano' ? 'Quick · on this device' : 'Deep · online';

  main.innerHTML = `
    <div class="mc-m-screen mc-m-approval">
      <div class="mc-m-backdrop" aria-hidden="true"></div>
      <section class="mc-m-sheet" role="group" aria-label="Proposed change">
        <span class="mc-m-sheet-grabber" aria-hidden="true"></span>
        <p class="mc-m-sheet-asked">You said: &ldquo;${esc(proposal.prompt)}&rdquo;</p>
        <p class="mc-m-sheet-status">${proposal.working ? `${esc(engineLabel)} is working&hellip;` : esc(proposal.summary)}</p>
        ${privacyChipHtml(privacy)}
        <div class="mc-m-sheet-actions">
          <button type="button" class="mc-m-btn mc-m-btn-keep" ${proposal.working ? 'disabled' : ''}>Keep</button>
          <button type="button" class="mc-m-btn mc-m-btn-drop" ${proposal.working ? 'disabled' : ''}>Drop</button>
        </div>
        <p class="mc-m-sheet-result" role="status" aria-live="polite"></p>
      </section>
    </div>`;

  const result = main.querySelector<HTMLElement>('.mc-m-sheet-result')!;
  const keep = main.querySelector<HTMLButtonElement>('.mc-m-btn-keep')!;
  const drop = main.querySelector<HTMLButtonElement>('.mc-m-btn-drop')!;
  const finish = (kept: boolean) => {
    keep.disabled = true; drop.disabled = true;
    result.textContent = kept ? 'Kept.' : 'Dropped. Nothing changed.';
  };
  keep.addEventListener('click', () => finish(true));
  drop.addEventListener('click', () => finish(false));
}
