import { describe, expect, it, vi } from 'vitest';
import { createWizClient, resolveWizToken } from '../src/devices/wizClient';

function fakeStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    store,
  };
}

describe('resolveWizToken', () => {
  it('prefers ?wizToken= and persists it', () => {
    const storage = fakeStorage();
    expect(resolveWizToken('?wizToken=abc123', storage)).toBe('abc123');
    expect(storage.store['mendcraft.wizToken']).toBe('abc123');
  });

  it('falls back to a stored token, then empty', () => {
    expect(resolveWizToken('', fakeStorage({ 'mendcraft.wizToken': 'stored-token' }))).toBe('stored-token');
    expect(resolveWizToken('', fakeStorage())).toBe('');
  });
});

describe('createWizClient token header', () => {
  it('sends x-wiz-token on every call, GET and POST alike', async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ input, init });
      return { ok: true, status: 200, json: async () => ({ ok: true, bulbs: [] }) };
    });
    const client = createWizClient('http://127.0.0.1:38888', fetchImpl, 'my-token');
    await client.health();
    await client.discover();

    for (const call of calls) {
      const headers = call.init?.headers as Record<string, string> | undefined;
      expect(headers?.['x-wiz-token']).toBe('my-token');
    }
  });
});
