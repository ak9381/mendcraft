// The backup voice: when Chrome's speech wedges (a line never starts), the
// Mac's own voice (`say` through the local bridge) says what Chrome owes and
// every line after it, until Chrome starts a line again.
import { describe, expect, it } from 'vitest';
import { backupLineMs, backupRate, createSpeaker, PROBE_MS, STUCK_MS, type RawVoice, type UtteranceLike } from '../src/ai/speaker';

function fakeSynth() {
  const voices: RawVoice[] = [{ voiceURI: 'Samantha', name: 'Samantha', lang: 'en-US', localService: true }];
  const queue: UtteranceLike[] = [];
  let cancels = 0;
  return {
    synth: { speaking: false, pending: false, getVoices: () => voices, cancel: () => { cancels++; queue.length = 0; }, speak: (u: UtteranceLike) => { queue.push(u); } },
    queue, cancels: () => cancels,
  };
}
/** Fake timers by delay; fire(ms) runs the earliest armed one with that delay. */
function timers() {
  const armed: { f: () => void; ms: number }[] = [];
  return {
    setTimer: (f: () => void, ms: number) => { const t = { f, ms }; armed.push(t); return t; },
    clearTimer: (h: unknown) => { const i = armed.indexOf(h as never); if (i >= 0) armed.splice(i, 1); },
    fire(ms: number) { const i = armed.findIndex((t) => t.ms === ms); if (i < 0) return false; const [t] = armed.splice(i, 1); t.f(); return true; },
    has: (ms: number) => armed.some((t) => t.ms === ms),
    count: () => armed.length,
  };
}
function fakeBackup(ok = true) {
  const said: { text: string; voice?: string; rate?: number }[] = [];
  let stops = 0;
  return { said, stops: () => stops, backup: { say: async (text: string, o: { voice?: string; rate?: number }) => { said.push({ text, ...o }); return ok; }, stop: () => { stops++; } } };
}
const mem = (): Storage => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, clear: () => m.clear(), key: () => null, get length() { return m.size; } } as Storage; };
const utter = (text: string): UtteranceLike => ({ text, rate: 1, pitch: 1, lang: '', voice: null });
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(ok = true) {
  const f = fakeSynth();
  const tm = timers();
  const b = fakeBackup(ok);
  const events: string[] = [];
  const sp = createSpeaker({
    synth: f.synth, makeUtterance: utter, storage: mem(), activated: () => true, ...tm, backup: b.backup,
    onStuck: (s) => events.push(s ? 'stuck' : 'unstuck'), onBackup: (on) => events.push(on ? 'backup' : 'chrome'),
  });
  return { f, tm, b, events, sp };
}

describe('speaker: the backup voice for a stuck Chrome', () => {
  it('no start in 8 s: the backup says what Chrome owes, once, in order', async () => {
    const { f, tm, b, events, sp } = setup();
    sp.speak('First sentence.');
    sp.enqueue('Second one.');
    expect(f.queue).toHaveLength(2);
    expect(tm.fire(STUCK_MS)).toBe(true);
    await flush();
    expect(b.said.map((x) => x.text)).toEqual(['First sentence.']);
    expect(b.said[0].voice).toBe('Samantha');
    expect(b.said[0].rate).toBe(backupRate(0.95));
    expect(events).toEqual(['stuck', 'backup']);
    // The next owed sentence waits out the first one's estimated length.
    expect(tm.fire(backupLineMs('First sentence.'))).toBe(true);
    await flush();
    expect(b.said.map((x) => x.text)).toEqual(['First sentence.', 'Second one.']);
    // Nothing was cancelled in Chrome (a cancel can wedge it).
    expect(f.cancels()).toBe(0);
  });
  it('while stuck, new lines go to the backup only: speak replaces, enqueue waits its turn', async () => {
    const { f, tm, b, sp } = setup();
    sp.speak('Lamp on.');
    tm.fire(STUCK_MS);
    await flush();
    const inChrome = f.queue.length;
    let started = 0;
    expect(sp.speak('Lamp off.', { onStart: () => { started++; } })).toBe(true);
    expect(b.stops()).toBe(1); // the last line stops first
    sp.enqueue('And dimmed.');
    await flush();
    expect(f.queue.length).toBe(inChrome); // nothing more into Chrome's wedged queue
    expect(b.said.map((x) => x.text)).toEqual(['Lamp on.', 'Lamp off.']);
    expect(started).toBe(1);
    tm.fire(backupLineMs('Lamp off.'));
    await flush();
    expect(b.said.map((x) => x.text)).toEqual(['Lamp on.', 'Lamp off.', 'And dimmed.']);
  });
  it('the probe: a silent line every 60 s; when it starts, Chrome is back (its late lines cancelled)', async () => {
    const { f, tm, b, events, sp } = setup();
    sp.speak('Lamp on.');
    tm.fire(STUCK_MS);
    await flush();
    expect(tm.fire(PROBE_MS)).toBe(true);
    const probe = f.queue.at(-1)!;
    expect(probe.text).toBe('.');
    expect(probe.volume).toBe(0);
    expect(tm.has(PROBE_MS)).toBe(true); // tried again later while still stuck
    probe.onstart?.();
    expect(f.cancels()).toBe(1);
    expect(sp.stuck()).toBe(false);
    expect(events).toEqual(['stuck', 'backup', 'chrome', 'unstuck']);
    expect(tm.has(PROBE_MS)).toBe(false);
    // Back to Chrome: the next line is Chrome's.
    const n = b.said.length;
    sp.speak('Back.');
    await flush();
    expect(f.queue.at(-1)!.text).toBe('Back.');
    expect(b.said.length).toBe(n);
  });
  it('a wedged line that starts late (already said by the backup) is cancelled, and Chrome is back', async () => {
    const { f, tm, sp } = setup();
    sp.speak('Lamp on.');
    const wedged = f.queue[0];
    tm.fire(STUCK_MS);
    await flush();
    wedged.onstart?.();
    expect(f.cancels()).toBe(1);
    expect(sp.stuck()).toBe(false);
  });
  it('stop() stops both voices and drops the queued sentences', async () => {
    const { tm, b, sp } = setup();
    sp.speak('One.');
    tm.fire(STUCK_MS);
    await flush();
    sp.enqueue('Two.');
    sp.stop();
    expect(b.stops()).toBe(1);
    expect(tm.fire(backupLineMs('One.'))).toBe(false);
    await flush();
    expect(b.said.map((x) => x.text)).toEqual(['One.']);
  });
  it('a backup that cannot speak (no bridge): lines go to Chrome as before, the chip says relaunch', async () => {
    const { f, tm, events, sp } = setup(false);
    sp.speak('Lamp on.');
    tm.fire(STUCK_MS);
    await flush();
    expect(events).toEqual(['stuck']);
    const n = f.queue.length;
    sp.speak('Lamp off.');
    expect(f.queue.length).toBe(n + 1);
  });
  it('no backup: unchanged (no probe, no extra timers)', () => {
    const f = fakeSynth();
    const tm = timers();
    const sp = createSpeaker({ synth: f.synth, makeUtterance: utter, storage: mem(), activated: () => true, ...tm });
    sp.speak('Lamp on.');
    tm.fire(STUCK_MS);
    expect(sp.stuck()).toBe(true);
    expect(tm.count()).toBe(0);
    sp.speak('Lamp off.');
    expect(f.queue.map((u) => u.text)).toEqual(['Lamp on.', 'Lamp off.']);
  });
  it('estimates and rates', () => {
    expect(backupLineMs('Hi.')).toBe(1200);
    expect(backupLineMs('x'.repeat(150))).toBe(10000);
    expect(backupRate(0.95)).toBe(171);
    expect(backupRate(0.1)).toBe(120);
    expect(backupRate(3)).toBe(260);
  });
});
