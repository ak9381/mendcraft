import { describe, expect, it, vi } from 'vitest';
import { createWizAwareConnector, isWizDevice } from '../../src/canvas/wizDevices';
import type { WizClient } from '../../src/devices/wizClient';
import type { DeviceConnector } from '../../src/canvas/deviceActions';

function fakeFallback(): DeviceConnector & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    run: async (intent) => {
      calls.push(intent);
      return { on: intent.on ?? true, brightness: intent.brightness ?? 50 };
    },
  };
}

function fakeClient(overrides: Partial<WizClient> = {}): WizClient {
  return {
    baseUrl: 'http://127.0.0.1:38888',
    health: vi.fn(async () => true),
    discover: vi.fn(async () => []),
    getPilot: vi.fn(async () => ({ on: true, dimming: 80 })),
    setPilot: vi.fn(async () => ({ on: true, dimming: 80 })),
    ...overrides,
  };
}

describe('isWizDevice', () => {
  it('matches the wiz- device id prefix used by the stub devices', () => {
    expect(isWizDevice('wiz-lamp-1')).toBe(true);
    expect(isWizDevice('wiz-lamp-2')).toBe(true);
    expect(isWizDevice('speaker-a')).toBe(false);
  });
});

describe('createWizAwareConnector', () => {
  it('routes a wiz- device to the real bridge when the bridge is up', async () => {
    const client = fakeClient();
    const fallback = fakeFallback();
    const status = { up: true };
    const connector = createWizAwareConnector({ client, fallback, status });

    const res = await connector.run({ deviceId: 'wiz-lamp-1', on: true });

    expect(client.setPilot).toHaveBeenCalledWith('', { kind: 'power', on: true });
    expect(res).toMatchObject({ on: true, sim: false });
    expect(fallback.calls).toHaveLength(0);
  });

  it('sends a dim intent when brightness is set', async () => {
    const client = fakeClient();
    const fallback = fakeFallback();
    const status = { up: true };
    const connector = createWizAwareConnector({ client, fallback, status });

    await connector.run({ deviceId: 'wiz-lamp-2', brightness: 70 });

    expect(client.setPilot).toHaveBeenCalledWith('', { kind: 'dim', dimming: 70 });
  });

  it('falls back to the simulated connector, tagged sim:true, when the bridge is down', async () => {
    const client = fakeClient();
    const fallback = fakeFallback();
    const status = { up: false };
    const connector = createWizAwareConnector({ client, fallback, status });

    const res = await connector.run({ deviceId: 'wiz-lamp-1', on: true });

    expect(client.setPilot).not.toHaveBeenCalled();
    expect(fallback.calls).toHaveLength(1);
    expect(res).toMatchObject({ on: true, sim: true });
  });

  it('never routes non-wiz devices to the bridge, even when it is up', async () => {
    const client = fakeClient();
    const fallback = fakeFallback();
    const status = { up: true };
    const connector = createWizAwareConnector({ client, fallback, status });

    const res = await connector.run({ deviceId: 'speaker-a', playing: true });

    expect(client.setPilot).not.toHaveBeenCalled();
    expect(fallback.calls).toHaveLength(1);
    expect(res).not.toHaveProperty('sim');
  });

  it('drops to the fallback and flips status.up false when the bridge call throws mid-session', async () => {
    const client = fakeClient({ setPilot: vi.fn(async () => { throw new Error('bridge dropped'); }) });
    const fallback = fakeFallback();
    const status = { up: true };
    const connector = createWizAwareConnector({ client, fallback, status });

    const res = await connector.run({ deviceId: 'wiz-lamp-1', on: false });

    expect(fallback.calls).toHaveLength(1);
    expect(res).toMatchObject({ sim: true });
    expect(status.up).toBe(false);
  });
});
