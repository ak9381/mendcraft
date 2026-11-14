import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  opLabel,
  looksKannada,
  scoreCases,
  scoreRouting,
  pct,
  type EvalCase,
} from '../src/eval/commandEval';

describe('opLabel', () => {
  it('maps op / generate / clarify envelopes', () => {
    expect(opLabel({ op: 'add_room' })).toBe('add_room');
    expect(opLabel({ generate: 'twoBedroom' })).toBe('generate:twoBedroom');
    expect(opLabel({ clarify: 'which wall?' })).toBe('clarify');
  });
  it('is defensive about junk', () => {
    expect(opLabel(null)).toBe('none');
    expect(opLabel({})).toBe('unknown');
  });
});

describe('looksKannada', () => {
  it('detects Kannada script and ignores Latin', () => {
    expect(looksKannada('ಒಂದು ಬಾಗಿಲು ಸೇರಿಸಿ')).toBe(true);
    expect(looksKannada('add a door')).toBe(false);
  });
});

describe('scoreCases', () => {
  const cases: EvalCase[] = [
    { text: 'a', expect: 'add_door' },
    { text: 'b', expect: 'move' },
  ];
  it('counts exact op matches', () => {
    const fake = (u: string) => (u === 'a' ? { op: 'add_door' } : { clarify: 'x' });
    const s = scoreCases(fake, cases);
    expect(s.correct).toBe(1);
    expect(s.total).toBe(2);
    expect(s.accuracy).toBe(0.5);
  });
});

describe('scoreRouting', () => {
  it('counts non-English cases the parser correctly declines', () => {
    const kn: EvalCase[] = [
      { text: 'ಒಂದು ಬಾಗಿಲು', expect: 'add_door' },
      { text: 'ಅದನ್ನು ಸರಿಸಿ', expect: 'move' },
    ];
    const declines = () => ({ clarify: 'I did not hear a command.' });
    const r = scoreRouting(declines, kn);
    expect(r.total).toBe(2);
    expect(r.routedOff).toBe(2);
    expect(r.rate).toBe(1);
  });
});

describe('pct', () => {
  it('rounds to whole percent', () => {
    expect(pct(0.825)).toBe('83%');
    expect(pct(0)).toBe('0%');
    expect(pct(1)).toBe('100%');
  });
});

describe('eval datasets are well-formed', () => {
  const evalDir = fileURLToPath(new URL('./eval', import.meta.url));
  for (const [file, lang, min] of [
    ['commands.en.json', 'en', 40],
    ['commands.kn.json', 'kn', 35],
  ] as const) {
    it(`${file} has >= ${min} well-formed cases`, () => {
      const data = JSON.parse(readFileSync(join(evalDir, file), 'utf8'));
      expect(data.language).toBe(lang);
      expect(Array.isArray(data.cases)).toBe(true);
      expect(data.cases.length).toBeGreaterThanOrEqual(min);
      for (const c of data.cases) {
        expect(typeof c.text).toBe('string');
        expect(c.text.length).toBeGreaterThan(0);
        expect(typeof c.expect).toBe('string');
        expect(c.expect.length).toBeGreaterThan(0);
      }
    });
  }

  it('every Kannada case actually contains Kannada script', () => {
    const data = JSON.parse(readFileSync(join(evalDir, 'commands.kn.json'), 'utf8'));
    for (const c of data.cases) expect(looksKannada(c.text)).toBe(true);
  });
});
