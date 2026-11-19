// Short "recent changes" list shown on the pairing and canvas screens.
import { esc } from '../htmlEsc';
import type { MobileRecentChange } from '../mockState';

const WHO_LABEL: Record<MobileRecentChange['who'], string> = {
  you: 'You',
  quick: 'Quick · on this device',
  deep: 'Deep · online',
};

export function recentChangesHtml(items: readonly MobileRecentChange[]): string {
  if (!items.length) return '';
  return `
    <section class="mc-m-recent" aria-label="Recent changes">
      <h2 class="mc-m-recent-h">Recent changes</h2>
      <ul>
        ${items
          .map(
            (i) => `<li>
              <span class="mc-m-recent-summary">${esc(i.summary)}</span>
              <span class="mc-m-recent-meta">${esc(WHO_LABEL[i.who])} · ${esc(i.when)}</span>
            </li>`,
          )
          .join('')}
      </ul>
    </section>`;
}
