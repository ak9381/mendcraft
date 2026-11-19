import { describe, expect, it } from 'vitest';
import { EN_PACK, SCRIPTED_KN_PACK, STATUS_KEYS, coerceLanguagePack, statusText } from '../../src/canvas/languagePack';

describe('new bar-string keys', () => {
  it('both packs carry the Go / Hands / offline strings', () => {
    for (const k of ['go', 'hands', 'simulateOffline', 'offlineOn'] as const) {
      expect(EN_PACK.strings[k]).toBeTruthy();
      expect(SCRIPTED_KN_PACK.strings[k]).toBeTruthy();
    }
    // The shipped Kannada pack is still valid after the additions.
    expect(coerceLanguagePack(SCRIPTED_KN_PACK).ok).toBe(true);
  });
});

describe('statusText (Kannada device-command status when the pack is on)', () => {
  it('returns Kannada with a kn pack, English otherwise', () => {
    for (const k of STATUS_KEYS) {
      const en = statusText(k, null);
      const kn = statusText(k, SCRIPTED_KN_PACK);
      expect(en).toBeTruthy();
      expect(kn).toBeTruthy();
      expect(/[ಀ-೿]/.test(kn)).toBe(true); // Kannada script
      expect(/[ಀ-೿]/.test(en)).toBe(false); // English has none
    }
  });

  it('an English pack (or no pack) stays English', () => {
    expect(statusText('lightsOff', EN_PACK)).toBe(statusText('lightsOff', null));
  });
});
