// What is read aloud, in one place. Speaking is OPT-IN per line: only AI
// replies, a review's title when it opens, the result of a command ("Lights
// on.", a refusal) and pairing outcomes are handed here. Hand / gesture hints,
// hold progress, facing, "Listening…", scroll / level HUDs and every other
// status line are written, never spoken — a hint that repeats (a held or
// misread gesture re-firing its "nothing to press" line) used to be re-spoken
// on every repeat.
//
// Three more rules on top of the speaker's own (ai/speaker.ts):
//   - the same line is never spoken twice within REPEAT_QUIET_MS;
//   - a status line replaces whatever was being said (latest wins — at most
//     one utterance waits behind it, never a backlog);
//   - with the Kannada pack on, only Kannada lines are spoken, in kn-IN: no
//     English fallback, no English button names. No kn-IN voice → silence
//     (the speaker never reads a line in a voice of another language).
import type { SpeakOptions, Speaker } from './speaker';

export const REPEAT_QUIET_MS = 10_000;

export interface ReadAloudDeps {
  speaker: Pick<Speaker, 'speak' | 'enqueue' | 'stop'>;
  /** Read aloud is on (More → Voice / the button below Talk). */
  enabled(): boolean;
  /** The language pack on screen ('kn' for Kannada; null / 'en' for English). */
  packLang(): string | null | undefined;
  now?: () => number;
}

export interface ReadAloud {
  /** Speak one opted-in line now, replacing whatever was being said. */
  line(text: string, o?: Pick<SpeakOptions, 'onStart'>): boolean;
  /** A reply spoken sentence by sentence: the first replaces what was being
   *  said, the rest follow it. */
  sentence(text: string, first: boolean, o?: Pick<SpeakOptions, 'onStart'>): boolean;
  /** New input from her: stop talking at once. */
  stop(): void;
}

const KANNADA = /[ಀ-೿]/;

/** The words to speak: never the "SIM ·" / "SIM:" prefix. */
export function spokenText(t: string): string {
  return t.replace(/^\s*SIM\s*[·:]\s*/, '').trim();
}

/** The language a line is spoken in, or null for "not at all". */
export function spokenLangFor(text: string, packLang: string | null | undefined): string | null {
  const kn = KANNADA.test(text);
  if (packLang === 'kn') return kn ? 'kn-IN' : null;
  return kn ? 'kn-IN' : 'en-US';
}

export function createReadAloud(d: ReadAloudDeps): ReadAloud {
  const now = d.now ?? (() => Date.now());
  const recent = new Map<string, number>();

  function fresh(line: string): boolean {
    const t = now();
    for (const [k, at] of recent) if (t - at >= REPEAT_QUIET_MS) recent.delete(k);
    const key = line.toLowerCase();
    if (recent.has(key)) return false;
    recent.set(key, t);
    return true;
  }

  function say(text: string, queue: boolean, o?: Pick<SpeakOptions, 'onStart'>): boolean {
    if (!d.enabled()) return false;
    const line = spokenText(text);
    if (!line) return false;
    const lang = spokenLangFor(line, d.packLang());
    if (!lang) return false;
    if (!fresh(line)) return false;
    const opts: SpeakOptions = { lang, ...(o?.onStart ? { onStart: o.onStart } : {}) };
    return queue ? d.speaker.enqueue(line, opts) : d.speaker.speak(line, opts);
  }

  return {
    line: (text, o) => say(text, false, o),
    sentence: (text, first, o) => say(text, !first, o),
    stop: () => d.speaker.stop(),
  };
}
