// presence.ts loop options the phone needs: frameIntervalMs throttles the
// tracking runs (10 fps idle), and a face-only tracker (look-to-edit) still
// emits frames, so onFrame subscribers see the facing signal.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ handCalls: 0, faceCalls: 0 }));

vi.mock('@mediapipe/tasks-vision', () => {
  const hand = { close: vi.fn(), detectForVideo: () => { h.handCalls++; return { landmarks: [], handedness: [] }; } };
  const face = { close: vi.fn(), detectForVideo: () => { h.faceCalls++; return { faceLandmarks: [], facialTransformationMatrixes: [] }; } };
  return {
    FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
    HandLandmarker: { createFromOptions: vi.fn(async () => hand) },
    FaceLandmarker: { createFromOptions: vi.fn(async () => face) },
  };
});

let rafs: (() => void)[] = [];
let clock = 0;
function stream() {
  const track = { stop: vi.fn(), readyState: 'live', addEventListener: vi.fn() };
  return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
}
function pump(ms: number, step = 8): void {
  for (let t = 0; t < ms; t += step) {
    clock += step;
    const run = rafs; rafs = [];
    for (const cb of run) cb();
  }
}

beforeEach(() => {
  h.handCalls = 0; h.faceCalls = 0; rafs = []; clock = 0;
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({
      style: {}, remove: vi.fn(), play: vi.fn(async () => undefined), readyState: 4,
      videoWidth: 480, videoHeight: 480, srcObject: null, setAttribute: vi.fn(),
    }),
    body: { appendChild: vi.fn() },
    querySelectorAll: () => [],
  };
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { rafs.push(cb); return rafs.length; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).document;
});

describe('presence frameIntervalMs + face-only frames', () => {
  it('frameIntervalMs 100 → about 10 hand runs per second instead of one per frame', async () => {
    const { createPresenceTracker } = await import('../src/input/presence');
    const t = createPresenceTracker(() => undefined, undefined, { detectFaces: false, frameIntervalMs: () => 100 });
    await t.start(stream());
    pump(1000);
    expect(h.handCalls).toBeGreaterThanOrEqual(9);
    expect(h.handCalls).toBeLessThanOrEqual(11);
    t.stop();
  });

  it('no interval → every animation frame (the laptop default is unchanged)', async () => {
    const { createPresenceTracker } = await import('../src/input/presence');
    const t = createPresenceTracker(() => undefined, undefined, { detectFaces: false });
    await t.start(stream());
    pump(1000, 16);
    expect(h.handCalls).toBeGreaterThan(55);
    t.stop();
  });

  it('a face-only tracker emits a frame per face run (no hand model)', async () => {
    const { createPresenceTracker } = await import('../src/input/presence');
    const frames: unknown[] = [];
    const t = createPresenceTracker(() => undefined, (f) => frames.push(f), { detectHands: false, detectFaces: true });
    await t.start(stream());
    pump(1000, 16);
    expect(h.handCalls).toBe(0);
    expect(h.faceCalls).toBeGreaterThanOrEqual(4);
    expect(frames.length).toBe(h.faceCalls);
    t.stop();
  });
});
