// Re-running "connect devices" to pair a second phone must not cost the first
// phone its link: the laptop keeps the SAME host session (same room, same
// session id) and only re-opens the code; pongs answer every paired phone; and
// a phone whose laptop session really did change follows it on its own.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALIAS_TTL_MS, createGuestSession, createHostSession, resolveRoomId } from '../../src/relay/session';
import { createLaptopLink, LINK_LINES, PING_EVERY_MS, PING_TIMEOUT_MS } from '../../src/canvas/laptopLink';
import { startPhoneJoin } from '../../src/canvas/phoneJoin';
import { createPairFirst } from '../../src/canvas/pairedRow';
import type { StorageLike } from '../../src/relay/pairingStore';
import { createFakeTransport, type RelayTransport } from '../../src/relay/transport';
import { buildControlSnapshot, type ControlSnapshot } from '../../src/relay/controlSnapshot';

const flush = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

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
  };
}
function phone(t: RelayTransport, platform: 'android' | 'ios') {
  const timers = manualTimers();
  const snaps: ControlSnapshot[] = [];
  const link = createLaptopLink({
    storage: memoryStorage(), platform, native: true,
    onSnapshot: (s) => { snaps.push(s); },
    joinExtras: { transport: t, keepAliveTimers: { setInterval: () => 0, clearInterval: () => undefined } },
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  return { link, timers, snaps };
}

describe('connect devices again: phone A stays paired while phone B joins', () => {
  it('pair A, run connect devices again, pair B → both ✓ and A keeps receiving', async () => {
    const t = createFakeTransport();
    const host = await startPhoneJoin({ transport: t, chime: () => undefined });
    if ('error' in host) throw new Error('host');
    const a = phone(t, 'android');
    await a.link.joinWithCode(host.code, true);
    await flush();
    expect(a.link.state()).toBe('connected');
    // A's signed proof (it knows the sid after the first pong) retired the code.
    a.timers.fire(PING_EVERY_MS); await flush();
    expect(await t.resolveAlias(host.rawCode)).toBeNull();

    // "connect devices" again: the canvas keeps the session and re-opens the code.
    const sidBefore = host.session.sid;
    await host.session.admitMore();
    await host.session.askWhoIsThere();
    await flush();
    expect(host.session.sid).toBe(sidBefore);
    expect(await t.resolveAlias(host.rawCode)).toBe(host.token);

    const b = phone(t, 'ios');
    await b.link.joinWithCode(host.code, true);
    await flush();
    expect(b.link.state()).toBe('connected');
    expect(a.link.state()).toBe('connected');

    // Every phone's proof keeps being answered — A's pings name the same sid.
    for (let i = 0; i < 3; i++) {
      a.timers.fire(PING_EVERY_MS); b.timers.fire(PING_EVERY_MS); await flush();
      a.timers.fire(PING_TIMEOUT_MS); b.timers.fire(PING_TIMEOUT_MS); await flush();
    }
    expect(a.link.state()).toBe('connected');
    expect(b.link.state()).toBe('connected');
    expect(a.link.message()).toBe(LINK_LINES.connected);

    const before = { a: a.snaps.length, b: b.snaps.length };
    await host.session.publishState(buildControlSnapshot({ rev: 77 }));
    await flush();
    expect(a.snaps.slice(before.a).map((s) => s.rev)).toContain(77);
    expect(b.snaps.slice(before.b).map((s) => s.rev)).toContain(77);

    // Pairing over: the code goes.
    await host.session.endAdmission();
    expect(await t.resolveAlias(host.rawCode)).toBeNull();
    await a.link.stop(); await b.link.stop(); await host.stop();
  });

  it('a phone follows a laptop whose host session really changed (bye, then a new session)', async () => {
    const t = createFakeTransport();
    const first = await startPhoneJoin({ transport: t, chime: () => undefined });
    if ('error' in first) throw new Error('host');
    const a = phone(t, 'android');
    await a.link.joinWithCode(first.code, true);
    await flush();
    expect(a.link.state()).toBe('connected');
    await first.stop(); // bye
    await flush();
    expect(a.link.state()).toBe('error');
    const second = await startPhoneJoin({ transport: t, chime: () => undefined, token: first.token });
    if ('error' in second) throw new Error('host');
    await flush();
    expect(second.session.sid).not.toBe(first.session.sid);
    expect(a.link.state()).toBe('connected');
    a.timers.fire(PING_EVERY_MS); await flush();
    a.timers.fire(PING_TIMEOUT_MS); await flush();
    expect(a.link.state()).toBe('connected');
    await a.link.stop(); await second.stop();
  });

  it('pair-first: begin() again keeps the real phones already paired', () => {
    const pf = createPairFirst({ say: () => undefined, sim: () => false, openPairing: async () => true, buildDashboard: () => undefined });
    void pf.begin();
    pf.addPhone({ id: 'android', label: 'Nothing phone' });
    void pf.begin();
    expect(pf.phase()).toBe('pairing');
    expect(pf.phones().map((p) => p.id)).toEqual(['android']);
    pf.addPhone({ id: 'ios', label: 'iPhone' });
    expect(pf.phones().map((p) => p.id)).toEqual(['android', 'ios']);
  });
});

const app = () => readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');

describe('review fixes', () => {
  it('I1: closing the extra-pairing card ends only that pairing — the phones stay', () => {
    const src = app();
    const repair = src.slice(src.indexOf('if (pairingStop && hostSession && relayKept()) {'), src.indexOf('if (simEnv() || !net.isOnline()) {'));
    expect(repair).toContain('onClose: () => { endExtraPairing(session); open.host.hidden = true; },');
    expect(repair).not.toContain('disconnectPhones()');
    expect(repair).toContain('setStatus(REPAIR_FAILED_LINE)');
    const fn = src.slice(src.indexOf('function endExtraPairing(session: HostSession): void {'), src.indexOf('async function joinPhone('));
    expect(fn).toContain('session.endAdmission()');
    expect(fn).toContain('livePairing?.stopChime();');
    expect(fn).not.toMatch(/disconnectPhones|pairingStop|pairFirst\.cancel/);
  });

  it('I2: the reopened code closes on pagehide and when pairing is done', () => {
    const src = app();
    expect(src).toContain("addEventListener('pagehide', onPageHide);");
    expect(src).toMatch(/const onPageHide = \(\): void => \{ if \(admissionOpen\) \{ admissionOpen = false; void hostSession\?\.endAdmission\(\)/);
    expect(src).toMatch(/if \(admissionOpen && pairFirst\.phase\(\) !== 'pairing'\) \{ admissionOpen = false; void hostSession\?\.endAdmission\(\)/);
  });

  it('I2: a short code older than ALIAS_TTL_MS no longer resolves (even if its doc is still there)', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t);
    const now = Date.now();
    expect(await resolveRoomId(t, { kind: 'code', code: host.code }, { now: () => now })).toBe(host.token);
    expect(await resolveRoomId(t, { kind: 'code', code: host.code }, { now: () => now + ALIAS_TTL_MS + 1000 })).toBeNull();
    // A full token never expires this way.
    expect(await resolveRoomId(t, { kind: 'token', token: host.token }, { now: () => now + 10 * ALIAS_TTL_MS })).toBe(host.token);
    // Reopening re-vouches for the code; ending admission retires it.
    await host.admitMore();
    expect(await resolveRoomId(t, { kind: 'code', code: host.code })).toBe(host.token);
    await host.endAdmission();
    expect(await resolveRoomId(t, { kind: 'code', code: host.code })).toBeNull();
    await host.close();
  });

  it("I3: another phone's (or a dashboard's) bye does not drop this phone's link", async () => {
    const t = createFakeTransport();
    const host = await startPhoneJoin({ transport: t, chime: () => undefined });
    if ('error' in host) throw new Error('host');
    const a = phone(t, 'android');
    await a.link.joinWithCode(host.code, true);
    await flush();
    expect(a.link.state()).toBe('connected');
    const other = await createGuestSession(t, host.token);
    await flush();
    await other.close(); // a phone's bye
    await t.publish(host.token, { v: 1, from: 'control', type: 'bye' });
    await flush();
    expect(a.link.state()).toBe('connected');
    a.timers.fire(PING_EVERY_MS); await flush();
    expect(a.link.state()).toBe('connected');
    // The laptop's own bye still counts.
    await host.stop();
    await flush();
    expect(a.link.state()).toBe('error');
    await a.link.stop();
  });
});
