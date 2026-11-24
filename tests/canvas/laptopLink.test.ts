import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLaptopLink, LINK_LINES, type LinkState } from '../../src/canvas/laptopLink';
import { joinPhoneSession, type PhoneSessionDeps } from '../../src/canvas/phoneGuestJoin';
import { startPhoneJoin } from '../../src/canvas/phoneJoin';
import { createFakeTransport } from '../../src/relay/transport';
import { loadPhonePair, type StorageLike } from '../../src/relay/pairingStore';
import type { ChimeListener } from '../../src/ux/pairingChime';

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
  };
}

/** A fake chime: records start/stop; `hear(code)` plays the decoder's onCode. */
function fakeChime(result: 'listening' | 'denied' | 'unsupported' = 'listening') {
  const made: Array<{ onCode(code: string): void; started: number; stopped: number }> = [];
  const create = (opts: { onCode(code: string): void }): ChimeListener => {
    const rec = { onCode: opts.onCode, started: 0, stopped: 0 };
    made.push(rec);
    return {
      start: async () => { rec.started++; return result; },
      stop: () => { rec.stopped++; },
      get active() { return rec.started > rec.stopped; },
    };
  };
  return { create, made, hear: (code: string) => made.at(-1)!.onCode(code) };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

async function setup(opts: { sim?: boolean; chime?: ReturnType<typeof fakeChime> } = {}) {
  const transport = createFakeTransport();
  const host = await startPhoneJoin({ transport });
  if ('error' in host) throw new Error('host');
  const storage = memoryStorage();
  const chime = opts.chime ?? fakeChime();
  const joins: PhoneSessionDeps[] = [];
  const binds: unknown[] = [];
  const states: LinkState[] = [];
  const snaps: unknown[] = [];
  const link = createLaptopLink({
    storage, platform: 'ios', native: true, sim: opts.sim,
    aiForwarder: { bind: (s) => { binds.push(s); } },
    onSnapshot: (s) => { snaps.push(s); },
    onChange: (s) => { states.push(s.state); },
    createListener: chime.create,
    join: (d) => { joins.push(d); return joinPhoneSession(d); },
    joinExtras: { transport, keepAliveTimers: { setInterval: () => 0, clearInterval: () => {} } },
  });
  return { host, storage, chime, joins, binds, states, snaps, link };
}

describe('Join laptop (phone-shell canvas)', () => {
  it('tap Join → listener started → code decoded → joinPhoneSession → pair saved → forwarder bound', async () => {
    const { host, storage, chime, joins, binds, link } = await setup();
    expect(chime.made).toHaveLength(0); // no mic at launch
    expect(loadPhonePair(storage)).toBeNull();

    await link.startJoin();
    expect(chime.made).toHaveLength(1);
    expect(chime.made[0]!.started).toBe(1);
    expect(link.state()).toBe('listening');
    expect(link.message()).toBe(LINK_LINES.listening);

    chime.hear(host.code);
    await tick();
    expect(chime.made[0]!.stopped).toBeGreaterThan(0); // mic closed once heard
    expect(joins).toHaveLength(1);
    expect(joins[0]).toMatchObject({ code: host.code, platform: 'ios', native: true, hubName: 'the laptop' });
    expect(loadPhonePair(storage)?.token).toBe(host.token); // the key the saved-pair rejoin reads
    expect(binds).toHaveLength(1);
    expect(binds[0]).not.toBeNull();
    expect(link.state()).toBe('connected');
    expect(link.message()).toBe('Connected to laptop ✓');

    await link.stop();
    expect(binds.at(-1)).toBeNull();
    await host.stop();
  });

  it('a board the laptop publishes reaches the phone after the chime join', async () => {
    const { host, chime, snaps, link } = await setup();
    await link.startJoin();
    chime.hear(host.code);
    await tick();
    await host.session.publishState({ v: 1, rev: 1 } as never);
    await tick();
    expect(snaps.length).toBeGreaterThan(0);
    await link.stop();
    await host.stop();
  });

  it('typed-code fallback joins the same way', async () => {
    const { host, storage, binds, link, chime } = await setup();
    await link.joinWithCode(host.code.toLowerCase(), true);
    expect(chime.made).toHaveLength(0);
    expect(link.state()).toBe('connected');
    expect(loadPhonePair(storage)?.token).toBe(host.token);
    expect(binds).toHaveLength(1);
    await link.stop();
    await host.stop();
  });

  it('plain-words errors: denied mic, unknown room, bad code', async () => {
    const denied = await setup({ chime: fakeChime('denied') });
    await denied.link.startJoin();
    expect(denied.link.message()).toBe(LINK_LINES.micDenied);
    await denied.host.stop();

    const { link, host } = await setup();
    await link.joinWithCode('ZZZZ-ZZZZ');
    expect(link.state()).toBe('error');
    expect(link.message()).toBe(LINK_LINES.noRoom);
    await link.joinWithCode('nope');
    expect(link.message()).toBe(LINK_LINES.badCode);
    await host.stop();
  });

  it('a remembered pair rejoins without opening the mic, and binds the forwarder', async () => {
    const first = await setup();
    await first.link.joinWithCode(first.host.code);
    await first.link.stop();
    const { storage, host } = first;
    const chime = fakeChime();
    const binds: unknown[] = [];
    const link = createLaptopLink({
      storage, platform: 'ios', native: true,
      aiForwarder: { bind: (s) => { binds.push(s); } },
      onSnapshot: () => {},
      createListener: chime.create,
      joinExtras: { transport: (first.joins[0]!.transport)!, keepAliveTimers: { setInterval: () => 0, clearInterval: () => {} } },
    });
    expect(await link.rejoinSaved()).toBe(true);
    expect(chime.made).toHaveLength(0);
    expect(binds).toHaveLength(1);
    await link.stop();
    await host.stop();
  });

  it('under ?sim=1 Join explains it needs a real laptop session and never opens the mic', async () => {
    const { link, chime, joins, host } = await setup({ sim: true });
    expect(link.state()).toBe('sim');
    await link.startJoin();
    await link.joinWithCode(host.code);
    expect(chime.made).toHaveLength(0);
    expect(joins).toHaveLength(0);
    expect(link.message()).toBe(LINK_LINES.sim);
    expect(await link.rejoinSaved()).toBe(false);
    await host.stop();
  });

  it('the phone-shell canvas mounts Join laptop and does not open the mic at launch', () => {
    const src = readFileSync(resolve(__dirname, '../../src/canvas/canvasMain.ts'), 'utf8');
    expect(src).toMatch(/createLaptopLink\(/);
    expect(src).toMatch(/mountLaptopLinkUi\(/);
    expect(src).toMatch(/link\.rejoinSaved\(\)/);
    expect(src).not.toMatch(/link\.startJoin\(\)/);
  });
});
