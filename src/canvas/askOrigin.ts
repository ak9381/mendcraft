// Which waiting review a phone asked for. A phone's words reach the laptop as
// a relay 'command' and run through the same turn path as the say box, so the
// review a turn opens does not know where its words came from. The relay
// handler notes the words here; the turn that opens a review takes them back
// (once) by its utterance. A phone leaving then drops only a review a phone
// asked for — never one she asked for on the laptop.

/** A phone ask older than this no longer marks a review (a turn is long done). */
export const ASK_ORIGIN_TTL_MS = 10 * 60_000;
const KEPT = 16;

export interface AskOrigins {
  /** A phone sent these words to run. */
  note(text: string): void;
  /** Did a phone ask for this (still unclaimed)? Claims it. */
  take(utterance: string): boolean;
}

const norm = (t: string): string => t.trim().replace(/\s+/g, ' ').toLowerCase();

export function createAskOrigins(now: () => number = () => Date.now()): AskOrigins {
  let asks: Array<{ text: string; at: number }> = [];
  const fresh = (): void => { const t = now(); asks = asks.filter((a) => t - a.at <= ASK_ORIGIN_TTL_MS); };
  return {
    note(text) {
      const n = norm(text);
      if (!n) return;
      fresh();
      asks.push({ text: n, at: now() });
      if (asks.length > KEPT) asks.shift();
    },
    take(utterance) {
      fresh();
      const n = norm(utterance);
      const i = asks.findIndex((a) => a.text === n);
      if (i < 0) return false;
      asks.splice(i, 1);
      return true;
    },
  };
}
