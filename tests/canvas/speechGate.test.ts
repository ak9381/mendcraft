import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSpeechGate, SOUND_OFF_CHIP, VOICE_STUCK_LINE } from '../../src/ai/speechGate';
import { createSpeaker, STUCK_MS, type RawVoice, type UtteranceLike } from '../../src/ai/speaker';
import type { ReadAloud } from '../../src/ai/readAloud';

function innerFake() {
  const spoken: string[] = [];
  const inner: ReadAloud = { line: (t) => { spoken.push(t); return true; }, sentence: (t) => { spoken.push(t); return true; }, stop: () => undefined };
  return { inner, spoken };
}
function gateWith(active: { v: boolean }) {
  const { inner, spoken } = innerFake();
  const chips: (string | null)[] = [];
  const logs: string[] = [];
  let gesture: (() => void) | null = null;
  const gate = createSpeechGate(inner, {
    hasBeenActive: () => active.v, enabled: () => true,
    chip: (t) => chips.push(t), onFirstGesture: (f) => { gesture = f; }, log: (l) => logs.push(l),
  });
  return { gate, spoken, chips, logs, click: () => { active.v = true; gesture?.(); } };
}

describe('speech gate: no click yet', () => {
  it('holds the line, keeps the chip up, and speaks it on the first gesture', () => {
    const g = gateWith({ v: false });
    expect(g.gate.line('Lamp on.')).toBe(false);
    expect(g.gate.line('Done: device. Say something else.')).toBe(false);
    expect(g.spoken).toEqual([]);
    expect(g.gate.chipText()).toBe(SOUND_OFF_CHIP);
    expect(g.chips).toEqual([SOUND_OFF_CHIP]); // shown once, never faded
    expect(g.gate.held()).toBe('Done: device. Say something else.');
    expect(g.logs).toEqual(['speech: blocked (no click yet)']);
    g.click();
    expect(g.spoken).toEqual(['Done: device. Say something else.']);
    expect(g.gate.chipText()).toBeNull();
    expect(g.chips.at(-1)).toBeNull();
    expect(g.gate.line('Lamp off.')).toBe(true);
    expect(g.spoken.at(-1)).toBe('Lamp off.');
  });
  it('a reply held sentence by sentence is spoken whole', () => {
    const g = gateWith({ v: false });
    g.gate.sentence('A gimbal holds the phone.', true);
    g.gate.sentence('It follows your face.', false);
    g.click();
    expect(g.spoken).toEqual(['A gimbal holds the phone. It follows your face.']);
  });
  it('read aloud off: nothing is held, no chip', () => {
    const { inner } = innerFake();
    const chips: (string | null)[] = [];
    const gate = createSpeechGate({ ...inner, line: () => false }, { hasBeenActive: () => false, enabled: () => false, chip: (t) => chips.push(t), onFirstGesture: () => undefined });
    expect(gate.line('x')).toBe(false);
    expect(chips).toEqual([]);
    expect(gate.held()).toBeNull();
  });
});

describe('speech gate: voice stuck in Chrome', () => {
  it('shows the relaunch chip while stuck; lines still tried; chip goes when voice is back', () => {
    const g = gateWith({ v: true });
    g.gate.setStuck(true);
    expect(g.gate.chipText()).toBe(VOICE_STUCK_LINE);
    expect(g.gate.line('Lamp on.')).toBe(true);
    g.gate.setStuck(false);
    expect(g.gate.chipText()).toBeNull();
    expect(g.logs.join('\n')).toMatch(/stuck in Chrome/);
  });
});

/** A synth like Chrome's when it hangs: utterances queue, onstart never fires. */
function fakeSynth(o: { starts: boolean }) {
  const voices: RawVoice[] = [{ voiceURI: 'Samantha', name: 'Samantha', lang: 'en-US', localService: true }];
  const queue: UtteranceLike[] = [];
  let cancels = 0;
  const synth = {
    getVoices: () => voices,
    cancel: () => { cancels++; queue.length = 0; },
    speak: (u: UtteranceLike) => { queue.push(u); if (o.starts) u.onstart?.(); },
  };
  return { synth, queue, cancels: () => cancels };
}
function fakeTimers() {
  let t: { f: () => void } | null = null;
  return { setTimer: (f: () => void, ms: number) => { expect(ms).toBe(STUCK_MS); t = { f }; return t; }, clearTimer: (h: unknown) => { if (h === t) t = null; }, fire: () => { const x = t; t = null; x?.f(); }, armed: () => !!t };
}
const mem = (): Storage => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, clear: () => m.clear(), key: () => null, get length() { return m.size; } } as Storage; };
const utter = (text: string): UtteranceLike => ({ text, rate: 1, pitch: 1, lang: '', voice: null });

describe('speaker: stuck detection', () => {
  it('a line that never starts on a clicked page: voice is marked stuck and nothing is cancelled (a cancel can wedge Chrome)', () => {
    const f = fakeSynth({ starts: false });
    const tm = fakeTimers();
    const stuck: boolean[] = [];
    const sp = createSpeaker({ synth: f.synth, makeUtterance: utter, storage: mem(), activated: () => true, onStuck: (s) => stuck.push(s), ...tm });
    expect(sp.speak('Lamp on.')).toBe(true);
    expect(tm.armed()).toBe(true);
    const before = f.cancels();
    tm.fire();
    expect(f.cancels()).toBe(before);
    expect(sp.stuck()).toBe(true);
    expect(stuck).toEqual([true]);
    // Still tried next time; when one finally starts, the stuck mark goes.
    sp.speak('Lamp off.');
    f.queue.at(-1)!.onstart?.();
    expect(sp.stuck()).toBe(false);
    expect(stuck).toEqual([true, false]);
  });
  it('not stuck before her first click (Chrome is only waiting for it)', () => {
    const f = fakeSynth({ starts: false });
    const tm = fakeTimers();
    const sp = createSpeaker({ synth: f.synth, makeUtterance: utter, storage: mem(), activated: () => false, onStuck: () => { throw new Error('no'); }, ...tm });
    sp.speak('Lamp on.');
    tm.fire();
    expect(sp.stuck()).toBe(false);
  });
  it('a line that starts is never stuck; a queued sentence is not timed', () => {
    const f = fakeSynth({ starts: true });
    const tm = fakeTimers();
    const sp = createSpeaker({ synth: f.synth, makeUtterance: utter, storage: mem(), activated: () => true, ...tm });
    sp.speak('Lamp on.');
    expect(tm.armed()).toBe(false);
    const g = fakeSynth({ starts: false });
    const tm2 = fakeTimers();
    const sp2 = createSpeaker({ synth: g.synth, makeUtterance: utter, storage: mem(), activated: () => true, ...tm2 });
    sp2.enqueue('and then this.');
    expect(tm2.armed()).toBe(false);
    // her own onStart still fires
    let started = 0;
    sp.speak('again', { onStart: () => { started++; } });
    expect(started).toBe(1);
  });
});

describe('canvas wiring', () => {
  it('the gate wraps read-aloud; the old fading hint is gone; the chip is styled', () => {
    const app = readFileSync('src/canvas/canvasApp.ts', 'utf8');
    expect(app).toContain('const readAloudLines = createSpeechGate(createReadAloud(');
    expect(app).toContain('onStuck: (stuck) => readAloudLines.setStuck(stuck)');
    expect(app).not.toContain('SPEECH_NEEDS_CLICK');
    const css = readFileSync('src/canvas/canvas.css', 'utf8');
    expect(css).toContain('.mc-speech-chip[hidden] { display: none; }');
  });
});
