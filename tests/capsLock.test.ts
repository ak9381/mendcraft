import { describe, expect, it } from 'vitest';
import { CAPS_DOUBLE_TAP_MS, pressKey, shiftAfter, type ShiftState } from '../src/input/keyboardLogic';

const off: ShiftState = { shift: false, caps: false, lastShiftAt: -Infinity };
function tap(s: ShiftState, key: string, now: number, field = { value: '', start: 0, end: 0 }) {
  const r = pressKey(field, key, s.shift);
  return { s: shiftAfter(s, key, r.shift, now), r };
}

describe('Shift double-tap = caps lock (C015)', () => {
  it('one tap is a one-shot shift', () => {
    let { s } = tap(off, 'Shift', 1000);
    expect(s).toMatchObject({ shift: true, caps: false });
    const t = tap(s, 'a', 1500); s = t.s;
    expect(t.r.value).toBe('A');
    expect(s.shift).toBe(false);
  });
  it('two taps within the window latch caps; letters stay upper; one more tap releases', () => {
    let s = tap(off, 'Shift', 1000).s;
    s = tap(s, 'Shift', 1000 + CAPS_DOUBLE_TAP_MS - 50).s;
    expect(s).toMatchObject({ shift: true, caps: true });
    let f = { value: '', start: 0, end: 0 };
    for (const ch of 'ab') { const t = tap(s, ch, 3000, f); s = t.s; f = { value: t.r.value, start: t.r.start, end: t.r.end }; }
    expect(f.value).toBe('AB');
    s = tap(s, 'Shift', 4000).s;
    expect(s).toMatchObject({ shift: false, caps: false });
    expect(tap(s, 'c', 4100, f).r.value).toBe('ABc');
  });
  it('two slow taps are on then off (no caps)', () => {
    let s = tap(off, 'Shift', 1000).s;
    s = tap(s, 'Shift', 1000 + CAPS_DOUBLE_TAP_MS + 100).s;
    expect(s).toMatchObject({ shift: false, caps: false });
  });
});
