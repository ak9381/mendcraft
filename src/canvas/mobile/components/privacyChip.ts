// The one reusable privacy-route chip shown wherever a change or proposal
// appears on a phone: "on this device", "routed via Mac: Nano cleaned, then
// Gemini", or "Gemini (no Nano on this phone)" — never invented, never blended.
import { esc } from '../htmlEsc';
import { choosePrivacyLabel, type PrivacyLabelInput } from '../privacyLabel';

export function privacyChipHtml(input: PrivacyLabelInput): string {
  const label = choosePrivacyLabel(input);
  return `<span class="mc-m-chip mc-m-chip-privacy">${esc(label)}</span>`;
}
