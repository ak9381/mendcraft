// "Try to break it": impossible requests are refused by real validation (never
// clamped), the responsible engine visibly fails, and the board is unchanged.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createDeviceStore } from '../../src/canvas/deviceActions';
import { scriptedEngine } from '../../src/canvas/aiTurn';
import type { DeviceRef } from '../../src/canvas/deviceCommands';
import { routeLine } from '../../src/canvas/routeLine';
import { detectAttempt, runBreakTurn, scriptedReply, validateAttempt, LAMP_RANGE_REFUSAL } from '../../src/canvas/tryToBreak';
import { ruleSuggestions } from '../../src/canvas/nextSteps';

const devices: DeviceRef[] = [
  { id: 'wiz-desk', label: 'Desk lamp', kind: 'lamp', on: true, brightness: 60 },
  { id: 'wiz-ceiling', label: 'Ceiling light', kind: 'lamp', on: false, brightness: 40 },
  { id: 'speaker-1', label: 'Speaker', kind: 'music' },
];
const world = { hasPlanBoard: false, devices };

const fakePanel = () => {
  const lines: Array<[string, string]> = [];
  return { lines, log: (v: string, d: string) => { lines.push([v, d]); }, fail: (d: string) => { lines.push(['fail', d]); } };
};

describe('detectAttempt + validateAttempt', () => {
  it('500% brightness is an attempt the validator refuses with a plain reason', () => {
    const a = detectAttempt('set the desk lamp to 500% brightness', devices)!;
    expect(a).toMatchObject({ kind: 'brightness', deviceId: 'wiz-desk', level: 500 });
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
  it('the dashboard step offers a "Try to break it" chip that routes', () => {
    const ctx = { lang: 'en', online: true, phones: 0 } as const;
    const chip = ruleSuggestions('dashboard', ctx).find((s) => s.label === 'Try to break it')!;
    expect(chip.say).toBe('set the desk lamp to 500% brightness');
    expect(routeLine(chip.say, world).name).toBe('device');
  });
});

describe('runBreakTurn', () => {
  const setup = (text: string) => {
    const emitted: unknown[] = [];
    const run = vi.fn(async () => ({}));
    const store = createDeviceStore({ 'wiz-desk': { on: true, brightness: 60 } as never }, { run }, (m) => emitted.push(m), () => 's');
    const attempt = detectAttempt(text, devices)!;
    return { store, run, before: JSON.stringify(store.all()), attempt, panel: fakePanel(), said: [] as string[], emitted };
  };
  const T = 'set the desk lamp to 500% brightness';

  it('the scripted SIM reply is the real-shaped attempt and still gets refused', async () => {
    const t = setup(T);
    expect(JSON.parse(scriptedReply(t.attempt))).toEqual({ deviceId: 'wiz-desk', brightness: 500 });
    const engine = scriptedEngine('nano', scriptedReply(t.attempt), { delayMs: 0 });
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
    const clamping = { ...scriptedEngine('nano', '{"deviceId":"wiz-desk","brightness":100}', { delayMs: 0 }), sim: false };
    const r = await runBreakTurn(T, t.attempt, { engine: clamping, devices, panel: t.panel, say: () => {} });
    expect(r.refused).toBe(true);
    expect(t.panel.lines.some(([, d]) => /SIM/.test(d))).toBe(false);
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
    const r = await runBreakTurn('add a control for the oven', attempt, { engine: scriptedEngine('nano', scriptedReply(attempt), { delayMs: 0 }), devices, panel, say: () => {} });
    expect(r).toEqual({ refused: true, reason: "There's no oven connected. Nothing changed." });
    expect(panel.lines.at(-1)).toEqual(['fail', "There's no oven connected. Nothing changed."]);
  });

  it('a valid 70% passes validation and is not refused', async () => {
    const attempt = detectAttempt('set the desk lamp to 70%', devices)!;
    const panel = fakePanel();
    const r = await runBreakTurn('x', attempt, { engine: scriptedEngine('nano', scriptedReply(attempt), { delayMs: 0 }), devices, panel, say: () => {} });
    expect(r.refused).toBe(false);
    expect(panel.lines.some(([v]) => v === 'fail')).toBe(false);
  });
});

describe('guard in the device store', () => {
  it('act() refuses a brightness above 100 instead of clamping it', async () => {
    const run = vi.fn(async () => ({}));
    const store = createDeviceStore({ 'wiz-desk': { on: true, brightness: 60 } as never }, { run }, () => {}, () => 's');
    const s = await store.act({ deviceId: 'wiz-desk', brightness: 500 });
    expect(run).not.toHaveBeenCalled();
    expect(s.brightness).toBe(60);
    expect(s.error).toBe('Lamps go from 10 to 100 %. Nothing changed.');
  });
});

describe('canvasApp wiring', () => {
  const src = readFileSync('src/canvas/canvasApp.ts', 'utf8');
  it('languageTurn settles the engine bar on every exit, like aiTurn (Nano card no longer stuck on Working)', () => {
    const body = src.slice(src.indexOf('async function languageTurn('), src.indexOf('/** A pack phrase (Kannada) routes'));
    expect(body).toMatch(/finally \{[^}]*engineBar\?\.settle\(\)/);
  });
  it('device and open-ended routes check the attempt before acting', () => {
    expect(src).toContain('breakTurn(');
  });
});
