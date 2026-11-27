import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from '../src/offline/registerSw';

function fakeWin(native: boolean | undefined) {
  const register = vi.fn(async () => ({}));
  const win = {
    navigator: { serviceWorker: { register } },
    document: { readyState: 'complete' },
    addEventListener: vi.fn(),
    ...(native === undefined ? {} : { Capacitor: { isNativePlatform: () => native } }),
  } as unknown as Window;
  return { win, register };
}

describe('registerServiceWorker', () => {
  it('registers /sw.js in a production web page', () => {
    const { win, register } = fakeWin(undefined);
    registerServiceWorker(win, true);
    expect(register).toHaveBeenCalledWith('/sw.js');
  });
  it('is a no-op inside the Capacitor native shell', () => {
    const { win, register } = fakeWin(true);
    registerServiceWorker(win, true);
    expect(register).not.toHaveBeenCalled();
  });
  it('is a no-op in dev', () => {
    const { win, register } = fakeWin(false);
    registerServiceWorker(win, false);
    expect(register).not.toHaveBeenCalled();
  });
});
