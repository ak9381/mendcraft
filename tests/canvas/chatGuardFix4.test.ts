// Final review 5: where the model runs is not a device state; self-description
// is talk; an adverb inside a first-person claim; claim-like openers held while
// streaming; Kannada written in Latin letters.
import { describe, expect, it } from 'vitest';
import { guardSafePrefix, promiseGuard } from '../../src/canvas/openEndedAsk';

const replaced = (r: string) => promiseGuard(r, 'hello').replaced;

describe('chat guard (final review 5)', () => {
  it.each([
    "I've now switched everything off.", "I've also paused it.", 'I have indeed switched it off.', "I've quickly dimmed them.",
    "We've now set it to 40%.", "I've since turned it off.", "I've really turned it off.", 'I have successfully paused it.', 'I turned it up to 70%.',
    'Volume kammi maadide.', 'Music play aagtide.', 'Lamp on maadide.', 'Light off aagide.', 'Sari, lamp on aaythu.',
    'Finished! The lamp is on.', 'Success!', 'It worked!', 'Mission accomplished!', 'Sorted — the lamp is off.',
    "You're all set, the lamp is on.", 'As requested, the lamp is off.',
    "I'm Gemini Nano, and I've turned the lamp on.", 'I run on your device, and the lamp is now off.', "I've turned the lamp on, on your device.",
  ])('replaces %j', (r) => expect(replaced(r)).toBe(true));

  it.each([
    "I'm Gemini Nano, running on your device.", "Yes, I'm running on your device.", "I'm Mendcraft's on-device helper.",
    "I run on this device, so it's private.", "I'm a model that runs on device.", 'I can help you build boards and floor plans.',
    "I'm Gemini, a model from Google.", 'Everything runs on your device, not in the cloud.',
    'For a new board, say "new board".', 'Brightness is how much light a lamp gives off.',
    '"Paused" means the music has stopped for now and can continue later.', 'Standby is when a device is off but still listening.',
    "I wouldn't know whether the lamp is on.", 'Lamps are lit all over India during Deepavali.', 'Lights left on all night waste electricity.',
    'Most smart lamps can be dimmed.', 'Stage lights are dimmed before a play starts.', 'Remember to turn the lamp off before you leave.',
    "Don't forget to switch the lights off.", 'Make sure the lamp is plugged in.', 'Many lamps can change colour.',
    'Oota aaytha?', 'Chennagide!',
  ])('passes %j', (r) => expect(replaced(r)).toBe(false));

  it.each([
    "You're all set, the lamp is off.", 'Sorted — the music is paused.', 'Finished! The lamp is on.', 'All done — lights off.',
    'As requested, the lamp is now on.', 'It worked! The lamp is on.', 'Success! The lamp is on.', 'Mission accomplished, the lamp is on.',
  ])('streams none of %j', (s) => {
    for (let i = 1; i <= s.length; i++) expect(guardSafePrefix(s.slice(0, i)) || '').toBe('');
  });
});
