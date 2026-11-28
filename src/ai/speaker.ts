// Speaking aloud, in one place: the browser's own speechSynthesis with the
// nicest ON-DEVICE voice installed (speechVoices.ts picks it), a little slower
// than normal for clarity, and never talking over itself — a new line cancels
// the one before it. Nothing is sent anywhere unless she opted in to online
// voices. The synth is injected so this runs in tests without a browser.
import {
  SPEECH_PITCH, SPEECH_RATE, loadAllowCloud, loadSavedVoice, pickSpokenVoice, toSynthVoice, voiceSpeaks, type SynthVoice,
} from './speechVoices';

export interface RawVoice { voiceURI: string; name: string; lang: string; localService?: boolean; default?: boolean }
export interface UtteranceLike { text: string; rate: number; pitch: number; lang: string; voice: RawVoice | null; onstart?: (() => void) | null }
export interface SynthLike {
  getVoices(): RawVoice[];
  cancel(): void;
  speak(u: UtteranceLike): void;
  addEventListener?(type: 'voiceschanged', f: () => void): void;
}

export interface SpeakOptions {
  lang?: string; voice?: SynthVoice | null; rate?: number;
  /** Fired when the voice actually starts on this line. */
  onStart?: () => void;
}

export interface SpeakerOptions {
  /** null = this browser cannot speak (replies stay as text). */
  synth?: SynthLike | null;
  makeUtterance?: (text: string) => UtteranceLike;
  storage?: Storage;
  now?: () => number;
  /** The page has had a real click / key since load (Chrome plays speech
   *  only then). Default: navigator.userActivation.hasBeenActive. */
  activated?: () => boolean;
  /** Chrome's speech can hang browser-wide (lines queue, `onstart` never
   *  fires, even after a click). Called with true when that is seen, false
   *  once a line really starts again. */
  onStuck?: (stuck: boolean) => void;
  /** Timers (tests pass fakes). */
  setTimer?: (f: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export interface Speaker {
  readonly supported: boolean;
  /** Installed voices (may be empty until the browser has loaded them). */
  voices(): SynthVoice[];
  /** The voice a line in `lang` would be spoken with (null = the system default). */
  voiceFor(lang?: string): SynthVoice | null;
  /** Speak one line; whatever was being said stops first. False if nothing
   *  was spoken — including when there is no named on-device voice to speak
   *  it with and online voices are off (the browser's own default is never
   *  trusted: it can be a cloud voice). */
  speak(text: string, o?: SpeakOptions): boolean;
  /** Say this AFTER whatever is being said (a reply spoken sentence by
   *  sentence as it arrives). Same voice rule as speak(). */
  enqueue(text: string, o?: SpeakOptions): boolean;
  /** The browser's voice list has loaded (so a first line is not delayed). */
  voicesReady(): boolean;
  stop(): void;
  /** A line did not start within STUCK_MS on an activated page (see onStuck). */
  stuck(): boolean;
}

function browserSynth(): SynthLike | null {
  const w = globalThis as unknown as { speechSynthesis?: SynthLike; SpeechSynthesisUtterance?: unknown; navigator?: { webdriver?: boolean } };
  // Automated browsers (tests, screenshots) never speak: on a Mac a headless
  // Chrome still talks out loud through the system voice.
  const synth = w.speechSynthesis && typeof w.SpeechSynthesisUtterance === 'function' ? w.speechSynthesis : null;
  if (synth && w.navigator?.webdriver) {
    // Everything else (voices, cancel) still works, so tests can check that
    // speech is stopped — only the actual speaking is a no-op.
    return new Proxy(synth, {
      get(target, key) {
        if (key === 'speak') return () => undefined;
        const v = (target as unknown as Record<PropertyKey, unknown>)[key];
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  }
  return synth;
}
function browserUtterance(text: string): UtteranceLike {
  const U = (globalThis as unknown as { SpeechSynthesisUtterance: new (t: string) => UtteranceLike }).SpeechSynthesisUtterance;
  return new U(text);
}

/** A line that could not be spoken because the browser had not loaded its
 *  voice list yet is spoken when the list arrives — if that is this soon. */
export const VOICES_WAIT_MS = 3000;
/** A line that has not started this long after speak() on a page she has
 *  clicked: Chrome's speech is stuck. The queue is cancelled. */
export const STUCK_MS = 3000;
export const VOICE_STUCK_LINE = 'Voice is stuck in Chrome — relaunch Chrome to hear replies';

function pageActivated(): boolean {
  const n = (globalThis as unknown as { navigator?: { userActivation?: { hasBeenActive?: boolean } } }).navigator;
  return n?.userActivation?.hasBeenActive === true;
}

export function createSpeaker(opts: SpeakerOptions = {}): Speaker {
  const synth = opts.synth === undefined ? browserSynth() : opts.synth;
  const make = opts.makeUtterance ?? browserUtterance;
  const now = opts.now ?? (() => Date.now());
  const raw = (): RawVoice[] => { try { return synth?.getVoices() ?? []; } catch { return []; } };
  const voices = (): SynthVoice[] => raw().map(toSynthVoice);
  const allowCloud = (): boolean => loadAllowCloud(opts.storage);
  const voiceFor = (lang = 'en-US'): SynthVoice | null =>
    pickSpokenVoice(voices(), { lang, saved: loadSavedVoice(opts.storage), allowCloud: allowCloud() });
  let waiting: { text: string; o: SpeakOptions; at: number } | null = null;
  const activated = opts.activated ?? pageActivated;
  const setTimer = opts.setTimer ?? ((f: () => void, ms: number) => setTimeout(f, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let stuck = false;
  let watch: unknown = null;
  const unwatch = (): void => { if (watch !== null) { clearTimer(watch); watch = null; } };
  function started(): void {
    unwatch();
    if (stuck) { stuck = false; opts.onStuck?.(false); }
  }
  /** A fresh line must start soon: if not (and she has clicked), it is stuck. */
  function watchStart(): void {
    unwatch();
    watch = setTimer(() => {
      watch = null;
      if (!activated()) return; // not stuck: Chrome is waiting for her first click
      try { synth?.cancel(); } catch { /* nothing to cancel */ }
      if (!stuck) { stuck = true; opts.onStuck?.(true); }
    }, STUCK_MS);
  }

  function speak(text: string, o: SpeakOptions = {}, queue = false): boolean {
    const line = text.trim();
    if (!synth || !line) return false;
    const lang = o.lang ?? 'en-US';
    const online = allowCloud();
    const list = raw();
    const voice = o.voice === undefined || o.voice === null ? voiceFor(lang) : o.voice;
    // The rule: with online voices off, a line is spoken ONLY with a voice we
    // can name and that lives on this device. An utterance with no voice set
    // is the browser's choice — Chrome may pick its online "Google" voice and
    // send the text away — so no named on-device voice means silence.
    const match = voice ? list.find((v) => v.voiceURI === voice.voiceURI) ?? null : null;
    if (!online && (!match || match.localService === false)) {
      // The list simply has not loaded yet: say it when it does (if soon).
      waiting = list.length === 0 ? { text: line, o, at: now() } : null;
      return false;
    }
    // No voice for her language: stay silent rather than read it in the wrong one.
    if (!voiceSpeaks(match ? toSynthVoice(match) : null, lang) && (o.voice === undefined || o.voice === null)) return false;
    try {
      const u = make(line);
      u.rate = o.rate ?? SPEECH_RATE;
      u.pitch = SPEECH_PITCH;
      u.lang = match?.lang || lang;
      if (match) u.voice = match;
      const onStart = o.onStart;
      u.onstart = () => { started(); onStart?.(); };
      waiting = null;
      if (!queue) synth.cancel(); // never over itself (a queued sentence follows the one before)
      // A queued sentence waits behind the one before it; only a fresh line is timed.
      if (!queue) watchStart();
      synth.speak(u);
      return true;
    } catch { unwatch(); return false; }
  }

  try {
    synth?.addEventListener?.('voiceschanged', () => {
      const w = waiting;
      waiting = null;
      if (w && raw().length > 0 && now() - w.at <= VOICES_WAIT_MS) speak(w.text, w.o);
    });
  } catch { /* no events here: a line said before the list loaded stays unsaid */ }

  // Chrome loads its voice list lazily: the first getVoices() returns nothing
  // and starts the load. Ask now, at startup, so the list is there by the
  // time the first reply is spoken (it used to cost that reply up to 3 s).
  raw();

  return {
    supported: !!synth,
    voices,
    voiceFor,
    speak: (text, o) => speak(text, o),
    enqueue: (text, o) => speak(text, o, true),
    voicesReady: () => raw().length > 0,
    stop() { waiting = null; unwatch(); try { synth?.cancel(); } catch { /* nothing playing */ } },
    stuck: () => stuck,
  };
}
