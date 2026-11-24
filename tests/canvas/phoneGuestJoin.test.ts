import { describe, expect, it, vi } from 'vitest';
import { startPhoneJoin } from '../../src/canvas/phoneJoin';
import { joinPhoneAsGuest } from '../../src/canvas/phoneGuestJoin';
import { createFakeTransport } from '../../src/relay/transport';
import { createHostSession } from '../../src/relay/session';
import { loadPhonePair, type StorageLike } from '../../src/relay/pairingStore';
import type { PairState } from '../../src/relay/protocol';
import { shortCodeOf } from '../../src/relay/protocol';

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
  };
}

describe('joinPhoneAsGuest', () => {
  it('joins an existing host room from a decoded short code (guest, not host)', async () => {
    const transport = createFakeTransport();
    const host = await startPhoneJoin({ transport });
    expect('error' in host).toBe(false);
    if ('error' in host) return;

    const storage = memoryStorage();
    const states: PairState[] = [];
    const guest = await joinPhoneAsGuest({
      code: host.code, // grouped ABCD-EFGH, as the chime would decode ungrouped but parseJoinInput accepts both
      transport,
      storage,
      platform: 'android',
      hubName: 'This laptop',
      onState: (s) => states.push(s),
    });

    expect('error' in guest).toBe(false);
    if ('error' in guest) return;

    // A guest session has a roomId but no minted token of its own.
    expect(guest.roomId).toBe(host.token);
    expect(guest.session.roomId).toBe(host.token);
    expect('token' in guest.session).toBe(false);

    await new Promise((r) => setTimeout(r, 20));
    expect(states).toContain('paired');

    const saved = loadPhonePair(storage);
    expect(saved?.token).toBe(host.token);
    expect(saved?.hubName).toBe('This laptop');
    expect(saved?.platform).toBe('android');
    expect(saved?.token).toHaveLength(24);
    // The remembered token is the full capability, not just the 8-char code.
    expect(saved?.token).not.toBe(shortCodeOf(host.token));

    await guest.stop();
    await host.stop();
  });

  it('does not mint a second host room when joining from a code', async () => {
    const transport = createFakeTransport();
    const first = await createHostSession(transport);
    const createHost = vi.fn();
    const guest = await joinPhoneAsGuest({
      code: first.code,
      transport,
    });
    expect('error' in guest).toBe(false);
    expect(createHost).not.toHaveBeenCalled();
    if (!('error' in guest)) {
      expect(guest.roomId).toBe(first.token);
      await guest.stop();
    }
    await first.close();
  });

  it('announces its platform to the laptop once joined', async () => {
    const transport = createFakeTransport();
    const host = await createHostSession(transport);
    const cmds: Array<{ kind: string; text?: string }> = [];
    host.onCommand((c) => cmds.push(c));
    const guest = await joinPhoneAsGuest({ code: host.code, transport, platform: 'ios' });
    expect('error' in guest).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    const ann = cmds.find((c) => c.kind === 'announce');
    expect(ann).toBeTruthy();
    expect(JSON.parse(ann!.text!)).toEqual({ platform: 'ios' });
    if (!('error' in guest)) await guest.stop();
    await host.close();
  });

  it('returns room not found for an unknown code', async () => {
    const transport = createFakeTransport();
    const result = await joinPhoneAsGuest({ code: 'ABCD1234', transport });
    expect(result).toEqual({ error: 'room not found' });
  });

  it('returns needs network when the probe fails', async () => {
    const result = await joinPhoneAsGuest({
      code: 'ABCD1234',
      probe: async () => ({ ok: false as const, reason: 'Offline' }),
    });
    expect(result).toEqual({ error: 'needs network' });
  });
});
