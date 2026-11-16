// LANGUAGE DETECTION — which language did she just speak (or type)?
//
// Order, cheapest + most private first:
//   1. Chrome's built-in Language Detector API (on device). Note: this is
//      Chrome's small dedicated detection model, NOT Gemini Nano, so the badge
//      says "Chrome AI · on device" rather than claiming Nano.
//   2. If that API is missing (Safari, iOS, older Chrome) or unsure: a Unicode
//      script check (Kannada script → Kannada, Hangul → Korean, kana → Japanese)
//      and an English word check — both pure, both on device.
//   3. Still ambiguous Latin text in Auto mode → ask Gemini in the cloud. That
//      call is the only one that leaves the device; the caller records it in the
//      "What left this device" ledger as job 'lang-detect'.
//
// The decision logic here is PURE (no DOM, no network) and unit-tested; the
// only browser touch is the thin `chromeDetector()` wrapper at the bottom.

import { findLanguage, type Language } from './language';

export type DetectVia = 'chrome' | 'script' | 'words' | 'cloud' | 'picked' | 'hint';

export interface Detection {
  lang: Language;
  /** 0..1 */
  confidence: number;
  via: DetectVia;
}

/** Badge text for how the language was found. */
export const DETECT_VIA_TEXT: Record<DetectVia, string> = {
  chrome: 'Chrome AI · on device',
  script: 'Script check · on device',
  words: 'Word check · on device',
  cloud: 'Gemini · cloud',
  picked: 'You picked it',
  hint: 'Listening language',
};

/** "Hindi · Chrome AI · on device (97%)" */
export function detectionLabel(d: Detection): string {
  const pct = d.via === 'picked' || d.via === 'hint' ? '' : ` (${Math.round(d.confidence * 100)}%)`;
  return `${d.lang.englishName} · ${DETECT_VIA_TEXT[d.via]}${pct}`;
}

/** Below this, the Chrome detector's top guess is treated as unsure. Short
 *  phrases score low (Chrome's own docs warn about it), so we fall through to
 *  the script/word checks instead of trusting a coin flip. */
export const MIN_DETECT_CONFIDENCE = 0.6;

// ---------------------------------------------------------------------------
// Script check.

interface ScriptRow { re: RegExp; code: string; /** one script ↔ one language? */ sure: boolean }

// Order matters only for kana vs Han: any kana at all means Japanese.
const SCRIPTS: ScriptRow[] = [
  { re: /[\u3040-\u30ff]/g, code: 'ja', sure: true },          // Hiragana + Katakana
  { re: /[\uac00-\ud7af\u1100-\u11ff]/g, code: 'ko', sure: true }, // Hangul
  { re: /[\u0c80-\u0cff]/g, code: 'kn', sure: true },          // Kannada
  { re: /[\u0b80-\u0bff]/g, code: 'ta', sure: true },          // Tamil
  { re: /[\u0c00-\u0c7f]/g, code: 'te', sure: true },          // Telugu
  { re: /[\u0d00-\u0d7f]/g, code: 'ml', sure: true },          // Malayalam
  { re: /[\u0a80-\u0aff]/g, code: 'gu', sure: true },          // Gujarati
  { re: /[\u0a00-\u0a7f]/g, code: 'pa', sure: true },          // Gurmukhi
  { re: /[\u0b00-\u0b7f]/g, code: 'or', sure: true },          // Odia
  { re: /[\u0980-\u09ff]/g, code: 'bn', sure: false },         // Bengali (also Assamese)
  { re: /[\u0900-\u097f]/g, code: 'hi', sure: false },         // Devanagari (also Marathi, Nepali)
  { re: /[\u0e00-\u0e7f]/g, code: 'th', sure: true },          // Thai
  { re: /[\u10a0-\u10ff]/g, code: 'ka', sure: true },          // Georgian
  { re: /[\u0530-\u058f]/g, code: 'hy', sure: true },          // Armenian
  { re: /[\u0370-\u03ff]/g, code: 'el', sure: true },          // Greek
  { re: /[\u0590-\u05ff]/g, code: 'he', sure: true },          // Hebrew
  { re: /[\u1200-\u137f]/g, code: 'am', sure: false },         // Ethiopic
  { re: /[\u0600-\u06ff]/g, code: 'ar', sure: false },         // Arabic (also Urdu, Persian)
  { re: /[\u0400-\u04ff]/g, code: 'ru', sure: false },         // Cyrillic (also Ukrainian, …)
  { re: /[\u4e00-\u9fff]/g, code: 'zh', sure: false },         // Han (could be Japanese kanji)
];

const LETTER_RE = /\p{L}/gu;

/**
 * Detect by writing system. Returns null for Latin-script (or empty) text,
 * which needs a real detector. Confidence is high for a one-language script
 * (Kannada) and modest for a shared one (Devanagari: Hindi or Marathi).
 */
export function scriptDetect(text: string): Detection | null {
  const letters = (text.match(LETTER_RE) ?? []).length;
  if (letters === 0) return null;
  // Kana is decisive even when kanji dominate ("元に戻して").
  for (const row of SCRIPTS) {
    const n = (text.match(row.re) ?? []).length;
    if (n === 0) continue;
    if (row.code === 'ja' || n / letters >= 0.5) {
      const lang = findLanguage(row.code);
      if (!lang) continue;
      return { lang, confidence: row.sure ? 0.95 : 0.7, via: 'script' };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// English word check (for Latin text when no detector is around). Small on
// purpose: common function words + this app's own command vocabulary.

const EN_WORDS = new Set((
  'a an the this that these those it its is are be to of in on at by for with and or not no yes ' +
  'please can you i me my we our make made move put add remove delete undo redo go show hide open close ' +
  'turn set dim brighten bright brighter darker lamp light lights music play pause stop next ' +
  'wall walls door doors window windows room rooms kitchen bedroom bathroom plan floor ' +
  'bigger smaller wider narrower thicker thinner taller shorter longer left right up down ' +
  'here there one two three four five more less bit little by meters metres meter mm cm ' +
  'select all copy duplicate rotate scroll read reply message call phone check accessibility ' +
  'save export help start teaching do new screen button text color colour red blue green'
).split(/\s+/));

/** Share of words that are common English (0..1); null when there are no words. */
export function englishWordShare(text: string): number | null {
  const words = text.toLowerCase().match(/[a-z']+/g);
  if (!words || words.length === 0) return null;
  const hits = words.filter((w) => EN_WORDS.has(w)).length;
  return hits / words.length;
}

/** Is this all ASCII-letter (plus digits/punctuation) text? */
export function isPlainLatin(text: string): boolean {
  const letters = text.match(LETTER_RE) ?? [];
  return letters.length > 0 && letters.every((c) => /[a-z]/i.test(c));
}

// ---------------------------------------------------------------------------
// Picking a Chrome detector result.

export interface RawDetectorResult { detectedLanguage: string; confidence: number }

/** The top Chrome detector guess if it is a real language and confident enough. */
export function pickDetectorResult(results: readonly RawDetectorResult[] | null | undefined): Detection | null {
  if (!results || results.length === 0) return null;
  const top = [...results].sort((a, b) => b.confidence - a.confidence)[0];
  if (!top || !(top.confidence >= MIN_DETECT_CONFIDENCE)) return null;
  const lang = findLanguage(top.detectedLanguage);
  return lang ? { lang, confidence: top.confidence, via: 'chrome' } : null;
}

// ---------------------------------------------------------------------------
// The decision after the on-device steps.

export interface DetectInput {
  text: string;
  /** 'auto' or a picked language code (ai/language AUTO_PICK). */
  pick: string;
  /** The picked language, or what recognition is listening in. */
  listening: Language;
  /** The Chrome detector's verdict (already filtered by pickDetectorResult). */
  device: Detection | null;
  /** The Language Detector API exists in this browser. */
  deviceAvailable: boolean;
  /** Firebase AI Logic is reachable (configured, App Check ok, online). */
  cloudReady: boolean;
}

export type DetectPlan =
  | { kind: 'done'; detection: Detection }
  | { kind: 'cloud'; fallback: Detection };

/**
 * Pure decision: given what the on-device steps found, are we done, or should
 * we ask Gemini in the cloud? A picked language is trusted unless Chrome
 * confidently heard another one (she switched languages mid-session). The cloud
 * is only asked in Auto mode, for ambiguous Latin text, when Chrome's detector
 * is missing — never for text the English word check is sure about.
 */
export function planDetection(input: DetectInput): DetectPlan {
  const { text, pick, listening, device } = input;
  const picked = pick !== 'auto';
  if (device && (!picked || device.lang.code !== listening.code)) return { kind: 'done', detection: device };
  if (picked) return { kind: 'done', detection: { lang: listening, confidence: 1, via: 'picked' } };

  const script = scriptDetect(text);
  if (script) return { kind: 'done', detection: script };

  const hint: Detection = { lang: listening, confidence: 0.5, via: 'hint' };
  const share = englishWordShare(text);
  if (share !== null && share >= 0.5 && isPlainLatin(text)) {
    const en = findLanguage('en')!;
    return { kind: 'done', detection: { lang: en, confidence: Math.min(0.95, 0.5 + share / 2), via: 'words' } };
  }
  // A working Chrome detector that stayed unsure: don't send text out just to
  // second-guess it — keep the listening language.
  if (input.deviceAvailable || !input.cloudReady) return { kind: 'done', detection: hint };
  return { kind: 'cloud', fallback: hint };
}

/** Parse the cloud detector's JSON ({"lang":"es","confidence":0.9}). */
export function parseCloudDetection(raw: unknown): Detection | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const lang = findLanguage(typeof r.lang === 'string' ? r.lang : null);
  if (!lang) return null;
  const c = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? r.confidence : 0.8;
  return { lang, confidence: Math.min(1, Math.max(0, c)), via: 'cloud' };
}

/** Structured output for the cloud detector (plain JSON Schema). */
export const LANG_DETECT_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: { lang: { type: 'string' }, confidence: { type: 'number' } },
  required: ['lang'],
};

/** The tiny cloud prompt: the transcript only, JSON-escaped. */
export function cloudDetectPrompt(text: string): string {
  return `Which language is this transcript in? Reply JSON only: {"lang":"<BCP-47 primary code, e.g. en, kn, hi, es, ja>","confidence":<0..1>}.\nTranscript: ${JSON.stringify(text.slice(0, 300))}`;
}

// ---------------------------------------------------------------------------
// Thin browser wrapper around Chrome's Language Detector API.

interface ChromeLanguageDetector { detect(text: string): Promise<RawDetectorResult[]> }
interface ChromeLanguageDetectorCtor {
  availability(): Promise<string>;
  create(): Promise<ChromeLanguageDetector>;
}

let detectorPromise: Promise<ChromeLanguageDetector | null> | null = null;

/** Does this browser ship the Language Detector API at all? */
export function chromeDetectorAvailable(): boolean {
  return typeof (globalThis as Record<string, unknown>).LanguageDetector === 'function'
    || typeof (globalThis as Record<string, unknown>).LanguageDetector === 'object';
}

/** Create (once) Chrome's on-device detector; null if missing or unavailable.
 *  'downloadable' models start downloading on create(); a failure is quiet. */
export function chromeDetector(): Promise<ChromeLanguageDetector | null> {
  if (detectorPromise) return detectorPromise;
  const Ctor = (globalThis as Record<string, unknown>).LanguageDetector as ChromeLanguageDetectorCtor | undefined;
  if (!Ctor || typeof Ctor.availability !== 'function') return (detectorPromise = Promise.resolve(null));
  const attempt = (async () => {
    try {
      const a = await Ctor.availability();
      if (a === 'unavailable') return null;
      return await Ctor.create();
    } catch {
      return null;
    }
  })();
  detectorPromise = attempt;
  // A failed create (e.g. a download that needs a user gesture) is retried on
  // the next utterance instead of being cached as "missing" forever.
  void attempt.then((d) => { if (!d && detectorPromise === attempt) detectorPromise = null; });
  return attempt;
}

/** Run Chrome's detector on the text (null if missing / failed / unsure). */
export async function detectOnDevice(text: string): Promise<Detection | null> {
  const d = await chromeDetector();
  if (!d) return null;
  try {
    return pickDetectorResult(await d.detect(text));
  } catch {
    return null;
  }
}
