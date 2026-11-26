// Gimbal modes over the relay (the laptop's gimbal tile → the docked iPhone):
// one allow-listed word, host → phone only, at most one per second on BOTH
// sides, a repeat of the same mode dropped, and never acted on from history.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createModeLimiter, GIMBAL_MODE_MIN_GAP_MS, GIMBAL_MODE_REPEAT_MS, validateCommand, type RandomBytes, type RelayMessage } from '../src/relay/protocol';
import { createFakeTransport, type RelayTransport } from '../src/relay/transport';
import { createGuestSession, createHostSession } from '../src/relay/session';

const seqRandom = (start = 0): RandomBytes => (n) => Uint8Array.from({ length: n }, (_, i) => start + i);
const flush = () => new Promise((r) => setTimeout(r, 0));
const modeMsg = (text: string): RelayMessage => ({ v: 1, from: 'host', type: 'cmd', cmd: { kind: 'gimbalMode', text } }) as RelayMessage;

describe('gimbalMode: validation', () => {
  it('only face / hands / hold, as text', () => {
    for (const m of ['face', 'hands', 'hold']) expect(validateCommand({ kind: 'gimbalMode', text: m })).toEqual({ kind: 'gimbalMode', text: m });
    for (const bad of [{ kind: 'gimbalMode', text: 'spin' }, { kind: 'gimbalMode', text: 'FACE' }, { kind: 'gimbalMode' }, { kind: 'gimbalMode', text: 1 }]) {
      expect(validateCommand(bad)).toBeNull();
    }
  });
});

describe('gimbalMode: the limiter', () => {
  it('<= 1 per second; the same mode again within 5 s is a repeat', () => {
    let t = 0;
    const lim = createModeLimiter(undefined, undefined, () => t);
    expect(GIMBAL_MODE_MIN_GAP_MS).toBe(1000);
    expect(GIMBAL_MODE_REPEAT_MS).toBe(5000);
    expect(lim.allow('face')).toBe(true);
    t = 500; expect(lim.allow('hold')).toBe(false); // inside the gap
    t = 1200; expect(lim.allow('face')).toBe(false); // a repeat
    t = 1300; expect(lim.allow('hands')).toBe(true); // a change, after the gap
    t = 6400; expect(lim.allow('hands')).toBe(true); // same mode, but the window is over
  });
});

describe('gimbalMode: over the relay', () => {
  it('host: rate-limited and repeats dropped on send; not paired → nothing sent', async () => {
    const tr = createFakeTransport();
    let now = 10_000;
    const host = await createHostSession(tr, seqRandom(), { now: () => now });
    expect(await host.sendGimbalMode('face')).toBe(false); // not paired
    const guest = await createGuestSession(tr, host.token, { now: () => now });
    const got: string[] = [];
    guest.onGimbalMode((m) => got.push(m));
    await flush();
    expect(await host.sendGimbalMode('face')).toBe(true);
    now += 300; expect(await host.sendGimbalMode('hold')).toBe(false);
    now += 900; expect(await host.sendGimbalMode('face')).toBe(false);
    expect(await host.sendGimbalMode('hands')).toBe(true);
    await flush();
    expect(got).toEqual(['face', 'hands']);
    await guest.close();
    await host.close();
  });

  it('phone: enforces the same gate whatever the sender does', async () => {
    const tr = createFakeTransport();
    let now = 0;
    const host = await createHostSession(tr, seqRandom());
    const guest = await createGuestSession(tr, host.token, { now: () => now });
    const got: string[] = [];
    guest.onGimbalMode((m) => got.push(m));
    await flush();
    for (const m of ['face', 'face', 'hold', 'hands']) await tr.publish(host.token, modeMsg(m));
    await flush();
    expect(got).toEqual(['face']);
    now = 1500; await tr.publish(host.token, modeMsg('face')); await flush();
    expect(got).toEqual(['face']); // a repeat
    now = 1600; await tr.publish(host.token, modeMsg('hold')); await flush();
    expect(got).toEqual(['face', 'hold']);
    await guest.close();
    await host.close();
  });

  it('host → phone only: a phone\'s gimbalMode never reaches another phone, and the laptop ignores it', async () => {
    const tr = createFakeTransport();
    const host = await createHostSession(tr, seqRandom());
    const guest = await createGuestSession(tr, host.token);
    const got: string[] = [];
    guest.onGimbalMode((m) => got.push(m));
    await flush();
    await guest.sendCommand({ kind: 'gimbalMode', text: 'face' });
    await tr.publish(host.token, { v: 1, from: 'phone', type: 'cmd', cmd: { kind: 'gimbalMode', text: 'hands' } } as RelayMessage);
    await flush();
    expect(got).toEqual([]);
    const app = readFileSync(new URL('../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
    expect(app).toMatch(/cmd\.kind === 'gimbalMode'\) return; \/\/ host → phone only/);
    await guest.close();
    await host.close();
  });

  it('a gimbalMode replayed from the room\'s history never acts', async () => {
    const fake = createFakeTransport();
    let token = '';
    // A room with history: every new listener first gets an old mode (server time before this session).
    const tr: RelayTransport = {
      ...fake,
      subscribe(roomId, onMsg, onError, startKnown) {
        const off = fake.subscribe(roomId, onMsg, onError, startKnown);
        if (roomId === token) queueMicrotask(() => onMsg(modeMsg('hands'), { at: -5 }));
        return off;
      },
    };
    const host = await createHostSession(tr, seqRandom());
    token = host.token;
    const guest = await createGuestSession(tr, host.token);
    const got: string[] = [];
    guest.onGimbalMode((m) => got.push(m));
    await flush(); await flush();
    expect(got).toEqual([]);
    expect(await host.sendGimbalMode('face')).toBe(true); // a live one still arrives
    await flush();
    expect(got).toEqual(['face']);
    await guest.close();
    await host.close();
  });
});
