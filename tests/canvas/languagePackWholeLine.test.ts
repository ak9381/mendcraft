// Final review 3 §1: a pack phrase acts only when the whole line IS the
// phrase (a polite word around it is fine), and a question never acts.
import { describe, expect, it } from 'vitest';
import { routePackPhrase, type LanguagePack } from '../../src/canvas/languagePack';

const kn: LanguagePack = {
  lang: 'kn', strings: {},
  phrases: { lampOn: ['ದೀಪ ಆನ್ ಮಾಡಿ', 'ಲೈಟ್ ಆನ್'], lampOff: ['ಲೈಟ್ ಆಫ್'], keep: ['ಇಟ್ಟುಕೋ'], drop: ['ಬೇಡ'] },
} as LanguagePack;
const es: LanguagePack = { lang: 'es', strings: {}, phrases: { lampOn: ['enciende la luz'] } } as LanguagePack;

describe('pack phrases match the whole line', () => {
  it.each([
    ['ದೀಪ ಆನ್ ಮಾಡಿದ್ದೀಯಾ?', kn], // did you turn it on?
    ['ದೀಪ ಆನ್ ಮಾಡಿಲ್ಲ', kn], // not turned on
    ['ಲೈಟ್ ಆನ್ ಇದೆಯಾ?', kn], // is it on?
    ['ಲೈಟ್ ಆಫ್ ಮಾಡಬೇಡ', kn], // don't turn it off
    ['ಲೈಟ್ ಆನ್?', kn],
    ['ನನಗೆ ಇದು ಬೇಡ ಅಂತ ಅನಿಸುತ್ತಿಲ್ಲ', kn],
    ['¿por qué no enciende la luz?', es],
    ['¿enciende la luz?', es],
    ['no enciende la luz', es],
  ])('does not act on %j', (line, pack) => {
    expect(routePackPhrase(line, pack)).toBeNull();
  });

  it.each([
    ['ದೀಪ ಆನ್ ಮಾಡಿ', kn, 'lampOn'],
    ['ದೀಪ ಆನ್ ಮಾಡಿ.', kn, 'lampOn'],
    ['ದಯವಿಟ್ಟು ದೀಪ ಆನ್ ಮಾಡಿ', kn, 'lampOn'],
    ['ಲೈಟ್ ಆಫ್ please', kn, 'lampOff'],
    ['ಇಟ್ಟುಕೋ', kn, 'keep'],
    ['ಬೇಡ', kn, 'drop'],
    ['Enciende la luz, por favor', es, 'lampOn'],
  ])('acts on %j', (line, pack, intent) => {
    expect(routePackPhrase(line, pack)).toBe(intent);
  });
});
