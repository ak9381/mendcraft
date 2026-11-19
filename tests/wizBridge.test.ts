import { describe, expect, it } from 'vitest';
import { isAllowedOrigin, isIPv4, sanitizeParams } from '../scripts/wizBridge.lib.mjs';

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

describe('wiz-bridge param sanitizer', () => {
  it('clamps known fields and drops unknown ones', () => {
    expect(sanitizeParams({ state: true, dimming: 5000, temp: 1, r: -9, evil: 'drop me' })).toEqual({
      state: true,
      dimming: 100,
      temp: 2200,
      r: 0,
    });
    expect(sanitizeParams(null)).toEqual({});
  });
});
