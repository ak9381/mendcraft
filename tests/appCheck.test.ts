import { afterEach, describe, expect, it } from 'vitest';
import { applyAppCheckDebugToken, shouldUseAppCheckDebug } from '../src/firebase/appCheck';

function clearToken(): void {
  const g = globalThis as Record<string, unknown>;
  delete g.FIREBASE_APPCHECK_DEBUG_TOKEN;
  const self = g.self as Record<string, unknown> | undefined;
  if (self) delete self.FIREBASE_APPCHECK_DEBUG_TOKEN;
}

afterEach(clearToken);

describe('App Check debug gating', () => {
  it('is on in Vite dev, even on a non-local host', () => {
    expect(shouldUseAppCheckDebug({ dev: true, hostname: 'mendcraft.web.app', search: '' })).toBe(true);
  });

  it('is on for a local server with ?debug', () => {
    expect(shouldUseAppCheckDebug({ dev: false, hostname: 'localhost', search: '?debug=1' })).toBe(true);
    expect(shouldUseAppCheckDebug({ dev: false, hostname: '127.0.0.1', search: '?debug' })).toBe(true);
    expect(shouldUseAppCheckDebug({ dev: false, hostname: '::1', search: '?debug' })).toBe(true);
  });

  it('is off on the hosted site even with ?debug, and off on localhost without it', () => {
    expect(shouldUseAppCheckDebug({ dev: false, hostname: 'mendcraft.web.app', search: '?debug=1' })).toBe(false);
    expect(shouldUseAppCheckDebug({ dev: false, hostname: 'localhost', search: '' })).toBe(false);
    expect(shouldUseAppCheckDebug({ dev: false, hostname: 'localhost', search: '?sim=1' })).toBe(false);
  });

  it('keeps an already-injected string token and does not overwrite it', () => {
    const g = globalThis as Record<string, unknown>;
    g.FIREBASE_APPCHECK_DEBUG_TOKEN = 'already-set';
    expect(applyAppCheckDebugToken({ dev: true })).toBe(true);
    expect(g.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe('already-set');
  });

  it('auto-generates only in dev when no token was injected', () => {
    expect(applyAppCheckDebugToken({ dev: true })).toBe(true);
    expect((globalThis as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true);
  });

  it('does not auto-generate for production + local ?debug without an injected token', () => {
    expect(applyAppCheckDebugToken({ dev: false, hostname: 'localhost', search: '?debug' })).toBe(false);
    expect((globalThis as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
  });

  it('does not set a token for a production hosted page', () => {
    expect(applyAppCheckDebugToken({ dev: false, hostname: 'mendcraft.web.app', search: '?debug' })).toBe(false);
    expect((globalThis as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
  });
});
