// NANO RAMBLE CONDENSER — pure helpers. A long natural ramble ("I was
// thinking, you know, when I'm rolling out chapatis…") of about 40+ words is condensed to ONE
// short command on the device before the copilot/fusion paths — and therefore
// the cloud payload — see it. The deterministic gates and the untrusted-JSON
// coercion live here; the model call is hybrid.condenseUtterance, which uses
// an ONLY_ON_DEVICE session so the raw ramble physically cannot ride to the
// cloud. Any miss (slow, off-device, junk) returns null and the caller keeps
// her raw words with the route line unchanged.

export const CONDENSE_MIN_WORDS = 40;
export const CONDENSE_TIMEOUT_MS = 1500;

export interface CondenseOutcome {
  text: string;
  fromWords: number;
  toWords: number;
  ms: number;
}

/** Prompt API responseConstraint (same shape family as CAD_TOOL_CONSTRAINT). */
export const CONDENSE_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: { command: { type: 'string' } },
  required: ['command'],
};

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Condense only a long ramble that is not already an exact rule command. */
export function shouldCondense(utterance: string, isExactCommand?: (u: string) => boolean): boolean {
  if (wordCount(utterance) < CONDENSE_MIN_WORDS) return false;
  if (isExactCommand?.(utterance)) return false;
  return true;
}

export function condensePrompt(utterance: string): string {
  return 'She is speaking naturally to a home-plan copilot. Condense her words into ONE short command or question. '
    + 'Keep every number, unit, room name and direction; invent nothing.\n'
    + `She said: ${JSON.stringify(utterance)}\n`
    + 'Reply JSON only: {"command":"..."}';
}

/** Untrusted model JSON → a short command, or null (caller keeps her words). */
export function coerceCondensed(raw: unknown, original: string): string | null {
  const cand = typeof raw === 'string' ? raw
    : raw && typeof raw === 'object' && typeof (raw as { command?: unknown }).command === 'string'
      ? (raw as { command: string }).command
      : null;
  if (!cand) return null;
  const text = cand.trim().replace(/\s+/g, ' ');
  if (!text || text.length > 200) return null;
  if (wordCount(text) >= wordCount(original)) return null;
  return text;
}
