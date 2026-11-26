// A chat reply as it arrives: what to show, what to say and when. The model
// writes about 20 characters a second, so waiting for the whole reply before
// showing or speaking anything is where the wait was. Here the words go on
// screen as they come, and each sentence is handed to the speaker the moment
// it is complete — she hears the first sentence while the second is written.
// Pure (no DOM, no speech): the canvas wires it to the status line and the
// speaker.

/** Replies are meant to be a sentence or two. Past this the stream is cut. */
export const REPLY_MAX_CHARS = 240;

/** No emoji in a reply that is read aloud (a voice reads them as names). */
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu;

/** What is shown and spoken: no emoji, no markdown stars, single spaces. */
export function cleanReply(text: string): string {
  return String(text ?? '')
    .replace(EMOJI, '')
    .replace(/[*_`#]+/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ +([.,!?;:])/g, '$1')
    .trim();
}

/** A sentence end: ., !, ? or … (and a closing quote/bracket), FOLLOWED by
 *  whitespace — so "3.5" or a still-arriving "e.g" is never cut in two. */
const SENTENCE_END = /[.!?…]+["'”’)\]]*(?=\s)/g;
/** Too short to be worth a separate utterance ("Hi!"): joined to the next. */
const MIN_SPOKEN = 12;

export interface SentenceFeed {
  /** The text so far: returns the sentences that became complete since the
   *  last call, in order. */
  push(full: string): string[];
  /** The stream ended: whatever is left unspoken (null when nothing). */
  flush(full?: string): string | null;
  /** How many characters have been handed out. */
  spokenUpTo(): number;
}

/** The first thing said may end at a clause ("I'm doing well,") instead of
 *  waiting for the full stop: at ~20 characters a second that is most of a
 *  second sooner, and it is where a person would breathe anyway. */
const CLAUSE_END = /[,;:—–]+(?=\s)/g;

export function createSentenceFeed(opts: { firstAtClause?: boolean } = {}): SentenceFeed {
  let done = 0;
  let last = '';
  return {
    push(full) {
      last = full;
      const out: string[] = [];
      // Nothing said yet: start at the first clause that is long enough, if
      // no sentence has ended before it.
      if (opts.firstAtClause && done === 0) {
        SENTENCE_END.lastIndex = 0;
        const sentence = SENTENCE_END.exec(full);
        CLAUSE_END.lastIndex = 0;
        let c: RegExpExecArray | null;
        while ((c = CLAUSE_END.exec(full))) {
          const end = c.index + c[0].length;
          if (sentence && sentence.index < c.index) break;
          const clause = full.slice(0, end).trim();
          if (clause.length < MIN_SPOKEN) continue;
          out.push(clause);
          done = end;
          break;
        }
      }
      SENTENCE_END.lastIndex = done;
      let from = done;
      let m: RegExpExecArray | null;
      while ((m = SENTENCE_END.exec(full))) {
        const end = m.index + m[0].length;
        const sentence = full.slice(from, end).trim();
        // A very short opener waits for the next sentence, so the voice does
        // not start, stop and start again within one breath.
        if (sentence.length < MIN_SPOKEN) continue;
        out.push(sentence);
        from = end;
      }
      done = from;
      return out;
    },
    flush(full) {
      const text = (full ?? last).slice(done).trim();
      done = (full ?? last).length;
      return text || null;
    },
    spokenUpTo: () => done,
  };
}
