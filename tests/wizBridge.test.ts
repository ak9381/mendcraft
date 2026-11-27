import { describe, expect, it } from 'vitest';
import { createDiscovery, isAllowedOrigin, isBulbAddress, isIPv4, validateParams } from '../scripts/wizBridge.lib.mjs';

describe('wiz-bridge CORS origin allowlist', () => {
  it('allows known dev / app origins', () => {
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowedOrigin('https://localhost')).toBe(true);
    expect(isAllowedOrigin('capacitor://localhost')).toBe(true);
    expect(isAllowedOrigin('https://mendcraft.web.app')).toBe(true);
    expect(isAllowedOrigin('https://mendcraft--preview-123.web.app')).toBe(true);
  });

  it('rejects anything else, including look-alikes', () => {
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false);
    expect(isAllowedOrigin('https://mendcraft.web.app.evil.com')).toBe(false);
    expect(isAllowedOrigin('http://localhost.evil.com')).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(false);
    expect(isAllowedOrigin('')).toBe(false);
  });
});

describe('wiz-bridge IPv4 destination check', () => {
  it('accepts dotted-quad literals only', () => {
    expect(isIPv4('192.168.1.50')).toBe(true);
    expect(isIPv4('255.255.255.255')).toBe(true);
    expect(isIPv4('bulb.local')).toBe(false);
    expect(isIPv4('256.0.0.1')).toBe(false);
    expect(isIPv4(null)).toBe(false);
  });
});

describe('wiz-bridge param check', () => {
  it('refuses out-of-range and unknown params instead of clamping them', () => {
    expect(validateParams({ state: true, dimming: 5000 }).ok).toBe(false);
    expect(validateParams({ state: true, temp: 1 }).ok).toBe(false);
    expect(validateParams({ state: true, evil: 'drop me' }).ok).toBe(false);
    expect(validateParams(null).ok).toBe(false);
    expect(validateParams({ state: true, dimming: 60 })).toEqual({ ok: true, params: { state: true, dimming: 60 } });
  });
});

describe('wiz-bridge /discover (final review D2): overlapping calls share one broadcast, never crash', () => {
  const fakeTimers = () => {
    const q: Array<{ at: number; fn: () => void }> = []; let now = 0;
    return {
      setTimeout: (fn: () => void, ms: number) => { q.push({ at: now + ms, fn }); },
      advance: (ms: number) => { now += ms; for (const t of q.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)) { q.splice(q.indexOf(t), 1); t.fn(); } },
    };
  };
  it('a second /discover while one is in flight gets the same answer; the next one broadcasts again', async () => {
    const t = fakeTimers(); let sends = 0;
    const d = createDiscovery({ send: () => { sends++; }, setTimeout: t.setTimeout, windowMs: 900 });
    const a = d.discover(); const b = d.discover();
    expect(b).toBe(a);
    d.onMessage('192.168.1.40', { result: { mac: 'aa', state: true } });
    t.advance(300); const c = d.discover(); expect(c).toBe(a); // still in flight
    t.advance(700);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual([{ ip: '192.168.1.40', mac: 'aa', state: { mac: 'aa', state: true } }]);
    expect(rb).toBe(ra);
    expect(sends).toBe(2); // one broadcast (two pulses), not two
    const next = d.discover(); expect(next).not.toBe(a);
    t.advance(1000);
    expect(await next).toEqual([]);
    // a reply outside any window is ignored, never thrown on
    expect(() => d.onMessage('192.168.1.41', {})).not.toThrow();
  });
  it('a send that throws still answers (empty), the bridge keeps running', async () => {
    const t = fakeTimers();
    const d = createDiscovery({ send: () => { throw new Error('ENETUNREACH'); }, setTimeout: t.setTimeout });
    const p = d.discover(); t.advance(2000);
    expect(await p).toEqual([]);
  });
  it('the bridge script uses the shared discovery and has a last-resort guard', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../scripts/wiz-bridge.mjs', import.meta.url), 'utf8');
    expect(src).toContain('createDiscovery(');
    expect(src).not.toMatch(/let discovering = null/);
    expect(src).toContain("process.on('uncaughtException'");
  });
});

describe('wiz-bridge bulb address (final review D4): private, never broadcast or public', () => {
  it('accepts private LAN hosts only', () => {
    for (const ip of ['192.168.1.50', '10.0.0.9', '172.16.4.2', '172.31.255.10', '169.254.3.4']) expect(isBulbAddress(ip)).toBe(true);
    for (const ip of ['255.255.255.255', '192.168.1.255', '192.168.1.0', '8.8.8.8', '172.32.0.1', '127.0.0.1', '0.0.0.0', '224.0.0.1', 'bulb.local', '']) expect(isBulbAddress(ip)).toBe(false);
  });
  it('getPilot and setPilot refuse any other address', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../scripts/wiz-bridge.mjs', import.meta.url), 'utf8');
    expect(src.match(/if \(!isBulbAddress\(ip\)\)/g)?.length).toBe(2);
  });
});
