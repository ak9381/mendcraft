import { describe, it, expect } from 'vitest';
import {
  validateCommand, validateMessage, fitsRoomMessageRules, CMD_JSON_MAX,
} from '../src/relay/protocol';
import { createFakeTransport } from '../src/relay/transport';
import { createHostSession, createGuestSession } from '../src/relay/session';
import { buildControlSnapshot, type ControlSnapshot } from '../src/relay/controlSnapshot';
import { serializeTransfer, validateTransfer } from '../src/canvas/tileTransfer';

const flush = () => new Promise((r) => setTimeout(r, 0));
const TOKEN = 'ABCDEFGHJKMNPQRSTVWXYZ01';

describe('protocol: transfer/announce command kinds', () => {
  const lamp = { type: 'lamp', deviceId: 'lamp-1', label: 'Lamp' };
  const text = serializeTransfer(
    validateTransfer({ tile: lamp, componentId: 'lamp-lamp-1', from: 'laptop', to: 'left', enterEdge: 'right' })!,
  )!;

  it('accepts a transfer command carrying JSON in text', () => {
    const c = validateCommand({ kind: 'transfer', text });
    expect(c).not.toBeNull();
    expect(c!.kind).toBe('transfer');
  });
  it('accepts an announce command', () => {
    expect(validateCommand({ kind: 'announce', text: JSON.stringify({ deviceId: 'dev-1', platform: 'android' }) })).not.toBeNull();
  });
  it('rejects empty or oversized transfer text', () => {
    expect(validateCommand({ kind: 'transfer', text: '' })).toBeNull();
    expect(validateCommand({ kind: 'transfer', text: 'x'.repeat(CMD_JSON_MAX + 1) })).toBeNull();
  });
  it('a transfer cmd message passes the room-write rules (cmd stays a map)', () => {
    const msg = validateMessage({ v: 1, from: 'phone', type: 'cmd', cmd: { kind: 'transfer', text } });
    expect(msg).not.toBeNull();
    expect(fitsRoomMessageRules({ ...msg, at: new Date() })).toBe(true);
  });
});

describe('session: resume the same room token', () => {
  it('reuses a provided token instead of minting a new one', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, undefined, { token: TOKEN });
    expect(host.token).toBe(TOKEN);
    expect(host.code).toBe(TOKEN.slice(0, 8));
    await host.close();
  });
  it('ignores a malformed resume token and mints a fresh one', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, undefined, { token: 'bad' });
    expect(host.token).not.toBe('bad');
    expect(host.token).toHaveLength(24);
    await host.close();
  });
});

describe('session: a second phone can join the same room', () => {
  it('host acks both phones so both reach paired', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, undefined, { token: TOKEN });
    const a = await createGuestSession(t, TOKEN);
    await flush();
    expect(a.state()).toBe('paired');
    const b = await createGuestSession(t, TOKEN);
    await flush();
    expect(b.state()).toBe('paired'); // ack fires even though host was already paired
    await Promise.all([a.close(), b.close(), host.close()]);
  });
});

describe('session: guests receive host state snapshots', () => {
  function snap(rev: number, extra: Partial<ControlSnapshot> = {}): ControlSnapshot {
    return buildControlSnapshot({ rev, ...(extra as object) });
  }

  it('onSnapshot fires on a published state (board/layout/transfer ride here)', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, undefined, { token: TOKEN });
    const guest = await createGuestSession(t, TOKEN);
    await flush();
    const seen: ControlSnapshot[] = [];
    guest.onSnapshot((s) => seen.push(s));
    await host.publishState(buildControlSnapshot({
      rev: 5,
      layout: { left: 'android', right: 'ios' },
      board: { kind: 'room', title: 'Room', tiles: [{ type: 'lamp', deviceId: 'lamp-1', label: 'Lamp' }] },
    }));
    await flush();
    expect(seen).toHaveLength(1);
    expect(seen[0].rev).toBe(5);
    expect(seen[0].layout).toEqual({ left: 'android', right: 'ios' });
    expect(seen[0].board?.tiles).toHaveLength(1);
    await Promise.all([guest.close(), host.close()]);
  });

  it('a transfer republished via state reaches the OTHER phone', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, undefined, { token: TOKEN });
    const left = await createGuestSession(t, TOKEN);
    const right = await createGuestSession(t, TOKEN);
    await flush();
    const rightSeen: ControlSnapshot[] = [];
    right.onSnapshot((s) => rightSeen.push(s));
    // Host applies a transfer it received from `left` and republishes state.
    await host.publishState(buildControlSnapshot({
      rev: 9,
      transfer: { componentId: 'lamp-lamp-1', to: 'right', enterEdge: 'left', rev: 9 },
      board: { kind: 'room', title: 'Room', tiles: [{ type: 'lamp', deviceId: 'lamp-1', label: 'Lamp' }] },
    }));
    await flush();
    expect(rightSeen.at(-1)?.transfer).toEqual({ componentId: 'lamp-lamp-1', to: 'right', enterEdge: 'left', rev: 9 });
    await Promise.all([left.close(), right.close(), host.close()]);
  });

  it('a late onSnapshot still sees the buffered snapshot', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, undefined, { token: TOKEN });
    const guest = await createGuestSession(t, TOKEN);
    await flush();
    await host.publishState(snap(3));
    await flush();
    const seen: ControlSnapshot[] = [];
    guest.onSnapshot((s) => seen.push(s)); // registered AFTER the publish
    expect(seen).toHaveLength(1);
    expect(seen[0].rev).toBe(3);
    await Promise.all([guest.close(), host.close()]);
  });
});
