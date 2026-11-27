import { describe, expect, it } from 'vitest';
import { SCRIPTED_KN_PACK, coerceLanguagePack, routePackPhrase, type LanguagePack } from '../../src/canvas/languagePack';
import { languagePackChanges } from '../../src/canvas/planDiff';

// Final review sim-1 A1: a model-written pack must never be able to approve
// (keep) or drop a review, nor fire on a short fragment of a longer sentence.
const pack = (phrases: Record<string, string[]>): LanguagePack => {
  const r = coerceLanguagePack({ lang: 'kn', strings: { ...SCRIPTED_KN_PACK.strings }, phrases });
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('pack phrases: exact, never a fragment', () => {
  const builtin = pack(SCRIPTED_KN_PACK.phrases as Record<string, string[]>);

  it('the built-in phrases still route when said as they are', () => {
    expect(routePackPhrase('ದೀಪ ಆನ್ ಮಾಡು', builtin)).toBe('lampOn');
    expect(routePackPhrase('ದೀಪ ಆಫ್ ಮಾಡು.', builtin)).toBe('lampOff');
    expect(routePackPhrase('ಇಟ್ಟುಕೋ', builtin)).toBe('keep');
    expect(routePackPhrase('ಬೇಡ', builtin)).toBe('drop');
    expect(routePackPhrase('ರದ್ದುಮಾಡು', builtin)).toBe('undo');
  });

  it('a trailing "?" is a question: no action (review sim-2 §5)', () => {
    const model = pack({ lampOn: ['ದೀಪ ಆನ್ ಮಾಡಿ', 'ಲೈಟ್ ಆನ್', 'ದೀಪ ಆನ್ ಮಾಡಿದ್ದೀಯಾ?'] });
    expect(routePackPhrase('ಲೈಟ್ ಆನ್?', model)).toBeNull();
    expect(routePackPhrase('ದೀಪ ಆನ್ ಮಾಡಿ?', model)).toBeNull();
    expect(routePackPhrase('ದೀಪ ಆನ್ ಮಾಡು ?', builtin)).toBeNull();
    expect(routePackPhrase('ದೀಪ ಆನ್ ಮಾಡಿದ್ದೀಯಾ', model)).toBeNull(); // a model phrase that is a question is dropped
    expect(routePackPhrase('ಲೈಟ್ ಆನ್', model)).toBe('lampOn');
  });

  it('a polite word around a phrase is fine', () => {
    expect(routePackPhrase('ದಯವಿಟ್ಟು ದೀಪ ಆನ್ ಮಾಡು', builtin)).toBe('lampOn');
    expect(routePackPhrase('please ಇಟ್ಟುಕೋ', builtin)).toBe('keep');
  });

  it('a phrase inside a longer sentence does not fire', () => {
    expect(routePackPhrase('ನನಗೆ ಇದು ಬೇಡ ಅಂತ ಅನಿಸುತ್ತಿಲ್ಲ', builtin)).toBeNull();
    expect(routePackPhrase('ದೀಪ ಆನ್ ಮಾಡು ಅಂತ ಹೇಳಬೇಡ', builtin)).toBeNull();
    expect(routePackPhrase('ಇಟ್ಟುಕೋಬೇಕಾ', builtin)).toBeNull();
  });

  it('a model-written keep/drop phrase is never taken: only the built-in ones', () => {
    const p = pack({ keep: ['ಹೌದು', 'ಸರಿ ಸರಿ'], drop: ['ಇಲ್ಲ ಇಲ್ಲ'], lampOn: ['ಬೆಳಕು ಬೇಕು'] });
    expect(p.phrases.keep).toEqual(SCRIPTED_KN_PACK.phrases.keep);
    expect(p.phrases.drop).toEqual(SCRIPTED_KN_PACK.phrases.drop);
    expect(routePackPhrase('ಹೌದು', p)).toBeNull();
    expect(routePackPhrase('ಸರಿ ಸರಿ', p)).toBeNull();
    expect(routePackPhrase('ಇಟ್ಟುಕೋ', p)).toBe('keep');
    expect(routePackPhrase('ಬೆಳಕು ಬೇಕು', p)).toBe('lampOn');
  });

  it('a one-letter model phrase is dropped, so it cannot match inside her words', () => {
    const p = pack({ lampOff: ['ಅ'], undo: ['ಆ'] });
    expect(p.phrases.lampOff ?? []).not.toContain('ಅ');
    expect(p.phrases.undo ?? []).not.toContain('ಆ');
    expect(routePackPhrase('ಅಮ್ಮ ಬಂದಳು', p)).toBeNull();
  });

  it('the review lists the spoken phrases it will add', () => {
    const p = pack({ lampOn: ['ಬೆಳಕು ಬೇಕು'] });
    const changes = languagePackChanges('Kannada', 19, p.phrases);
    expect(changes[0].label).toBe('Switch the interface to Kannada (19 labels)');
    expect(changes.map((c) => c.label).join('\n')).toContain('ಬೆಳಕು ಬೇಕು');
  });
});
