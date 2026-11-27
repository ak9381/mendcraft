// Fix wave (final review 1): relay / phone paths on the laptop canvas. The
// canvas is not mounted in unit tests, so the wiring is checked in the source
// and the pure pieces are exercised directly.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFakeTransport } from '../../src/relay/transport';
import { startPhoneJoin } from '../../src/canvas/phoneJoin';
import { tileFromPhone } from '../../src/canvas/tileTransfer';
import { createAskOrigins } from '../../src/canvas/askOrigin';
import { MAX_TILES, type SurfacePlan, type TileSpec } from '../../src/canvas/surfacePlan';
import { clearHostToken, loadHostToken, saveHostToken, type StorageLike } from '../../src/relay/pairingStore';
import { createLaptopLink, LINK_LINES, PING_EVERY_MS, PING_TIMEOUT_MS } from '../../src/canvas/laptopLink';
import type { RelayTransport } from '../../src/relay/transport';

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
  const link = createLaptopLink({
    storage: memoryStorage(), platform, native: true,
    onSnapshot: () => undefined,
    joinExtras: { transport: t, keepAliveTimers: { setInterval: () => 0, clearInterval: () => undefined } },
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  return { link, timers };
}

const app = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
const joinPhoneSrc = app.slice(app.indexOf('async function joinPhone('), app.indexOf('// Keep / drop act on the waiting board Proposal'));

describe('C2 follow-up: a laptop reload keeps the room for remembered phones', () => {
  it('a new pairing resumes the remembered room; only with none remembered is a new room minted', () => {
    expect(joinPhoneSrc).toContain('token: loadHostToken(storage) ?? undefined');
    expect(joinPhoneSrc).not.toContain('clearHostToken(');
  });

  it('the room is remembered once a phone is really here (its first live announce), never before', () => {
    const announce = app.slice(app.indexOf('function handlePhoneDeviceCommand('), app.indexOf("bodyLanguage('wakeup');"));
    expect(announce).toMatch(/if \(live === 'first'\) \{[\s\S]*?if \(hostSession\) saveHostToken\(storage, hostSession\.token\);/);
    expect(app.match(/saveHostToken\(/g)?.length).toBe(1);
  });

  it('only the explicit Disconnect forgets the room; closing the sheet or the card keeps it', () => {
    const disc = app.slice(app.indexOf('function disconnectPhones('), app.indexOf('function forgetPhoneSense('));
    expect(disc).toContain('if (forget) clearHostToken(storage);');
    expect(app).toContain("disconnectPhones({ forget: true }); say('Phones disconnected.');");
    expect(app.match(/clearHostToken\(/g)?.length).toBe(1);
    const close = app.slice(app.indexOf('function closeConnectSheet('), app.indexOf('function openConnectSheet('));
    expect(close).not.toContain('clearHostToken');
  });

  it('reload: a phone paired in the room rejoins the new laptop session on its own, no chime code', async () => {
    const t = createFakeTransport();
    const storage = memoryStorage();
    const first = await startPhoneJoin({ transport: t, chime: () => undefined, token: loadHostToken(storage) ?? undefined });
    if ('error' in first) throw new Error('host');
    const a = phone(t, 'android');
    await a.link.joinWithCode(first.code, true);
    await flush();
    expect(a.link.state()).toBe('connected');
    saveHostToken(storage, first.token); // its first live announce
    // The laptop reloads: the page is gone (no bye), a new page, a new session.
    a.timers.fire(PING_EVERY_MS); await flush();
    const joins: string[] = [];
    const second = await startPhoneJoin({ transport: t, chime: () => joins.push('chime'), token: loadHostToken(storage) ?? undefined });
    if ('error' in second) throw new Error('host');
    expect(second.token).toBe(first.token);
    expect(second.rawCode).not.toBe(first.rawCode); // the chime code is still new each window
    expect(second.token.startsWith(second.rawCode)).toBe(false);
    a.timers.fire(PING_TIMEOUT_MS); await flush();
    a.timers.fire(PING_EVERY_MS); await flush();
    expect(a.link.state()).toBe('connected');
    expect(a.link.message()).toBe(LINK_LINES.connected);
    await a.link.stop(); await first.stop(); await second.stop();
  });

  it('with no phone remembered, a new pairing mints a new room', async () => {
    const t = createFakeTransport();
    const storage = memoryStorage();
    const a = await startPhoneJoin({ transport: t, chime: () => undefined, token: loadHostToken(storage) ?? undefined });
    if ('error' in a) throw new Error('host');
    // Nobody joined: nothing remembered, the next pairing is a new room.
    const b = await startPhoneJoin({ transport: t, chime: () => undefined, token: loadHostToken(storage) ?? undefined });
    if ('error' in b) throw new Error('host');
    expect(b.token).not.toBe(a.token);
    saveHostToken(storage, b.token);
    clearHostToken(storage); // Disconnect
    const c = await startPhoneJoin({ transport: t, chime: () => undefined, token: loadHostToken(storage) ?? undefined });
    if ('error' in c) throw new Error('host');
    expect(c.token).not.toBe(b.token);
    await a.stop(); await b.stop(); await c.stop();
  });

  it('phones already paired in the open room keep it: one more phone re-opens a window on the same session', () => {
    expect(joinPhoneSrc).toMatch(/if \(pairingStop && hostSession && relayKept\(\)\) \{[\s\S]*?await session\.admitMore\(\)/);
  });

  it('two fresh pairings get two rooms and two codes, none derived from the other', async () => {
    const t = createFakeTransport();
    const a = await startPhoneJoin({ transport: t, chime: () => undefined });
    const b = await startPhoneJoin({ transport: t, chime: () => undefined });
    if ('error' in a || 'error' in b) throw new Error('host');
    expect(a.token).not.toBe(b.token);
    expect(a.rawCode).not.toBe(b.rawCode);
    expect(a.token.startsWith(a.rawCode)).toBe(false);
    await a.stop();
    await b.stop();
  });
});

const lamp = (id: string): TileSpec => ({ type: 'lamp', deviceId: id, label: `Lamp ${id}` } as unknown as TileSpec);
const board = (n: number): SurfacePlan => ({ kind: 'room', title: 'Room', tiles: Array.from({ length: n }, (_, i) => lamp(`l${i}`)) });

describe('I1: a tile sent back from a phone is a proposal, never applied as it comes', () => {
  it('a board at the tile cap refuses it; a duplicate changes nothing; otherwise a checked plan', () => {
    expect(tileFromPhone(board(MAX_TILES), lamp('new'))).toEqual({ ok: false, why: 'full' });
    const dup = tileFromPhone(board(2), lamp('l1'));
    expect(dup).toEqual({ ok: false, why: 'same' });
    const r = tileFromPhone(board(2), lamp('new'));
    expect(r.ok && r.plan.tiles.length).toBe(3);
  });

  it('the canvas opens a review for it (refused while one is open), and never writes the board directly', () => {
    const branch = app.slice(app.indexOf("// kind === 'transfer'"), app.indexOf('const edgeTransfer = createEdgeTransferController('));
    expect(branch).toContain('tileFromPhone(');
    expect(branch).toContain('reviewBusy()');
    expect(branch).toContain('proposePhoneTile(');
    expect(branch).not.toMatch(/surfaces\[frameId\] = next/);
  });
});

describe('I2: a phone leaving drops only a review a phone asked for', () => {
  it('phone asks are remembered by their words and taken once', () => {
    let t = 0;
    const o = createAskOrigins(() => t);
    o.note('add a lamp');
    expect(o.take('add a fan')).toBe(false);
    expect(o.take(' add a lamp ')).toBe(true);
    expect(o.take('add a lamp')).toBe(false);
    o.note('old');
    t += 11 * 60_000;
    expect(o.take('old')).toBe(false);
  });

  it('the gone/disconnected handler only drops a phone-asked review', () => {
    expect(joinPhoneSrc).not.toMatch(/if \(pending\) drop\(\);/);
    expect(joinPhoneSrc).toContain("if (pending?.from === 'phone') drop();");
    expect(joinPhoneSrc).toMatch(/run: \(text\) => \{ askOrigins\.note\(text\); return run\(text\); \}/);
  });
});

describe('I6: a phone Undo goes through the review gate', () => {
  it('dispatchRelayCommand gets userUndo, not undo', () => {
    expect(joinPhoneSrc).toMatch(/dispatchRelayCommand\(cmd, \{[\s\S]*?undo: userUndo,/);
  });
});
