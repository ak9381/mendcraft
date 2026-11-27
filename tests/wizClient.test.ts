import { describe, expect, it, vi } from 'vitest';
import { createWizClient, resolveWizToken, wizTokenFreeUrl } from '../src/devices/wizClient';

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

describe('final review M3: ?wizToken= leaves the address bar once stored', () => {
  it('stores the token and returns the address without it (other params and the hash kept)', () => {
    const storage = fakeStorage();
    expect(wizTokenFreeUrl('https://x.test/canvas?sim=0&wizToken=abc123&a=1#b', storage)).toBe('https://x.test/canvas?sim=0&a=1#b');
    expect(storage.store['mendcraft.wizToken']).toBe('abc123');
    expect(wizTokenFreeUrl('https://x.test/canvas?wizToken=abc123', fakeStorage())).toBe('https://x.test/canvas');
  });
  it('no token in the address: null (nothing to change)', () => {
    expect(wizTokenFreeUrl('https://x.test/canvas?sim=1', fakeStorage())).toBeNull();
  });
  it('storage that will not keep it: the address keeps the token (the bridge still works this session)', () => {
    const broken = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(wizTokenFreeUrl('https://x.test/canvas?wizToken=abc123', broken)).toBeNull();
    expect(wizTokenFreeUrl('https://x.test/canvas?wizToken=abc123', null)).toBeNull();
  });
  it('the canvas strips it at boot', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../src/canvas/canvasMain.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/const tokenFree = wizTokenFreeUrl\(location\.href, [^\n]*\);\s*if \(tokenFree\) \{ try \{ history\.replaceState\(history\.state, '', tokenFree\);/);
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
