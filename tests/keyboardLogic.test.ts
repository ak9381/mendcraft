import { describe, it, expect } from 'vitest';
import { pressKey, shiftChar, type FieldState } from '../src/input/keyboardLogic';

const at = (value: string, caret: number): FieldState => ({ value, start: caret, end: caret });

describe('shiftChar', () => {
  it('upper-cases letters and maps digit symbols', () => {
    expect(shiftChar('a', true)).toBe('A');
    expect(shiftChar('a', false)).toBe('a');
    expect(shiftChar('1', true)).toBe('!');
    expect(shiftChar('5', true)).toBe('%');
  });
});

describe('pressKey', () => {
  it('inserts a character at the caret', () => {
    const r = pressKey(at('ab', 1), 'x', false);
    expect(r.value).toBe('axb');
    expect(r.start).toBe(2);
  });

  it('applies shift to the inserted char and consumes the latch', () => {
    const r = pressKey(at('', 0), 'q', true);
    expect(r.value).toBe('Q');
    expect(r.shift).toBe(false);
  });

  it('replaces a selection on insert', () => {
    const r = pressKey({ value: 'hello', start: 1, end: 4 }, 'z', false);
    expect(r.value).toBe('hzo');
    expect(r.start).toBe(2);
  });

  it('backspace deletes the char before the caret', () => {
    const r = pressKey(at('abc', 2), 'Backspace', false);
    expect(r.value).toBe('ac');
    expect(r.start).toBe(1);
  });

  it('backspace deletes a selection', () => {
    const r = pressKey({ value: 'abcd', start: 1, end: 3 }, 'Backspace', false);
    expect(r.value).toBe('ad');
    expect(r.start).toBe(1);
  });

  it('backspace at start is a no-op', () => {
    const r = pressKey(at('abc', 0), 'Backspace', false);
    expect(r.value).toBe('abc');
    expect(r.start).toBe(0);
  });

  it('space inserts a space', () => {
    expect(pressKey(at('a', 1), 'Space', false).value).toBe('a ');
  });

  it('shift toggles the latch without changing text', () => {
    const r = pressKey(at('a', 1), 'Shift', false);
    expect(r.shift).toBe(true);
    expect(r.value).toBe('a');
  });

  it('enter requests submit, close requests close', () => {
    expect(pressKey(at('a', 1), 'Enter', false).submit).toBe(true);
    expect(pressKey(at('a', 1), 'Close', false).close).toBe(true);
  });

  it('clamps an out-of-range caret', () => {
    const r = pressKey({ value: 'ab', start: 99, end: 99 }, 'x', false);
    expect(r.value).toBe('abx');
  });

  it('normalises a reversed selection', () => {
    const r = pressKey({ value: 'abcd', start: 3, end: 1 }, 'z', false);
    expect(r.value).toBe('azd');
  });
});
