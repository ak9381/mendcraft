// A canvas language pack: the UI strings she sees and the spoken phrases that
// route to the same intents. English (EN_PACK) is the polished baseline. Another
// language is a human-in-the-loop AI turn: Gemini drafts a pack, it's validated
// here (known keys only, the language's own script, no markup), shown in
// review, and only applied on Approve. An approved pack is stored as the
// artifact `pack-<lang>` and checked again here every time it loads.
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

/** The scripts the canvas can check: a pack's every string must carry at
 *  least one letter of its language's script. A language outside this table
 *  is refused (SCRIPT_UNKNOWN). Fixed in code, never generated. */
export const LANG_SCRIPTS: Record<string, RegExp> = {
  kn: /[ಀ-೿]/, hi: /[ऀ-ॿ]/, mr: /[ऀ-ॿ]/, ta: /[஀-௿]/,
  te: /[ఀ-౿]/, ml: /[ഀ-ൿ]/, bn: /[ঀ-৿]/, gu: /[઀-૿]/,
  es: /[a-záéíóúñü]/i, fr: /[a-zàâçéèêëîïôûùüÿœ]/i, de: /[a-zäöüß]/i,
};
/** The English name of every language in LANG_SCRIPTS. */
export const LANG_NAMES: Record<string, string> = {
  kn: 'Kannada', hi: 'Hindi', mr: 'Marathi', ta: 'Tamil',
  te: 'Telugu', ml: 'Malayalam', bn: 'Bengali', gu: 'Gujarati',
  es: 'Spanish', fr: 'French', de: 'German',
};
/** The languages written in a Latin script (a line can't be told apart from English). */
export const LATIN_LANGS: ReadonlySet<string> = new Set(['es', 'fr', 'de']);
export const SCRIPT_UNKNOWN = "I can't check that script yet. Nothing changed.";
/** The script a language is checked against, or null when it isn't in the table. */
export function scriptOf(lang: string): RegExp | null {
  return Object.prototype.hasOwnProperty.call(LANG_SCRIPTS, lang) ? LANG_SCRIPTS[lang] : null;
}
/** The English name of a code in the table (else the code itself). */
export function langName(lang: string): string {
  return Object.prototype.hasOwnProperty.call(LANG_NAMES, lang) ? LANG_NAMES[lang] : lang;
}

/** How she names each language: English and its own name. */
const LANG_WORDS: Record<string, string[]> = {
  kn: ['kannada', 'ಕನ್ನಡ'], hi: ['hindi', 'हिन्दी', 'हिंदी'], mr: ['marathi', 'मराठी'],
  ta: ['tamil', 'தமிழ்'], te: ['telugu', 'తెలుగు'], ml: ['malayalam', 'മലയാളം'],
  bn: ['bengali', 'bangla', 'বাংলা'], gu: ['gujarati', 'ગુજરાતી'],
  es: ['spanish', 'español', 'espanol'], fr: ['french', 'français', 'francais'], de: ['german', 'deutsch'],
};
/** The verbs around a language name: "add Kannada", "switch to Hindi",
 *  "in Tamil", "change the language to French", or the name alone. The
 *  whole line must be the ask, so "play an old Kannada song" is not one. */
const ASK_LEAD = String.raw`(?:please\s+)?(?:(?:add|use|turn\s+on|(?:switch|change)(?:\s+(?:the\s+)?(?:canvas|screen|interface|app|language|buttons))?\s+(?:in)?to|(?:show\s+(?:it|everything|the\s+canvas|the\s+screen)\s+)?in)\s+)?(?:the\s+)?`;
const ASK_TAIL = String.raw`(?:\s+(?:language|pack|labels))?(?:\s+please)?`;
function askWord(text: string, words: readonly string[]): boolean {
  const t = text.trim().replace(/[.!?।]+$/u, '').trim().toLowerCase().normalize('NFC');
  if (!t) return false;
  return words.some((w) => new RegExp(`^${ASK_LEAD}${w.normalize('NFC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${ASK_TAIL}$`, 'iu').test(t));
}
/** "add Kannada" / "switch to Hindi" / "in Tamil" → the code from
 *  LANG_SCRIPTS, else null. Only the languages the canvas can check. */
export function languageAsk(text: string): string | null {
  for (const [code, words] of Object.entries(LANG_WORDS)) if (askWord(text, words)) return code;
  return null;
}
/** The same asks for any language name she might say (English names from
 *  `names`, code → English name): the code, so a language outside the table
 *  can be refused plainly instead of becoming an open-ended chat turn. */
export function languageAskAny(text: string, names: Readonly<Record<string, string>>): string | null {
  const known = languageAsk(text);
  if (known) return known;
  for (const [code, name] of Object.entries(names)) if (name && askWord(text, [name.toLowerCase()])) return code;
  return null;
}
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

function okString(v: unknown, script: RegExp): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_STRING && !/[<>]/.test(v) && script.test(v);
}

/** What a pack turn sends: the English UI strings (keys and words) and the
 *  language asked for. No board data, no device names, no addresses. */
export const PACK_SENT_WORDS = 'the English button labels and the language you asked for. No board data, no device names.';
/** Why the pack turn went to Gemini, for the review's route line. */
export const packRouteLine = (name: string): string => `Gemini writes the ${name} pack. Only the English labels were sent.`;

/** The prompt for a pack in `lang` (a code in LANG_SCRIPTS). */
export function packPrompt(lang: string): string {
  const name = langName(lang);
  return [
    `Translate the smart-canvas UI into ${name}. Reply with JSON only:`,
    `{"lang":"${lang}","strings":{key:text},"phrases":{intent:[phrases]}}`,
    `UI strings (key: English): ${Object.entries(EN_PACK.strings).map(([k, v]) => `${k}: ${v}`).join('; ')}.`,
    `Every key is required except ${LANG_OPTIONAL_KEYS.join(', ')}.`,
    `Phrases are what she might say for an intent; intents: ${INTENT_KEYS.join(', ')}.`,
    `${name} in its own script, each string at most ${MAX_STRING} characters, no markup.`,
  ].join('\n');
}

/** Each English label and what the pack puts in its place, for the review. */
export function packSwaps(pack: LanguagePack): { key: LangStringKey; en: string; to: string }[] {
  const out: { key: LangStringKey; en: string; to: string }[] = [];
  for (const k of [...LANG_STRING_KEYS, ...LANG_OPTIONAL_KEYS]) {
    const to = pack.strings[k];
    if (to) out.push({ key: k, en: EN_PACK.strings[k] ?? k, to });
  }
  return out;
}

/** Untrusted AI reply → a valid LanguagePack, or a reason it was refused. A
 *  language outside LANG_SCRIPTS is refused with SCRIPT_UNKNOWN. */
export function coerceLanguagePack(raw: unknown): Coerced<LanguagePack> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };
  const r = raw as Record<string, unknown>;
  const lang = typeof r.lang === 'string' && /^[a-z]{2,3}$/.test(r.lang) ? r.lang : null;
  if (!lang) return { ok: false, error: 'lang must be a 2–3 letter code' };
  const script = scriptOf(lang);
  if (!script) return { ok: false, error: SCRIPT_UNKNOWN };
  if (!r.strings || typeof r.strings !== 'object' || Array.isArray(r.strings)) return { ok: false, error: 'strings must be an object' };
  const strings: Partial<Record<LangStringKey, string>> = {};
  for (const [k, v] of Object.entries(r.strings as Record<string, unknown>)) {
    if (!STRING_KEY_SET.has(k)) return { ok: false, error: `unknown string key "${k}"` };
    if (!okString(v, script)) return { ok: false, error: `string "${k}" must be ≤${MAX_STRING} chars, ${langName(lang)} script, no markup` };
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
      const good = arr.filter((p): p is string => okString(p, script));
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

/** A device-command status line in the active pack's language: Kannada when a
 *  kn pack is on, English for every other pack (packs carry UI strings only). */
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
