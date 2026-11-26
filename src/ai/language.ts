// SPOKEN LANGUAGE SUPPORT — "Polished in English. Speak any language."
//
// English is the ONE polished language: UI text, fixed command phrases and
// spoken replies are written and checked in English. Every other language
// (Kannada, Hindi, Spanish, Japanese, …) is supported, not polished:
//   1. the language is DETECTED (ai/langDetect: Chrome's on-device Language
//      Detector, else a Gemini cloud call that the ledger records);
//   2. speech recognition listens in a picked language, or "Auto" (the last
//      detected language);
//   3. Gemini turns the transcript into the SAME English command intents —
//      Nano first when Chrome says it can run that language, otherwise the
//      cloud (translate + op in ONE Firebase AI Logic call);
//   4. replies are spoken in that language when the browser has a voice for it
//      (the model's own short reply), otherwise in English.
// The old fixed Kannada phrases stay only as an OFFLINE fallback.
//
// Pure: it decides, labels and pairs captions; it never calls a model, Firebase,
// a speech API or the DOM, so every branch is unit-tested without a network.

import { badgeLabel, sourceText, type OnDeviceKind, type RouteReason } from './router';
import type { Source } from './hybrid';

export interface Language {
  /** BCP-47 primary subtag — also the tag we ask Nano about (expectedInputs). */
  code: string;
  /** Native label for the picker: "English", "ಕನ್ನಡ (Kannada)". */
  label: string;
  /** English name, shown on the badge ("Gemini · cloud · Kannada"). */
  englishName: string;
  /** Full BCP-47 tag for Web Speech recognition + speechSynthesis. */
  speechLang: string;
}

/** The only polished language. */
export const POLISHED_CODE = 'en';

/** Plain copy used on the landing page, settings and the picker tooltip. */
export const LANGUAGE_PROMISE = 'Polished in English. Speak any language.';

/** The picker's "detect it for me" value (stored in localStorage as-is). */
export const AUTO_PICK = 'auto';

// Common speech-recognition languages offered in the picker. NOT a whitelist:
// detection and Gemini handle any language; findLanguage() synthesizes a row
// for a code that isn't listed here (Intl.DisplayNames gives the names).
export const LANGUAGES: readonly Language[] = [
  { code: 'en', label: 'English', englishName: 'English', speechLang: 'en-US' },
  { code: 'hi', label: 'हिन्दी (Hindi)', englishName: 'Hindi', speechLang: 'hi-IN' },
  { code: 'kn', label: 'ಕನ್ನಡ (Kannada)', englishName: 'Kannada', speechLang: 'kn-IN' },
  { code: 'ta', label: 'தமிழ் (Tamil)', englishName: 'Tamil', speechLang: 'ta-IN' },
  { code: 'te', label: 'తెలుగు (Telugu)', englishName: 'Telugu', speechLang: 'te-IN' },
  { code: 'ml', label: 'മലയാളം (Malayalam)', englishName: 'Malayalam', speechLang: 'ml-IN' },
  { code: 'mr', label: 'मराठी (Marathi)', englishName: 'Marathi', speechLang: 'mr-IN' },
  { code: 'bn', label: 'বাংলা (Bengali)', englishName: 'Bengali', speechLang: 'bn-IN' },
  { code: 'gu', label: 'ગુજરાતી (Gujarati)', englishName: 'Gujarati', speechLang: 'gu-IN' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ (Punjabi)', englishName: 'Punjabi', speechLang: 'pa-IN' },
  { code: 'ur', label: 'اردو (Urdu)', englishName: 'Urdu', speechLang: 'ur-PK' },
  { code: 'es', label: 'Español (Spanish)', englishName: 'Spanish', speechLang: 'es-ES' },
  { code: 'fr', label: 'Français (French)', englishName: 'French', speechLang: 'fr-FR' },
  { code: 'de', label: 'Deutsch (German)', englishName: 'German', speechLang: 'de-DE' },
  { code: 'pt', label: 'Português (Portuguese)', englishName: 'Portuguese', speechLang: 'pt-BR' },
  { code: 'it', label: 'Italiano (Italian)', englishName: 'Italian', speechLang: 'it-IT' },
  { code: 'ar', label: 'العربية (Arabic)', englishName: 'Arabic', speechLang: 'ar-SA' },
  { code: 'ru', label: 'Русский (Russian)', englishName: 'Russian', speechLang: 'ru-RU' },
  { code: 'tr', label: 'Türkçe (Turkish)', englishName: 'Turkish', speechLang: 'tr-TR' },
  { code: 'id', label: 'Bahasa Indonesia (Indonesian)', englishName: 'Indonesian', speechLang: 'id-ID' },
  { code: 'vi', label: 'Tiếng Việt (Vietnamese)', englishName: 'Vietnamese', speechLang: 'vi-VN' },
  { code: 'th', label: 'ไทย (Thai)', englishName: 'Thai', speechLang: 'th-TH' },
  { code: 'zh', label: '中文 (Chinese)', englishName: 'Chinese', speechLang: 'zh-CN' },
  { code: 'ja', label: '日本語 (Japanese)', englishName: 'Japanese', speechLang: 'ja-JP' },
  { code: 'ko', label: '한국어 (Korean)', englishName: 'Korean', speechLang: 'ko-KR' },
  { code: 'sw', label: 'Kiswahili (Swahili)', englishName: 'Swahili', speechLang: 'sw-KE' },
];

export const DEFAULT_LANGUAGE: Language = LANGUAGES[0];

/** "kn-IN" / "KN" / "zh_Hans" → "kn" / "kn" / "zh"; junk → null. */
export function baseCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const base = code.trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(base) && base !== 'und' ? base : null;
}

function displayName(code: string, inLocale: string): string | undefined {
  try {
    return new Intl.DisplayNames([inLocale], { type: 'language', fallback: 'none' }).of(code) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Look a language up by code. Listed rows win; any other real BCP-47 language
 * gets a synthesized row (names from Intl.DisplayNames), so a detected language
 * we never listed — Swahili, Tagalog, Odia — still gets a badge, a caption and a
 * recognition tag. Unknown/invalid codes return undefined.
 */
export function findLanguage(code: string | null | undefined): Language | undefined {
  const base = baseCode(code);
  if (!base) return undefined;
  const listed = LANGUAGES.find((l) => l.code === base);
  if (listed) return listed;
  const englishName = displayName(base, 'en');
  if (!englishName) return undefined;
  const native = displayName(base, base);
  const label = native && native !== englishName ? `${native} (${englishName})` : englishName;
  // Keep a region the caller gave us ("sw-TZ"); otherwise the bare code.
  const full = code!.trim().replace('_', '-');
  return { code: base, label, englishName, speechLang: full.toLowerCase().startsWith(`${base}-`) ? full : base };
}

/** Resolve a stored/queried code to a real language, falling back to English. */
export function resolveLanguage(code: string | null | undefined): Language {
  return findLanguage(code) ?? DEFAULT_LANGUAGE;
}

export function isEnglish(lang: Language): boolean {
  return lang.code === POLISHED_CODE;
}

/** The picker value: 'auto' or a language code. Anything unknown → 'auto'
 *  (the default — new users are detected, not forced into English). */
export function resolvePick(stored: string | null | undefined): string {
  if (stored === AUTO_PICK || stored == null || stored === '') return AUTO_PICK;
  return findLanguage(stored)?.code ?? AUTO_PICK;
}

/**
 * Which language should speech RECOGNITION listen in? Web Speech needs a tag up
 * front (it cannot auto-detect), so "Auto" listens in the last language we
 * detected, else the browser's own language, else English. A picked language is
 * used as-is.
 */
export function recognitionLanguage(
  pick: string,
  lastDetected: Language | null,
  browserLang: string | null | undefined,
): Language {
  if (pick !== AUTO_PICK) return resolveLanguage(pick);
  return lastDetected ?? findLanguage(browserLang) ?? DEFAULT_LANGUAGE;
}

/** Picker label for "Auto", showing what it is listening in right now. */
export function autoLabel(listening: Language): string {
  return `Auto (${listening.englishName})`;
}

// ---------------------------------------------------------------------------
// Routing.

export interface LanguageEnv {
  /** Gemini Nano is ready in this browser (any language). */
  deviceReady: boolean;
  /** Firebase AI Logic is configured and App Check passed. */
  cloudReady: boolean;
  /** Nano reports it can run THIS language on-device (availability check). */
  deviceLangReady: boolean;
}

/** A non-English transcript needs translation before it can become an op. */
export function shouldTranslate(lang: Language): boolean {
  return !isEnglish(lang);
}

/**
 * Should this (non-English) transcript be translated in the CLOUD rather than
 * on-device? Yes unless Nano is both ready AND reports support for the
 * language — then we try it on-device first (requirement: Nano first when it
 * supports the language, cloud otherwise). English never translates.
 */
export function translateInCloud(lang: Language, env: LanguageEnv): boolean {
  if (!shouldTranslate(lang)) return false;
  return !(env.deviceReady && env.deviceLangReady);
}

/**
 * The router's reason for a non-English command, in plain words, shown in the
 * badge tooltip and the Routing panel ("Hindi: Nano can't run it here → cloud").
 * English returns null (the normal router reason already says it all).
 */
export function langRouteNote(
  lang: Language,
  env: LanguageEnv,
  source: Source,
  escalated: boolean,
): string | null {
  if (isEnglish(lang)) return null;
  const n = lang.englishName;
  if (source === 'rules') {
    return env.cloudReady || env.deviceReady
      ? `${n}: AI could not answer → offline phrases`
      : `${n}: no AI here → offline phrases`;
  }
  if (source === 'on-device') return `${n}: Nano runs ${n} on this device`;
  if (escalated) return `${n}: Nano was unsure → cloud`;
  if (env.deviceReady && env.deviceLangReady) return `${n}: Nano failed → cloud`;
  if (env.deviceReady) return `${n}: Nano can't run ${n} here → cloud`;
  return `${n}: no on-device AI here → cloud`;
}

// ---------------------------------------------------------------------------
// Badge. For a translated command the reason text is the language name, so the
// honest source badge reads "Gemini · cloud · Kannada" / "Gemini Nano · on device · Kannada". A command
// that fell to the deterministic rules floor was NOT translated, so it keeps the
// normal reason (e.g. "Rules · fallback") — never a misleading language label.

export function languageBadgeLabel(
  source: Source,
  reason: RouteReason,
  lang: Language,
  translated: boolean,
  kind: OnDeviceKind = 'nano',
): string {
  if (reason === 'handed-off') {
    if (translated && shouldTranslate(lang) && source !== 'rules') {
      return `${kind === 'apple' ? 'Apple' : 'Nano'} → Gemini · ${lang.englishName}`;
    }
    return badgeLabel(source, reason, kind);
  }
  if (translated && shouldTranslate(lang) && source !== 'rules') {
    return `${sourceText(source, kind)} · ${lang.englishName}`;
  }
  return badgeLabel(source, reason, kind);
}

// ---------------------------------------------------------------------------
// Live caption pairing: her words beside the English translation.

export interface Caption {
  /** What she said, in her language (or typed command). */
  heard: string;
  /** The English translation, or null when there is nothing to pair. */
  translation: string | null;
  lang: Language;
}

/**
 * Pair the heard transcript with its English translation for the caption bar.
 * The translation is dropped (null) when the language is English, when no
 * translation came back, or when it is identical to the heard text (nothing to
 * show) — so the caption never shows a redundant or empty second line.
 */
export function buildCaption(
  heard: string,
  translation: string | null | undefined,
  lang: Language,
): Caption {
  const h = heard.trim();
  const t = (typeof translation === 'string' ? translation : '').trim();
  const show = !isEnglish(lang) && t !== '' && t.toLowerCase() !== h.toLowerCase();
  return { heard: h, translation: show ? t : null, lang };
}

// ---------------------------------------------------------------------------
// Fixed confirmations. English is the polished set. The Kannada column is kept
// ONLY as an offline fallback (no model reachable, but the browser has a
// Kannada voice); every other language falls back to English. This is not a
// "Kannada mode" — new languages get the model's own short reply instead.

export type PhraseKey =
  | 'listening'
  | 'micOff'
  | 'view3d'
  | 'view2d'
  | 'done'
  | 'couldNotBuild'
  | 'languageSet';

const PHRASES: Record<PhraseKey, Record<string, string>> = {
  listening: { en: 'Listening.', kn: 'ಕೇಳುತ್ತಿದ್ದೇನೆ.' },
  micOff: { en: 'Mic off.', kn: 'ಮೈಕ್ ಆಫ್ ಆಗಿದೆ.' },
  view3d: { en: '3D view.', kn: 'ತ್ರಿಡಿ ನೋಟ.' },
  view2d: { en: '2D view.', kn: 'ಎರಡು ಆಯಾಮದ ನೋಟ.' },
  done: { en: 'Done.', kn: 'ಆಯಿತು.' },
  couldNotBuild: { en: 'Could not build that.', kn: 'ಅದನ್ನು ರಚಿಸಲಾಗಲಿಲ್ಲ.' },
  languageSet: { en: 'Language set to English.', kn: 'ಭಾಷೆ ಕನ್ನಡಕ್ಕೆ ಹೊಂದಿಸಲಾಗಿದೆ.' },
};

export function localize(key: PhraseKey, lang: Language): string {
  const row = PHRASES[key];
  return row[lang.code] ?? row.en;
}

// ---------------------------------------------------------------------------
// Spoken op confirmations. After a voice command lands an op we speak a SHORT
// confirmation: English from this fixed table, another language from the
// model's own ≤4-word reply (pickReply), Kannada offline from the fallback
// column. The on-screen verifier always keeps the detailed English message.

export type ConfirmKey =
  | 'moved' | 'deleted' | 'rotated' | 'resized' | 'added'
  | 'duplicated' | 'undone' | 'redone' | 'renamed' | 'styled' | 'done';

/** Common editor ops → a confirmation phrase key. Mode-agnostic: plan, ui and
 *  part ops share these verbs. Anything not listed speaks the generic "Done." */
const OP_CONFIRM: Record<string, ConfirmKey> = {
  move: 'moved', move_many: 'moved', move_end: 'moved', move_opening: 'moved', set_pos: 'moved', align: 'moved',
  delete: 'deleted',
  rotate: 'rotated', mirror: 'rotated',
  scale: 'resized', offset: 'resized', set_size: 'resized', set_sizing: 'resized',
  set_width: 'resized', set_length: 'resized', set_height: 'resized', set_thickness: 'resized', set_sill: 'resized',
  add: 'added', add_wall: 'added', add_door: 'added', add_window: 'added', add_room: 'added',
  add_text: 'added', add_fixture: 'added', add_opening: 'added', add_frame: 'added',
  add_node: 'added', add_dim: 'added', hole: 'added', wrap: 'added',
  duplicate: 'duplicated', array: 'duplicated',
  undo: 'undone', redo: 'redone',
  rename: 'renamed', set_text: 'renamed',
  set_fill: 'styled', set_font: 'styled', set_style: 'styled', set_swing: 'styled', set_layout: 'styled',
};

const CONFIRM_PHRASES: Record<ConfirmKey, Record<string, string>> = {
  moved: { en: 'Moved.', kn: 'ಸರಿಸಲಾಗಿದೆ.' },
  deleted: { en: 'Deleted.', kn: 'ಅಳಿಸಲಾಗಿದೆ.' },
  rotated: { en: 'Rotated.', kn: 'ತಿರುಗಿಸಲಾಗಿದೆ.' },
  resized: { en: 'Resized.', kn: 'ಗಾತ್ರ ಬದಲಾಯಿಸಲಾಗಿದೆ.' },
  added: { en: 'Added.', kn: 'ಸೇರಿಸಲಾಗಿದೆ.' },
  duplicated: { en: 'Duplicated.', kn: 'ನಕಲು ಮಾಡಲಾಗಿದೆ.' },
  undone: { en: 'Undone.', kn: 'ರದ್ದುಗೊಳಿಸಲಾಗಿದೆ.' },
  redone: { en: 'Redone.', kn: 'ಮತ್ತೆ ಮಾಡಲಾಗಿದೆ.' },
  renamed: { en: 'Renamed.', kn: 'ಹೆಸರು ಬದಲಾಯಿಸಲಾಗಿದೆ.' },
  styled: { en: 'Updated.', kn: 'ನವೀಕರಿಸಲಾಗಿದೆ.' },
  done: { en: 'Done.', kn: 'ಆಯಿತು.' },
};

/** Map an applied op's name to its confirmation key (generic 'done' fallback). */
export function opConfirmKey(opName: string | null | undefined): ConfirmKey {
  if (!opName) return 'done';
  return OP_CONFIRM[opName] ?? 'done';
}

/** The short spoken confirmation for an applied op, in the active language. */
export function confirmPhrase(opName: string | null | undefined, lang: Language): string {
  const row = CONFIRM_PHRASES[opConfirmKey(opName)];
  return row[lang.code] ?? row.en;
}

// ---------------------------------------------------------------------------
// Spoken replies. speechSynthesis only (no cloud voice): the reply is spoken in
// her language when the browser has a voice for it AND we have text in that
// language (the model's short reply, or the offline Kannada fallback);
// otherwise the English confirmation is spoken in English. Muting silences all.

export type SpeechRoute = 'lang' | 'english' | 'silent';

export interface SpeechEnv {
  /** speechSynthesis has a usable voice for this language. */
  synthHasVoice: boolean;
}

/** Where a reply is spoken: in her language, in English, or not at all. */
export function pickSpeechRoute(lang: Language, env: SpeechEnv, muted: boolean): SpeechRoute {
  if (muted) return 'silent';
  if (isEnglish(lang)) return 'english';
  return env.synthHasVoice ? 'lang' : 'english';
}

export interface Reply {
  /** What to say. */
  text: string;
  /** The language it is in (drives utterance.lang and the voice). */
  lang: Language;
}

/**
 * The spoken confirmation for an applied op. English → the fixed English verb.
 * Another language with a browser voice → the model's short reply in that
 * language, else the offline fixed phrase if one exists (Kannada only). No
 * voice, or no text in that language → the English verb, spoken in English.
 */
export function pickReply(
  opName: string | null | undefined,
  lang: Language,
  modelReply: string | null | undefined,
  synthHasVoice: boolean,
): Reply {
  const english: Reply = { text: confirmPhrase(opName, DEFAULT_LANGUAGE), lang: DEFAULT_LANGUAGE };
  if (isEnglish(lang) || !synthHasVoice) return english;
  const fromModel = typeof modelReply === 'string' ? modelReply.trim() : '';
  if (fromModel) return { text: fromModel, lang };
  const row = CONFIRM_PHRASES[opConfirmKey(opName)];
  return row[lang.code] ? { text: row[lang.code], lang } : english;
}

// ---------------------------------------------------------------------------
// Voice selection for speechSynthesis. Pure over a plain voice list so it is
// testable without the browser. Prefer an exact BCP-47 match (hi-IN), then any
// voice for the base language (hi-*), else none → the caller speaks English.

export interface VoiceLike {
  lang: string;
  name?: string;
}

export function pickVoice<T extends VoiceLike>(voices: readonly T[], lang: Language): T | null {
  const want = lang.speechLang.toLowerCase();
  const base = lang.code.toLowerCase();
  const norm = (v: T) => (v.lang ?? '').toLowerCase().replace('_', '-');
  return (
    voices.find((v) => norm(v) === want) ??
    voices.find((v) => norm(v) === base || norm(v).startsWith(`${base}-`)) ??
    null
  );
}
