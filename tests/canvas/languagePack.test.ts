import { describe, expect, it } from 'vitest';
import { EN_PACK, INTENT_KEYS, LANG_STRING_KEYS, coerceLanguagePack, routePackPhrase } from '../../src/canvas/languagePack';
import { KN_PACK } from '../helpers/knPack';
import { CANVAS_DOC_VERSION, parseCanvasDoc } from '../../src/canvas/frames';

const knStrings = { showEverything: 'ಎಲ್ಲಾ ತೋರಿಸು', newBoard: 'ಹೊಸ ಬೋರ್ಡ್', keep: 'ಇಟ್ಟುಕೋ', drop: 'ಬೇಡ' };

describe('coerceLanguagePack', () => {
  it('accepts a valid Kannada pack with known keys and intents', () => {
    const r = coerceLanguagePack(KN_PACK);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.strings.keep).toBe('ಇಟ್ಟುಕೋ');
      expect(r.value.phrases.lampOn).toEqual(['ದೀಪ ಆನ್ ಮಾಡು']);
    }
  });

  it('rejects a partial pack that would leave some chrome in English', () => {
    const r = coerceLanguagePack({ lang: 'kn', strings: knStrings, phrases: { lampOn: ['ದೀಪ ಆನ್ ಮಾಡು'] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/incomplete pack: missing string/);
  });

  it('rejects an unknown string key', () => {
    expect(coerceLanguagePack({ lang: 'kn', strings: { ...knStrings, hack: 'ಆನ್' }, phrases: {} }).ok).toBe(false);
  });

  it('rejects a Latin-only string (strings must be Kannada script)', () => {
    expect(coerceLanguagePack({ lang: 'kn', strings: { ...knStrings, keep: 'Keep' }, phrases: {} }).ok).toBe(false);
  });

  it('rejects markup in a string', () => {
    expect(coerceLanguagePack({ lang: 'kn', strings: { ...knStrings, keep: '<b>ಇಟ್ಟುಕೋ</b>' }, phrases: {} }).ok).toBe(false);
  });

  it('drops a phrase for an unknown intent instead of refusing the pack (live Gemini sent "ai")', () => {
    const r = coerceLanguagePack({ lang: 'kn', strings: { ...KN_PACK.strings }, phrases: { hack: ['ಆನ್'], ai: ['ಎಐ'] } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.value.phrases)).toEqual([]);
  });

  it('drops a markup phrase but keeps the good ones', () => {
    const intent = Object.keys(KN_PACK.phrases)[0];
    const r = coerceLanguagePack({ lang: 'kn', strings: { ...KN_PACK.strings }, phrases: { [intent]: ['<b>x</b>', 'ಆನ್'] } });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value.phrases as Record<string, string[]>)[intent]).toEqual(['ಆನ್']);
  });

  it('rejects a string longer than 80 chars', () => {
    expect(coerceLanguagePack({ lang: 'kn', strings: { ...knStrings, keep: 'ಇ'.repeat(81) }, phrases: {} }).ok).toBe(false);
  });
});

describe('the shipped Kannada pack', () => {
  it('is itself valid and covers every UI string key', () => {
    expect(coerceLanguagePack(KN_PACK).ok).toBe(true);
    for (const k of LANG_STRING_KEYS) expect(KN_PACK.strings[k]).toBeTruthy();
  });

  it('EN_PACK covers every UI string key in English', () => {
    for (const k of LANG_STRING_KEYS) expect(EN_PACK.strings[k]).toBeTruthy();
  });

  it('only has phrases for known intents', () => {
    for (const k of Object.keys(KN_PACK.phrases)) expect(INTENT_KEYS).toContain(k);
  });
});

describe('routePackPhrase', () => {
  const pack = coerceLanguagePack(KN_PACK);
  it('maps a Kannada phrase to its intent, else null', () => {
    if (!pack.ok) throw new Error('scripted pack invalid');
    expect(routePackPhrase('ದೀಪ ಆನ್ ಮಾಡು', pack.value)).toBe('lampOn');
    expect(routePackPhrase('ಎಲ್ಲಾ ತೋರಿಸು', pack.value)).toBe('showEverything');
    expect(routePackPhrase('ಇಟ್ಟುಕೋ', pack.value)).toBe('keep');
    expect(routePackPhrase('hello there', pack.value)).toBeNull();
  });
});

describe('persisted pack survives parseCanvasDoc', () => {
  const frame = { id: 'f1', kind: 'room', title: 'Room', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: false };

  it('round-trips lang + pack', () => {
    const parsed = parseCanvasDoc({
      version: CANVAS_DOC_VERSION, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: [frame], surfaces: {},
      lang: 'kn', pack: KN_PACK,
    });
    expect(parsed?.lang).toBe('kn');
    expect(parsed?.pack?.strings.keep).toBe(KN_PACK.strings.keep);
  });

  it('drops an invalid pack but keeps the doc', () => {
    const parsed = parseCanvasDoc({
      version: CANVAS_DOC_VERSION, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: [frame], surfaces: {},
      lang: 'kn', pack: { lang: 'kn', strings: { keep: 'Keep' }, phrases: {} },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.pack).toBeUndefined();
    expect(parsed?.lang).toBeUndefined();
  });
});
