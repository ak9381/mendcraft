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

const app = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
const joinPhoneSrc = app.slice(app.indexOf('async function joinPhone('), app.indexOf('// Keep / drop act on the waiting board Proposal'));

describe('C2: a new pairing opens a new room', () => {
  it('a fresh pairing never resumes the stored room token, and forgets it', () => {
    expect(joinPhoneSrc).not.toContain('loadHostToken(');
    expect(joinPhoneSrc).toContain('clearHostToken(storage)');
    expect(app).not.toContain('saveHostToken(');
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
