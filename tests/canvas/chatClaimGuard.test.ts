import { describe, expect, it } from 'vitest';
import { buildOpenEndedPrompt, guardSafePrefix, promiseGuard, promisesAction } from '../../src/canvas/openEndedAsk';

// Final review sim-1 C1: plain past tense, bare participles, state claims,
// "there's now …" and "I made …" are claims too — chat changed nothing.
describe('state and past-tense claims (port of main C1)', () => {
  const claims = [
    // the review's probe on sim-main
    'I turned the lamp on.',
    'I switched off the fan.',
    'I added a study next to bedroom 2.',
    'The lamp is on now.',
    "It's on now.",
    'It is on.',
    'Turned the lamp on.',
    'Sure! Turning the lamp on.',
    'There’s now a study next to bedroom 2.',
    "There's now a study next to bedroom 2.",
    'Lamp on!',
    'Okay, lamp turned on.',
    'I made the lamp brighter.',
    'The music is playing now.',
    'Playing your music.',
    // main's C1 set
    'I set the lamp to warm white.',
    'I played your jazz playlist.',
    'I just dimmed the lights for you.',
    'Done — the lamp is on.',
    'Done — I turned it off.',
    'Your lights are off now.',
    "The lamp's on now.",
    'The heater is on now.',
    'The music is now playing.',
    'Switched off the fan for you.',
    'Okay, the fan is off.',
    'Lamp is on.',
    'Lights off.',
    'It’s off now.',
    // still caught before
    'Done.',
    'Your lamp is now blue.',
    'The lamp has been turned on.',
    'I have called your daughter.',
  ];
  for (const c of claims) {
    it(`replaces: ${c}`, () => {
      expect(promisesAction(c)).toBe(true);
      expect(promiseGuard(c, 'is the lamp on').replaced).toBe(true);
    });
  }
  const talk = [
    'I turned 80 last spring — just kidding, I’m a helper.',
    'Is the lamp on? You can check its tile on the board.',
    'I set out to help, so ask me anything.',
    'I changed my mind about that joke.',
    'Moving on, how was your day?',
    'Putting it simply: rest is good.',
    'Playing cards sounds like fun.',
    'I made a mistake there, sorry.',
    'It is on the board, in the top left.',
    'That’s off topic, but fun.',
    'There is a lamp tile on your board.',
    'AI helps.',
    'You can say “lamp on” to switch it.',
    'Hello! I am doing well, thanks.',
  ];
  for (const c of talk) it(`passes: ${c}`, () => expect(promiseGuard(c).replaced).toBe(false));

  it('streaming holds a state claim until its sentence ends, then shows nothing', () => {
    expect(guardSafePrefix('Okay, the lamp is on')).not.toContain('lamp');
    expect(guardSafePrefix('The heater is on, ')).toBe('');
    expect(guardSafePrefix('The lamp is on now. ')).toBe(null);
    expect(guardSafePrefix('It is on. ')).toBe(null);
    expect(guardSafePrefix('I turned the lamp on. ')).toBe(null);
    const s = guardSafePrefix('Sure! Turning the lamp ');
    expect(s === null || !/Turning/.test(s)).toBe(true);
    const t = guardSafePrefix('Okay, lamp turned ');
    expect(t === null || !/lamp/.test(t)).toBe(true);
  });

  it('small talk still streams clause by clause', () => {
    expect(guardSafePrefix('Hi there, nice to see you. How')).toBe('Hi there, nice to see you.');
  });
});

describe('replies the English guard cannot read', () => {
  it('the model is told to answer in English', () => {
    expect(buildOpenEndedPrompt('hola')).toMatch(/In English/);
  });
  const nonLatin = ['ದೀಪ ಆನ್ ಆಗಿದೆ.', 'दीपक चालू कर दिया।', 'ランプをつけました。'];
  for (const f of nonLatin) {
    it(`another script is never streamed and is replaced: ${f}`, () => {
      expect(guardSafePrefix(`${f} `)).toBe('');
      expect(promiseGuard(f, 'ದೀಪ ಆನ್ ಮಾಡು').replaced).toBe(true);
    });
  }
  const latinClaims = ['He encendido la lámpara.', "J'ai allumé la lampe.", 'Ich habe die Lampe eingeschaltet.', 'Listo, la luz está encendida.', 'Ho acceso la lampada.'];
  for (const f of latinClaims) it(`a claim in another Latin language is replaced: ${f}`, () => expect(promiseGuard(f).replaced).toBe(true));
  it('a restored name in another script does not trip it', () => {
    expect(promiseGuard('Say hi to ಅಮ್ಮ for me, she sounds lovely.').replaced).toBe(false);
  });
});
