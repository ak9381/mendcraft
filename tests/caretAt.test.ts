import { describe, expect, it } from 'vitest';
import { caretIndexAt } from '../src/input/caretAt';

const mono = (s: string) => s.length * 10;
describe('caretIndexAt (C023 hand drag-select)', () => {
  it('maps an x offset to the nearest character boundary', () => {
    expect(caretIndexAt('hello', -5, mono)).toBe(0);
    expect(caretIndexAt('hello', 4, mono)).toBe(0);
    expect(caretIndexAt('hello', 6, mono)).toBe(1);
    expect(caretIndexAt('hello', 31, mono)).toBe(3);
    expect(caretIndexAt('hello', 500, mono)).toBe(5);
  });
  it('handles an empty field', () => { expect(caretIndexAt('', 40, mono)).toBe(0); });
});
