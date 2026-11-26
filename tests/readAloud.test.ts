// Read aloud is opt-in per line (ai/readAloud.ts): the founder heard a voice
// repeat a hint in a loop with Kannada on. Hints never speak; the same line is
// never spoken twice in 10 s; a status line replaces what was being said;
// with Kannada on and no kn-IN voice, nothing is spoken at all.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSpeaker, type RawVoice, type UtteranceLike } from '../src/ai/speaker';
import { createReadAloud, REPEAT_QUIET_MS, spokenLangFor, spokenText } from '../src/ai/readAloud';

const SAMANTHA: RawVoice = { voiceURI: 'com.apple.voice.premium.en-US.Samantha', name: 'Samantha (Premium)', lang: 'en-US', localService: true };
const SOUMYA: RawVoice = { voiceURI: 'com.apple.voice.compact.kn-IN.Soumya', name: 'Soumya', lang: 'kn-IN', localService: true };

function memStore(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}

function rig(o: { voices?: RawVoice[]; pack?: string | null; on?: boolean } = {}) {
  const spoken: UtteranceLike[] = [];
  let queue: UtteranceLike[] = [];
  let cancels = 0;
  let clock = 1_000;
  const synth = {
    getVoices: () => o.voices ?? [SAMANTHA],
    cancel: () => { cancels++; queue = []; },
    speak: (u: UtteranceLike) => { spoken.push(u); queue.push(u); },
  };
  const speaker = createSpeaker({ synth, makeUtterance: (text) => ({ text, rate: 1, pitch: 1, lang: '', voice: null }), storage: memStore() });
  const state = { on: o.on ?? true, pack: o.pack ?? null };
  const ra = createReadAloud({ speaker, enabled: () => state.on, packLang: () => state.pack, now: () => clock });
  return { ra, spoken, state, queued: () => queue.length, cancels: () => cancels, tick: (ms: number) => { clock += ms; } };
}

describe('read aloud: opt-in lines only', () => {
  it('an AI reply speaks', () => {
    const r = rig();
    expect(r.ra.sentence('The lamp is in the living room.', true)).toBe(true);
    expect(r.spoken.map((u) => u.text)).toEqual(['The lamp is in the living room.']);
    expect(r.spoken[0].lang).toBe('en-US');
  });

  it('the same line twice within 10 s speaks once; after 10 s it may speak again', () => {
    const r = rig();
    expect(r.ra.line('Lights on.')).toBe(true);
    r.tick(4_000);
    expect(r.ra.line('Lights on.')).toBe(false);
    r.tick(REPEAT_QUIET_MS - 4_000);
    expect(r.ra.line('Lights on.')).toBe(true);
    expect(r.spoken.length).toBe(2);
  });

  it('a status line replaces whatever was being said (never a backlog)', () => {
    const r = rig();
    r.ra.sentence('First sentence of a reply.', true);
    r.ra.sentence('Second sentence.', false);
    expect(r.queued()).toBe(2);
    r.ra.line('Blocked a plan that did not pass the check.');
    expect(r.queued()).toBe(1);
    r.ra.line('Lights off.');
    expect(r.queued()).toBe(1);
  });

  it('Kannada on with no kn-IN voice: silent — no English fallback, no button names', () => {
    const r = rig({ voices: [SAMANTHA], pack: 'kn' });
    expect(r.ra.line('ದೀಪ ಆನ್ ಆಯಿತು.')).toBe(false);
    expect(r.ra.line('Lights on.')).toBe(false);
    expect(r.ra.line('Cancel')).toBe(false);
    expect(r.ra.sentence('The lamp is on.', true)).toBe(false);
    expect(r.spoken).toEqual([]);
  });

  it('Kannada on with a kn-IN voice: Kannada lines speak in kn-IN, English lines stay silent', () => {
    const r = rig({ voices: [SAMANTHA, SOUMYA], pack: 'kn' });
    expect(r.ra.line('ದೀಪ ಆನ್ ಆಯಿತು.')).toBe(true);
    expect(r.ra.line('Lights on.')).toBe(false);
    expect(r.spoken.map((u) => u.lang)).toEqual(['kn-IN']);
  });

  it('read aloud off: nothing speaks; the SIM prefix is never read', () => {
    const off = rig({ on: false });
    expect(off.ra.line('Lights on.')).toBe(false);
    expect(spokenText('SIM · Playing Jazz on the speaker.')).toBe('Playing Jazz on the speaker.');
    expect(spokenText('SIM: iPhone joined.')).toBe('iPhone joined.');
    expect(spokenLangFor('Lights on.', null)).toBe('en-US');
    expect(spokenLangFor('Lights on.', 'kn')).toBeNull();
  });
});

describe('read aloud: wiring in the canvas', () => {
  const app = readFileSync('src/canvas/canvasApp.ts', 'utf8');
  const gc = readFileSync('src/canvas/gestureControl.ts', 'utf8');

  it('say() speaks only when the caller opts in, and the mic opening stops the voice', () => {
    const say = app.slice(app.indexOf('const say = (t: string'), app.indexOf('/** A reply shown and spoken AS IT ARRIVES'));
    expect(say).toContain('if (t === LISTENING_STATUS) readAloudLines.stop();');
    expect(say).toContain('else if (o.speak) readAloudLines.line(');
    expect(say).not.toMatch(/speaker\.speak\(/);
  });

  it('a gesture hint (nothing to press) is passed to say() without { speak }', () => {
    expect(gc).toMatch(/opts\.say\?\.\(a\.why\);/);
    expect(app).toMatch(/createGestureControl\(\{[\s\S]{0,200}\n\s+say,\n/);
  });

  it('opted in: replies, review titles, command results, refusals and pairing outcomes', () => {
    expect(app).toContain('readAloudLines.line(model.title);');
    expect(app).toContain('say(statusText(sk, pack), { speak: true });');
    expect(app).toContain("say('Blocked a plan that did not pass the check.', { speak: true })");
    expect(readFileSync('src/canvas/pairedRow.ts', 'utf8')).toContain("joined.`, { speak: true });");
    // Never: hands on, hints, facing, "Listening…".
    expect(app).toContain("say('Hands on. Palm to point · fist to click · hold a fist to move.');");
  });
});
