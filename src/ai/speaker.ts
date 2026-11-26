// Speaking aloud, in one place: the browser's own speechSynthesis with the
// nicest ON-DEVICE voice installed (speechVoices.ts picks it), a little slower
// than normal for clarity, and never talking over itself — a new line cancels
// the one before it. Nothing is sent anywhere unless she opted in to online
// voices. The synth is injected so this runs in tests without a browser.
import {
  SPEECH_PITCH, SPEECH_RATE, loadAllowCloud, loadSavedVoice, pickSpokenVoice, toSynthVoice, voiceSpeaks, type SynthVoice,
} from './speechVoices';

export interface RawVoice { voiceURI: string; name: string; lang: string; localService?: boolean; default?: boolean }
export interface UtteranceLike { text: string; rate: number; pitch: number; lang: string; voice: RawVoice | null }
export interface SynthLike {
  getVoices(): RawVoice[];
  cancel(): void;
  speak(u: UtteranceLike): void;
}

export interface SpeakerOptions {
  /** null = this browser cannot speak (replies stay as text). */
  synth?: SynthLike | null;
  makeUtterance?: (text: string) => UtteranceLike;
  storage?: Storage;
}

export interface Speaker {
  readonly supported: boolean;
  /** Installed voices (may be empty until the browser has loaded them). */
  voices(): SynthVoice[];
  /** The voice a line in `lang` would be spoken with (null = the system default). */
  voiceFor(lang?: string): SynthVoice | null;
  /** Speak one line; whatever was being said stops first. False if nothing was spoken. */
  speak(text: string, o?: { lang?: string; voice?: SynthVoice | null; rate?: number }): boolean;
  stop(): void;
}

function browserSynth(): SynthLike | null {
  const w = globalThis as unknown as { speechSynthesis?: SynthLike; SpeechSynthesisUtterance?: unknown };
  return w.speechSynthesis && typeof w.SpeechSynthesisUtterance === 'function' ? w.speechSynthesis : null;
}
function browserUtterance(text: string): UtteranceLike {
  const U = (globalThis as unknown as { SpeechSynthesisUtterance: new (t: string) => UtteranceLike }).SpeechSynthesisUtterance;
  return new U(text);
}

export function createSpeaker(opts: SpeakerOptions = {}): Speaker {
  const synth = opts.synth === undefined ? browserSynth() : opts.synth;
  const make = opts.makeUtterance ?? browserUtterance;
  const raw = (): RawVoice[] => { try { return synth?.getVoices() ?? []; } catch { return []; } };
  const voices = (): SynthVoice[] => raw().map(toSynthVoice);
  const voiceFor = (lang = 'en-US'): SynthVoice | null =>
    pickSpokenVoice(voices(), { lang, saved: loadSavedVoice(opts.storage), allowCloud: loadAllowCloud(opts.storage) });
  return {
    supported: !!synth,
    voices,
    voiceFor,
    speak(text, o = {}) {
      const line = text.trim();
      if (!synth || !line) return false;
      const lang = o.lang ?? 'en-US';
      const voice = o.voice === undefined ? voiceFor(lang) : o.voice;
      // No voice for her language: stay silent rather than read it in the wrong one.
      if (o.voice === undefined && !voiceSpeaks(voice, lang)) return false;
      try {
        const u = make(line);
        u.rate = o.rate ?? SPEECH_RATE;
        u.pitch = SPEECH_PITCH;
        u.lang = voice?.lang || lang;
        const match = voice ? raw().find((v) => v.voiceURI === voice.voiceURI) ?? null : null;
        if (match) u.voice = match;
        synth.cancel(); // never over itself
        synth.speak(u);
        return true;
      } catch { return false; }
    },
    stop() { try { synth?.cancel(); } catch { /* nothing playing */ } },
  };
}
