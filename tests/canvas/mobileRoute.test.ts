import { describe, expect, it } from 'vitest';
import { parseMobileScreen } from '../../src/canvas/mobile/mobileRoute';

describe('parseMobileScreen', () => {
  it('defaults to "pair" with no query param', () => {
    expect(parseMobileScreen('')).toBe('pair');
  });

  it('reads each valid ?mobileScreen= value', () => {
    for (const s of ['pair', 'canvas', 'dashboard', 'approval', 'gimbal', 'tablet']) {
      expect(parseMobileScreen(`?mobileScreen=${s}`)).toBe(s);
    }
  });

  it('falls back to "pair" for an unknown value', () => {
    expect(parseMobileScreen('?mobileScreen=nope')).toBe('pair');
  });

  it('composes with other query params', () => {
    expect(parseMobileScreen('?sim=1&mobileScreen=gimbal&platform=ios')).toBe('gimbal');
  });
});
