// Browser speechSynthesis voice picker: ranking, persistence, fallback, and
// "change voice" phrases. Pure — no speechSynthesis, no paid TTS.

import { afterEach, describe, expect, it } from 'vitest';
import {
  VOICE_STORE_KEY,
  clearSavedVoice,
  isIndianEnglish,
  isKannada,
  isNaturalVoice,
  loadSavedVoice,
  matchVoice,
  parseChangeVoice,
  pickSpokenVoice,
  previewPhrase,
  rankVoices,
  resolveChangeVoice,
  saveVoice,
  type SavedVoice,
  type SynthVoice,
} from '../src/ai/speechVoices';

const v = (partial: Partial<SynthVoice> & Pick<SynthVoice, 'voiceURI' | 'name' | 'lang'>): SynthVoice => ({
  localService: true,
  default: false,
  ...partial,
});

const MAC: SynthVoice[] = [
  v({ voiceURI: 'com.apple.voice.compact.en-US.Samantha', name: 'Samantha', lang: 'en-US', default: true }),
  v({ voiceURI: 'com.apple.voice.compact.en-GB.Daniel', name: 'Daniel', lang: 'en-GB' }),
  v({ voiceURI: 'com.apple.voice.enhanced.en-IN.Rishi', name: 'Rishi (Enhanced)', lang: 'en-IN' }),
  v({ voiceURI: 'com.apple.voice.compact.en-IN.Rishi', name: 'Rishi', lang: 'en-IN' }),
  v({ voiceURI: 'com.apple.voice.compact.kn-IN.Soumya', name: 'Soumya', lang: 'kn-IN' }),
  v({ voiceURI: 'com.google.en-US.Neural', name: 'Google US English', lang: 'en-US' }),
  v({ voiceURI: 'urn.remote.wavenet', name: 'WaveNet English', lang: 'en-US', localService: false }),
];

function memoryStore(initial: Record<string, string> = {}): Storage {
  const data = { ...initial };
  return {
    get length() { return Object.keys(data).length; },
    clear() { for (const k of Object.keys(data)) delete data[k]; },
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    key(i) { return Object.keys(data)[i] ?? null; },
    removeItem(k) { delete data[k]; },
    setItem(k, val) { data[k] = String(val); },
  } as Storage;
}

describe('voice flags', () => {
  it('spots natural/enhanced names and Kannada / Indian English langs', () => {
    expect(isNaturalVoice(v({ voiceURI: 'a', name: 'Rishi (Enhanced)', lang: 'en-IN' }))).toBe(true);
    expect(isNaturalVoice(v({ voiceURI: 'b', name: 'Samantha', lang: 'en-US' }))).toBe(false);
    expect(isKannada(v({ voiceURI: 'c', name: 'Soumya', lang: 'kn-IN' }))).toBe(true);
    expect(isKannada(v({ voiceURI: 'd', name: 'Kannada Female', lang: 'kn' }))).toBe(true);
    expect(isIndianEnglish(v({ voiceURI: 'e', name: 'Rishi', lang: 'en-IN' }))).toBe(true);
    expect(isIndianEnglish(v({ voiceURI: 'f', name: 'Indian English', lang: 'en' }))).toBe(true);
  });
});

describe('rankVoices', () => {
  it('lists natural/enhanced first, then keeps Kannada and Indian English near the top', () => {
    const ranked = rankVoices(MAC);
    expect(ranked[0].name).toBe('Rishi (Enhanced)');
    const names = ranked.map((x) => x.name);
    expect(names).toContain('Soumya');
    expect(names).toContain('Rishi');
    // Kannada and Indian English should appear before leftover compact English.
    expect(names.indexOf('Soumya')).toBeLessThan(names.indexOf('Daniel'));
    expect(names.indexOf('Rishi')).toBeLessThan(names.indexOf('Daniel'));
  });

  it('prefers an on-device voice over a remote one with a similar name', () => {
    const ranked = rankVoices([
      v({ voiceURI: 'remote', name: 'English', lang: 'en-US', localService: false }),
      v({ voiceURI: 'local', name: 'English', lang: 'en-US', localService: true }),
    ]);
    expect(ranked[0].voiceURI).toBe('local');
  });
});

describe('pickSpokenVoice', () => {
  it('uses the saved voice when it is still installed', () => {
    const saved: SavedVoice = { voiceURI: 'com.apple.voice.compact.en-GB.Daniel', name: 'Daniel', lang: 'en-GB' };
    expect(pickSpokenVoice(MAC, { lang: 'en-US', saved })?.name).toBe('Daniel');
  });

  it('falls back when the saved voice has been uninstalled', () => {
    const saved: SavedVoice = { voiceURI: 'gone', name: 'Missing', lang: 'en-US' };
    const picked = pickSpokenVoice(MAC, { lang: 'en-US', saved });
    expect(picked).not.toBeNull();
    expect(picked?.voiceURI).not.toBe('gone');
  });

  it('for Kannada replies, prefers a Kannada voice even if the saved one is English', () => {
    const saved: SavedVoice = { voiceURI: 'com.apple.voice.compact.en-US.Samantha', name: 'Samantha', lang: 'en-US' };
    expect(pickSpokenVoice(MAC, { lang: 'kn-IN', saved })?.name).toBe('Soumya');
  });

  it('uses the saved Kannada voice for Kannada replies', () => {
    const saved: SavedVoice = { voiceURI: 'com.apple.voice.compact.kn-IN.Soumya', name: 'Soumya', lang: 'kn-IN' };
    expect(pickSpokenVoice(MAC, { lang: 'kn-IN', saved })?.name).toBe('Soumya');
  });

  it('falls back to a language match, then any English, then the first voice, then null', () => {
    expect(pickSpokenVoice(MAC, { lang: 'hi-IN' })?.lang.toLowerCase().startsWith('en')).toBe(true);
    expect(pickSpokenVoice([], { lang: 'en-US' })).toBeNull();
    const only = [v({ voiceURI: 'x', name: 'X', lang: 'fr-FR' })];
    expect(pickSpokenVoice(only, { lang: 'en-US' })?.name).toBe('X');
  });

  it('among matches for a language, prefers a natural/enhanced voice', () => {
    expect(pickSpokenVoice(MAC, { lang: 'en-IN' })?.name).toBe('Rishi (Enhanced)');
  });
});

describe('persistence', () => {
  const store = memoryStore();
  afterEach(() => { store.clear(); });

  it('remembers the choice on this device and can clear it', () => {
    expect(loadSavedVoice(store)).toBeNull();
    saveVoice({ voiceURI: 'com.apple.voice.compact.kn-IN.Soumya', name: 'Soumya', lang: 'kn-IN' }, store);
    expect(store.getItem(VOICE_STORE_KEY)).toBeTruthy();
    expect(loadSavedVoice(store)).toEqual({
      voiceURI: 'com.apple.voice.compact.kn-IN.Soumya',
      name: 'Soumya',
      lang: 'kn-IN',
    });
    clearSavedVoice(store);
    expect(loadSavedVoice(store)).toBeNull();
  });

  it('ignores a corrupt stored value', () => {
    store.setItem(VOICE_STORE_KEY, '{not-json');
    expect(loadSavedVoice(store)).toBeNull();
    store.setItem(VOICE_STORE_KEY, JSON.stringify({ name: 'no uri' }));
    expect(loadSavedVoice(store)).toBeNull();
  });
});

describe('parseChangeVoice', () => {
  it('opens the picker for change/switch/pick/choose voice', () => {
    for (const u of ['change voice', 'change the voice', 'Change the spoken voice', 'switch voice', 'pick a voice', 'choose a voice']) {
      expect(parseChangeVoice(u), u).toEqual({ action: 'open' });
    }
  });

  it('sets a named or accent voice', () => {
    expect(parseChangeVoice('change voice to Rishi')).toEqual({ action: 'set', query: 'rishi' });
    expect(parseChangeVoice('use the Soumya voice')).toEqual({ action: 'set', query: 'soumya' });
    expect(parseChangeVoice('speak with Indian English')).toEqual({ action: 'set', query: 'indian english' });
    expect(parseChangeVoice('use the Kannada voice')).toEqual({ action: 'set', query: 'kannada' });
  });

  it('previews or resets the voice', () => {
    expect(parseChangeVoice('preview voice')).toEqual({ action: 'preview' });
    expect(parseChangeVoice('preview the voice')).toEqual({ action: 'preview' });
    expect(parseChangeVoice('reset voice')).toEqual({ action: 'reset' });
    expect(parseChangeVoice('use the default voice')).toEqual({ action: 'reset' });
  });

  it('does not steal ordinary plan commands', () => {
    expect(parseChangeVoice("what's the wall thickness?")).toBeNull();
    expect(parseChangeVoice('add a door')).toBeNull();
    expect(parseChangeVoice('change the wall')).toBeNull();
  });
});

describe('resolveChangeVoice', () => {
  const SAVED_DANIEL: SavedVoice = { voiceURI: 'com.apple.voice.compact.en-GB.Daniel', name: 'Daniel', lang: 'en-GB' };

  it('open: keeps the current voice and invites by a real example name', () => {
    const out = resolveChangeVoice({ action: 'open' }, MAC, SAVED_DANIEL);
    expect(out.action).toBe('open');
    expect(out.voice?.name).toBe('Daniel');
    // The example is the top-ranked installed voice, not an invented one.
    expect(out.say).toBe('Pick a voice, or say use the Rishi (Enhanced) voice.');
  });

  it('preview: speaks the preview phrase with the saved voice', () => {
    const out = resolveChangeVoice({ action: 'preview' }, MAC, SAVED_DANIEL);
    expect(out.action).toBe('preview');
    expect(out.voice?.name).toBe('Daniel');
    expect(out.say).toBe(previewPhrase('en-GB'));
  });

  it('preview with a saved Kannada voice uses the Kannada phrase', () => {
    const saved: SavedVoice = { voiceURI: 'com.apple.voice.compact.kn-IN.Soumya', name: 'Soumya', lang: 'kn-IN' };
    const out = resolveChangeVoice({ action: 'preview' }, MAC, saved);
    expect(out.voice?.name).toBe('Soumya');
    expect(out.say).toBe(previewPhrase('kn-IN'));
  });

  it('reset: confirms with the auto-picked voice, ignoring the saved one', () => {
    const out = resolveChangeVoice({ action: 'reset' }, MAC, SAVED_DANIEL);
    expect(out.action).toBe('reset');
    // Saved Daniel is ignored; the auto pick for en-US applies.
    expect(out.voice?.name).toBe(pickSpokenVoice(MAC, { lang: 'en-US' })?.name);
    expect(out.say).toBe('Back to the usual voice.');
  });

  it('set: returns the matched voice and a confirmation naming it', () => {
    const out = resolveChangeVoice({ action: 'set', query: 'soumya' }, MAC, null);
    expect(out.action).toBe('set');
    expect(out.voice?.name).toBe('Soumya');
    expect(out.say).toBe('Voice set to Soumya.');
  });

  it('set with an unknown name: not-found keeps the current voice and says so', () => {
    const out = resolveChangeVoice({ action: 'set', query: 'zarkon' }, MAC, SAVED_DANIEL);
    expect(out.action).toBe('not-found');
    expect(out.voice?.name).toBe('Daniel');
    expect(out.say).toBe('I could not find a voice called zarkon. Pick one from the list.');
  });

  it('with no voices at all, voice is null and the text still explains', () => {
    for (const intent of [{ action: 'open' } as const, { action: 'preview' } as const, { action: 'reset' } as const]) {
      const out = resolveChangeVoice(intent, [], null);
      expect(out.voice).toBeNull();
      expect(out.say.length).toBeGreaterThan(0);
    }
    const preview = resolveChangeVoice({ action: 'preview' }, [], null);
    expect(preview.say).toBe('This browser has no spoken voices. Replies stay as text.');
  });
});

describe('match and preview', () => {
  it('resolves a spoken query against the ranked list', () => {
    expect(matchVoice(MAC, 'Soumya')?.name).toBe('Soumya');
    expect(matchVoice(MAC, 'kannada')?.name).toBe('Soumya');
    expect(matchVoice(MAC, 'Indian English')?.name).toBe('Rishi (Enhanced)');
    expect(matchVoice(MAC, 'no such voice')).toBeNull();
  });

  it('has a short preview phrase in English and Kannada', () => {
    expect(previewPhrase('en-US')).toMatch(/Mendcraft/i);
    expect(previewPhrase('kn-IN').length).toBeGreaterThan(0);
    expect(previewPhrase('kn-IN')).not.toBe(previewPhrase('en-US'));
  });
});
