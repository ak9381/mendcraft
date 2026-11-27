// sim-main review items, applied to main's guard.
import { describe, expect, it } from 'vitest';
import { guardSafePrefix, promiseGuard } from '../../src/canvas/openEndedAsk';

describe('chat guard: sim-main review', () => {
  it.each([
    "That's a lovely dashboard you've built.",
    'To turn the lamp on, say "lamp on".',
    'A dashboard is a board of tiles.',
    'A scene is a saved look for your lamp.',
    'Volume is how loud the speaker plays.',
  ])('passes %j', (r) => expect(promiseGuard(r).replaced).toBe(false));
  it.each(['I think the lamp is on now.', 'I believe the lights are off.', 'No, the lamp is off.'])('replaces the hedged claim %j', (r) => expect(promiseGuard(r).replaced).toBe(true));
  it('a short opener is not spoken before a clause the guard replaces', () => {
    const reply = 'No, the lamp is off now.';
    for (let n = 1; n <= reply.length; n++) {
      const safe = guardSafePrefix(reply.slice(0, n));
      if (safe === null) return;
      expect(safe).toBe('');
    }
    throw new Error('never caught');
  });
});
