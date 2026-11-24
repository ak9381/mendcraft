import { describe, expect, it } from 'vitest';
import { EN_PACK, LANG_OPTIONAL_KEYS, LANG_STRING_KEYS, SCRIPTED_KN_PACK, STATUS_KEYS, coerceLanguagePack, statusText } from '../../src/canvas/languagePack';

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

describe('optional keys: Tools chip and review buttons', () => {
  const full = () => ({ ...SCRIPTED_KN_PACK.strings });

  it('LANG_OPTIONAL_KEYS lists the four optional keys, outside the required set', () => {
    expect([...LANG_OPTIONAL_KEYS]).toEqual(['tools', 'approve', 'reject', 'askElse']);
    for (const k of LANG_OPTIONAL_KEYS) expect((LANG_STRING_KEYS as readonly string[]).includes(k)).toBe(false);
  });

  it('a pack missing only the optional keys is still accepted', () => {
    const strings = full();
    for (const k of LANG_OPTIONAL_KEYS) delete strings[k];
    expect(coerceLanguagePack({ lang: 'kn', strings }).ok).toBe(true);
  });

  it('a pack that supplies optional keys keeps them; a bad optional value is refused', () => {
    const ok = coerceLanguagePack({ lang: 'kn', strings: full() });
    expect(ok.ok && ok.value.strings.tools).toBe(SCRIPTED_KN_PACK.strings.tools);
    expect(coerceLanguagePack({ lang: 'kn', strings: { ...full(), tools: 'Tools' } }).ok).toBe(false);
  });

  it('the scripted pack has all four optional keys in Kannada script', () => {
    for (const k of LANG_OPTIONAL_KEYS) expect(/[ಀ-೿]/.test(SCRIPTED_KN_PACK.strings[k] ?? '')).toBe(true);
  });

  it('English labels: Tools / Approve / Reject / Ask for something else, Keep / Drop', () => {
    expect(EN_PACK.strings.tools).toBe('Tools');
    expect(EN_PACK.strings.approve).toBe('Approve');
    expect(EN_PACK.strings.reject).toBe('Reject');
    expect(EN_PACK.strings.askElse).toBe('Ask for something else');
    expect(EN_PACK.strings.keep).toBe('Keep');
    expect(EN_PACK.strings.drop).toBe('Drop');
  });

  it('the Gemini prompt key list (EN_PACK strings) includes the optional keys', () => {
    for (const k of LANG_OPTIONAL_KEYS) expect(Object.keys(EN_PACK.strings)).toContain(k);
  });
});
