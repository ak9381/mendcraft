import { describe, expect, it } from 'vitest';
import { looksLikeSurfacePlan } from '../src/ai/hybrid';

describe('looksLikeSurfacePlan (canvas hedge race filter)', () => {
  it('accepts a plan with a tiles list, at the top or one envelope down', () => {
    expect(looksLikeSurfacePlan({ kind: 'room', title: 'x', tiles: [] })).toBe(true);
    expect(looksLikeSurfacePlan({ plan: { kind: 'room', tiles: [{ type: 'connect' }] } })).toBe(true);
  });
  it('rejects empty or tile-less replies so the backup model can still win', () => {
    expect(looksLikeSurfacePlan({})).toBe(false);
    expect(looksLikeSurfacePlan({ kind: 'room', title: 'x' })).toBe(false);
    expect(looksLikeSurfacePlan({ tiles: 'lamp' })).toBe(false);
    expect(looksLikeSurfacePlan([])).toBe(false);
    expect(looksLikeSurfacePlan(null)).toBe(false);
  });
});
