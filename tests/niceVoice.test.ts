// A nicer spoken voice: the picker prefers the best ON-DEVICE voice (Apple
// Premium, then Enhanced; Android's local Google voices; a Kannada voice for
// Kannada), never a cloud voice unless she opts in, speaks a little slower,
// never over itself, and tells a Mac user once how to get a Premium voice.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLOUD_VOICE_KEY, MAC_VOICE_HINT, SPEECH_PITCH, SPEECH_RATE, isCloudVoice, isNoveltyVoice, listPickerVoices, loadAllowCloud, loadReadAloud,
  macVoiceHintOnce, needsMacVoiceHint, parseChangeVoice, pickSpokenVoice, saveAllowCloud, saveReadAloud, saveVoice, speechPlatform, usableVoices, voiceKindLabel,
  voiceSpeaks, voiceTier, type SynthVoice,
} from '../src/ai/speechVoices';
import { createSpeaker, type RawVoice, type UtteranceLike } from '../src/ai/speaker';
import { mountVoiceSheet } from '../src/canvas/voiceSheet';
import { routeLine } from '../src/canvas/routeLine';
import { PHONE_GROUPS } from '../src/canvas/phoneMenu';

const v = (name: string, lang: string, o: Partial<SynthVoice> = {}): SynthVoice => ({ voiceURI: o.voiceURI ?? `uri:${name}:${lang}`, name, lang, localService: true, ...o });

/** A stock Mac: compact voices, the joke voices, Chrome's online Google voices. */
const MAC_STOCK: SynthVoice[] = [
  v('Albert', 'en-US'), v('Bad News', 'en-US'), v('Zarvox', 'en-US'),
  v('Samantha', 'en-US', { default: true }), v('Daniel', 'en-GB'), v('Karen', 'en-AU'), v('Rishi', 'en-IN'),
  v('Google US English', 'en-US', { localService: false }), v('Google UK English Female', 'en-GB', { localService: false }),
];
/** The same Mac after she downloaded better voices. */
const MAC_NICE: SynthVoice[] = [...MAC_STOCK, v('Samantha (Enhanced)', 'en-US'), v('Evan (Enhanced)', 'en-US'), v('Zoe (Premium)', 'en-US'), v('Ava (Premium)', 'en-US'), v('Soumya', 'kn-IN')];
const ANDROID: SynthVoice[] = [
  v('English United States', 'en_US', { voiceURI: 'en-us-x-sfg-network', localService: false }),
  v('English United States', 'en_US', { voiceURI: 'en-us-x-sfg-local' }),
  v('English United States', 'en_US', { voiceURI: 'en-us-x-iom-local' }),
  v('English India', 'en_IN', { voiceURI: 'en-in-x-ene-local' }),
  v('Kannada India', 'kn_IN', { voiceURI: 'kn-in-x-knf-network', localService: false }),
  v('Kannada India', 'kn_IN', { voiceURI: 'kn-in-x-knf-local' }),
];
/** iOS WebView: compact voices, plus enhanced / Siri ones only if she installed them. */
const IOS_STOCK: SynthVoice[] = [v('Samantha', 'en-US', { default: true }), v('Daniel', 'en-GB'), v('Rishi', 'en-IN')];
const IOS_NICE: SynthVoice[] = [...IOS_STOCK, v('Ava (Enhanced)', 'en-US'), v('Siri Voice 4', 'en-US')];

function memStore(): Storage {
  const data: Record<string, string> = {};
  return { get length() { return Object.keys(data).length; }, clear() { for (const k of Object.keys(data)) delete data[k]; },
    getItem: (k) => (k in data ? data[k] : null), key: (i) => Object.keys(data)[i] ?? null, removeItem(k) { delete data[k]; }, setItem(k, val) { data[k] = String(val); } } as Storage;
}

describe('ranking: what counts as a nicer voice', () => {
  it('Premium over Enhanced over on-device Google over plain', () => {
    expect(voiceTier(v('Ava (Premium)', 'en-US'))).toBe(3);
    expect(voiceTier(v('Samantha (Enhanced)', 'en-US'))).toBe(2);
    expect(voiceTier(v('Siri Voice 4', 'en-US'))).toBe(2);
    expect(voiceTier(ANDROID[1])).toBe(1);
    expect(voiceTier(v('Samantha', 'en-US'))).toBe(0);
    expect(isNoveltyVoice(v('Bad News', 'en-US'))).toBe(true);
    expect(isCloudVoice(MAC_STOCK[7])).toBe(true);
  });
});

describe('the picker', () => {
  it('Mac with Premium voices installed: a Premium voice, in her region', () => {
    const picked = pickSpokenVoice(MAC_NICE, { lang: 'en-US' })!;
    expect(voiceTier(picked)).toBe(3);
    expect(['Ava (Premium)', 'Zoe (Premium)']).toContain(picked.name);
  });

  it('Mac with only Enhanced voices: an Enhanced one', () => {
    const list = MAC_NICE.filter((x) => voiceTier(x) !== 3);
    expect(pickSpokenVoice(list, { lang: 'en-US' })!.name).toMatch(/\(Enhanced\)$/);
  });

  it('stock Mac: an ordinary on-device voice — never a joke voice, never Chrome\'s online Google voice', () => {
    const picked = pickSpokenVoice(MAC_STOCK, { lang: 'en-US' })!;
    expect(picked.localService).toBe(true);
    expect(isNoveltyVoice(picked)).toBe(false);
    expect(picked.name).toBe('Samantha');
  });

  it('NEVER picks a cloud voice (localService === false) unless she opted in — not even a saved one', () => {
    for (const list of [MAC_STOCK, MAC_NICE, ANDROID, IOS_STOCK]) {
      for (const lang of ['en-US', 'en-GB', 'kn-IN', 'hi-IN']) {
        const p = pickSpokenVoice(list, { lang });
        if (p) expect(p.localService, `${p.name} for ${lang}`).not.toBe(false);
      }
    }
    const savedCloud = { voiceURI: MAC_STOCK[7].voiceURI, name: 'Google US English', lang: 'en-US' };
    expect(pickSpokenVoice(MAC_STOCK, { lang: 'en-US', saved: savedCloud })!.localService).toBe(true);
    expect(pickSpokenVoice([MAC_STOCK[7]], { lang: 'en-US' })).toBeNull(); // only cloud voices: none is used
    // Opted in: her saved online voice is honoured.
    expect(pickSpokenVoice(MAC_STOCK, { lang: 'en-US', saved: savedCloud, allowCloud: true })!.name).toBe('Google US English');
  });

  it('Android: the on-device Google voice ("…-local"), not the network twin', () => {
    const picked = pickSpokenVoice(ANDROID, { lang: 'en-US' })!;
    expect(picked.voiceURI).toMatch(/^en-us-x-[a-z]+-local$/);
    expect(pickSpokenVoice(ANDROID, { lang: 'en-IN' })!.voiceURI).toBe('en-in-x-ene-local');
  });

  it('Kannada pack on: a kn-IN voice — on a Mac and on Android (the local one)', () => {
    expect(pickSpokenVoice(MAC_NICE, { lang: 'kn-IN' })!.name).toBe('Soumya');
    expect(pickSpokenVoice(ANDROID, { lang: 'kn-IN' })!.voiceURI).toBe('kn-in-x-knf-local');
    // No Kannada voice installed: the pick is not a Kannada speaker, so Kannada text is not read aloud.
    expect(voiceSpeaks(pickSpokenVoice(MAC_STOCK, { lang: 'kn-IN' }), 'kn-IN')).toBe(false);
    expect(voiceSpeaks(pickSpokenVoice(MAC_NICE, { lang: 'kn-IN' }), 'kn-IN')).toBe(true);
  });

  it('iOS WebView: enhanced / Siri voices when installed, else falls back to the compact voice', () => {
    expect(voiceTier(pickSpokenVoice(IOS_NICE, { lang: 'en-US' })!)).toBe(2);
    expect(pickSpokenVoice(IOS_STOCK, { lang: 'en-US' })!.name).toBe('Samantha');
    expect(pickSpokenVoice([], { lang: 'en-US' })).toBeNull(); // the list not loaded yet: the system default speaks
  });

  it('her saved on-device choice wins over the automatic pick and is remembered', () => {
    const store = memStore();
    saveVoice(v('Daniel', 'en-GB'), store);
    const speaker = createSpeaker({ synth: { getVoices: () => MAC_NICE as RawVoice[], cancel() {}, speak() {} }, makeUtterance: (text) => ({ text, rate: 1, pitch: 1, lang: '', voice: null }), storage: store });
    expect(speaker.voiceFor('en-US')!.name).toBe('Daniel');
  });

  it('the list she picks from: this language, nicest first, no joke voices, no cloud voices until she allows them', () => {
    const names = listPickerVoices(MAC_NICE, { lang: 'en-US' }).map((x) => x.name);
    expect(voiceTier(v(names[0], 'en-US'))).toBe(3);
    expect(names).not.toContain('Bad News');
    expect(names).not.toContain('Google US English');
    expect(names).not.toContain('Soumya');
    expect(listPickerVoices(MAC_NICE, { lang: 'en-US', allowCloud: true }).map((x) => x.name)).toContain('Google US English');
    expect(voiceKindLabel(MAC_STOCK[7])).toMatch(/^Online — text is sent/);
    expect(voiceKindLabel(v('Ava (Premium)', 'en-US'))).toBe('Premium · on this device');
  });
});

describe('opt-in and the Mac hint', () => {
  it('online voices are off until she turns them on; reading aloud is ON by default; both are remembered', () => {
    const store = memStore();
    expect(loadAllowCloud(store)).toBe(false);
    expect(loadReadAloud(store)).toBe(true);
    saveAllowCloud(true, store); saveReadAloud(false, store);
    expect(loadAllowCloud(store)).toBe(true);
    expect(store.getItem(CLOUD_VOICE_KEY)).toBe('1');
    expect(loadReadAloud(store)).toBe(false); // her "off" is kept
    saveReadAloud(true, store);
    expect(loadReadAloud(store)).toBe(true);
    saveAllowCloud(false, store);
    expect(loadAllowCloud(store)).toBe(false);
  });

  it('platform from the user agent (an iPad reports itself as a Mac with touch)', () => {
    expect(speechPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130')).toBe('mac');
    expect(speechPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios');
    expect(speechPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('ios');
    expect(speechPlatform('Mozilla/5.0 (Linux; Android 15; A001)')).toBe('android');
    expect(speechPlatform('Mozilla/5.0 (Windows NT 10.0)')).toBe('other');
  });

  it('a Mac with no Premium / Enhanced voice gets the download hint — once; nobody else does', () => {
    const store = memStore();
    expect(needsMacVoiceHint(MAC_STOCK, 'mac')).toBe(true);
    expect(needsMacVoiceHint(MAC_NICE, 'mac')).toBe(false);
    expect(needsMacVoiceHint(IOS_STOCK, 'ios')).toBe(false);
    expect(needsMacVoiceHint(ANDROID, 'android')).toBe(false);
    expect(needsMacVoiceHint([], 'mac')).toBe(false); // the voice list has not loaded: say nothing yet
    expect(macVoiceHintOnce(MAC_STOCK, 'mac', 'en-US', store)).toBe(MAC_VOICE_HINT);
    expect(macVoiceHintOnce(MAC_STOCK, 'mac', 'en-US', store)).toBeNull();
    expect(MAC_VOICE_HINT).toBe("For a nicer voice: System Settings → Accessibility → Spoken Content → System voice → Manage Voices → download 'Ava (Premium)'.");
  });
});

function fakeSynth(voices: SynthVoice[]) {
  const log: string[] = [];
  const spoken: UtteranceLike[] = [];
  return {
    log, spoken,
    synth: { getVoices: () => voices as RawVoice[], cancel() { log.push('cancel'); }, speak(u: UtteranceLike) { log.push(`speak:${u.text}`); spoken.push(u); } },
    makeUtterance: (text: string): UtteranceLike => ({ text, rate: 1, pitch: 1, lang: '', voice: null }),
  };
}

describe('speaking', () => {
  it('a little slower for clarity, with the picked on-device voice, and never over itself', () => {
    const f = fakeSynth(MAC_NICE);
    const speaker = createSpeaker({ synth: f.synth, makeUtterance: f.makeUtterance, storage: memStore() });
    expect(speaker.speak('Lights on.')).toBe(true);
    expect(speaker.speak('Dimmed Desk lamp.')).toBe(true);
    expect(f.log).toEqual(['cancel', 'speak:Lights on.', 'cancel', 'speak:Dimmed Desk lamp.']); // the earlier line is cancelled first
    expect(f.spoken[0].rate).toBe(SPEECH_RATE);
    expect(SPEECH_RATE).toBeCloseTo(0.95);
    expect(f.spoken[0].pitch).toBe(SPEECH_PITCH);
    expect(voiceTier(f.spoken[0].voice as SynthVoice)).toBe(3);
    expect(f.spoken[0].voice!.localService).toBe(true);
  });

  it('Kannada is spoken with a Kannada voice, or not at all', () => {
    const withKn = fakeSynth(MAC_NICE);
    createSpeaker({ synth: withKn.synth, makeUtterance: withKn.makeUtterance, storage: memStore() }).speak('ದೀಪ ಆನ್ ಆಯಿತು.', { lang: 'kn-IN' });
    expect(withKn.spoken[0].voice!.name).toBe('Soumya');
    const without = fakeSynth(MAC_STOCK);
    expect(createSpeaker({ synth: without.synth, makeUtterance: without.makeUtterance, storage: memStore() }).speak('ದೀಪ ಆನ್ ಆಯಿತು.', { lang: 'kn-IN' })).toBe(false);
    expect(without.spoken).toEqual([]);
  });

  it('no speech in this browser, or an empty line: nothing happens and nothing throws', () => {
    expect(createSpeaker({ synth: null }).speak('hello')).toBe(false);
    const f = fakeSynth(MAC_STOCK);
    expect(createSpeaker({ synth: f.synth, makeUtterance: f.makeUtterance, storage: memStore() }).speak('   ')).toBe(false);
    expect(f.log).toEqual([]);
  });

  it('the studio and the pairing code have no speech path of their own left (they go through the speaker)', () => {
    // Structural guard only — the behaviour is tested below, on the speaker they all use.
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main).not.toMatch(/new SpeechSynthesisUtterance/);
    expect(main).not.toMatch(/speechSynthesis\.speak\(/);
    expect(readFileSync('src/ux/pairingChime.ts', 'utf8')).not.toMatch(/new SpeechSynthesisUtterance|speechSynthesis\.speak\(/);
  });
});

describe('privacy: with "Online voices" off, no text can reach a cloud voice', () => {
  /** The browser as the app sees it: a global speechSynthesis + SpeechSynthesisUtterance. */
  function withBrowser<T>(voices: SynthVoice[], run: (b: { spoken: UtteranceLike[]; setVoices(v: SynthVoice[]): void; fireVoicesChanged(): void }) => T): T {
    const g = globalThis as unknown as Record<string, unknown>;
    const before = { synth: g.speechSynthesis, utter: g.SpeechSynthesisUtterance };
    let list = voices;
    const spoken: UtteranceLike[] = [];
    const listeners: Array<() => void> = [];
    g.speechSynthesis = { getVoices: () => list, cancel() {}, speak(u: UtteranceLike) { spoken.push(u); }, addEventListener(_t: string, f: () => void) { listeners.push(f); } };
    g.SpeechSynthesisUtterance = function Utterance(this: UtteranceLike, text: string) { this.text = text; this.rate = 1; this.pitch = 1; this.lang = ''; this.voice = null; };
    try { return run({ spoken, setVoices(v) { list = v; }, fireVoicesChanged() { listeners.forEach((f) => f()); } }); }
    finally { g.speechSynthesis = before.synth; g.SpeechSynthesisUtterance = before.utter; }
  }
  const CLOUD_ONLY = [v('Google US English', 'en-US', { localService: false }), v('Google UK English Female', 'en-GB', { localService: false })];

  it('voice list empty (not loaded yet): nothing is spoken — the browser default is never trusted', () => {
    withBrowser([], (b) => {
      expect(createSpeaker({ storage: memStore() }).speak('Lights on.')).toBe(false);
      expect(b.spoken).toEqual([]);
    });
  });

  it('…and the line is spoken with an on-device voice once the list arrives, if that is soon', () => {
    withBrowser([], (b) => {
      let t = 1000;
      const speaker = createSpeaker({ storage: memStore(), now: () => t });
      speaker.speak('Lights on.');
      b.setVoices(MAC_NICE); t += 400; b.fireVoicesChanged();
      expect(b.spoken.map((u) => u.text)).toEqual(['Lights on.']);
      expect(b.spoken[0].voice!.localService).toBe(true);
      // A line that waited too long is dropped, not blurted out later.
      b.setVoices([]); speaker.speak('Saved.'); b.setVoices(MAC_NICE); t += 10_000; b.fireVoicesChanged();
      expect(b.spoken).toHaveLength(1);
    });
  });

  it('only cloud voices installed: nothing is spoken — auto-pick, an explicit cloud voice, and a saved one alike', () => {
    withBrowser(CLOUD_ONLY, (b) => {
      const store = memStore();
      const speaker = createSpeaker({ storage: store });
      expect(speaker.speak('Lights on.')).toBe(false);
      expect(speaker.speak('Hello, this is Mendcraft.', { voice: CLOUD_ONLY[0] })).toBe(false); // a preview / "voice set" line
      expect(speaker.speak('Voice set.', { voice: null })).toBe(false); // "change voice" with nothing to speak it
      saveVoice(CLOUD_ONLY[0], store);
      expect(speaker.speak('Lights on.')).toBe(false);
      expect(b.spoken).toEqual([]);
    });
  });

  it('the list arrived but holds only cloud voices: still silent', () => {
    withBrowser([], (b) => {
      const speaker = createSpeaker({ storage: memStore() });
      speaker.speak('Lights on.');
      b.setVoices(CLOUD_ONLY); b.fireVoicesChanged();
      expect(b.spoken).toEqual([]);
    });
  });

  it('a voice we cannot find in the browser\'s list is not spoken with the default instead', () => {
    withBrowser(MAC_STOCK, (b) => {
      expect(createSpeaker({ storage: memStore() }).speak('Hello.', { voice: v('Ghost', 'en-US') })).toBe(false);
      expect(b.spoken).toEqual([]);
    });
  });

  it('"Online voices" turned on: now it speaks — with the cloud voice she chose, or the default when none is named', () => {
    withBrowser(CLOUD_ONLY, (b) => {
      const store = memStore();
      saveAllowCloud(true, store);
      const speaker = createSpeaker({ storage: store });
      expect(speaker.speak('Lights on.')).toBe(true);
      expect(b.spoken[0].voice!.name).toBe('Google US English');
    });
    withBrowser([], (b) => {
      const store = memStore();
      saveAllowCloud(true, store);
      expect(createSpeaker({ storage: store }).speak('Lights on.')).toBe(true);
      expect(b.spoken[0].voice).toBeNull();
    });
  });

  it('a mixed list (stock Mac in Chrome): the on-device voice speaks, never the Google one', () => {
    withBrowser(MAC_STOCK, (b) => {
      const speaker = createSpeaker({ storage: memStore() });
      for (const line of ['Lights on.', 'Dimmed Desk lamp.', 'Saved.']) speaker.speak(line);
      expect(b.spoken).toHaveLength(3);
      for (const u of b.spoken) expect(u.voice!.localService).toBe(true);
    });
  });

  it('the studio\'s list: cloud voices cannot be listed, previewed or picked until online voices are on', () => {
    expect(usableVoices(MAC_STOCK, false).some(isCloudVoice)).toBe(false);
    expect(usableVoices(MAC_STOCK, false).map((x) => x.name)).toContain('Samantha');
    expect(usableVoices(MAC_STOCK, true).some(isCloudVoice)).toBe(true);
    expect(usableVoices(CLOUD_ONLY, false)).toEqual([]);
  });
});

describe('the Voice sheet (More → Voice)', () => {
  interface El { tag: string; className: string; hidden: boolean; kids: El[]; attrs: Record<string, string>; on: Record<string, Array<(e: unknown) => void>>;
    textContent: string; setAttribute(n: string, val: string): void; getAttribute(n: string): string | null; append(...c: El[]): void; addEventListener(t: string, f: (e: unknown) => void): void; click(): void }
  function doc() {
    return { createElement(tag: string): El {
      let text = '';
      const el = { tag, className: '', hidden: false, kids: [] as El[], attrs: {} as Record<string, string>, on: {} as Record<string, Array<(e: unknown) => void>>,
        setAttribute(n: string, val: string) { el.attrs[n] = val; }, getAttribute: (n: string) => el.attrs[n] ?? null,
        append(...c: El[]) { el.kids.push(...c); }, addEventListener(t: string, f: (e: unknown) => void) { (el.on[t] ??= []).push(f); },
        click() { (el.on.click ?? []).forEach((f) => f({})); } } as unknown as El;
      Object.defineProperty(el, 'textContent', { get: () => text + el.kids.map((k) => k.textContent).join(''), set: (val: string) => { text = val; el.kids.length = 0; } });
      return el;
    } };
  }
  const find = (el: El, cls: string): El[] => [...(el.className.split(' ').includes(cls) ? [el] : []), ...el.kids.flatMap((k) => find(k, cls))];
  function open(voices: SynthVoice[], platform: 'mac' | 'ios' | 'android', store = memStore()) {
    const f = fakeSynth(voices);
    const speaker = createSpeaker({ synth: f.synth, makeUtterance: f.makeUtterance, storage: store });
    const said: string[] = [];
    const d = doc();
    const root = d.createElement('div');
    const sheet = mountVoiceSheet(root as never, { speaker, lang: () => 'en-US', platform, storage: store, say: (t) => said.push(t) }, d as never);
    sheet.open();
    return { root, sheet, f, said, store, speaker };
  }

  it('lists the installed voices nicest first, each with a Test button that speaks with THAT voice', () => {
    const s = open(MAC_NICE, 'mac');
    const rows = find(s.root, 'mc-voice-row');
    expect(rows.length).toBeGreaterThan(4);
    expect(find(rows[0], 'mc-voice-name')[0].textContent).toMatch(/\(Premium\)$/);
    expect(find(rows[0], 'mc-voice-pick')[0].attrs['aria-pressed']).toBe('true'); // the one in use
    const samantha = rows.find((r) => find(r, 'mc-voice-name')[0].textContent === 'Samantha')!;
    find(samantha, 'mc-voice-test')[0].click();
    expect(s.f.spoken.at(-1)!.voice!.name).toBe('Samantha');
    expect(s.f.spoken.at(-1)!.text).toBe('Hello, this is Mendcraft.');
    expect(find(s.root, 'mc-voice-hint')[0].hidden).toBe(true); // nice voices installed: no hint
  });

  it('choosing a voice remembers it and confirms in that voice', () => {
    const s = open(MAC_NICE, 'mac');
    const row = find(s.root, 'mc-voice-row').find((r) => find(r, 'mc-voice-name')[0].textContent === 'Evan (Enhanced)')!;
    find(row, 'mc-voice-pick')[0].click();
    expect(s.said.at(-1)).toBe('Voice set to Evan (Enhanced).');
    expect(s.speaker.voiceFor('en-US')!.name).toBe('Evan (Enhanced)');
    expect(s.f.spoken.at(-1)!.voice!.name).toBe('Evan (Enhanced)');
    // …and a fresh speaker on the same device still uses it.
    const again = createSpeaker({ synth: s.f.synth, makeUtterance: s.f.makeUtterance, storage: s.store });
    expect(again.voiceFor('en-US')!.name).toBe('Evan (Enhanced)');
  });

  it('a stock Mac shows the download hint once; online voices are not listed until she turns them on', () => {
    const store = memStore();
    const s = open(MAC_STOCK, 'mac', store);
    expect(find(s.root, 'mc-voice-hint')[0].hidden).toBe(false);
    expect(find(s.root, 'mc-voice-hint')[0].textContent).toBe(MAC_VOICE_HINT);
    const names = () => find(s.root, 'mc-voice-name').map((n) => n.textContent);
    expect(names()).not.toContain('Google US English');
    expect(names()).not.toContain('Bad News');
    const online = find(s.root, 'mc-voice-toggle').find((b) => /Online voices/.test(b.textContent))!;
    expect(online.attrs['aria-pressed']).toBe('false');
    online.click();
    expect(names()).toContain('Google US English');
    expect(s.said.at(-1)).toMatch(/text leaves this device/);
    // Opened again later: the hint has been shown already.
    s.sheet.close();
    expect(find(open(MAC_STOCK, 'mac', store).root, 'mc-voice-hint')[0].hidden).toBe(true);
  });

  it('phones get the same sheet, and no Mac hint', () => {
    const ios = open(IOS_STOCK, 'ios');
    expect(find(ios.root, 'mc-voice-row').length).toBe(3);
    expect(find(ios.root, 'mc-voice-hint')[0].hidden).toBe(true);
    expect(find(open(ANDROID, 'android').root, 'mc-voice-kind')[0].textContent).toMatch(/On this device/);
    expect(PHONE_GROUPS.flatMap((g) => g.cmds)).toContain('voice');
  });

  it('"Read replies aloud" is on by default; turning it off is remembered', () => {
    const s = open(MAC_NICE, 'mac');
    const read = () => find(s.root, 'mc-voice-toggle').find((b) => /Read replies aloud/.test(b.textContent))!;
    expect(read().attrs['aria-pressed']).toBe('true');
    read().click();
    expect(read().attrs['aria-pressed']).toBe('false');
    expect(loadReadAloud(s.store)).toBe(false);
  });
});

describe('wiring', () => {
  it('"change voice" opens the picker; "use the Ava voice" sets it; ordinary commands are untouched', () => {
    const world = { hasPlanBoard: false, devices: [] };
    expect(routeLine('change voice', world)).toEqual({ name: 'voice', intent: { action: 'open' } });
    expect(routeLine('use the Ava voice', world)).toEqual({ name: 'voice', intent: { action: 'set', query: 'ava' } });
    expect(routeLine('preview voice', world)).toEqual({ name: 'voice', intent: { action: 'preview' } });
    expect(routeLine('show everything', world).name).toBe('canvas');
    expect(parseChangeVoice('turn on the desk lamp')).toBeNull();
  });

  it('More has a Voice entry; replies are read aloud only when she turned that on', () => {
    const app = readFileSync('src/canvas/canvasApp.ts', 'utf8');
    expect(app).toMatch(/<button data-cmd="voice" class="mc-btn">Voice<\/button>/);
    expect(app).toMatch(/voice: \(\) => voiceSheet\.open\(\)/);
    expect(app).toMatch(/if \(readAloud && t && t !== LISTENING_STATUS\) speaker\.speak\(/);
    expect(app).toMatch(/let readAloud = loadReadAloud\(voiceStore\);/);
  });
});
