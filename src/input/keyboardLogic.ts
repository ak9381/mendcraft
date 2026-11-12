// Pure on-screen-keyboard key handling: given the current field text + caret and
// a key press, compute the next text + caret. DOM-free so it's unit-testable;
// the DOM component (onscreenKeyboard.ts) just applies the result to the field.

/** Special non-character keys. Character keys are their own single-char string. */
export type SpecialKey = 'Backspace' | 'Enter' | 'Shift' | 'Space' | 'Close';

export interface FieldState {
  value: string;
  /** Caret / selection start. */
  start: number;
  /** Selection end (== start when no range selected). */
  end: number;
}

export interface KeyResult extends FieldState {
  /** Shift latch after this press (keys consume a one-shot shift). */
  shift: boolean;
  /** The field should submit / fire Enter (caller dispatches the real event). */
  submit: boolean;
  /** The keyboard should close. */
  close: boolean;
}

/** The QWERTY layout rendered by the component (rows of character keys). */
export const KEY_ROWS: string[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const SHIFT_SYMBOLS: Record<string, string> = {
  '1': '!', '2': '@', '3': '#', '4': '$', '5': '%',
  '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
};

/** Apply shift to a single character key (letters upper-case, digits → symbols). */
export function shiftChar(ch: string, shift: boolean): string {
  if (!shift) return ch;
  if (SHIFT_SYMBOLS[ch]) return SHIFT_SYMBOLS[ch];
  return ch.toUpperCase();
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Compute the next field state for one key press. `key` is either a single
 * character (already un-shifted — shift is applied here) or a SpecialKey.
 */
export function pressKey(
  state: FieldState,
  key: string,
  shift: boolean,
): KeyResult {
  const len = state.value.length;
  let start = clamp(state.start, 0, len);
  let end = clamp(state.end, 0, len);
  if (end < start) [start, end] = [end, start];

  const base: KeyResult = { ...state, start, end, shift, submit: false, close: false };

  const insert = (text: string): KeyResult => {
    const value = state.value.slice(0, start) + text + state.value.slice(end);
    const caret = start + text.length;
    return { value, start: caret, end: caret, shift: false, submit: false, close: false };
  };

  switch (key) {
    case 'Shift':
      return { ...base, shift: !shift };
    case 'Close':
      return { ...base, close: true };
    case 'Enter':
      return { ...base, submit: true };
    case 'Space':
      return insert(' ');
    case 'Backspace': {
      if (end > start) {
        // Delete the selection.
        const value = state.value.slice(0, start) + state.value.slice(end);
        return { value, start, end: start, shift, submit: false, close: false };
      }
      if (start === 0) return { ...base }; // nothing to delete
      const value = state.value.slice(0, start - 1) + state.value.slice(end);
      return { value, start: start - 1, end: start - 1, shift, submit: false, close: false };
    }
    default:
      // A character key.
      return insert(shiftChar(key, shift));
  }
}
