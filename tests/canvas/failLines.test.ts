import { describe, expect, it } from 'vitest';
import {
  INCOMPLETE_KN_LINE, OFFLINE_MID_LINE, PHONE_DROP_LINE, PHONE_DROP_UNDONE,
  QUOTA_SAVE_LINE, phoneDropLine, saveSpokenLine, tryWriteStorage,
} from '../../src/canvas/failLines';

describe('tryWriteStorage / saveSpokenLine', () => {
  it('returns true and the Saved line when the write succeeds', () => {
    const store: Record<string, string> = {};
    expect(tryWriteStorage({ setItem: (k, v) => { store[k] = v; } }, 'k', '{"ok":true}')).toBe(true);
    expect(store.k).toBe('{"ok":true}');
    expect(saveSpokenLine(true, 'Living room', '11:34 PM')).toBe('Saved Living room at 11:34 PM.');
    expect(saveSpokenLine(true, null, '11:34 PM')).toBe('Saved the canvas at 11:34 PM.');
  });
  it('returns false and the quota line when setItem throws — never claims Saved', () => {
    expect(tryWriteStorage({ setItem: () => { throw new Error('QuotaExceededError'); } }, 'k', 'x')).toBe(false);
    expect(saveSpokenLine(false, 'Living room', '11:34 PM')).toBe(QUOTA_SAVE_LINE);
    expect(saveSpokenLine(false, 'Living room', '11:34 PM')).not.toMatch(/^Saved /);
  });
});

describe('phoneDropLine', () => {
  it('tells the truth about whether a mid-flight command was undone', () => {
    expect(phoneDropLine(false)).toBe(PHONE_DROP_LINE);
    expect(phoneDropLine(true)).toBe(PHONE_DROP_UNDONE);
  });
});

describe('shared failure lines stay plain and specific', () => {
  it('names the failure without jargon', () => {
    expect(OFFLINE_MID_LINE).toMatch(/unchanged/);
    expect(INCOMPLETE_KN_LINE).toMatch(/still in English/);
  });
});
