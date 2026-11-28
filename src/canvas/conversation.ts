// Who owns her next line. Every flow that waits for an answer (the review,
// the "Did you mean" cards, the gimbal questions, the morph card, pair-first,
// "Lamp 1 or Lamp 2?") is registered here with an explicit priority, instead
// of a hand-ordered chain of ifs in run(). Pure: the flows are adapters that
// the canvas passes in.
//
// Rules:
// - Active modals are asked in priority order; the FIRST that answers claims
//   the line, and no other modal sees it. A modal that passes lets the next
//   one (and then the routes) have it.
// - "cancel" / "never mind" / "stop" / "forget it" (the whole line) closes the
//   modal that would have had it, with a spoken line.
// - A blocking modal (a question on screen) never lets an unanswered line
//   through: it re-prompts with the answers it takes, "or say cancel".
// - A soft modal (morph, pair-first, point choice) that a line ends says so
//   ("Left pairing.") and the line is routed. Never a silent swallow.
import type { Heard } from './hearing';

export type ModalId = 'review' | 'intentChoices' | 'intentAsk' | 'gimbalAsk' | 'morph' | 'pairFirst' | 'pointChoice';
/** answered: the modal took the line. reprompt: not an answer (blocking: ask
 *  again). pass: not for it, it stays open. end-and-pass: the line ended it. */
export type Claim = 'answered' | 'reprompt' | 'pass' | 'end-and-pass';

export interface Modal {
  id: ModalId;
  kind: 'blocking' | 'soft';
  priority: number;
  active(): boolean;
  /** Counted by busy() (default: active()). A finished morph card is open
   *  but waits for nothing. */
  waits?(): boolean;
  /** Offer the line. May act (an answer is acted on here). */
  claim(h: Heard): Claim;
  /** The re-prompt for a blocking modal ("Answer the question first: …"). */
  prompt(): string;
  /** Close it for "cancel" (it says its own line, or returns one to say). */
  cancel(): string | void;
  /** Said when a line ends a soft modal ("Left pairing."). */
  endLine?: string;
  /** Watches only: counted by busy(), never offered a line (the review is
   *  answered through the keep / drop routes). */
  listens?: boolean;
}

export interface HandleResult { claimed: boolean; by?: ModalId; claim?: Claim }

export interface Conversation {
  register(m: Modal): void;
  /** The highest-priority active modal. */
  current(): ModalId | null;
  handle(h: Heard): HandleResult;
  /** Anything waits on her. `blockingOnly`: only a question on screen or a review. */
  busy(o?: { blockingOnly?: boolean }): boolean;
  cancelAll(reason: string): void;
}

export const CANCEL_RE = /^\s*(?:please\s+)?(?:cancel|never\s*mind|stop|forget\s+it)(?:\s+(?:it|that))?\s*[.!]*\s*$/i;
export const CANCELLED_LINE = 'Okay, cancelled.';
/** "Answer the question first: yes, no, or say cancel." */
export const answersPrompt = (answers: readonly string[]): string => `Answer the question first: ${answers.join(', ')}, or say cancel.`;

/** Explicit, tested precedence (higher first). */
export const MODAL_PRIORITY: Readonly<Record<ModalId, number>> = {
  review: 70, intentChoices: 60, intentAsk: 50, gimbalAsk: 40, morph: 30, pairFirst: 20, pointChoice: 10,
};

export function createConversation(d: { say(line: string): void; log?(line: string): void }): Conversation {
  const modals: Modal[] = [];
  const ordered = (): Modal[] => modals.filter((m) => m.active()).sort((a, b) => b.priority - a.priority);
  return {
    register(m) { modals.push(m); },
    current: () => ordered()[0]?.id ?? null,
    busy: (o = {}) => modals.some((m) => (!o.blockingOnly || m.kind === 'blocking') && (m.waits ? m.waits() : m.active())),
    cancelAll(reason) {
      for (const m of ordered()) { if (m.listens === false) continue; m.cancel(); d.log?.(`modal ${m.id}: cancelled (${reason})`); }
    },
    handle(h) {
      for (const m of ordered()) {
        if (m.listens === false) continue;
        // A modal opened by an earlier modal's answer is not offered this line.
        if (!m.active()) continue;
        const c = m.claim(h);
        if (c === 'answered') { d.log?.(`modal ${m.id}: answered`); return { claimed: true, by: m.id, claim: c }; }
        if (m.active() && CANCEL_RE.test(h.text)) {
          const line = m.cancel();
          d.say(typeof line === 'string' && line ? line : CANCELLED_LINE);
          d.log?.(`modal ${m.id}: cancelled`);
          return { claimed: true, by: m.id, claim: 'answered' };
        }
        if (m.kind === 'blocking') {
          d.say(m.prompt());
          d.log?.(`modal ${m.id}: reprompt`);
          return { claimed: true, by: m.id, claim: 'reprompt' };
        }
        if (c === 'end-and-pass') {
          if (m.endLine) d.say(m.endLine);
          d.log?.(`modal ${m.id}: ended, line routed`);
        }
      }
      return { claimed: false };
    },
  };
}
