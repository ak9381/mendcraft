import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('../../src/input/presence');
  vi.doUnmock('../../src/input/cameraShare');
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('startPhoneLookToEdit', () => {
  it('does not open the camera at all while look-to-edit is off (default)', async () => {
    vi.resetModules();
    const create = vi.fn();
    vi.doMock('../../src/input/presence', () => ({ createPresenceTracker: create }));
    const { startPhoneLookToEdit } = await import('../../src/canvas/phoneCanvasRuntime');
    const handle = { setFacing: vi.fn() };
    const stop = startPhoneLookToEdit(handle, { enabled: false });
    await new Promise((r) => setTimeout(r, 700));
    expect(create).not.toHaveBeenCalled();
    expect(handle.setFacing).not.toHaveBeenCalled();
    stop();
  });

  it('reports an unknown (null) face signal when the camera is denied, never false', async () => {
    vi.resetModules();
    const create = vi.fn(() => ({ start: () => Promise.reject(new Error('NotAllowedError')), stop: vi.fn() }));
    vi.doMock('../../src/input/presence', () => ({ createPresenceTracker: create }));
    vi.doMock('../../src/input/cameraShare', () => ({ hasLiveCameraStream: () => false }));
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 1; });
    const { startPhoneLookToEdit } = await import('../../src/canvas/phoneCanvasRuntime');
    const handle = { setFacing: vi.fn() };
    const stop = startPhoneLookToEdit(handle, { enabled: true });
    await new Promise((r) => setTimeout(r, 900));
    expect(create).toHaveBeenCalled();
    expect(handle.setFacing).toHaveBeenCalledWith(null);
    expect(handle.setFacing).not.toHaveBeenCalledWith(false);
    stop();
  });
});
