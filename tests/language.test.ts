// Spoken-language support: the pure language layer (src/ai/language.ts) — the
// picker registry, speech-recognition language, when a transcript must be
// translated in the cloud, the honest "Cloud · Kannada" badge, caption pairing,
// localized confirmations and voice selection — plus the single fusion call that
// translates AND emits a typed op (mocked models, no network).

import { afterEach, describe, expect, it } from 'vitest';
import {
  LANGUAGES,
  DEFAULT_LANGUAGE,
  findLanguage,
  resolveLanguage,
  isEnglish,
  shouldTranslate,
  translateInCloud,
  languageBadgeLabel,
  buildCaption,
  localize,
  pickVoice,
  type LanguageEnv,
} from '../src/ai/language';
import { fuseIntent, setModelsForTest, type FusionContext, type TextGenModel } from '../src/ai/hybrid';
import { setActiveMode } from '../src/core/modes';

const EN = resolveLanguage('en');
const KN = resolveLanguage('kn');

// ─── picker registry ─────────────────────────────────────────────────────────

describe('language picker registry', () => {
  it('ships English (default) and Kannada, and is easy to extend', () => {
    expect(DEFAULT_LANGUAGE.code).toBe('en');
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en', 'kn']);
    // Every row carries the pieces the picker / speech / badge need.
    for (const l of LANGUAGES) {
      expect(l.label).toBeTruthy();
      expect(l.englishName).toBeTruthy();
      expect(l.speechLang).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });

  it('looks languages up by code and falls back to English for unknown/empty', () => {
    expect(findLanguage('kn')?.englishName).toBe('Kannada');
    expect(findLanguage('zz')).toBeUndefined();
    expect(resolveLanguage('kn').code).toBe('kn');
    expect(resolveLanguage(null).code).toBe('en');
    expect(resolveLanguage('zz').code).toBe('en');
  });

  it('knows which language is English', () => {
    expect(isEnglish(EN)).toBe(true);
    expect(isEnglish(KN)).toBe(false);
  });
});

// ─── speech-recognition language ─────────────────────────────────────────────

describe('speech language', () => {
  it('uses kn-IN for Kannada and en-US for English', () => {
    expect(KN.speechLang).toBe('kn-IN');
    expect(EN.speechLang).toBe('en-US');
  });
});

// ─── when to escalate / translate ────────────────────────────────────────────

const env = (deviceReady: boolean, cloudReady: boolean, deviceLangReady: boolean): LanguageEnv =>
  ({ deviceReady, cloudReady, deviceLangReady });

describe('translation routing (when to escalate to the cloud)', () => {
  it('English never translates', () => {
    expect(shouldTranslate(EN)).toBe(false);
    expect(translateInCloud(EN, env(true, true, true))).toBe(false);
    expect(translateInCloud(EN, env(false, true, false))).toBe(false);
  });

  it('non-English needs translation', () => {
    expect(shouldTranslate(KN)).toBe(true);
  });

  it('non-English goes to the cloud when Nano cannot run the language', () => {
    expect(translateInCloud(KN, env(true, true, false))).toBe(true); // device up but no kn
    expect(translateInCloud(KN, env(false, true, false))).toBe(true); // no device at all
  });

  it('non-English tries on-device first when Nano reports it supports the language', () => {
    expect(translateInCloud(KN, env(true, true, true))).toBe(false);
  });
});

// ─── badge label ─────────────────────────────────────────────────────────────

describe('languageBadgeLabel (honest source · language)', () => {
  it('a translated non-English command shows "Cloud · Kannada"', () => {
    expect(languageBadgeLabel('cloud', 'no-device', KN, true)).toBe('Cloud · Kannada');
    expect(languageBadgeLabel('on-device', 'private', KN, true)).toBe('On-device · Kannada');
  });

  it('English keeps the normal source · reason label', () => {
    expect(languageBadgeLabel('cloud', 'big-job', EN, false)).toBe('Cloud · big job');
    expect(languageBadgeLabel('rules', 'exact', EN, false)).toBe('Rules · exact command');
  });

  it('a non-English command that fell to the rules floor is NOT labelled with the language', () => {
    // Translation never happened — the badge must stay honest, not claim Kannada.
    expect(languageBadgeLabel('rules', 'fallback', KN, true)).toBe('Rules · fallback');
  });
});

// ─── caption pairing ─────────────────────────────────────────────────────────

describe('buildCaption (her words + English translation)', () => {
  it('pairs a Kannada transcript with its English translation', () => {
    const cap = buildCaption('ಬಾಗಿಲು ಇಲ್ಲಿ ಹಾಕು', 'put a door here', KN);
    expect(cap.heard).toBe('ಬಾಗಿಲು ಇಲ್ಲಿ ಹಾಕು');
    expect(cap.translation).toBe('put a door here');
  });

  it('shows no translation line for English', () => {
    expect(buildCaption('move it left', 'move it left', EN).translation).toBeNull();
  });

  it('drops an empty or identical translation', () => {
    expect(buildCaption('ಬಾಗಿಲು', '', KN).translation).toBeNull();
    expect(buildCaption('ಬಾಗಿಲು', undefined, KN).translation).toBeNull();
    expect(buildCaption('door', 'door', KN).translation).toBeNull();
  });
});

// ─── localized confirmations + voice ─────────────────────────────────────────

describe('localized confirmations', () => {
  it('replies in the chosen language, falling back to English', () => {
    expect(localize('listening', EN)).toBe('Listening.');
    expect(localize('listening', KN)).not.toBe('Listening.');
    expect(localize('listening', KN).length).toBeGreaterThan(0);
  });
});

describe('pickVoice (kn-IN voice if one exists, else none)', () => {
  it('prefers an exact BCP-47 match, then the base language', () => {
    const voices = [{ lang: 'en-US', name: 'Alex' }, { lang: 'kn-IN', name: 'Kavya' }];
    expect(pickVoice(voices, KN)?.name).toBe('Kavya');
    expect(pickVoice([{ lang: 'kn', name: 'Base' }], KN)?.name).toBe('Base');
  });

  it('returns null when no voice matches (caller stays text-only)', () => {
    expect(pickVoice([{ lang: 'en-US', name: 'Alex' }], KN)).toBeNull();
    expect(pickVoice([], KN)).toBeNull();
  });
});

// ─── single translate-and-op fusion call (mocked models) ─────────────────────

const model = (text: string, inferenceSource?: string): TextGenModel => ({
  generateContent: async () => ({ response: { text: () => text, inferenceSource } }),
});

const ctx: FusionContext = {
  space: 'plan', unit: 'mm', cursor: { x: 100, y: 200 }, hoverId: null, selectedIds: [], nearby: [],
};

describe('fuseIntent with a language (cloud translate + op in one call)', () => {
  afterEach(() => {
    setModelsForTest(null);
    setActiveMode('plan');
  });

  it('cloud fusion returns the typed op AND the English translation', async () => {
    setActiveMode('plan');
    setModelsForTest({
      enabled: true,
      fusionCloud: model('{"op":"add_door","target":"w2","translation":"put a door here","confidence":0.9}'),
    });
    const r = await fuseIntent('ಬಾಗಿಲು ಇಲ್ಲಿ ಹಾಕು', ctx, { forceCloud: true, lang: KN });
    expect(r.source).toBe('cloud');
    expect(r.result).toMatchObject({ op: 'add_door', target: 'w2' });
    expect('translation' in r.result).toBe(false); // split off before coercion
    expect(r.translation).toBe('put a door here');
    expect(r.confidence).toBe(0.9);
  });
});
