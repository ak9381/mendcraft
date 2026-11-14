// CONFIDENCE STATES + CHOOSER + CONFIRM GATING (pure, DOM-free).
//
// Every voice/pinch command result lands in one of three states before it may
// touch the document:
//   sure    -> apply now (exact rules, rule/model agreement, or high model
//              confidence);
//   unsure  -> "Did you mean…?" with up to 3 big choice chips; NOTHING is
//              applied until the user picks one (pinch/click a chip or say
//              "first"/"second" — Kannada words too);
//   unknown -> say so and suggest commands.
// Destructive ops (delete many, clear, overwrite) need an explicit confirm
// even when sure. The shell (main.ts) owns the chips' DOM; this module owns
// every decision, so all of it is unit-testable without a browser or model.

import type { Source } from './hybrid';

export type ConfidenceState = 'sure' | 'unsure' | 'unknown';

/** A model op at/above this confidence applies without asking. */
export const SURE_CONFIDENCE = 0.7;
/** Ambiguous deixis ("that one" among several candidates) raises the bar. */
export const SURE_AMBIGUOUS_DEIXIS = 0.85;

/** Everything the classifier may know about one command result. */
export interface ConfidenceSignals {
  /** The mode's validator accepted the result (schema + coerce). */
  valid: boolean;
  /** The result is a clarify question, not an op. */
  clarify: boolean;
  source: Source;
  /** Model confidence 0..1 (absent on the exact-rule path). */
  confidence?: number;
  /** Rule-parser agreement with the model op: true = same op (two independent
   *  paths agree), false = a different op, null = rules couldn't parse it. */
  ruleAgrees?: boolean | null;
  /** Deictic utterance with several candidates and nothing under the cursor. */
  deixisAmbiguous?: boolean;
}

export function classifyConfidence(s: ConfidenceSignals): ConfidenceState {
  if (!s.valid || s.clarify) return 'unknown';
  if (s.source === 'rules') return 'sure'; // deterministic: exact match or clarify
  if (s.ruleAgrees === true) return 'sure'; // model and rules independently agree
  const bar = s.deixisAmbiguous ? SURE_AMBIGUOUS_DEIXIS : SURE_CONFIDENCE;
  const c = typeof s.confidence === 'number' ? s.confidence : 0;
  return c >= bar ? 'sure' : 'unsure';
}

/** Chip text shown next to the honest source badge. */
export const STATE_TEXT: Record<ConfidenceState, string> = {
  sure: 'sure',
  unsure: 'unsure — choose',
  unknown: 'unknown',
};

// ---------------------------------------------------------------------------
// "Did you mean…?" choices.

export interface Choice {
  /** Short human label for the chip. */
  label: string;
  /** The op envelope this chip would apply (already mode-validated). */
  result: Record<string, unknown>;
  /** Who proposed it — keeps the badge honest when a chip is picked. */
  source: Source;
}

export const MAX_CHOICES = 3;

/** Dedupe candidate interpretations (same op JSON), drop clarifies and empty
 *  slots, cap at MAX_CHOICES. Order is preserved (best candidate first). */
export function buildChoices(candidates: ReadonlyArray<Choice | null | undefined>): Choice[] {
  const seen = new Set<string>();
  const out: Choice[] = [];
  for (const c of candidates) {
    if (!c || typeof c.result !== 'object') continue;
    if (typeof (c.result as { clarify?: unknown }).clarify === 'string') continue;
    const key = JSON.stringify(c.result);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= MAX_CHOICES) break;
  }
  return out;
}

const MAX_DESCRIBE = 64;

/** Short human label for an op envelope: "move (target w3, dx 100)". Generic
 *  over every mode's vocabulary — op name plus the first few scalar fields. */
export function describeOp(op: Record<string, unknown>): string {
  const name = typeof op.op === 'string' ? op.op.replace(/_/g, ' ') : 'command';
  if (name === 'batch' && Array.isArray(op.ops)) {
    return `batch of ${op.ops.length} steps`;
  }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(op)) {
    if (k === 'op' || v == null) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      parts.push(`${k} ${v}`);
    }
    if (parts.length >= 3) break;
  }
  const s = parts.length ? `${name} (${parts.join(', ')})` : name;
  return s.length > MAX_DESCRIBE ? `${s.slice(0, MAX_DESCRIBE - 1)}…` : s;
}

// ---------------------------------------------------------------------------
// Spoken/typed replies to the chips: "first" / "second" / "third", bare
// digits, apply/cancel words — English and Kannada. A long utterance is NOT a
// reply (the user moved on to a new command).

export type ChoiceReply = { kind: 'pick'; index: number } | { kind: 'cancel' } | null;

/** Explicit ordinals, checked first: "the second one" must not match on "one". */
const ORDINAL_WORDS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['first', 'ಮೊದಲನೇ', 'ಮೊದಲ', 'ಮೊದಲನೆಯದು']),
  new Set(['second', 'ಎರಡನೇ', 'ಎರಡನೆಯದು']),
  new Set(['third', 'ಮೂರನೇ', 'ಮೂರನೆಯದು']),
];
/** Bare number words/digits, only consulted when no explicit ordinal matched. */
const NUMBER_WORDS: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['one', '1', 'ಒಂದು']),
  new Set(['two', '2', 'ಎರಡು']),
  new Set(['three', '3', 'ಮೂರು']),
];
const CANCEL_WORDS = new Set(['cancel', 'no', 'none', 'stop', 'nevermind', 'ರದ್ದು', 'ಬೇಡ', 'ಇಲ್ಲ']);
/** Confirm words — only meaningful when there is exactly ONE choice (a confirm
 *  bar); with several chips "apply" is ambiguous and falls through. */
const APPLY_WORDS = new Set(['apply', 'yes', 'confirm', 'ok', 'okay', 'ಸರಿ', 'ಹೌದು', 'ಅನ್ವಯಿಸು']);

/** Keep letters/marks/digits only — Kannada vowel signs/virama are \p{M}
 *  marks and must survive (see docs/LESSONS.md). */
function choiceTokens(utterance: string): string[] {
  return utterance
    .toLowerCase()
    .normalize('NFC')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{M}\p{N}]+/gu, ''))
    .filter(Boolean);
}

export function parseChoiceReply(utterance: string, count: number): ChoiceReply {
  const tokens = choiceTokens(utterance);
  if (tokens.length === 0 || tokens.length > 4) return null; // a new command, not a pick
  const joined = tokens.join('');
  if (tokens.some((t) => CANCEL_WORDS.has(t)) || joined === 'nevermind') return { kind: 'cancel' };
  if (count === 1 && tokens.some((t) => APPLY_WORDS.has(t))) return { kind: 'pick', index: 0 };
  for (const words of [ORDINAL_WORDS, NUMBER_WORDS]) {
    for (let i = 0; i < Math.min(count, words.length); i++) {
      if (tokens.some((t) => words[i].has(t))) return { kind: 'pick', index: i };
    }
  }
  return null;
}

/** The spoken/on-screen prompt for the chooser (or the single-op confirm). */
export function choicePrompt(langCode: string, count: number): string {
  if (langCode === 'kn') {
    return count === 1
      ? 'ಅನ್ವಯಿಸಲು "ಸರಿ" ಎಂದು ಹೇಳಿ, ಬೇಡವಾದರೆ "ರದ್ದು".'
      : 'ನೀವು ಹೇಳಿದ್ದು ಯಾವುದು? "ಮೊದಲನೇ" ಅಥವಾ "ಎರಡನೇ" ಎಂದು ಹೇಳಿ; ಬೇಡವಾದರೆ "ರದ್ದು".';
  }
  return count === 1
    ? 'Say "apply" to go ahead, or "cancel".'
    : 'Did you mean…? Say "first" or "second" (or tap a chip); "cancel" does nothing.';
}

/** Suggestions shown when a command is unknown — per mode, always runnable. */
export function suggestCommands(modeId: string): string[] {
  if (modeId === 'ui') return ['make the button green', 'make it 56 pixels tall', 'check accessibility'];
  if (modeId === 'part') return ['cup grip', 'make it wider by 5', 'undo'];
  return ['add a door', 'make this wall 4 meters', 'check accessibility'];
}

// ---------------------------------------------------------------------------
// Destructive ops: these always confirm, even when sure. Single deletes stay
// un-gated (intentional + one undo away); the gate is for the irreversible-
// FEELING ones — delete many, clear/reset, overwrite.

const DESTRUCTIVE_NAME = /^(clear|reset|overwrite|replace|delete_all|remove_all)/;

export function isDestructiveOp(op: Record<string, unknown>, selectedCount = 0): boolean {
  const name = typeof op.op === 'string' ? op.op : '';
  if (DESTRUCTIVE_NAME.test(name)) return true;
  if (name === 'delete') {
    if (Array.isArray(op.ids) && op.ids.length > 1) return true;
    const target = op.target ?? op.id;
    return target === 'selected' && selectedCount > 1;
  }
  if (name === 'batch' && Array.isArray(op.ops)) {
    const subs = op.ops.filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null);
    const deletes = subs.filter((o) => o.op === 'delete').length;
    if (deletes >= 2) return true;
    return subs.some((o) => o.op !== 'batch' && isDestructiveOp(o, selectedCount));
  }
  return false;
}
