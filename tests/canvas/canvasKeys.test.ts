import { describe, expect, it } from 'vitest';
import { isTypingTarget } from '../../src/canvas/canvasNav';

// Review focus 1: typing in the say box / teach input must never be hijacked.
describe('canvas key guard', () => {
  const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as unknown as EventTarget;
  it('say box / teach input / textarea are typing targets', () => {
    expect(isTypingTarget(el('INPUT'))).toBe(true);
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
  });
  it('a descendant of a contenteditable counts via closest()', () => {
    expect(isTypingTarget(el('SPAN', { closest: (s: string) => (s.includes('contenteditable') ? {} : null) }))).toBe(true);
  });
  it('a div / button is not', () => {
    expect(isTypingTarget(el('DIV'))).toBe(false);
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
  });
});
