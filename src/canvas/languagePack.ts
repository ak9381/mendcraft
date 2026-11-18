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
] as const;
export type LangStringKey = (typeof LANG_STRING_KEYS)[number];

/** Intents a translated phrase may route to (canvas + device commands). */
export const INTENT_KEYS = [
  'lampOn', 'lampOff', 'brighter', 'dimmer',
  'showEverything', 'newBoard', 'save', 'keep', 'drop', 'undo',
] as const;
export type IntentKey = (typeof INTENT_KEYS)[number];

export interface LanguagePack {
  lang: string;
  strings: Partial<Record<LangStringKey, string>>;
  phrases: Partial<Record<IntentKey, string[]>>;
}

export const MAX_STRING = 80;
const KANNADA = /[ಀ-೿]/;
const STRING_KEY_SET = new Set<string>(LANG_STRING_KEYS);
const INTENT_KEY_SET = new Set<string>(INTENT_KEYS);

/** Polished English baseline. These are the data-i18n defaults; undo restores them. */
export const EN_PACK: LanguagePack = {
  lang: 'en',
  strings: {
    showEverything: 'Show everything', newBoard: 'New board', save: 'Save', undo: 'Undo', ai: 'AI activity',
    sayPlaceholder: 'Say: new board · show everything · go to floor plan',
    emptyLead: 'Empty board.', emptyConnect: 'Connect this room', emptyFloorplan: 'Floor plan',
    keep: 'PINCH  keep', drop: 'BRUSH  drop',
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
    emptyLead: 'ಖಾಲಿ ಬೋರ್ಡ್.',
    emptyConnect: 'ಈ ಕೋಣೆ ಸೇರಿಸು',
    emptyFloorplan: 'ನೆಲ ನಕ್ಷೆ',
    keep: 'ಇಟ್ಟುಕೋ',
    drop: 'ಬೇಡ',
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

  const phrases: Partial<Record<IntentKey, string[]>> = {};
  if (r.phrases !== undefined) {
    if (!r.phrases || typeof r.phrases !== 'object' || Array.isArray(r.phrases)) return { ok: false, error: 'phrases must be an object' };
    for (const [intent, arr] of Object.entries(r.phrases as Record<string, unknown>)) {
      if (!INTENT_KEY_SET.has(intent)) return { ok: false, error: `unknown intent "${intent}"` };
      if (!Array.isArray(arr) || !arr.length) return { ok: false, error: `phrases.${intent} must be a non-empty list` };
      for (const p of arr) if (!okString(p)) return { ok: false, error: `phrase for "${intent}" must be Kannada, ≤${MAX_STRING} chars, no markup` };
      phrases[intent as IntentKey] = arr as string[];
    }
  }
  return { ok: true, value: { lang, strings, phrases } };
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
