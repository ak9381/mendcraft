// Password / payment field guard (pure). Used by the web-app tests and
// mirrored in the content script. Paste is refused into these fields, and
// nothing ever submits a form.

export type SensitiveReason = 'password' | 'payment';

export interface FieldInfo {
  tag?: string;
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  inputMode?: string;
  ariaLabel?: string;
  placeholder?: string;
  label?: string;
}

const PASSWORD_AUTOCOMPLETE = new Set([
  'password', 'current-password', 'new-password', 'one-time-code',
]);

const PAYMENT_AUTOCOMPLETE = new Set([
  'cc-name', 'cc-given-name', 'cc-additional-name', 'cc-family-name',
  'cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-type',
  'transaction-currency', 'transaction-amount',
]);

const PASSWORD_RE = /\b(pass(word|wd|code)?|passwd|secret|pin)\b/i;
const PAYMENT_RE = /\b(card[-_\s]?number|credit[-_\s]?card|debit[-_\s]?card|cc[-_\s]?num(ber)?|card[-_\s]?no|cvc|cvv2?|cid|csc|card[-_\s]?verif|expir(y|ation)|exp[-_\s]?(month|year|date)|iban|routing[-_\s]?number|account[-_\s]?number)\b/i;

function tokens(field: FieldInfo): string {
  return [field.name, field.id, field.ariaLabel, field.placeholder, field.label, field.autocomplete]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(' ');
}

function autocompleteTokens(value: string | undefined): string[] {
  if (!value) return [];
  return value.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean);
}

/** Why this field is off-limits, or null if paste is allowed (after confirm). */
export function sensitiveFieldReason(field: FieldInfo | null | undefined): SensitiveReason | null {
  if (!field) return null;
  const type = (field.type ?? '').toLowerCase();
  if (type === 'password') return 'password';
  const ac = autocompleteTokens(field.autocomplete);
  if (ac.some((t) => PASSWORD_AUTOCOMPLETE.has(t))) return 'password';
  if (ac.some((t) => PAYMENT_AUTOCOMPLETE.has(t) || t.startsWith('cc-'))) return 'payment';
  const blob = tokens(field);
  if (PASSWORD_RE.test(blob)) return 'password';
  if (PAYMENT_RE.test(blob)) return 'payment';
  return null;
}

export type PasteBlock = 'needs-confirm' | 'password' | 'payment' | 'no-field';

export interface PasteDecision {
  ok: boolean;
  reason?: PasteBlock;
}

/**
 * May we insert text into this field? Confirm is required for every paste.
 * Password and payment fields are always refused, even after a confirm.
 * A missing field is refused. This never authorises a form submit.
 */
export function canPaste(opts: { confirmed: boolean; field: FieldInfo | null }): PasteDecision {
  if (!opts.field) return { ok: false, reason: 'no-field' };
  const sensitive = sensitiveFieldReason(opts.field);
  if (sensitive) return { ok: false, reason: sensitive };
  if (!opts.confirmed) return { ok: false, reason: 'needs-confirm' };
  return { ok: true };
}

/** Forms are never auto-submitted. There is no code path that returns true. */
export function maySubmitForm(): false {
  return false;
}
