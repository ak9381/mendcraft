// presence.ts loop options the phone needs: frameIntervalMs throttles the
// tracking runs (10 fps idle), and a face-only tracker (look-to-edit) still
// emits frames, so onFrame subscribers see the facing signal.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ handCalls: 0, faceCalls: 0, handCostMs: 0, advance: (_ms: number) => undefined as void }));

vi.mock('@mediapipe/tasks-vision', () => {
  const hand = { close: vi.fn(), detectForVideo: () => { h.handCalls++; h.advance(h.handCostMs); return { landmarks: [], handedness: [] }; } };
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
  h.handCalls = 0; h.faceCalls = 0; h.handCostMs = 0; h.advance = (ms) => { clock += ms; }; rafs = []; clock = 0;
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

  it('slow tracking runs in a row (GPU busy, e.g. with Nano) get a short pause each; one slow run gets none', async () => {
    const { createPresenceTracker, trackingBackoffMs } = await import('../src/input/presence');
    expect(trackingBackoffMs(4, true)).toBe(0); // a normal run waits for nothing
    expect(trackingBackoffMs(300, false)).toBe(0); // one slow run alone: a hiccup
    expect(trackingBackoffMs(100, true)).toBe(50); // half its time…
    expect(trackingBackoffMs(5000, true)).toBe(80); // …at most 80 ms
    h.handCostMs = 200; // each detectForVideo blocks the main thread 200 ms
    const t = createPresenceTracker(() => undefined, undefined, { detectFaces: false });
    await t.start(stream());
    const before = clock;
    pump(4000, 16);
    const elapsed = clock - before;
    const busy = h.handCalls * 200;
    expect(h.handCalls).toBeGreaterThan(5); // the hands keep ticking…
    expect(busy / elapsed).toBeLessThanOrEqual(0.75); // …and the page gets the thread between runs
    t.stop();
  });
});
