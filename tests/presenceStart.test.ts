// presence.start() must ask for the camera FIRST (in parallel with the
// wasm/model downloads) so Chrome's permission prompt appears immediately and
// a CSP/model failure can never hide it — and must release an owned stream if
// the models then fail to load.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  order: [] as string[],
  handFail: false,
}));

vi.mock('@mediapipe/tasks-vision', () => {
  const task = { close: vi.fn(), detectForVideo: () => ({ landmarks: [], faceLandmarks: [] }) };
  return {
    FilesetResolver: {
      forVisionTasks: vi.fn(async () => {
        h.order.push('fileset');
        return {};
      }),
    },
    HandLandmarker: {
      createFromOptions: vi.fn(async () => {
        if (h.handFail) throw new Error('Failed to fetch');
        return task;
      }),
    },
    FaceLandmarker: { createFromOptions: vi.fn(async () => task) },
  };
});

function fakeVideoElement() {
  return {
    style: {},
    remove: vi.fn(),
    play: vi.fn(async () => undefined),
    readyState: 0,
    set srcObject(_v: unknown) {},
    get srcObject() { return null; },
  };
}

function fakeStream() {
  const track = { stop: vi.fn(), readyState: 'live' };
  return {
    track,
    stream: {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream,
  };
}

const originalNavigator = globalThis.navigator;

describe('presence.start camera-before-models ordering', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;
  let owned: ReturnType<typeof fakeStream>;

  beforeEach(() => {
    h.order.length = 0;
    h.handFail = false;
    owned = fakeStream();
    getUserMedia = vi.fn(async () => {
      h.order.push('getUserMedia');
      return owned.stream;
    });
    (globalThis as Record<string, unknown>).document = {
      createElement: () => fakeVideoElement(),
      body: { appendChild: vi.fn() },
      querySelectorAll: () => [],
    };
    Object.defineProperty(globalThis, 'navigator', {
      value: { mediaDevices: { getUserMedia } },
      configurable: true,
      writable: true,
    });
    (globalThis as Record<string, unknown>).cancelAnimationFrame = vi.fn();
    (globalThis as Record<string, unknown>).requestAnimationFrame = vi.fn(() => 1);
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
    Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true, writable: true });
    delete (globalThis as Record<string, unknown>).cancelAnimationFrame;
    delete (globalThis as Record<string, unknown>).requestAnimationFrame;
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('requests the camera before the wasm fileset resolves', async () => {
    const { createPresenceTracker } = await import('../src/input/presence');
    const tracker = createPresenceTracker(() => {});
    await tracker.start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(h.order.indexOf('getUserMedia')).toBeLessThan(h.order.indexOf('fileset'));
    tracker.stop();
  });

  it('stops the owned stream tracks when model loading fails, and rethrows', async () => {
    h.handFail = true;
    const { createPresenceTracker } = await import('../src/input/presence');
    const tracker = createPresenceTracker(() => {});
    await expect(tracker.start()).rejects.toThrow('Failed to fetch');
    // The cleanup runs on the stream promise's microtask; let it settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(getUserMedia).toHaveBeenCalledTimes(1); // the prompt still appeared
    expect(owned.track.stop).toHaveBeenCalled();
  });

  it('propagates a camera denial when the models load fine', async () => {
    const denied = new Error('Permission denied');
    denied.name = 'NotAllowedError';
    getUserMedia.mockRejectedValue(denied);
    const { createPresenceTracker } = await import('../src/input/presence');
    const tracker = createPresenceTracker(() => {});
    await expect(tracker.start()).rejects.toMatchObject({ name: 'NotAllowedError' });
  });

  it('does not stop tracks of an existing (shared) stream on model failure', async () => {
    h.handFail = true;
    const shared = fakeStream();
    const { createPresenceTracker } = await import('../src/input/presence');
    const tracker = createPresenceTracker(() => {});
    await expect(tracker.start(shared.stream)).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(shared.track.stop).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('does not load FaceLandmarker when detectFaces is false (laptop canvas)', async () => {
    const vision = await import('@mediapipe/tasks-vision');
    const { createPresenceTracker } = await import('../src/input/presence');
    const tracker = createPresenceTracker(() => {}, undefined, { detectFaces: false });
    await tracker.start();
    expect(vision.HandLandmarker.createFromOptions).toHaveBeenCalled();
    expect(vision.FaceLandmarker.createFromOptions).not.toHaveBeenCalled();
    tracker.stop();
  });

  it('loads FaceLandmarker by default (Facing pill path)', async () => {
    const vision = await import('@mediapipe/tasks-vision');
    const { createPresenceTracker } = await import('../src/input/presence');
    const tracker = createPresenceTracker(() => {});
    await tracker.start();
    expect(vision.FaceLandmarker.createFromOptions).toHaveBeenCalled();
    expect(vision.HandLandmarker.createFromOptions).toHaveBeenCalled();
    tracker.stop();
  });

  it('does not load HandLandmarker when detectHands is false (phone face-only)', async () => {
    const vision = await import('@mediapipe/tasks-vision');
    const { createPresenceTracker } = await import('../src/input/presence');
    const tracker = createPresenceTracker(() => {}, undefined, { detectHands: false });
    await tracker.start();
    expect(vision.FaceLandmarker.createFromOptions).toHaveBeenCalled();
    expect(vision.HandLandmarker.createFromOptions).not.toHaveBeenCalled();
    tracker.stop();
  });
});

describe('shouldRunFace throttle', () => {
  it('runs at a few fps, not every frame', async () => {
    const { shouldRunFace, FACE_INTERVAL_MS } = await import('../src/input/presence');
    expect(FACE_INTERVAL_MS).toBe(200);
    expect(shouldRunFace(0, -Infinity)).toBe(true);
    expect(shouldRunFace(100, 0)).toBe(false);
    expect(shouldRunFace(200, 0)).toBe(true);
  });
});
