// Final review 4: the conservative thing + state rule, measured on a set
// written before it was designed (chatGuardHeldOut4.data.ts). First
// measurement after the redesign, before any tuning: 98/100 caught, 0/140
// replaced. Targets: >= 95 % caught, <= 3 % wrongly replaced.
import { describe, expect, it } from 'vitest';
import { promiseGuard } from '../../src/canvas/openEndedAsk';
import { HELD_CLAIMS, HELD_NATURAL } from './chatGuardHeldOut4.data';

const replaced = (r: string) => promiseGuard(r, 'hello').replaced;

describe('chat guard, held-out set (final review 4)', () => {
  it('sizes', () => {
    expect(HELD_CLAIMS.length).toBeGreaterThanOrEqual(100);
    expect(HELD_NATURAL.length).toBeGreaterThanOrEqual(140);
  });
  it('>= 95 % of claims replaced, <= 3 % of natural replies replaced', () => {
    const missed = HELD_CLAIMS.filter((c) => !replaced(c));
    const wrong = HELD_NATURAL.filter(replaced);
    console.log(`held-out: claims ${HELD_CLAIMS.length - missed.length}/${HELD_CLAIMS.length}, natural ${wrong.length}/${HELD_NATURAL.length} replaced`, missed, wrong);
    expect((HELD_CLAIMS.length - missed.length) / HELD_CLAIMS.length).toBeGreaterThanOrEqual(0.95);
    expect(wrong.length / HELD_NATURAL.length).toBeLessThanOrEqual(0.03);
  });
  // Review 4 §5: a trailing "hope that helps" / "when you asked" never
  // exempts the clause that holds the claim.
  it.each([
    'I turned the lamp on when you asked.', 'I switched it off, hope that helps!', 'Turned the lamp on, hope that helps!',
    'The lamp is on now, hope you like it!', 'The lights are off now, I hope you sleep well.', 'Glad to help — the lamp is on now.',
    "The lamp is on now, let me know if it's too bright.", "I dimmed the lights, hopefully that's cosy.", 'Your favourite playlist is playing now.',
    'Lights are off until you say otherwise.', 'Not sure, but the lamp is on.',
  ])('replaces %j', (r) => expect(replaced(r)).toBe(true));
  it.each([
    'If the lamp is off, tap its tile.', "I'm glad it's brighter.", "I don't know if the lamp is on; check its tile.",
    'Tap the lamp tile to turn it on.', "I can't change your lamp from chat.",
  ])('passes %j', (r) => expect(replaced(r)).toBe(false));
});
