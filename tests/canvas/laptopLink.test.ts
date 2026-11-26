import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLaptopLink, LINK_LINES, type LinkState } from '../../src/canvas/laptopLink';
import { joinPhoneSession, type PhoneSessionDeps } from '../../src/canvas/phoneGuestJoin';
import { startPhoneJoin } from '../../src/canvas/phoneJoin';
import { createFakeTransport } from '../../src/relay/transport';
import { loadPhonePair, type StorageLike } from '../../src/relay/pairingStore';
import { createChimeListener, type ChimeListener } from '../../src/ux/pairingChime';
import { LISTEN_TIMEOUT_MS, SAVED_FAIL_SHOW_MS } from '../../src/canvas/laptopLink';
import { createCanvasAiFeed, type FeedChannel } from '../../src/canvas/aiFeed';

/** A fake getUserMedia-backed capture that resolves only when told to. */
function deferredCapture() {
  const pending: Array<{ resolve: (stop: () => void) => void }> = [];
  let open = 0;
  const startCapture = () => new Promise<() => void>((resolve) => { pending.push({ resolve }); });
  const grant = (i = 0) => { open++; pending[i]!.resolve(() => { open--; }); };
  return { startCapture, grant, open: () => open, pending };
}

/** Manual timers: run them by hand. */
function manualTimers() {
  const list = new Map<number, { fn: () => void; ms: number }>();
  let id = 0;
  return {
    setTimer: (fn: () => void, ms: number) => { list.set(++id, { fn, ms }); return id; },
    clearTimer: (i: unknown) => { list.delete(i as number); },
    fire: (ms: number) => { for (const [k, t] of [...list]) if (t.ms === ms) { list.delete(k); t.fn(); } },
    count: () => list.size,
  };
}

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
    expect(src).toMatch(/visibilitychange/);
    expect(src).toMatch(/link\.cancel\(\)/);
    expect(src).toMatch(/pageshow/);
  });
});

describe('Join laptop: mic, timeout and reconnect safety', () => {
  it('chime listener: stop() during the permission prompt closes the mic once granted', async () => {
    const cap = deferredCapture();
    const l = createChimeListener({ onCode: () => {}, startCapture: cap.startCapture });
    const p = l.start();
    l.stop(); // cancelled while getUserMedia is still pending
    cap.grant();
    expect(await p).toBe('stopped');
    expect(cap.open()).toBe(0);
    expect(l.active).toBe(false);
  });

  it('chime listener: a second start() while the first is pending leaves only one mic open', async () => {
    const cap = deferredCapture();
    const l = createChimeListener({ onCode: () => {}, startCapture: cap.startCapture });
    const p1 = l.start();
    const p2 = l.start();
    cap.grant(0);
    cap.grant(1);
    expect(await p1).toBe('stopped');
    expect(await p2).toBe('listening');
    expect(cap.open()).toBe(1);
    l.stop();
    expect(cap.open()).toBe(0);
  });

  it('link: cancel while the permission prompt is up never leaves the mic open', async () => {
    const cap = deferredCapture();
    const timers = manualTimers();
    const link = createLaptopLink({
      storage: memoryStorage(), platform: 'android', native: true, onSnapshot: () => {},
      createListener: (o) => createChimeListener({ ...o, startCapture: cap.startCapture }),
      setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    });
    const started = link.startJoin();
    link.cancel(); // app backgrounded / panel closed
    cap.grant();
    await started;
    expect(cap.open()).toBe(0);
    expect(link.state()).toBe('idle');
    expect(timers.count()).toBe(0);
  });

  it('link: listening stops after 60 s with a plain message', async () => {
    const cap = deferredCapture();
    const timers = manualTimers();
    const link = createLaptopLink({
      storage: memoryStorage(), platform: 'android', native: true, onSnapshot: () => {},
      createListener: (o) => createChimeListener({ ...o, startCapture: cap.startCapture }),
      setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    });
    const started = link.startJoin();
    cap.grant();
    await started;
    expect(cap.open()).toBe(1);
    timers.fire(LISTEN_TIMEOUT_MS);
    expect(cap.open()).toBe(0);
    expect(link.state()).toBe('error');
    expect(link.message()).toBe(LINK_LINES.timeout);
  });

  it('cancel() only stops listening; a connected session stays', async () => {
    const { host, link, binds } = await setup();
    await link.joinWithCode(host.code);
    link.cancel();
    expect(link.state()).toBe('connected');
    expect(binds.at(-1)).not.toBeNull();
    await link.stop();
    await host.stop();
  });

  it('the pill reverts when the session drops (laptop left)', async () => {
    const { host, link } = await setup();
    await link.joinWithCode(host.code);
    expect(link.state()).toBe('connected');
    await host.stop(); // host bye → guest 'gone'
    await tick();
    expect(link.state()).toBe('error');
    expect(link.message()).toBe(LINK_LINES.lost);
    await link.stop();
  });

  it('after pagehide stop(), resume() (pageshow / foreground) rejoins the remembered pair', async () => {
    const { host, link, binds } = await setup();
    await link.joinWithCode(host.code);
    await link.stop();
    expect(link.state()).toBe('idle');
    expect(await link.resume()).toBe(true);
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); // the laptop answers the ping
    expect(link.state()).toBe('connected');
    expect(binds.filter((b) => b !== null)).toHaveLength(2);
    expect(await link.resume()).toBe(false); // already connected: no-op
    await link.stop();
    await host.stop();
  });

  it('a failed saved rejoin shows savedFailed, then resets to idle', async () => {
    const timers = manualTimers();
    const first = await setup();
    await first.link.joinWithCode(first.host.code);
    await first.link.stop();
    await first.host.stop(); // the room is gone
    const link = createLaptopLink({
      storage: first.storage, platform: 'ios', native: true, onSnapshot: () => {},
      join: async () => ({ error: 'room not found' as const }),
      setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    });
    expect(await link.rejoinSaved()).toBe(false);
    expect(link.message()).toBe(LINK_LINES.savedFailed);
    timers.fire(SAVED_FAIL_SHOW_MS);
    expect(link.state()).toBe('idle');
    expect(link.message()).toBe(LINK_LINES.idle);
  });
});

describe('phone shell never broadcasts untagged feed messages locally', () => {
  it('createCanvasAiFeed(phoneShell) posts nothing; the laptop canvas does', () => {
    const sent: unknown[] = [];
    const channel: FeedChannel = { postMessage: (m) => { sent.push(m); }, addEventListener: () => {} };
    createCanvasAiFeed(true, { channel }).publish({ kind: 'log', engine: 'nano', verb: 'done', text: 'x' });
    expect(sent).toHaveLength(0);
    createCanvasAiFeed(false, { channel }).publish({ kind: 'log', engine: 'nano', verb: 'done', text: 'x' });
    expect(sent).toHaveLength(1);
  });

  it('canvasApp builds its feed with createCanvasAiFeed(phoneShell)', () => {
    const src = readFileSync(resolve(__dirname, '../../src/canvas/canvasApp.ts'), 'utf8');
    expect(src).toMatch(/createCanvasAiFeed\(phoneShell[,)]/);
    expect(src).not.toMatch(/createAiFeed\(\)/);
  });
});
