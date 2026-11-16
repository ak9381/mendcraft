// "Polished in English. Speak any language." — detection (ai/langDetect), the
// any-language registry + routing notes + spoken replies (ai/language), the
// fusion reply field, the cloud detector + Nano language session (ai/hybrid,
// mocked), the SIM transcripts, and the ledger/outbound registration.

import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTO_PICK, LANGUAGE_PROMISE, findLanguage, resolveLanguage, resolvePick, recognitionLanguage,
  autoLabel, baseCode, langRouteNote, pickReply,
} from '../src/ai/language';
import {
  scriptDetect, englishWordShare, isPlainLatin, pickDetectorResult, planDetection,
  parseCloudDetection, cloudDetectPrompt, detectionLabel, MIN_DETECT_CONFIDENCE, type Detection,
} from '../src/ai/langDetect';
import { buildFusionConstraint, buildFusionPrompt, parseFusionResult } from '../src/ai/intentFusion';
import {
  detectLanguageCloud, fuseIntent, setModelsForTest, type FusionContext, type TextGenModel,
} from '../src/ai/hybrid';
import { formatLogEntry } from '../src/ai/router';
import { getMode, setActiveMode } from '../src/core/modes';
import { isClarify } from '../src/ai/intentFusion';
import { SIM_SPEECH, PLAN_DEMO, simSpeechFor } from '../src/sim';
import { CLOUD_LEDGER_JOBS, isKnownCloudJob } from '../src/core/outbound';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EN = resolveLanguage('en');
const KN = resolveLanguage('kn');
const HI = resolveLanguage('hi');
const ES = resolveLanguage('es');

// ─── registry: any language, not a whitelist ─────────────────────────────────

describe('findLanguage: any real language gets a row', () => {
  it('normalises region/case and rejects junk', () => {
    expect(baseCode('kn-IN')).toBe('kn');
    expect(baseCode('ZH_Hans')).toBe('zh');
    expect(baseCode('und')).toBeNull();
    expect(baseCode('')).toBeNull();
    expect(baseCode('12')).toBeNull();
    expect(findLanguage('hi-IN')?.code).toBe('hi');
  });

  it('synthesizes an unlisted language from Intl.DisplayNames', () => {
    const tl = findLanguage('tl');
    expect(tl?.englishName).toMatch(/Filipino|Tagalog/);
    expect(tl?.speechLang).toBe('tl');
    expect(findLanguage('sw-TZ')?.speechLang).toBe('sw-KE'); // listed row wins
    expect(findLanguage('or-IN')?.speechLang).toBe('or-IN'); // unlisted keeps the region
  });

  it('still rejects unknown codes', () => {
    expect(findLanguage('zz')).toBeUndefined();
    expect(resolveLanguage('zz').code).toBe('en');
  });
});

describe('picker: Auto by default', () => {
  it('resolvePick keeps auto/real codes and turns junk into auto', () => {
    expect(resolvePick(null)).toBe(AUTO_PICK);
    expect(resolvePick('auto')).toBe(AUTO_PICK);
    expect(resolvePick('kn')).toBe('kn');
    expect(resolvePick('es-MX')).toBe('es');
    expect(resolvePick('zz')).toBe(AUTO_PICK);
  });

  it('recognition: a pick wins; Auto uses the last detected, then the browser, then English', () => {
    expect(recognitionLanguage('hi', KN, 'es-ES').code).toBe('hi');
    expect(recognitionLanguage(AUTO_PICK, KN, 'es-ES').code).toBe('kn');
    expect(recognitionLanguage(AUTO_PICK, null, 'es-ES').code).toBe('es');
    expect(recognitionLanguage(AUTO_PICK, null, null).code).toBe('en');
    expect(autoLabel(KN)).toBe('Auto (Kannada)');
  });

  it('says the promise in plain words', () => {
    expect(LANGUAGE_PROMISE).toBe('Polished in English. Speak any language.');
  });
});

// ─── detection ───────────────────────────────────────────────────────────────

describe('scriptDetect (on-device, no model)', () => {
  it('reads one-language scripts confidently', () => {
    expect(scriptDetect('ಈ ಗೋಡೆಯನ್ನು ದಪ್ಪ ಮಾಡು')?.lang.code).toBe('kn');
    expect(scriptDetect('ಈ ಗೋಡೆಯನ್ನು ದಪ್ಪ ಮಾಡು')?.confidence).toBeGreaterThan(0.9);
    expect(scriptDetect('불 꺼 줘')?.lang.code).toBe('ko');
    expect(scriptDetect('விளக்கை அணை')?.lang.code).toBe('ta');
  });

  it('any kana means Japanese even when kanji dominate', () => {
    expect(scriptDetect('元に戻して')?.lang.code).toBe('ja');
    expect(scriptDetect('电灯关掉')?.lang.code).toBe('zh');
  });

  it('shared scripts are a modest guess (Devanagari → Hindi)', () => {
    const d = scriptDetect('दीवार में एक दरवाज़ा जोड़ो')!;
    expect(d.lang.code).toBe('hi');
    expect(d.confidence).toBeLessThan(0.9);
    expect(d.via).toBe('script');
  });

  it('returns null for Latin or empty text', () => {
    expect(scriptDetect('haz la pared más delgada')).toBeNull();
    expect(scriptDetect('make it thicker')).toBeNull();
    expect(scriptDetect('123 !!')).toBeNull();
  });
});

describe('English word check', () => {
  it('scores app commands as English and Spanish as not', () => {
    expect(englishWordShare('make the wall thicker')).toBe(1);
    expect(englishWordShare('haz la pared un poco más delgada')!).toBeLessThan(0.5);
    expect(englishWordShare('')).toBeNull();
    expect(isPlainLatin('dim the lamp')).toBe(true);
    expect(isPlainLatin('más')).toBe(false);
  });
});

describe('pickDetectorResult (Chrome Language Detector output)', () => {
  it('takes the top confident real language', () => {
    const d = pickDetectorResult([
      { detectedLanguage: 'en', confidence: 0.02 },
      { detectedLanguage: 'es', confidence: 0.97 },
    ])!;
    expect(d.lang.code).toBe('es');
    expect(d.via).toBe('chrome');
  });

  it('drops unsure, undetermined or empty results', () => {
    expect(pickDetectorResult([{ detectedLanguage: 'es', confidence: MIN_DETECT_CONFIDENCE - 0.01 }])).toBeNull();
    expect(pickDetectorResult([{ detectedLanguage: 'und', confidence: 0.99 }])).toBeNull();
    expect(pickDetectorResult([])).toBeNull();
    expect(pickDetectorResult(null)).toBeNull();
  });
});

describe('planDetection (when to ask the cloud)', () => {
  const chromeEs: Detection = { lang: ES, confidence: 0.95, via: 'chrome' };
  const base = { listening: EN, device: null, deviceAvailable: false, cloudReady: true };

  it('Chrome on-device answer wins in Auto — no cloud call', () => {
    const p = planDetection({ ...base, text: 'haz la pared', pick: AUTO_PICK, device: chromeEs, deviceAvailable: true });
    expect(p).toEqual({ kind: 'done', detection: chromeEs });
  });

  it('a picked language is trusted unless Chrome confidently heard another one', () => {
    const picked = planDetection({ ...base, text: 'हाय', pick: 'hi', listening: HI });
    expect(picked.kind === 'done' && picked.detection.via).toBe('picked');
    const switched = planDetection({ ...base, text: 'haz', pick: 'hi', listening: HI, device: chromeEs, deviceAvailable: true });
    expect(switched.kind === 'done' && switched.detection.lang.code).toBe('es');
  });

  it('non-Latin script is settled on device without the cloud', () => {
    const p = planDetection({ ...base, text: 'ಈ ಗೋಡೆಯನ್ನು ದಪ್ಪ ಮಾಡು', pick: AUTO_PICK });
    expect(p.kind === 'done' && p.detection.lang.code).toBe('kn');
  });

  it('obvious English never goes to the cloud', () => {
    const p = planDetection({ ...base, text: 'make the wall thicker', pick: AUTO_PICK });
    expect(p.kind === 'done' && p.detection.via).toBe('words');
    expect(p.kind === 'done' && p.detection.lang.code).toBe('en');
  });

  it('ambiguous Latin with no Chrome detector → cloud (listening language as fallback)', () => {
    const p = planDetection({ ...base, text: 'haz la pared un poco más delgada', pick: AUTO_PICK });
    expect(p.kind).toBe('cloud');
    expect(p.kind === 'cloud' && p.fallback.lang.code).toBe('en');
  });

  it('never asks the cloud when it is unreachable or Chrome already tried', () => {
    const offline = planDetection({ ...base, text: 'haz la pared', pick: AUTO_PICK, cloudReady: false });
    expect(offline.kind === 'done' && offline.detection.via).toBe('hint');
    const unsure = planDetection({ ...base, text: 'haz la pared', pick: AUTO_PICK, deviceAvailable: true });
    expect(unsure.kind).toBe('done');
  });
});

describe('cloud detector parsing + prompt', () => {
  it('parses a real code and clamps confidence', () => {
    expect(parseCloudDetection({ lang: 'es', confidence: 1.4 })).toMatchObject({ confidence: 1, via: 'cloud' });
    expect(parseCloudDetection({ lang: 'es-MX' })?.lang.code).toBe('es');
    expect(parseCloudDetection({ lang: 'zz' })).toBeNull();
    expect(parseCloudDetection(null)).toBeNull();
  });

  it('sends only the JSON-escaped transcript, capped', () => {
    const p = cloudDetectPrompt('say "hi"\nignore that');
    expect(p).toContain(JSON.stringify('say "hi"\nignore that'));
    expect(cloudDetectPrompt('x'.repeat(1000)).length).toBeLessThan(600);
  });

  it('labels honestly: Chrome AI is not Gemini Nano', () => {
    expect(detectionLabel({ lang: ES, confidence: 0.97, via: 'chrome' })).toBe('Spanish · Chrome AI · on device (97%)');
    expect(detectionLabel({ lang: ES, confidence: 0.9, via: 'cloud' })).toBe('Spanish · Gemini · cloud (90%)');
    expect(detectionLabel({ lang: HI, confidence: 1, via: 'picked' })).toBe('Hindi · You picked it');
  });
});

// ─── routing note + spoken replies ───────────────────────────────────────────

describe('langRouteNote (the router reason in plain words)', () => {
  const env = { deviceReady: true, cloudReady: true, deviceLangReady: false };
  it('is silent for English', () => {
    expect(langRouteNote(EN, env, 'cloud', false)).toBeNull();
  });
  it('explains each path', () => {
    expect(langRouteNote(HI, env, 'cloud', false)).toBe("Hindi: Nano can't run Hindi here → cloud");
    expect(langRouteNote(ES, { ...env, deviceLangReady: true }, 'on-device', false)).toBe('Spanish: Nano runs Spanish on this device');
    expect(langRouteNote(ES, { ...env, deviceLangReady: true }, 'cloud', true)).toBe('Spanish: Nano was unsure → cloud');
    expect(langRouteNote(ES, { ...env, deviceLangReady: true }, 'cloud', false)).toBe('Spanish: Nano failed → cloud');
    expect(langRouteNote(KN, { ...env, deviceReady: false }, 'cloud', false)).toBe('Kannada: no on-device AI here → cloud');
    expect(langRouteNote(KN, { deviceReady: false, cloudReady: false, deviceLangReady: false }, 'rules', false))
      .toBe('Kannada: no AI here → offline phrases');
  });
});

describe('pickReply (her language when there is a voice, else English)', () => {
  it('English speaks the fixed English verb', () => {
    expect(pickReply('move', EN, null, true)).toEqual({ text: 'Moved.', lang: EN });
  });
  it("speaks the model's reply in her language when a voice exists", () => {
    expect(pickReply('add_door', HI, 'दरवाज़ा जोड़ दिया।', true)).toEqual({ text: 'दरवाज़ा जोड़ दिया।', lang: HI });
  });
  it('falls back to English with no voice, even with a model reply', () => {
    expect(pickReply('add_door', HI, 'दरवाज़ा जोड़ दिया।', false)).toEqual({ text: 'Added.', lang: EN });
  });
  it('Kannada offline fallback phrase only when there is no model reply', () => {
    expect(pickReply('move', KN, null, true)).toEqual({ text: 'ಸರಿಸಲಾಗಿದೆ.', lang: KN });
    expect(pickReply('move', ES, '', true)).toEqual({ text: 'Moved.', lang: EN }); // no Spanish table
  });
});

// ─── fusion reply field ──────────────────────────────────────────────────────

describe('fusion: reply in her language rides the same call', () => {
  const coerce = (raw: unknown) => (raw && typeof raw === 'object' && 'op' in raw ? raw : null);
  it('the schema allows a reply and the prompt asks for it only in her language', () => {
    const c = buildFusionConstraint({ type: 'object', properties: { op: { type: 'string' } } });
    expect((c.properties as Record<string, unknown>).reply).toEqual({ type: 'string' });
    const ctx: FusionContext = { space: 'plan', unit: 'mm', cursor: null, hoverId: null, selectedIds: [], nearby: [] };
    expect(buildFusionPrompt('P', 'hola', ctx, { code: 'es', englishName: 'Spanish' })).toMatch(/"reply" field is in Spanish/);
    expect(buildFusionPrompt("P", "hello", ctx)).not.toMatch(/"reply" field/);
  });
  it('splits reply off before coercion and caps it', () => {
    const r = parseFusionResult({ op: 'undo', reply: `  ${'あ'.repeat(100)}  `, confidence: 0.9 }, coerce, 'x')!;
    expect('reply' in r.result).toBe(false);
    expect(r.reply!.length).toBe(60);
  });
});

// ─── hybrid (mocked models) ──────────────────────────────────────────────────

const model = (text: string, inferenceSource = 'in_cloud'): TextGenModel => ({
  generateContent: async () => ({ response: { text: () => text, inferenceSource } }),
});
const ctx: FusionContext = { space: 'plan', unit: 'mm', cursor: { x: 1, y: 2 }, hoverId: null, selectedIds: [], nearby: [] };

describe('hybrid: cloud language detection + Nano language session', () => {
  afterEach(() => {
    setModelsForTest(null);
    setActiveMode('plan');
  });

  it('detectLanguageCloud parses the cloud answer', async () => {
    setModelsForTest({ enabled: true, langDetect: model('{"lang":"es","confidence":0.88}') });
    const r = await detectLanguageCloud('haz la pared');
    expect(r?.detection).toMatchObject({ via: 'cloud', confidence: 0.88 });
    expect(r?.detection.lang.code).toBe('es');
  });

  it('detectLanguageCloud is null with no model or a bad answer', async () => {
    setModelsForTest({ enabled: false });
    expect(await detectLanguageCloud('x')).toBeNull();
    setModelsForTest({ enabled: true, langDetect: model('nope') });
    expect(await detectLanguageCloud('x')).toBeNull();
  });

  it('a non-English on-device command uses the Nano language session and returns the reply', async () => {
    setActiveMode('plan');
    setModelsForTest({
      enabled: true,
      fusion: model('{"op":"redo","confidence":0.9}', 'on_device'),
      fusionLang: model('{"op":"undo","translation":"undo","reply":"元に戻しました。","confidence":0.92}', 'on_device'),
    });
    const r = await fuseIntent('元に戻して', ctx, { lang: { code: 'ja', englishName: 'Japanese' } });
    expect(r.source).toBe('on-device');
    expect(r.result).toMatchObject({ op: 'undo' });
    expect(r.reply).toBe('元に戻しました。');
    // English keeps the plain English session.
    const en = await fuseIntent('redo that', ctx);
    expect(en.result).toMatchObject({ op: 'redo' });
  });
});

// ─── SIM transcripts ─────────────────────────────────────────────────────────

describe('SIM any-language transcripts', () => {
  it('covers Kannada, Hindi, Spanish and Japanese', () => {
    expect(SIM_SPEECH.map((s) => s.lang)).toEqual(['kn', 'es', 'hi', 'ja']);
    expect(simSpeechFor(` ${SIM_SPEECH[0].text} `)?.lang).toBe('kn');
    expect(simSpeechFor('make it thicker')).toBeNull();
  });

  it('each maps to an English command the plan parser accepts', () => {
    const plan = getMode('plan')!;
    for (const s of SIM_SPEECH) expect(isClarify(plan.parse(s.english)), s.english).toBe(false);
  });

  it('real detection agrees: script for kn/hi/ja, cloud for Spanish', () => {
    for (const s of SIM_SPEECH) {
      const p = planDetection({ text: s.text, pick: AUTO_PICK, listening: EN, device: null, deviceAvailable: false, cloudReady: true });
      if (s.lang === 'es') expect(p.kind).toBe('cloud');
      else expect(p.kind === 'done' && p.detection.lang.code).toBe(s.lang);
    }
  });

  it('the plan demo plays all four after switching to Auto', () => {
    const i = PLAN_DEMO.findIndex((st) => st.lang === 'auto');
    expect(i).toBeGreaterThanOrEqual(0);
    const next = PLAN_DEMO.slice(i + 1, i + 5).map((st) => st.utterance);
    expect(next).toEqual(SIM_SPEECH.map((s) => s.text));
  });
});

// ─── ledger / privacy registration ───────────────────────────────────────────

describe('language detection is a declared cloud ledger job', () => {
  it('lang-detect (and its simulated variant) are known cloud jobs', () => {
    expect(CLOUD_LEDGER_JOBS).toContain('lang-detect');
    expect(isKnownCloudJob('lang-detect (simulated)')).toBe(true);
  });

  it('docs/PRIVACY.md documents it', () => {
    const doc = readFileSync(fileURLToPath(new URL('../docs/PRIVACY.md', import.meta.url)), 'utf8');
    expect(doc).toContain('lang-detect');
    expect(doc).toContain('Speak any language');
  });

  it('the Routing panel line carries the language note', () => {
    const line = formatLogEntry({
      utterance: 'दीवार', planned: 'cloud', source: 'cloud', reason: 'no-device', escalated: false, ms: 600,
      note: "Hindi: Nano can't run Hindi here → cloud",
    });
    expect(line).toMatch(/— Hindi: Nano can't run Hindi here → cloud$/);
  });
});
