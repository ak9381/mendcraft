import { describe, expect, it } from 'vitest';
import { registeredChip, registeredLine } from '../../src/canvas/scanRegistration';

// Final review sim-1 H1: ?sim=1 registration reads no face and locks nothing,
// so it must never be said as real.
describe('registration wording', () => {
  it('real: registered and locked', () => {
    expect(registeredChip(false)).toBe('Registered');
    expect(registeredLine(false)).toBe('Registered. Tracking is locked to you.');
  });
  it('?sim=1: labelled SIM and scripted, never "locked to you"', () => {
    expect(registeredChip(true)).toBe('SIM · registered (scripted)');
    expect(registeredLine(true)).toMatch(/^SIM · /);
    expect(registeredLine(true)).toMatch(/scripted/);
    expect(registeredLine(true)).not.toMatch(/locked to you/);
  });
});
