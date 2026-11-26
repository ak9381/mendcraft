// "Laptop ✓" needs a round trip, a reloaded laptop does not show phones from
// the room's history, and a catch-up batch of phone lines is drained, not
// dropped.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createLaptopLink, LINK_LINES, PING_EVERY_MS, PING_TIMEOUT_MS } from '../../src/canvas/laptopLink';
import { createAnnounceGate, createPhoneAiRepublisher, HOST_AI_EVENT_RATE } from '../../src/canvas/phoneAiFeed';
import { announcePhone, keepAnnouncing } from '../../src/canvas/phoneGuestJoin';
import { startPhoneJoin } from '../../src/canvas/phoneJoin';
import { routeLine } from '../../src/canvas/routeLine';
import { parsePing, validateCommand, type RelayMessage } from '../../src/relay/protocol';
import type { StorageLike } from '../../src/relay/pairingStore';
import { createGuestSession, createHostSession, UNSIGNED_PING_GAP_MS } from '../../src/relay/session';
import { createFakeTransport, type RelayTransport } from '../../src/relay/transport';

const flush = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const TOKEN = 'ABCDEFGHJKMNPQRSTVWXYZ01';

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => (m.has(k) ? m.get(k)! : null), setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
}
function manualTimers() {
  const list = new Map<number, { fn: () => void; ms: number }>();
  let id = 0;
  return {
    setTimer: (fn: () => void, ms: number) => { list.set(++id, { fn, ms }); return id; },
    clearTimer: (i: unknown) => { list.delete(i as number); },
    fire: (ms: number) => { for (const [k, t] of [...list]) if (t.ms === ms) { list.delete(k); t.fn(); } },
    pending: (ms: number) => [...list.values()].filter((t) => t.ms === ms).length,
  };
}

/** A transport that, like Firestore, replays a room's whole history to every
 *  new subscriber; `mute` makes one direction go quiet (a listener that
 *  silently stopped delivering). */
function historyTransport() {
  const base = createFakeTransport();
  const log = new Map<string, RelayMessage[]>();
  const muted = new Set<string>();
  const t: RelayTransport = {
    ...base,
    async publish(roomId, msg) {
      if (muted.has(msg.from)) return; // the write lands nowhere anyone hears
      log.set(roomId, [...(log.get(roomId) ?? []), msg]);
      await base.publish(roomId, msg);
    },
    subscribe(roomId, onMsg, onError) {
      const past = [...(log.get(roomId) ?? [])];
      queueMicrotask(() => { for (const m of past) onMsg(m); });
      return base.subscribe(roomId, onMsg, onError);
    },
  };
  return { t, mute: (from: 'host' | 'phone', on: boolean) => { if (on) muted.add(from); else muted.delete(from); }, log };
}

describe('ping / pong: the phone\'s proof that the laptop hears it', () => {
  it('the relay accepts a ping and a pong and nothing oversized', () => {
    expect(validateCommand({ kind: 'ping', text: JSON.stringify({ n: 'p1-abc' }) })).not.toBeNull();
    expect(validateCommand({ kind: 'pong', text: JSON.stringify({ n: 'p1-abc', sid: 'sid-12345' }) })).not.toBeNull();
    expect(validateCommand({ kind: 'ping', text: 'x'.repeat(400) })).toBeNull();
    expect(parsePing('{"n":"has spaces"}')).toBeNull();
    expect(validateCommand({ kind: 'whoIsThere', text: 'a b c' })).toBeNull();
    expect(validateCommand({ kind: 'whoIsThere' })).not.toBeNull();
  });

  it('the host echoes the nonce with its session id; a ping is never run as a command', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, undefined, { token: TOKEN });
    const cmds: string[] = [];
    host.onCommand((c) => { cmds.push(c.kind); });
    const guest = await createGuestSession(t, TOKEN);
    const pongs: string[] = [];
    guest.onPong((n) => { pongs.push(n); });
    expect(guest.hostSid()).toBeNull();
    await guest.ping('p1-abc');
    await flush();
    expect(pongs).toEqual(['p1-abc']);
    expect(guest.hostSid()).toBe(host.sid);
    expect(cmds).toEqual([]);
    await guest.close(); await host.close();
  });

  it('pings that do not name this session (history after a reload) get at most three answers per gap', async () => {
    const t = createFakeTransport();
    const clock = { t: 1000 };
    const host = await createHostSession(t, undefined, { token: TOKEN, now: () => clock.t });
    const guest = await createGuestSession(t, TOKEN);
    const pongs: string[] = [];
    guest.onPong((n) => { pongs.push(n); });
    const old = (n: string) => t.publish(TOKEN, { v: 1, from: 'phone', type: 'cmd', cmd: { kind: 'ping', text: JSON.stringify({ n, sid: 'an-old-session' }) } });
    for (let i = 1; i <= 8; i++) await old(`old-${i}`);
    await flush();
    expect(pongs).toEqual(['old-1', 'old-2', 'old-3']);
    clock.t += UNSIGNED_PING_GAP_MS;
    await guest.ping('live-1'); // signed with the sid just learned: always answered
    await guest.ping('live-2');
    await flush();
    expect(pongs).toEqual(['old-1', 'old-2', 'old-3', 'live-1', 'live-2']);
    await guest.close(); await host.close();
  });
});

describe('"Laptop ✓" only after the laptop answered', () => {
  async function setup() {
    const h = historyTransport();
    const host = await startPhoneJoin({ transport: h.t, chime: () => undefined });
    if ('error' in host) throw new Error('host');
    const timers = manualTimers();
    const states: string[] = [];
    const link = createLaptopLink({
      storage: memoryStorage(), platform: 'android', native: true,
      onSnapshot: () => undefined,
      onChange: (s) => { states.push(`${s.state}:${s.message}`); },
      joinExtras: { transport: h.t, keepAliveTimers: { setInterval: () => 0, clearInterval: () => undefined } },
      setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    });
    return { h, host, timers, states, link };
  }

  it('connected once the ping came back; then proved again every 15 s', async () => {
    const { host, timers, link } = await setup();
    await link.joinWithCode(host.code, true);
    await flush();
    expect(link.state()).toBe('connected');
    expect(link.message()).toBe(LINK_LINES.connected);
    expect(timers.pending(PING_TIMEOUT_MS)).toBe(0);
    expect(timers.pending(PING_EVERY_MS)).toBe(1);
    timers.fire(PING_EVERY_MS);
    await flush();
    expect(link.state()).toBe('connected');
    await link.stop();
    expect(timers.pending(PING_EVERY_MS) + timers.pending(PING_TIMEOUT_MS)).toBe(0);
    await host.stop();
  });

  it('a laptop that stopped hearing: "Laptop — reconnecting…" after 5 s, and ✓ again when it answers', async () => {
    const { h, host, timers, states, link } = await setup();
    await link.joinWithCode(host.code, true);
    await flush();
    expect(link.state()).toBe('connected');

    h.mute('phone', true); // the laptop no longer hears this phone
    timers.fire(PING_EVERY_MS);
    await flush();
    expect(link.state()).toBe('connected'); // still inside the 5 s
    timers.fire(PING_TIMEOUT_MS);
    expect(link.state()).toBe('reconnecting');
    expect(link.message()).toBe('Laptop — reconnecting…');
    await flush();
    timers.fire(PING_TIMEOUT_MS); // it keeps asking
    expect(link.state()).toBe('reconnecting');

    h.mute('phone', false);
    await flush();
    timers.fire(PING_TIMEOUT_MS); // this retry goes through
    await flush();
    expect(link.state()).toBe('connected');
    expect(states.at(-1)).toBe(`connected:${LINK_LINES.connected}`);
    await link.stop(); await host.stop();
  });

  it('joining a room nobody is hosting (only old messages in it) never shows ✓', async () => {
    const { h, host, timers, link } = await setup();
    const token = host.token;
    // History: the laptop published state, then went away without a bye.
    await host.session.publishState({ v: 1 } as never).catch(() => undefined);
    h.mute('host', true);
    await link.joinWithCode(token, false);
    await flush();
    expect(link.state()).toBe('joining');
    timers.fire(PING_TIMEOUT_MS);
    expect(link.state()).toBe('reconnecting');
    await link.stop();
  });

  it('the pill shows the reconnecting line', () => {
    const src = read('src/canvas/laptopLink.ts');
    expect(src).toMatch(/s === 'connected' \? 'Laptop ✓' : s === 'reconnecting' \? LINK_LINES\.reconnecting : 'Join laptop'/);
  });
});

describe('a reloaded laptop does not show phones from the room\'s history', () => {
  /** canvasApp's announce handling, reduced to the gate. */
  async function laptop(t: RelayTransport, token?: string) {
    const gate = createAnnounceGate();
    const shown: string[] = [];
    let session: Awaited<ReturnType<typeof createHostSession>> | null = null;
    const ask = () => { if (session && gate.shouldAsk()) void session.askWhoIsThere().catch(() => undefined); };
    const res = await startPhoneJoin({
      transport: t, token, chime: () => undefined,
      onState: (st) => { if (st === 'paired') ask(); },
      onCommand: (cmd) => {
        if (cmd.kind !== 'announce') return;
        const o = JSON.parse(cmd.text ?? '{}') as { platform: string; deviceId: string; sid?: unknown };
        const live = gate.check(o.sid, session?.sid, o.deviceId);
        if (live === 'stale') { ask(); return; }
        if (live === 'first') shown.push(o.platform);
      },
    });
    if ('error' in res) throw new Error('host');
    session = res.session;
    void res.session.askWhoIsThere().catch(() => undefined);
    return { ...res, shown };
  }
  const noTimers = { setInterval: () => 0, clearInterval: () => undefined };

  it('first pair: the phone is shown after it answers whoIsThere with this session\'s id', async () => {
    const h = historyTransport();
    const host = await laptop(h.t);
    const guest = await createGuestSession(h.t, host.token);
    const stop = keepAnnouncing(guest, 'android', { deviceId: 'dev-2222bbbb', native: true }, noTimers);
    announcePhone(guest, 'android', { deviceId: 'dev-2222bbbb', native: true }); // no sid yet
    await flush(20);
    expect(host.shown).toEqual(['android']);
    stop(); await guest.close(); await host.stop();
  });

  it('after a reload the old announce is replayed and ignored; a phone still there is shown again', async () => {
    const h = historyTransport();
    const first = await laptop(h.t);
    const guest = await createGuestSession(h.t, first.token);
    const stop = keepAnnouncing(guest, 'android', { deviceId: 'dev-2222bbbb', native: true }, noTimers);
    announcePhone(guest, 'android', { deviceId: 'dev-2222bbbb', native: true });
    await flush(20);
    expect(first.shown).toEqual(['android']);

    // The phone app is killed (no bye). The laptop reloads into the same room.
    stop();
    h.mute('phone', true);
    const reloaded = await laptop(h.t, first.token);
    await flush(20);
    expect(reloaded.session.state()).toBe('paired'); // an old hello was replayed…
    expect(reloaded.shown).toEqual([]); // …but no phone is shown

    // A phone that IS there answers the new session and is shown.
    h.mute('phone', false);
    const back = await createGuestSession(h.t, first.token);
    const stopBack = keepAnnouncing(back, 'android', { deviceId: 'dev-2222bbbb', native: true }, noTimers);
    announcePhone(back, 'android', { deviceId: 'dev-2222bbbb', native: true });
    await flush(30);
    expect(reloaded.shown).toEqual(['android']);
    stopBack(); await back.close(); await reloaded.stop();
  });

  it('the gate: stale without the current id, first once, then again; clear() asks for proof anew', () => {
    const clock = { t: 0 };
    const gate = createAnnounceGate({ now: () => clock.t });
    expect(gate.check(undefined, 'sid-now', 'd1')).toBe('stale');
    expect(gate.check('sid-old', 'sid-now', 'd1')).toBe('stale');
    expect(gate.check('sid-now', null, 'd1')).toBe('stale');
    expect(gate.check('sid-now', 'sid-now', 'd1')).toBe('first');
    expect(gate.check('sid-now', 'sid-now', 'd1')).toBe('again');
    gate.clear();
    expect(gate.check('sid-now', 'sid-now', 'd1')).toBe('first');
    expect(gate.shouldAsk()).toBe(true);
    expect(gate.shouldAsk()).toBe(false); // not twice inside the gap
    clock.t = 2000;
    expect(gate.shouldAsk()).toBe(true);
  });

  it('canvasApp shows a phone only through the gate (no chip on a bare hello)', () => {
    const app = read('src/canvas/canvasApp.ts');
    expect(app).toMatch(/announceGate\.check\(sid, hostSession\?\.sid,/);
    expect(app).toMatch(/if \(live === 'stale'\) \{ askWhoIsThere\(\); return; \}/);
    expect(app).not.toMatch(/pairFirst\.addGeneric\(\)/);
  });
});

describe('a catch-up batch of phone lines is drained, not dropped', () => {
  it('40 lines at once all reach the feed, in order, at 10 a second', () => {
    const clock = { t: 0 };
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const sent: Array<{ text?: string }> = [];
    const rep = createPhoneAiRepublisher({
      feed: { publish: (m) => { sent.push(m as { text?: string }); } },
      now: () => clock.t, setTimer: (fn, ms) => { timers.push({ fn, ms }); },
    });
    rep.announce('android', 'dev-2222bbbb', true);
    sent.length = 0;
    for (let i = 0; i < 40; i++) {
      expect(rep.handle(JSON.stringify({ k: 'log', id: 'dev-2222bbbb', engine: 'gemini', verb: 'note', text: `line ${i}` }))).toBe(true);
    }
    expect(sent).toHaveLength(HOST_AI_EVENT_RATE.max);
    expect(rep.queued()).toBe(30);
    for (let guard = 0; guard < 10 && timers.length; guard++) {
      const next = timers.shift()!;
      clock.t += next.ms;
      next.fn();
    }
    expect(rep.queued()).toBe(0);
    expect(sent.map((m) => m.text)).toEqual(Array.from({ length: 40 }, (_, i) => `line ${i}`));
    expect(clock.t).toBeGreaterThanOrEqual(3000); // never faster than the rate
  });

  it('a line that arrives while others wait keeps its place behind them', () => {
    const clock = { t: 0 };
    const timers: Array<() => void> = [];
    const sent: Array<{ text?: string }> = [];
    const rep = createPhoneAiRepublisher({ feed: { publish: (m) => { sent.push(m as { text?: string }); } }, now: () => clock.t, setTimer: (fn) => { timers.push(fn); } });
    rep.announce('android', 'dev-2222bbbb', true);
    sent.length = 0;
    const line = (text: string) => rep.handle(JSON.stringify({ k: 'log', id: 'dev-2222bbbb', engine: 'gemini', verb: 'note', text }));
    for (let i = 0; i < 12; i++) line(`a${i}`);
    clock.t = 1001; // a slot is free again, but two lines are still waiting
    line('late');
    while (timers.length) timers.shift()!();
    expect(sent.map((m) => m.text).slice(-3)).toEqual(['a10', 'a11', 'late']);
  });
});

describe('single-call boards, toast position, "show me a dashboard"', () => {
  it('a cloud-only draft carries the improve goal in its one prompt', () => {
    const app = read('src/canvas/canvasApp.ts');
    expect(app).toMatch(/const ONE_CALL_ROOM_GOAL = 'Group the lights and add a room plan tile\.';/);
    expect(app).toMatch(/const onlyCall = engineFor\(engineId, '\{\}'\)\.id === 'gemini';/);
    expect(app).toMatch(/streamTurn\(frameId, engineId, utterance, script, 'dashboard', onlyCall \? ONE_CALL_ROOM_GOAL : undefined,/);
  });

  it('the phone toast sits above the mic, not over the board title', () => {
    const css = read('src/canvas/canvas.css');
    const i = css.indexOf('.mc-phone-simple .mc-phone-say:not([hidden]) {');
    const rule = css.slice(i, css.indexOf('}', i));
    expect(rule).toMatch(/bottom: calc\(124px \+ var\(--safe-area-inset-bottom/);
    expect(rule).not.toMatch(/\btop:/);
  });

  it.each(['show me a dashboard', 'Show me a dashboard for my lights', 'show me a control panel for the lamp'])('"%s" → a board turn', (text) => {
    expect(routeLine(text, { hasPlanBoard: false, devices: [] }).name).toBe('connectRoom');
  });

  it('other "show" lines keep their routes', () => {
    expect(routeLine('show ai', { hasPlanBoard: false, devices: [] }).name).toBe('showAi');
    expect(routeLine('show tools', { hasPlanBoard: false, devices: [] }).name).toBe('paletteOpen');
    expect(routeLine('show history', { hasPlanBoard: false, devices: [] }).name).toBe('history');
  });
});
