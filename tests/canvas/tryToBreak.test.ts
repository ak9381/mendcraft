// "Try to break it": impossible requests are refused by real validation (never
// clamped), the responsible engine visibly fails, and the board is unchanged.
import { readFileSync } from 'node:fs';
import { recordedEngine } from '../helpers/recordedEngine';
import { describe, expect, it, vi } from 'vitest';
import { createDeviceStore } from '../../src/canvas/deviceActions';
import type { DeviceRef } from '../../src/canvas/deviceCommands';
import { routeLine } from '../../src/canvas/routeLine';
import { VOLUME_RANGE_REFUSAL, detectAttempt, impossibleAttempt, runBreakTurn, validateAttempt, type Attempt, LAMP_RANGE_REFUSAL } from '../../src/canvas/tryToBreak';

const devices: DeviceRef[] = [
  { id: 'lamp-a', label: 'Desk lamp', kind: 'lamp', on: true, brightness: 60 },
  { id: 'lamp-b', label: 'Ceiling light', kind: 'lamp', on: false, brightness: 40 },
  { id: 'speaker-a', label: 'Speaker', kind: 'music' },
];
const world = { hasPlanBoard: false, devices };

const fakePanel = () => {
  const lines: Array<[string, string]> = [];
  return { lines, log: (v: string, d: string) => { lines.push([v, d]); }, fail: (d: string) => { lines.push(['fail', d]); } };
};

describe('detectAttempt + validateAttempt', () => {
  it('500% brightness is an attempt the validator refuses with a plain reason', () => {
    const a = detectAttempt('set the desk lamp to 500% brightness', devices)!;
    expect(a).toMatchObject({ kind: 'brightness', deviceId: 'lamp-a', level: 500 });
    expect(validateAttempt(a, devices)).toEqual({ ok: false, reason: 'Lamps go from 10 to 100 %. Nothing changed.' });
    expect(LAMP_RANGE_REFUSAL).toBe('Lamps go from 10 to 100 %. Nothing changed.');
  });
  it('a 5000% request is not misread as 0 (off)', () => {
    const a = detectAttempt('set the desk lamp to 5000%', devices)!;
    expect(a.kind === 'brightness' && a.level).toBe(5000);
    expect(validateAttempt(a, devices).ok).toBe(false);
  });
  it('70 % is fine, and so is off (0)', () => {
    expect(validateAttempt(detectAttempt('set the desk lamp to 70%', devices)!, devices).ok).toBe(true);
    expect(validateAttempt(detectAttempt('set the desk lamp to 0%', devices)!, devices).ok).toBe(true);
  });
  it('a control for an oven that is not connected is refused', () => {
    const a = detectAttempt('add a control for the oven', devices)!;
    expect(a).toMatchObject({ kind: 'control', thing: 'oven' });
    expect(validateAttempt(a, devices)).toEqual({ ok: false, reason: "There's no oven connected. Nothing changed." });
  });
  it('a control for a connected device, or plain chat, is not an attempt', () => {
    expect(detectAttempt('add a control for the speaker', devices)).toBeNull();
    expect(detectAttempt('add a control for the room', devices)).toBeNull();
    expect(detectAttempt('what can you do', devices)).toBeNull();
  });
});

describe('routing (existing routes)', () => {
  it('500% goes to the device route; the oven ask is open-ended', () => {
    expect(routeLine('set the desk lamp to 500% brightness', world).name).toBe('device');
    expect(routeLine('add a control for the oven', world).name).toBe('openEnded');
  });
});

describe('runBreakTurn', () => {
  const setup = (text: string) => {
    const emitted: unknown[] = [];
    const run = vi.fn(async () => ({}));
    const store = createDeviceStore({ 'lamp-a': { on: true, brightness: 60 } as never }, { run }, (m) => emitted.push(m), () => 's');
    const attempt = detectAttempt(text, devices)!;
    return { store, run, before: JSON.stringify(store.all()), attempt, panel: fakePanel(), said: [] as string[], emitted };
  };
  const T = 'set the desk lamp to 500% brightness';
  // The reply a model gives for this ask (a recorded-reply fixture; src/ holds none).
  const replyFor = (a: Attempt): string => (a.kind === 'brightness' ? JSON.stringify({ deviceId: a.deviceId, brightness: a.level })
    : a.kind === 'volume' ? JSON.stringify({ deviceId: a.deviceId, volume: a.level }) : JSON.stringify({ add: 'control', for: a.thing }));

  it('a recorded SIM reply of the real-shaped attempt still gets refused', async () => {
    const t = setup(T);
    expect(JSON.parse(replyFor(t.attempt))).toEqual({ deviceId: 'lamp-a', brightness: 500 });
    const engine = recordedEngine('nano', replyFor(t.attempt), { delayMs: 0 });
    const r = await runBreakTurn(T, t.attempt, { engine, devices, panel: t.panel, say: (s) => t.said.push(s) });
    expect(r).toEqual({ refused: true, reason: 'Lamps go from 10 to 100 %. Nothing changed.' });
    expect(t.panel.lines.at(-1)).toEqual(['fail', 'Lamps go from 10 to 100 %. Nothing changed.']);
    expect(t.panel.lines.some(([, d]) => /SIM/.test(d))).toBe(true);
    expect(t.said).toEqual(['Lamps go from 10 to 100 %. Nothing changed.']);
    expect(JSON.stringify(t.store.all())).toBe(t.before);
    expect(t.run).not.toHaveBeenCalled();
    expect(t.emitted).toEqual([]);
  });

  it('a live model that quietly clamps to 100 is still refused (the request was 500)', async () => {
    const t = setup(T);
    const clamping = { ...recordedEngine('nano', '{"deviceId":"lamp-a","brightness":100}', { delayMs: 0 }), sim: false };
    const r = await runBreakTurn(T, t.attempt, { engine: clamping, devices, panel: t.panel, say: () => {} });
    expect(r.refused).toBe(true);
    expect(t.panel.lines.some(([, d]) => /SIM/.test(d))).toBe(false);
  });

  it('a model that never answers is given a short window, then the guard refuses alone (no long wait)', async () => {
    const t = setup(T);
    const hung = { id: 'nano' as const, sim: false, stream: (): Promise<string> => new Promise<string>(() => undefined) };
    const r = await runBreakTurn(T, t.attempt, { engine: hung, devices, panel: t.panel, say: () => {}, modelMs: 20 });
    expect(r.refused).toBe(true);
    expect(t.panel.lines.some(([, d]) => /didn’t answer in time/.test(d))).toBe(true);
    expect(JSON.stringify(t.store.all())).toBe(t.before);
  });

  it('refuses even when the engine throws (validation does not need the model)', async () => {
    const t = setup(T);
    const broken = { id: 'nano' as const, sim: false, stream: async (): Promise<string> => { throw new Error('boom'); } };
    const r = await runBreakTurn(T, t.attempt, { engine: broken, devices, panel: t.panel, say: () => {} });
    expect(r.refused).toBe(true);
    expect(t.panel.lines.at(-1)![0]).toBe('fail');
  });

  it('oven: refused with the plain reason', async () => {
    const attempt = detectAttempt('add a control for the oven', devices)!;
    const panel = fakePanel();
    const r = await runBreakTurn('add a control for the oven', attempt, { engine: recordedEngine('nano', replyFor(attempt), { delayMs: 0 }), devices, panel, say: () => {} });
    expect(r).toEqual({ refused: true, reason: "There's no oven connected. Nothing changed." });
    expect(panel.lines.at(-1)).toEqual(['fail', "There's no oven connected. Nothing changed."]);
  });

  it('a valid 70% passes validation and is not refused', async () => {
    const attempt = detectAttempt('set the desk lamp to 70%', devices)!;
    const panel = fakePanel();
    const r = await runBreakTurn('x', attempt, { engine: recordedEngine('nano', replyFor(attempt), { delayMs: 0 }), devices, panel, say: () => {} });
    expect(r.refused).toBe(false);
    expect(panel.lines.some(([v]) => v === 'fail')).toBe(false);
  });
});

describe('volume and bare numbers', () => {
  it('speaker volume to 150% is refused with the volume reason', () => {
    const a = detectAttempt('set the speaker volume to 150%', devices)!;
    expect(a).toMatchObject({ kind: 'volume', deviceId: 'speaker-a', level: 150 });
    expect(validateAttempt(a, devices)).toEqual({ ok: false, reason: VOLUME_RANGE_REFUSAL });
    expect(VOLUME_RANGE_REFUSAL).toBe('Volume goes from 0 to 100 %. Nothing changed.');
    expect(validateAttempt(detectAttempt('speaker volume to 80%', devices)!, devices).ok).toBe(true);
  });
  it('a bare "set the lamp to 500" is read as a percent', () => {
    expect(impossibleAttempt('set the desk lamp to 500', devices)).toMatchObject({ kind: 'brightness', level: 500 });
    expect(impossibleAttempt('set the desk lamp to 50', devices)).toBeNull();
  });
  it('any out-of-range clause in a combined request is refused', () => {
    expect(impossibleAttempt('desk lamp 50% and speaker volume 500%', devices)).toMatchObject({ kind: 'volume', level: 500 });
    expect(impossibleAttempt('desk lamp to 50% and ceiling light to 60%', devices)).toBeNull();
  });
  it('typed 1-9% for a lamp is refused (not raised to 10)', () => {
    expect(impossibleAttempt('set the desk lamp to 5%', devices)).toMatchObject({ level: 5 });
  });
});

describe('unusable live reply', () => {
  it('does not claim the model proposed anything', async () => {
    const attempt = detectAttempt('set the desk lamp to 500% brightness', devices)!;
    const panel = fakePanel();
    const junk = { id: 'nano' as const, sim: false, stream: async () => 'sorry, I cannot help' };
    const r = await runBreakTurn('x', attempt, { engine: junk, devices, panel, say: () => {} });
    expect(r.refused).toBe(true);
    expect(panel.lines.some(([, d]) => /proposed/.test(d))).toBe(false);
    expect(panel.lines.some(([, d]) => d.includes('reply wasn’t usable; checking your request directly.'))).toBe(true);
  });
});

describe('guard in the device store', () => {
  it('act() refuses a brightness above 100 instead of clamping it', async () => {
    const run = vi.fn(async () => ({}));
    const store = createDeviceStore({ 'lamp-a': { on: true, brightness: 60 } as never }, { run }, () => {}, () => 's');
    const s = await store.act({ deviceId: 'lamp-a', brightness: 500 });
    expect(run).not.toHaveBeenCalled();
    expect(s.brightness).toBe(60);
    expect(s.error).toBe('Lamps go from 10 to 100 %. Nothing changed.');
  });
});

describe('guard in the device store (more)', () => {
  const mk = () => createDeviceStore({ 'lamp-a': { on: true, brightness: 60 } as never, 's': { volume: 30 } as never }, { run: vi.fn(async () => ({})) }, () => {}, () => 'x');
  it('refuses brightness 5 (not clamped up by wiz) and accepts 0 and 10', async () => {
    const st = mk();
    expect((await st.act({ deviceId: 'lamp-a', brightness: 5 })).error).toBe('Lamps go from 10 to 100 %. Nothing changed.');
    expect((await st.act({ deviceId: 'lamp-a', brightness: 10 })).error).toBe('');
    expect((await st.act({ deviceId: 'lamp-a', brightness: 0, on: false })).error).toBe('');
  });
  it('uses the volume message for volume', async () => {
    const st = mk();
    const s = await st.act({ deviceId: 's', volume: 150 });
    expect(s.error).toBe(VOLUME_RANGE_REFUSAL);
    expect(s.volume).toBe(30);
  });
});

describe('canvasApp wiring', () => {
  const src = readFileSync('src/canvas/canvasApp.ts', 'utf8');
  it('languageTurn settles the engine bar on every exit, like aiTurn (Nano card no longer stuck on Working)', () => {
    const body = src.slice(src.indexOf('async function languageTurn('), src.indexOf('/** A pack phrase (Kannada) routes'));
    expect(body).toMatch(/finally \{[^}]*settleEngines\(\)/);
    // settleEngines settles the bar AND tells the AI feed (monitor)
    expect(src).toMatch(/const settleEngines = \(\): void => \{ engineBar\?\.settle\(\); panels\.settle\(\); \}/);
  });
  it('device and open-ended routes check the attempt before acting', () => {
    expect(src).toContain('breakTurn(');
  });
});

describe('plain button presses never hit the refusal (lampStep)', () => {
  const press = async (from: number, delta: number) => {
    const { lampStep } = await import('../../src/canvas/deviceGuard');
    const store = createDeviceStore({ l: { on: true, brightness: from } as never }, { run: vi.fn(async (i) => ({ brightness: i.brightness })) }, () => {}, () => 'x');
    return store.act({ deviceId: 'l', brightness: lampStep(from + delta) });
  };
  it('brighter at 90 -> 100', async () => { const s = await press(90, 20); expect(s.brightness).toBe(100); expect(s.error).toBe(''); });
  it('dimmer at 25 -> 10', async () => { const s = await press(25, -20); expect(s.brightness).toBe(10); expect(s.error).toBe(''); });
  it('dimmer at 10 -> 10', async () => { const s = await press(10, -20); expect(s.brightness).toBe(10); expect(s.error).toBe(''); });
  it('the call sites in canvasApp all go through lampStep (spikeMain is not ported)', () => {
    for (const f of ['src/canvas/canvasApp.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/brightness: (cur\.brightness [+-] 20|Math\.(min|max)\(\d+, cur [+-] 20\))/);
    }
  });
});
