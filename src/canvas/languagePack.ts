// A canvas language pack: the UI strings she sees and the spoken phrases that
// route to the same intents. English (EN_PACK) is the polished baseline. Another
// language is a human-in-the-loop AI turn: Gemini drafts a pack, it's validated
// here (known keys only, real script, no markup), shown as a Proposal, and only
// applied on keep. The active pack persists in the canvas doc so it works offline.
import type { Coerced } from './surfacePlan';

/** Every UI string the canvas can translate (bar buttons, placeholder, empty
 *  state, proposal words). */
export const LANG_STRING_KEYS = [
  'showEverything', 'newBoard', 'save', 'undo', 'ai',
  'sayPlaceholder', 'emptyLead', 'emptyConnect', 'emptyFloorplan',
  'keep', 'drop',
  'go', 'hands', 'simulateOffline', 'offlineOn',
] as const;
/** Strings a pack MAY translate. A live Gemini pack that omits them still
 *  validates (the English label stays); the scripted Kannada pack has them. */
export const LANG_OPTIONAL_KEYS = ['tools', 'approve', 'reject', 'askElse'] as const;
export type LangStringKey = (typeof LANG_STRING_KEYS)[number] | (typeof LANG_OPTIONAL_KEYS)[number];

/** Intents a translated phrase may route to (canvas + device commands). */
export const INTENT_KEYS = [
  'lampOn', 'lampOff', 'brighter', 'dimmer',
  'showEverything', 'newBoard', 'save', 'keep', 'drop', 'undo',
] as const;
export type IntentKey = (typeof INTENT_KEYS)[number];
/** Canned English label per intent (an understood-as line, not a translation). */
export const INTENT_ENGLISH: Record<IntentKey, string> = {
  lampOn: 'turn the lamp on', lampOff: 'turn the lamp off', brighter: 'make it brighter', dimmer: 'make it dimmer',
  showEverything: 'show everything', newBoard: 'new board', save: 'save', keep: 'keep', drop: 'drop', undo: 'undo',
};

export interface LanguagePack {
  lang: string;
  strings: Partial<Record<LangStringKey, string>>;
  phrases: Partial<Record<IntentKey, string[]>>;
}

export const MAX_STRING = 80;
const KANNADA = /[ಀ-೿]/;
const STRING_KEY_SET = new Set<string>([...LANG_STRING_KEYS, ...LANG_OPTIONAL_KEYS]);
const INTENT_KEY_SET = new Set<string>(INTENT_KEYS);

/** Polished English baseline. These are the data-i18n defaults; undo restores them. */
export const EN_PACK: LanguagePack = {
  lang: 'en',
  strings: {
    showEverything: 'Show everything', newBoard: 'New board', save: 'Save', undo: 'Undo', ai: 'AI activity',
    sayPlaceholder: 'Type or say a command…',
    emptyLead: 'What would you like to build on this board?', emptyConnect: 'Connect this room', emptyFloorplan: 'Floor plan',
    keep: 'Keep', drop: 'Drop',
    tools: 'Tools', approve: 'Approve', reject: 'Reject', askElse: 'Something else',
    go: 'Go', hands: 'Hands',
    simulateOffline: 'Simulate offline', offlineOn: 'Offline (simulated)',
  },
  phrases: {},
};

/** A correct, natural Kannada pack — the scripted "add kannada" reply (SIM). */
export const SCRIPTED_KN_PACK: LanguagePack = {
  lang: 'kn',
  strings: {
    showEverything: 'ಎಲ್ಲಾ ತೋರಿಸು',
    newBoard: 'ಹೊಸ ಬೋರ್ಡ್',
    save: 'ಉಳಿಸು',
    undo: 'ರದ್ದುಮಾಡು',
    ai: 'ಎಐ ಚಟುವಟಿಕೆ',
    sayPlaceholder: 'ಹೇಳಿ: ಹೊಸ ಬೋರ್ಡ್ · ಎಲ್ಲಾ ತೋರಿಸು · ನೆಲ ನಕ್ಷೆ',
    emptyLead: 'ಈ ಬೋರ್ಡ್‌ನಲ್ಲಿ ನೀವು ಏನನ್ನು ನಿರ್ಮಿಸಲು ಇಷ್ಟಪಡುತ್ತೀರಿ?',
    emptyConnect: 'ಈ ಕೋಣೆ ಸೇರಿಸು',
    emptyFloorplan: 'ನೆಲ ನಕ್ಷೆ',
    keep: 'ಇಟ್ಟುಕೋ',
    drop: 'ಬೇಡ',
    tools: 'ಉಪಕರಣಗಳು',
    approve: 'ಒಪ್ಪಿಕೊಳ್ಳಿ',
    reject: 'ತಿರಸ್ಕರಿಸಿ',
    askElse: 'ಬೇರೆ ಏನಾದರೂ ಕೇಳಿ',
    go: 'ಹೋಗು',
    hands: 'ಕೈ ಸನ್ನೆ',
    simulateOffline: 'ಆಫ್‌ಲೈನ್ ಅನುಕರಿಸು',
    offlineOn: 'ಆಫ್‌ಲೈನ್ (ಅನುಕರಣೆ)',
  },
  phrases: {
    lampOn: ['ದೀಪ ಆನ್ ಮಾಡು'],
    lampOff: ['ದೀಪ ಆಫ್ ಮಾಡು', 'ದೀಪ ಆರಿಸು'],
    brighter: ['ಬೆಳಕು ಹೆಚ್ಚಿಸು'],
    dimmer: ['ಬೆಳಕು ಕಡಿಮೆ ಮಾಡು'],
    showEverything: ['ಎಲ್ಲಾ ತೋರಿಸು'],
    newBoard: ['ಹೊಸ ಬೋರ್ಡ್'],
    save: ['ಉಳಿಸು'],
    keep: ['ಇಟ್ಟುಕೋ'],
    drop: ['ಬೇಡ'],
    undo: ['ರದ್ದುಮಾಡು'],
  },
};

function okString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_STRING && !/[<>]/.test(v) && KANNADA.test(v);
}

/** Untrusted AI reply → a valid LanguagePack, or a reason it was refused. */
export function coerceLanguagePack(raw: unknown): Coerced<LanguagePack> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };
  const r = raw as Record<string, unknown>;
  const lang = typeof r.lang === 'string' && /^[a-z]{2,3}$/.test(r.lang) ? r.lang : null;
  if (!lang) return { ok: false, error: 'lang must be a 2–3 letter code' };
  if (!r.strings || typeof r.strings !== 'object' || Array.isArray(r.strings)) return { ok: false, error: 'strings must be an object' };
  const strings: Partial<Record<LangStringKey, string>> = {};
  for (const [k, v] of Object.entries(r.strings as Record<string, unknown>)) {
    if (!STRING_KEY_SET.has(k)) return { ok: false, error: `unknown string key "${k}"` };
    if (!okString(v)) return { ok: false, error: `string "${k}" must be ≤${MAX_STRING} chars, Kannada script, no markup` };
    strings[k as LangStringKey] = v;
  }
  if (!Object.keys(strings).length) return { ok: false, error: 'no strings' };
  const missing = LANG_STRING_KEYS.filter((k) => !strings[k]);
  if (missing.length) return { ok: false, error: `incomplete pack: missing string "${missing[0]}"` };

  const phrases: Partial<Record<IntentKey, string[]>> = {};
  if (r.phrases !== undefined) {
    if (!r.phrases || typeof r.phrases !== 'object' || Array.isArray(r.phrases)) return { ok: false, error: 'phrases must be an object' };
    for (const [intent, arr] of Object.entries(r.phrases as Record<string, unknown>)) {
      // Phrases are optional extras: a phrase for an intent we don't know, or
      // one that fails the checks, is dropped — it never sinks the whole pack
      // (live Gemini added an "ai" intent and the pack was refused).
      if (!INTENT_KEY_SET.has(intent)) continue;
      if (!Array.isArray(arr) || !arr.length) continue;
      const good = arr.filter(okString);
      if (good.length) phrases[intent as IntentKey] = good;
    }
  }
  return { ok: true, value: { lang, strings, phrases } };
}

/** Status lines a device command can end with. English is the baseline; a
 *  Kannada pack localizes them so "ದೀಪ ಆಫ್ ಮಾಡು" is confirmed in Kannada. */
export const STATUS_KEYS = [
  'lightsOn', 'lightsOff', 'brighter', 'dimmer',
  'playing', 'paused', 'nextSong', 'louder', 'softer', 'done',
] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];

const EN_STATUS: Record<StatusKey, string> = {
  lightsOn: 'Lights on.', lightsOff: 'Lights off.',
  brighter: 'Brighter.', dimmer: 'Dimmer.',
  playing: 'Playing.', paused: 'Paused.', nextSong: 'Next song.',
  louder: 'Louder.', softer: 'Softer.', done: 'Done.',
};
const KN_STATUS: Record<StatusKey, string> = {
  lightsOn: 'ದೀಪ ಆನ್ ಆಯಿತು.', lightsOff: 'ದೀಪ ಆಫ್ ಆಯಿತು.',
  brighter: 'ಬೆಳಕು ಹೆಚ್ಚಾಯಿತು.', dimmer: 'ಬೆಳಕು ಕಡಿಮೆಯಾಯಿತು.',
  playing: 'ಹಾಡು ಶುರುವಾಯಿತು.', paused: 'ಹಾಡು ನಿಂತಿದೆ.', nextSong: 'ಮುಂದಿನ ಹಾಡು.',
  louder: 'ಧ್ವನಿ ಹೆಚ್ಚಾಯಿತು.', softer: 'ಧ್ವನಿ ಕಡಿಮೆಯಾಯಿತು.', done: 'ಆಯಿತು.',
};

/** A device-command status line in the active pack's language (Kannada when a
 *  kn pack is on; English otherwise). */
export function statusText(k: StatusKey, pack: LanguagePack | null): string {
  return pack?.lang === 'kn' ? KN_STATUS[k] : EN_STATUS[k];
}

/** Script-aware normalize: keep letters/digits of any script, drop punctuation. */
function normMulti(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** A spoken phrase → the intent it routes to, or null. Longest phrases win so a
 *  specific sentence beats a word it contains. */
export function routePackPhrase(text: string, pack: LanguagePack): IntentKey | null {
  const t = normMulti(text);
  if (!t) return null;
  let best: { intent: IntentKey; len: number } | null = null;
  for (const intent of INTENT_KEYS) {
    for (const phrase of pack.phrases[intent] ?? []) {
      const p = normMulti(phrase);
      if (p && t.includes(p) && (!best || p.length > best.len)) best = { intent, len: p.length };
    }
  }
  return best?.intent ?? null;
}
