// Where a reply's time goes, for ?nanoTrace=1: from the end of her speech (or
// her Enter key) to the first words on screen and the first spoken word.
// Timings only — never what was said.
//
//   [nano-trace] voice: mic stop → final 310 ms (final result)
//   [nano-trace] reply: asked (voice) → first chunk 820 ms
//   [nano-trace] reply: first chunk → first spoken word 640 ms
//   [nano-trace] reply: asked → first spoken word 1460 ms; whole reply 2900 ms
import { nanoTrace } from './nanoTrace';

export interface ReplyTrace {
  /** The recognizer handed over what she said. `sinceStopMs`: time since the
   *  mic was asked to stop (null: it was still listening). */
  heard(sinceStopMs: number | null, from: 'final' | 'interim' | 'end'): void;
  /** A chat turn starts (typed, or the voice turn just heard). */
  asked(): void;
  /** The first text of the reply is on screen. */
  firstChunk(): void;
  /** The voice started on the first sentence. */
  spoken(): void;
  /** The whole reply is in. */
  done(): void;
}

export function createReplyTrace(opts: { now?: () => number; log?: (line: string) => void } = {}): ReplyTrace {
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const log = opts.log ?? nanoTrace;
  const ms = (from: number): number => Math.round(now() - from);
  let heardAt = -Infinity;
  let askedAt = 0;
  let chunkAt = 0;
  let spokenAt = 0;
  let voice = false;
  return {
    heard(sinceStopMs, from) {
      heardAt = now();
      const how = from === 'final' ? 'final result' : from === 'interim' ? 'last interim, the final was slow' : 'recognizer ended';
      log(sinceStopMs == null ? `voice: final while listening (${how})` : `voice: mic stop → final ${Math.round(sinceStopMs)} ms (${how})`);
    },
    asked() {
      askedAt = now();
      chunkAt = 0; spokenAt = 0;
      voice = askedAt - heardAt < 400; // this turn is the one just heard
    },
    firstChunk() {
      if (chunkAt || !askedAt) return;
      chunkAt = now();
      log(`reply: asked (${voice ? 'voice' : 'typed'}) → first chunk ${ms(askedAt)} ms`);
    },
    spoken() {
      if (spokenAt || !askedAt) return;
      spokenAt = now();
      log(`reply: first chunk → first spoken word ${chunkAt ? Math.round(spokenAt - chunkAt) : 0} ms`);
    },
    done() {
      if (!askedAt) return;
      log(`reply: asked → first spoken word ${spokenAt ? `${Math.round(spokenAt - askedAt)} ms` : 'not spoken'}; whole reply ${ms(askedAt)} ms`);
      askedAt = 0;
    },
  };
}

/** The page's one reply trace. */
export const replyTrace: ReplyTrace = createReplyTrace();
