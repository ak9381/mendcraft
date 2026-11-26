import { describe, expect, it } from 'vitest';
import { isAllowedOrigin, isIPv4, validateParams } from '../scripts/wizBridge.lib.mjs';

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
