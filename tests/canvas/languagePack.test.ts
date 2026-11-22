import { describe, expect, it } from 'vitest';
import { EN_PACK, INTENT_KEYS, LANG_STRING_KEYS, SCRIPTED_KN_PACK, coerceLanguagePack, routePackPhrase } from '../../src/canvas/languagePack';
import { CANVAS_DOC_VERSION, parseCanvasDoc } from '../../src/canvas/frames';

const knStrings = { showEverything: 'ಎಲ್ಲಾ ತೋರಿಸು', newBoard: 'ಹೊಸ ಬೋರ್ಡ್', keep: 'ಇಟ್ಟುಕೋ', drop: 'ಬೇಡ' };

describe('coerceLanguagePack', () => {
  it('accepts a valid Kannada pack with known keys and intents', () => {
    const r = coerceLanguagePack(SCRIPTED_KN_PACK);
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

  it('rejects a phrase for an unknown intent', () => {
    expect(coerceLanguagePack({ lang: 'kn', strings: { ...SCRIPTED_KN_PACK.strings }, phrases: { hack: ['ಆನ್'] } }).ok).toBe(false);
  });

  it('rejects a string longer than 80 chars', () => {
    expect(coerceLanguagePack({ lang: 'kn', strings: { ...knStrings, keep: 'ಇ'.repeat(81) }, phrases: {} }).ok).toBe(false);
  });
});

describe('the shipped Kannada pack', () => {
  it('is itself valid and covers every UI string key', () => {
    expect(coerceLanguagePack(SCRIPTED_KN_PACK).ok).toBe(true);
    for (const k of LANG_STRING_KEYS) expect(SCRIPTED_KN_PACK.strings[k]).toBeTruthy();
  });

  it('EN_PACK covers every UI string key in English', () => {
    for (const k of LANG_STRING_KEYS) expect(EN_PACK.strings[k]).toBeTruthy();
  });

  it('only has phrases for known intents', () => {
    for (const k of Object.keys(SCRIPTED_KN_PACK.phrases)) expect(INTENT_KEYS).toContain(k);
  });
});

describe('routePackPhrase', () => {
  const pack = coerceLanguagePack(SCRIPTED_KN_PACK);
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
      lang: 'kn', pack: SCRIPTED_KN_PACK,
    });
    expect(parsed?.lang).toBe('kn');
    expect(parsed?.pack?.strings.keep).toBe(SCRIPTED_KN_PACK.strings.keep);
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
