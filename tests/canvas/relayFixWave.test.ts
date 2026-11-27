// Fix wave (final-review-sim-1): relay / phone paths on the laptop canvas. The
// canvas is not mounted in unit tests, so the wiring is checked in the source
// and the pure pieces are exercised directly.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createFakeTransport } from '../../src/relay/transport';
import { startPhoneJoin } from '../../src/canvas/phoneJoin';
import { tileFromPhone } from '../../src/canvas/tileTransfer';
import { createAskOrigins } from '../../src/canvas/askOrigin';
import { PHONE_DROP_LINE, PHONE_KEEP_LINE, PHONE_MIC_OFF_LINE, PHONE_MIC_ON_LINE, phoneDecision, phoneMic } from '../../src/canvas/phoneGate';
import { MAX_TILES, type SurfacePlan, type TileSpec } from '../../src/canvas/surfacePlan';

const app = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
const joinPhoneSrc = app.slice(app.indexOf('async function joinPhone('), app.indexOf('// Keep / drop act on the waiting board Proposal'));

describe('C2: a new pairing opens a new room unless a phone remembers the stored one', () => {
  it('joinPhone resumes only a room a phone remembers; the room is still saved for a reload', () => {
    expect(joinPhoneSrc).toContain('token: hostRoomToResume(storage)');
    expect(joinPhoneSrc).not.toContain('loadHostToken(');
    expect(joinPhoneSrc).toContain('saveHostToken(storage, res.token)');
  });

  it("a phone's first live announce marks the room as remembered", () => {
    const first = app.slice(app.indexOf("if (live === 'first') {"), app.indexOf("phoneSeenAt.set(platform, Date.now())"));
    expect(first).toContain('rememberHostPhone(storage, hostSession.token)');
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

  it('a resumed room still gets a fresh code (the chime never says the token)', async () => {
    const t = createFakeTransport();
    const a = await startPhoneJoin({ transport: t, chime: () => undefined });
    if ('error' in a) throw new Error('host');
    await a.stop();
    const b = await startPhoneJoin({ transport: t, chime: () => undefined, token: a.token });
    if ('error' in b) throw new Error('host');
    expect(b.token).toBe(a.token);
    expect(b.rawCode).not.toBe(a.rawCode);
    expect(b.token.startsWith(b.rawCode)).toBe(false);
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
    expect(joinPhoneSrc).toContain('askOrigins.note(text)');
  });
});

describe('I6: a phone Undo goes through the review gate', () => {
  it('dispatchRelayCommand gets userUndo, not undo', () => {
    expect(joinPhoneSrc).toMatch(/dispatchRelayCommand\(cmd, \{[\s\S]*?undo: userUndo,/);
  });
});

describe('R1: a phone never approves on the laptop', () => {
  it('keep from a phone is always refused; drop only of a review that phone asked for', () => {
    expect(phoneDecision('keep', 'phone')).toBe(PHONE_KEEP_LINE);
    expect(phoneDecision('keep', undefined)).toBe(PHONE_KEEP_LINE);
    expect(phoneDecision('drop', undefined)).toBe(PHONE_DROP_LINE);
    expect(phoneDecision('drop', 'phone')).toBeNull();
  });

  it('keep() and drop() ask the gate while a phone command runs', () => {
    const keepSrc = app.slice(app.indexOf('function keep(): void'), app.indexOf('function userUndo(): void'));
    expect(keepSrc).toMatch(/function keep\(\): void \{[\s\S]*?phoneDecision\('keep'/);
    expect(keepSrc).toMatch(/function drop\(\): void \{[\s\S]*?phoneDecision\('drop'/);
    expect(joinPhoneSrc).toMatch(/fromPhone = true;[\s\S]*?return run\(text\);[\s\S]*?finally \{ fromPhone = false; \}/);
  });
});

describe('R2: a phone never switches the laptop mic on silently', () => {
  it('on is refused and said; off is allowed and said', () => {
    const say = vi.fn();
    const off = { listening: false, toggle: vi.fn(), stop: vi.fn() };
    phoneMic(off, say);
    expect(off.toggle).not.toHaveBeenCalled();
    expect(say).toHaveBeenLastCalledWith(PHONE_MIC_ON_LINE);
    const on = { listening: true, toggle: vi.fn(), stop: vi.fn() };
    phoneMic(on, say);
    expect(on.stop).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenLastCalledWith(PHONE_MIC_OFF_LINE);
  });

  it('the relay mic command goes through phoneMic', () => {
    expect(joinPhoneSrc).toMatch(/toggleMic: \(\) => phoneMic\(micFabRef, say\)/);
  });
});
