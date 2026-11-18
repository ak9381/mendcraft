import { describe, expect, it, vi } from 'vitest';
import { startPhoneJoin } from '../../src/canvas/phoneJoin';
import { createFakeTransport } from '../../src/relay/transport';
import { createGuestSession } from '../../src/relay/session';
import type { PairState } from '../../src/relay/protocol';

describe('phoneJoin', () => {
  it('creates host session with fake transport and returns code and stop function', async () => {
    const transport = createFakeTransport();
    const result = await startPhoneJoin({ transport });

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(typeof result.code).toBe('string');
      // Format ABCD-1234
      expect(result.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(typeof result.stop).toBe('function');

      // Stop cleans up without error
      await expect(result.stop()).resolves.toBeUndefined();
    }
  });

  it('triggers chime callback when phone guest connects and flips state to paired', async () => {
    const transport = createFakeTransport();
    const chime = vi.fn();
    const states: PairState[] = [];

    const result = await startPhoneJoin({
      transport,
      chime,
      onState: (s) => states.push(s),
    });

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.token).toBeDefined();

      // Guest connects to the same room
      const guest = await createGuestSession(transport, result.token);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(chime).toHaveBeenCalledTimes(1);
      expect(states).toContain('paired');

      await guest.close();
      await result.stop();
    }
  });

  it('returns { error: "needs network" } without throwing when probe fails', async () => {
    const fakeProbe = vi.fn(async () => ({ ok: false as const, reason: 'Offline' }));
    const result = await startPhoneJoin({ probe: fakeProbe });

    expect(result).toEqual({ error: 'needs network' });
  });

  it('returns { error: "needs network" } without throwing when createHostSession throws', async () => {
    const transport = createFakeTransport();
    const throwingHostFactory = vi.fn(async () => {
      throw new Error('Firestore connection failed');
    });

    const result = await startPhoneJoin({
      transport,
      createHostSession: throwingHostFactory as unknown as typeof import('../../src/relay/session').createHostSession,
    });

    expect(result).toEqual({ error: 'needs network' });
  });
});
