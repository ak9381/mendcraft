// SPOKEN LANGUAGE SUPPORT — the pure language layer for the demo user who
// speaks Kannada (Akash's mom). It decides, labels, localizes, and pairs
// captions; it never calls a model, Firebase, speech API, or the DOM, so every
// branch is unit-tested without a network.
//
// Routing contract (wired in main.ts / ai/hybrid.fuseIntent):
//   • English  → the normal hybrid router (rules → on-device → cloud).
//   • non-English → if Nano reports it can run this language on-device, try it
//     there first; otherwise send the transcript to the cloud through Firebase
//     AI Logic, which TRANSLATES and emits the same typed op in ONE call. The
//     badge then reads "Cloud · Kannada" so the source stays honest.
//
// No Chrome Translator API, no other AI API: the translation happens inside the
// one Firebase AI Logic fusion call that already produces the op.

import { SOURCE_TEXT, badgeLabel, type RouteReason } from './router';
import type { Source } from './hybrid';

export interface Language {
  /** BCP-47 primary subtag — also the tag we ask Nano about (expectedInputs). */
  code: string;
  /** Native label for the picker: "English", "ಕನ್ನಡ". */
  label: string;
  /** English name, shown on the badge ("Cloud · Kannada"). */
  englishName: string;
  /** Full BCP-47 tag for Web Speech recognition + speechSynthesis. */
  speechLang: string;
}

// Add a language by appending one row — the picker, speech lang, routing, badge
// and captions all read from here. Kannada is the demo language; English is the
// deterministic default the rule parser and on-device Nano already speak.
export const LANGUAGES: readonly Language[] = [
  { code: 'en', label: 'English', englishName: 'English', speechLang: 'en-US' },
  { code: 'kn', label: 'ಕನ್ನಡ (Kannada)', englishName: 'Kannada', speechLang: 'kn-IN' },
];

export const DEFAULT_LANGUAGE: Language = LANGUAGES[0];

export function findLanguage(code: string | null | undefined): Language | undefined {
  if (!code) return undefined;
  return LANGUAGES.find((l) => l.code === code);
}

/** Resolve a stored/queried code to a real language, falling back to English. */
export function resolveLanguage(code: string | null | undefined): Language {
  return findLanguage(code) ?? DEFAULT_LANGUAGE;
}

export function isEnglish(lang: Language): boolean {
  return lang.code === 'en';
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

// ---------------------------------------------------------------------------
// Badge. For a translated command the reason text is the language name, so the
// honest source badge reads "Cloud · Kannada" / "On-device · Kannada". A command
// that fell to the deterministic rules floor was NOT translated, so it keeps the
// normal reason (e.g. "Rules · fallback") — never a misleading language label.

export function languageBadgeLabel(
  source: Source,
  reason: RouteReason,
  lang: Language,
  translated: boolean,
): string {
  if (translated && shouldTranslate(lang) && source !== 'rules') {
    return `${SOURCE_TEXT[source]} · ${lang.englishName}`;
  }
  return badgeLabel(source, reason);
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
// Localized confirmations. Only the fixed UI confirmations live here (chrome,
// not AI output); dynamic model/rule text is spoken as-is. Missing a phrase for
// a language falls back to English so a new language is never a blank reply.

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
// Voice selection for speechSynthesis. Pure over a plain voice list so it is
// testable without the browser. Prefer an exact BCP-47 match (kn-IN), then any
// voice for the base language (kn-*), else none → the caller stays text-only.

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
