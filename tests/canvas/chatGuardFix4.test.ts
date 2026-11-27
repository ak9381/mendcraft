import { describe, expect, it } from 'vitest';
import { guardSafePrefix, promiseGuard } from '../../src/canvas/openEndedAsk';

// Review sim-4 §2: the lines the review found passing (and wrongly replaced).
// These are the lines the fix was built against; the held-out set 5 is not.
describe('chat guard, review sim-4 §2', () => {
  it.each([
    // no app noun
    'I took care of it.', "I've handled it for you.", 'I made the change.', 'The change has been made.', 'I just finished creating it.',
    "I've logged that for you.", 'Your settings have been changed.', 'The device has been paired.', 'Maybe I\'ve already saved it. Yes, saved.',
    'All done!', "That's sorted.", 'Done ✅',
    // a noun the guard does not know
    'I created a connector for your smart plug.', 'Your connector is set up and working.', "I've reset the camera.",
    'Timer started, 10 minutes.', "I've added milk to your shopping list.", 'Your message is on its way to Amma.',
    // emoji in place of the full stop
    'Lamp off ✅', 'Sent! 📨', '💡 Done, it\'s glowing now.',
    // Kannada
    'Aaytu, light off maadide.', 'Sari, light off maadtini.', 'Light on maadidini, nodi.', 'ನಾನು lamp on ಮಾಡಿದ್ದೇನೆ.',
    'Okay. Light ಆಫ್ ಆಗಿದೆ, enjoy.',
    // other
    'The new board is live.', 'Board created successfully.',
    // hedge clauses that are the claim
    "Perhaps it's done now — enjoy the light.", 'I think that worked — the lamp is on.',
  ])('replaced: %s', (r) => expect(promiseGuard(r, '').replaced).toBe(true));

  it.each([
    'I got your message, thank you.', "I'm Gemini Nano, running on your device.", 'I run on your device, so nothing leaves it.',
    'If you turned the lamp on, the room would be brighter.',
    'The purpose of the "turn off the lamp" command is to switch the light off.',
    'Brightness is how much light a lamp gives off.',
    'No, I don\'t think so.', 'No worries at all.', 'No problem!', 'Well done!', 'Hmm, good question.',
    'Good night 🌙', 'Lovely 😊', 'Namaskara, hegiddira?', 'Oota aaytha?',
    'I hope it works out for you.', 'I think you will like it.', 'Perhaps a walk would help.',
  ])('passes: %s', (r) => expect(promiseGuard(r, '').replaced).toBe(false));

  it.each([
    'No. The lamp is off.', 'No! It\'s on.', 'Yes. The lamp is on.', 'Yes! It is on.',
    'Hmm, the lamp is off.', 'Well, it is on now.', 'Actually, the lamp is off.', 'Not yet, but the lamp is on now.',
    "Perhaps it's done now — the lamp is on.", 'I think that worked — the lamp is on.',
    'Okay. Light ಆಫ್ ಆಗಿದೆ, enjoy.',
  ])('streamed, nothing shown before the replacement: %s', (full) => {
    expect(promiseGuard(full, '').replaced).toBe(true);
    for (let i = 1; i <= full.length; i++) {
      const shown = guardSafePrefix(full.slice(0, i));
      expect(shown === null || shown === '', `${full.slice(0, i)} → ${shown}`).toBe(true);
    }
  });

  it('a natural "No." reply still streams once its next sentence passes', () => {
    const full = 'No. I only chat here, so I cannot see it. Ask the board instead.';
    expect(guardSafePrefix(full)).toBe('No. I only chat here, so I cannot see it.');
  });
});
