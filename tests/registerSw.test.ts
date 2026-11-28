import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from '../src/offline/registerSw';

function fakeWin(native: boolean | undefined) {
  const register = vi.fn(async () => ({}));
  const rootUnregister = vi.fn(async () => true);
  const canvasUnregister = vi.fn(async () => true);
  const getRegistrations = vi.fn(async () => [
    { scope: 'https://mendcraft.web.app/', unregister: rootUnregister },
    { scope: 'https://mendcraft.web.app/canvas', unregister: canvasUnregister },
  ]);
  const win = {
    location: { origin: 'https://mendcraft.web.app' },
    navigator: { serviceWorker: { register, getRegistrations } },
    document: { readyState: 'complete' },
    addEventListener: vi.fn(),
    ...(native === undefined ? {} : { Capacitor: { isNativePlatform: () => native } }),
  } as unknown as Window;
  return { win, register, rootUnregister, canvasUnregister };
}

describe('registerServiceWorker', () => {
  it('registers /sw.js for the canvas only, so other pages never wait on the worker', () => {
    const { win, register } = fakeWin(undefined);
    registerServiceWorker(win, true);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/canvas' });
  });
  it('removes an older whole-site registration and keeps the canvas one', async () => {
    const { win, rootUnregister, canvasUnregister } = fakeWin(undefined);
    registerServiceWorker(win, true);
    await new Promise((r) => setTimeout(r, 0));
    expect(rootUnregister).toHaveBeenCalledTimes(1);
    expect(canvasUnregister).not.toHaveBeenCalled();
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
