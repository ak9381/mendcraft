// Free, on-device spoken-reply voices via the browser's speechSynthesis.
// No paid TTS, nothing leaves the device. Pure over a plain voice list so
// tests don't need a browser. The saved choice is stored in this browser
// (localStorage) — that is already per device.

export const VOICE_STORE_KEY = 'mendcraft:spoken-voice';

export interface SynthVoice {
  voiceURI: string;
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
}

export interface SavedVoice {
  voiceURI: string;
  name?: string;
  lang?: string;
}

export type ChangeVoiceIntent =
  | { action: 'open' }
  | { action: 'preview' }
  | { action: 'reset' }
  | { action: 'set'; query: string };

const NATURAL_RE = /\b(natural|enhanced|premium|neural|wavenet|studio|journey)\b/i;

function normLang(lang: string | undefined): string {
  return (lang ?? '').toLowerCase().replace(/_/g, '-');
}

function baseLang(lang: string | undefined): string {
  return normLang(lang).split('-')[0] ?? '';
}

export function isNaturalVoice(voice: SynthVoice): boolean {
  return NATURAL_RE.test(voice.name);
}

export function isKannada(voice: SynthVoice): boolean {
  const lang = normLang(voice.lang);
  return lang === 'kn' || lang.startsWith('kn-') || /kannada/i.test(voice.name);
}

export function isIndianEnglish(voice: SynthVoice): boolean {
  const lang = normLang(voice.lang);
  return lang === 'en-in' || /indian english/i.test(voice.name);
}

/** A voice whose audio is made off this device: the text to speak is sent to
 *  the voice's provider. Never used unless the person opts in. */
export function isCloudVoice(voice: SynthVoice): boolean {
  return voice.localService === false;
}

/** How good a voice sounds, by what the platforms call it:
 *  3 = Apple "(Premium)"; 2 = Apple "(Enhanced)" / Siri, or another natural /
 *  neural voice; 1 = Android's on-device Google voices ("en-us-x-sfg-local");
 *  0 = the ordinary compact voice. */
export function voiceTier(voice: SynthVoice): 0 | 1 | 2 | 3 {
  const id = `${voice.name} ${voice.voiceURI}`;
  if (/\bpremium\b/i.test(id)) return 3;
  if (NATURAL_RE.test(id) || /\bsiri\b/i.test(id)) return 2;
  if (/-x-[a-z0-9]+-local\b/i.test(id) || /#(fe)?male_\d+-local\b/i.test(id)) return 1;
  return 0;
}

/** macOS's joke voices (Bad News, Bells, Zarvox…): never an automatic pick. */
const NOVELTY_RE = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|deranged|hysterical|pipe organ)\b/i;
export function isNoveltyVoice(voice: SynthVoice): boolean {
  return NOVELTY_RE.test(voice.name);
}

function qualityScore(voice: SynthVoice): number {
  let score = voiceTier(voice) * 100;
  if (isNoveltyVoice(voice)) score -= 150;
  if (voice.localService !== false) score += 20;
  if (isKannada(voice) || isIndianEnglish(voice)) score += 15;
  if (voice.default) score += 5;
  return score;
}

/** Natural/enhanced first; Kannada and Indian English stay near the top. */
export function rankVoices(voices: readonly SynthVoice[]): SynthVoice[] {
  return [...voices].sort((a, b) => {
    const d = qualityScore(b) - qualityScore(a);
    if (d !== 0) return d;
    return a.name.localeCompare(b.name);
  });
}

function langMatches(voice: SynthVoice, want: string): boolean {
  const have = normLang(voice.lang);
  const need = normLang(want);
  if (!need) return false;
  const needBase = baseLang(need);
  return have === need || have === needBase || have.startsWith(`${needBase}-`);
}

function findSaved(voices: readonly SynthVoice[], saved?: SavedVoice | null): SynthVoice | null {
  if (!saved?.voiceURI) return null;
  return voices.find((v) => v.voiceURI === saved.voiceURI) ?? null;
}

function bestForLang(voices: readonly SynthVoice[], lang: string): SynthVoice | null {
  const matches = rankVoices(voices.filter((v) => langMatches(v, lang)));
  if (!matches.length) return null;
  // Same quality: the voice for the exact region asked for ("en-GB") first.
  const top = voiceTier(matches[0]);
  const exact = matches.find((v) => voiceTier(v) === top && !isNoveltyVoice(v) && normLang(v.lang) === normLang(lang));
  return exact ?? matches[0];
}

/**
 * Choose a voice for a reply in `lang` (BCP-47 or base code).
 * Saved choice wins for the same language family; Kannada replies still
 * prefer a Kannada voice when one exists. Then: language match (natural
 * first), any English, first available, or null.
 */
export function pickSpokenVoice(
  all: readonly SynthVoice[],
  opts: { lang?: string; saved?: SavedVoice | null; allowCloud?: boolean } = {},
): SynthVoice | null {
  // On-device voices only: a voice with localService === false sends the text
  // to a cloud TTS, so it is never picked — not even a saved one — unless she
  // opted in (allowCloud).
  const voices = opts.allowCloud ? all : all.filter((v) => !isCloudVoice(v));
  if (voices.length === 0) return null;
  const want = opts.lang ?? 'en-US';
  const wantBase = baseLang(want) || 'en';
  const saved = findSaved(voices, opts.saved);

  if (saved) {
    if (wantBase === 'kn') {
      if (isKannada(saved)) return saved;
      return bestForLang(voices, 'kn') ?? saved;
    }
    return saved;
  }

  return (
    bestForLang(voices, want) ??
    bestForLang(voices, 'en') ??
    rankVoices(voices)[0] ??
    voices[0] ??
    null
  );
}

export function matchVoice(voices: readonly SynthVoice[], query: string): SynthVoice | null {
  const q = query.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!q) return null;
  const ranked = rankVoices(voices);
  if (/^kannada\b/.test(q)) return ranked.find(isKannada) ?? null;
  if (/^indian english\b/.test(q) || q === 'en in' || q === 'en-in') {
    return ranked.find(isIndianEnglish) ?? null;
  }
  return (
    ranked.find((v) => v.name.toLowerCase() === q) ??
    ranked.find((v) => v.name.toLowerCase().includes(q)) ??
    ranked.find((v) => normLang(v.lang) === q.replace(/\s+/g, '-')) ??
    null
  );
}

export function previewPhrase(lang?: string): string {
  if (baseLang(lang) === 'kn') return 'ನಮಸ್ಕಾರ, ಇದು ಮೆಂಡ್‌ಕ್ರಾಫ್ಟ್.';
  return 'Hello, this is Mendcraft.';
}

function storageOf(store?: Storage): Storage | undefined {
  return store ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
}

export function loadSavedVoice(store?: Storage): SavedVoice | null {
  const s = storageOf(store);
  if (!s) return null;
  try {
    const raw = s.getItem(VOICE_STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedVoice>;
    if (!parsed || typeof parsed.voiceURI !== 'string' || !parsed.voiceURI.trim()) return null;
    const saved: SavedVoice = { voiceURI: parsed.voiceURI.trim() };
    if (typeof parsed.name === 'string' && parsed.name.trim()) saved.name = parsed.name.trim();
    if (typeof parsed.lang === 'string' && parsed.lang.trim()) saved.lang = parsed.lang.trim();
    return saved;
  } catch {
    return null;
  }
}

export function saveVoice(voice: SavedVoice | SynthVoice, store?: Storage): void {
  const s = storageOf(store);
  if (!s) return;
  const saved: SavedVoice = { voiceURI: voice.voiceURI };
  if (voice.name) saved.name = voice.name;
  if (voice.lang) saved.lang = voice.lang;
  try {
    s.setItem(VOICE_STORE_KEY, JSON.stringify(saved));
  } catch {
    /* quota / private mode — fail open, the session still uses the in-memory choice */
  }
}

export function clearSavedVoice(store?: Storage): void {
  const s = storageOf(store);
  if (!s) return;
  try {
    s.removeItem(VOICE_STORE_KEY);
  } catch {
    /* ignore */
  }
}

/** Voice-control phrases for the picker. Null if this is not a voice-change request. */
export function parseChangeVoice(utterance: string): ChangeVoiceIntent | null {
  const t = utterance
    .toLowerCase()
    .replace(/[^a-z0-9.\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.?]+$/, '');
  if (!t) return null;

  if (/^(preview|try|hear) (the )?(spoken )?voice$/.test(t) || t === 'preview voice') {
    return { action: 'preview' };
  }
  if (
    /^(reset|restore|clear) (the )?(spoken )?voice$/.test(t) ||
    /^use (the )?(default|usual|built-in) voice$/.test(t) ||
    t === 'default voice'
  ) {
    return { action: 'reset' };
  }

  const setTo =
    t.match(/^(?:change|switch|set) (?:the )?(?:spoken )?voice(?: to| to the)? (.+)$/) ??
    t.match(/^use (?:the )?(.+?) voice$/) ??
    t.match(/^speak (?:with|in|using) (.+)$/);
  if (setTo) {
    const query = setTo[1].trim().replace(/^(the|a|an) /, '');
    if (!query || query === 'default' || query === 'usual' || query === 'built-in') {
      return { action: 'reset' };
    }
    return { action: 'set', query };
  }

  if (
    /^(change|switch|pick|choose|open|show) (a |the )?(spoken )?voice$/.test(t) ||
    t === 'change voice' ||
    t === 'voice picker'
  ) {
    return { action: 'open' };
  }
  return null;
}

export interface ChangeVoiceOutcome {
  action: 'open' | 'preview' | 'reset' | 'set' | 'not-found';
  /** The voice to speak `say` (and any preview) with; null when the browser has none. */
  voice: SynthVoice | null;
  /** The confirmation — screen-reader text always; spoken aloud when a voice exists. */
  say: string;
}

const NO_VOICES_TEXT = 'This browser has no spoken voices. Replies stay as text.';

/**
 * Decide what a spoken "change voice" command does and says. Pure: the caller
 * owns the side effects (saveVoice/clearSavedVoice, opening the panel) and the
 * actual speechSynthesis call.
 */
export function resolveChangeVoice(
  intent: ChangeVoiceIntent,
  voices: readonly SynthVoice[],
  saved?: SavedVoice | null,
  lang = 'en-US',
): ChangeVoiceOutcome {
  const current = pickSpokenVoice(voices, { lang, saved });
  switch (intent.action) {
    case 'open': {
      const example = rankVoices(voices)[0]?.name;
      return {
        action: 'open',
        voice: current,
        say: example ? `Pick a voice, or say use the ${example} voice.` : NO_VOICES_TEXT,
      };
    }
    case 'preview':
      return {
        action: 'preview',
        voice: current,
        say: current ? previewPhrase(current.lang) : NO_VOICES_TEXT,
      };
    case 'reset':
      return {
        action: 'reset',
        voice: pickSpokenVoice(voices, { lang }),
        say: 'Back to the usual voice.',
      };
    case 'set': {
      const matched = matchVoice(voices, intent.query);
      if (matched) {
        return { action: 'set', voice: matched, say: `Voice set to ${matched.name}.` };
      }
      return {
        action: 'not-found',
        voice: current,
        say: `I could not find a voice called ${intent.query}. Pick one from the list.`,
      };
    }
  }
}

/** Map a browser SpeechSynthesisVoice (or a test double) to SynthVoice. */
export function toSynthVoice(voice: {
  voiceURI: string;
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
}): SynthVoice {
  return {
    voiceURI: voice.voiceURI,
    name: voice.name,
    lang: voice.lang,
    localService: voice.localService,
    default: voice.default,
  };
}

// ---- nicer voice: clarity settings, cloud opt-in, the Mac download hint ----

/** A little slower than normal speech: clearer, never rushed. */
export const SPEECH_RATE = 0.95;
export const SPEECH_PITCH = 1;

export const CLOUD_VOICE_KEY = 'mendcraft:spoken-voice-cloud';
export const VOICE_HINT_KEY = 'mendcraft:spoken-voice-hint-shown';
export const READ_ALOUD_KEY = 'mendcraft:read-replies-aloud';

function flag(key: string, store?: Storage): boolean {
  try { return storageOf(store)?.getItem(key) === '1'; } catch { return false; }
}
function setFlag(key: string, on: boolean, store?: Storage): void {
  try { const s = storageOf(store); if (on) s?.setItem(key, '1'); else s?.removeItem(key); } catch { /* private mode: in-memory only */ }
}
/** Has she opted in to online voices (text leaves the device to be spoken)? Off unless '1'. */
export const loadAllowCloud = (store?: Storage): boolean => flag(CLOUD_VOICE_KEY, store);
export const saveAllowCloud = (on: boolean, store?: Storage): void => setFlag(CLOUD_VOICE_KEY, on, store);
/** Canvas: read status replies aloud. ON by default (Akash, 26 Nov); her
 *  choice is remembered: '1' on, '0' off, nothing stored = on. */
export const loadReadAloud = (store?: Storage): boolean => {
  try { return storageOf(store)?.getItem(READ_ALOUD_KEY) !== '0'; } catch { return true; }
};
export const saveReadAloud = (on: boolean, store?: Storage): void => {
  try { storageOf(store)?.setItem(READ_ALOUD_KEY, on ? '1' : '0'); } catch { /* private mode: in-memory only */ }
};

export type SpeechPlatform = 'mac' | 'ios' | 'android' | 'other';
/** Which OS's voices we are looking at (iPadOS reports itself as a Mac with touch). */
export function speechPlatform(ua: string, maxTouchPoints = 0): SpeechPlatform {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && maxTouchPoints > 1)) return 'ios';
  if (/macintosh|mac os x/i.test(ua)) return 'mac';
  return 'other';
}

export const MAC_VOICE_HINT = "For a nicer voice: System Settings → Accessibility → Spoken Content → System voice → Manage Voices → download 'Ava (Premium)'.";

/** True on a Mac that has voices but no Premium / Enhanced one in this
 *  language: the place to say how to get one (we never download anything). */
export function needsMacVoiceHint(voices: readonly SynthVoice[], platform: SpeechPlatform, lang = 'en-US'): boolean {
  if (platform !== 'mac' || voices.length === 0) return false;
  return !voices.some((v) => !isCloudVoice(v) && langMatches(v, lang) && voiceTier(v) >= 2);
}
/** The hint, once: null if it does not apply or was already shown. Marks it shown. */
export function macVoiceHintOnce(voices: readonly SynthVoice[], platform: SpeechPlatform, lang = 'en-US', store?: Storage): string | null {
  if (!needsMacVoiceHint(voices, platform, lang) || flag(VOICE_HINT_KEY, store)) return null;
  setFlag(VOICE_HINT_KEY, true, store);
  return MAC_VOICE_HINT;
}

/** The voices the picker lists for a language, best first: on-device only
 *  unless she allowed online voices; joke voices left out; at most `max`. */
export function listPickerVoices(voices: readonly SynthVoice[], opts: { lang?: string; allowCloud?: boolean; max?: number } = {}): SynthVoice[] {
  const lang = opts.lang ?? 'en-US';
  const usable = voices.filter((v) => (opts.allowCloud || !isCloudVoice(v)) && !isNoveltyVoice(v) && langMatches(v, lang));
  const first = bestForLang(usable, lang);
  const ranked = rankVoices(usable);
  const ordered = first ? [first, ...ranked.filter((v) => v !== first)] : ranked;
  return ordered.slice(0, opts.max ?? 12);
}

/** "Ava (Premium)" stays as it is; the tag says what kind of voice it is. */
export function voiceKindLabel(voice: SynthVoice): string {
  if (isCloudVoice(voice)) return 'Online — text is sent to be spoken';
  const tier = voiceTier(voice);
  return tier === 3 ? 'Premium · on this device' : tier === 2 ? 'Enhanced · on this device' : 'On this device';
}

/** Can `voice` speak text written in `lang`? (An English voice reading Kannada is noise.) */
export function voiceSpeaks(voice: SynthVoice | null, lang: string): boolean {
  if (!voice) return baseLang(lang) === 'en';
  return langMatches(voice, lang);
}

/** The voices a picker may list or use: on-device ones, plus online ones only
 *  after she turned online voices on. */
export function usableVoices(voices: readonly SynthVoice[], allowCloud: boolean): SynthVoice[] {
  return voices.filter((v) => allowCloud || !isCloudVoice(v));
}
