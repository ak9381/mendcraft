// The phone's ONE front camera (phoneCamera.ts): hands and look-to-edit share
// one getUserMedia and one tracker; nothing opens until a use is turned on;
// hiding the app stops the camera and showing it resumes; the idle throttle.
import { describe, expect, it, vi } from 'vitest';
import { createPhoneCamera, PHONE_CAMERA_CONSTRAINTS, readPhoneHands, writePhoneHands, PHONE_HANDS_KEY } from '../../src/canvas/phoneCamera';
import { startPhoneLookToEdit } from '../../src/canvas/phoneCanvasRuntime';
import { PHONE_HAND_FEEL } from '../../src/canvas/handFeel';
import type { PresenceFrame } from '../../src/input/presence';

function fakeStream() {
  const track = { readyState: 'live', stop: vi.fn(() => { track.readyState = 'ended'; }) };
  return { track, stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream };
}

function harness(opts: { gumFails?: Error } = {}) {
  const streams: ReturnType<typeof fakeStream>[] = [];
  const getUserMedia = vi.fn(async () => {
    if (opts.gumFails) throw opts.gumFails;
    const s = fakeStream();
    streams.push(s);
    return s.stream;
  });
  type Made = { opts: { detectHands: boolean; detectFaces: boolean; frameIntervalMs: () => number }; onFrame: (f: PresenceFrame) => void; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
  const trackers: Made[] = [];
  const createTracker = vi.fn((_e: () => void, onFrame: (f: PresenceFrame) => void, o: Made['opts']) => {
    const m: Made = { opts: o, onFrame, start: vi.fn(async () => undefined), stop: vi.fn() };
    trackers.push(m);
    return m;
  });
  const listeners = new Map<string, () => void>();
  const doc = {
    visibilityState: 'visible' as 'visible' | 'hidden',
    addEventListener: vi.fn((type: string, fn: () => void) => { listeners.set(type, fn); }),
    removeEventListener: vi.fn(),
  };
  let clock = 0;
  const cam = createPhoneCamera({ getUserMedia, createTracker, doc: doc as unknown as Document, now: () => clock });
  const setVisible = async (v: boolean) => {
    doc.visibilityState = v ? 'visible' : 'hidden';
    listeners.get('visibilitychange')?.();
    await cam.setUse('face', cam.uses().includes('face')); // flush the chain
  };
  return { cam, getUserMedia, createTracker, trackers, streams, doc, setVisible, tick: (ms: number) => { clock += ms; } };
}

const frame = (hands = 0, handGate: boolean | null = null): PresenceFrame => ({
  hands: Array.from({ length: hands }, () => ({ points: [], label: 'Right' })) as unknown as PresenceFrame['hands'],
  rejectedHands: [], faces: [{ box: { x: 0, y: 0, w: 1, h: 1, cx: 0.5, cy: 0.5 }, isOperator: true, facing: true, handGate, dim: false }],
  facing: true, registered: false, paused: false, aspect: 640 / 480,
});

describe('phone camera hub', () => {
  it('opens nothing until a use is turned on (permission only on toggle)', async () => {
    const h = harness();
    await new Promise((r) => setTimeout(r, 10));
    expect(h.getUserMedia).not.toHaveBeenCalled();
    expect(h.createTracker).not.toHaveBeenCalled();
    expect(h.cam.status()).toBe('off');
    await h.cam.setUse('hands', true);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    expect(h.getUserMedia).toHaveBeenCalledWith(PHONE_CAMERA_CONSTRAINTS);
    expect((PHONE_CAMERA_CONSTRAINTS.video as MediaTrackConstraints).facingMode).toBe('user');
    expect(h.cam.status()).toBe('live');
  });

  it('hands + look-to-edit share ONE getUserMedia and one live tracker (hands + face)', async () => {
    const h = harness();
    await h.cam.setUse('face', true);
    expect(h.trackers.at(-1)!.opts).toMatchObject({ detectHands: false, detectFaces: true });
    await h.cam.setUse('hands', true);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    // Mode switch: the face-only tracker stops, a hands+face one starts on the SAME stream.
    expect(h.trackers).toHaveLength(2);
    expect(h.trackers[0].stop).toHaveBeenCalled();
    expect(h.trackers[1].opts).toMatchObject({ detectHands: true, detectFaces: true });
    expect(h.trackers[1].start).toHaveBeenCalledWith(h.streams[0].stream);
    expect(h.streams[0].track.stop).not.toHaveBeenCalled();
    // Turning hands off keeps the camera for look-to-edit (face only again).
    await h.cam.setUse('hands', false);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    expect(h.trackers.at(-1)!.opts.detectHands).toBe(false);
    // Both off: the camera is released.
    await h.cam.setUse('face', false);
    expect(h.streams[0].track.stop).toHaveBeenCalled();
    expect(h.cam.status()).toBe('off');
  });

  it('look-to-edit started with the hub rides the hands stream (no second camera)', async () => {
    const h = harness();
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 1; });
    try {
      await h.cam.setUse('hands', true);
      const handle = { setFacing: vi.fn() };
      const stop = startPhoneLookToEdit(handle, { enabled: true, camera: h.cam });
      await new Promise((r) => setTimeout(r, 450));
      await h.cam.setUse('hands', true); // flush
      expect(h.cam.uses().sort()).toEqual(['face', 'hands']);
      expect(h.getUserMedia).toHaveBeenCalledTimes(1);
      expect(h.trackers).toHaveLength(1); // the hands tracker already runs faces
      h.trackers[0].onFrame(frame(0));
      expect(handle.setFacing).toHaveBeenLastCalledWith(true);
      h.trackers[0].onFrame(frame(0));
      expect(handle.setFacing).toHaveBeenCalledTimes(1); // deduped per change
      stop();
      expect(handle.setFacing).toHaveBeenLastCalledWith(null);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('hidden → tracker and camera stopped; visible → reopened', async () => {
    const h = harness();
    await h.cam.setUse('hands', true);
    await h.setVisible(false);
    expect(h.trackers[0].stop).toHaveBeenCalled();
    expect(h.streams[0].track.stop).toHaveBeenCalled();
    expect(h.cam.status()).toBe('off');
    await h.setVisible(true);
    expect(h.getUserMedia).toHaveBeenCalledTimes(2);
    expect(h.trackers).toHaveLength(2);
    expect(h.cam.status()).toBe('live');
    expect(h.cam.uses()).toEqual(['hands']);
  });

  it('hiding while the models still load stops the camera at once (no wait behind the start)', async () => {
    const h = harness();
    let finish: () => void = () => undefined;
    h.createTracker.mockImplementationOnce((_e, onFrame, o) => {
      const m = { opts: o, onFrame, start: vi.fn(() => new Promise<void>((r) => { finish = r; })), stop: vi.fn() };
      h.trackers.push(m);
      return m;
    });
    const starting = h.cam.setUse('hands', true);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.cam.status()).toBe('starting');
    h.doc.visibilityState = 'hidden';
    (h.doc.addEventListener.mock.calls.find((c) => c[0] === 'visibilitychange')![1] as () => void)();
    expect(h.trackers[0].stop).toHaveBeenCalled();
    expect(h.streams[0].track.stop).toHaveBeenCalled();
    expect(h.cam.status()).toBe('off'); // the indicator goes off at once too
    finish();
    await starting;
    await h.cam.setUse('hands', true);
    expect(h.cam.status()).toBe('off');
  });

  it('a use turned on while hidden waits for visible', async () => {
    const h = harness();
    h.doc.visibilityState = 'hidden';
    await h.cam.setUse('hands', true);
    expect(h.getUserMedia).not.toHaveBeenCalled();
    await h.setVisible(true);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('throttles to 10 fps with no hand for 2 s; full rate while a hand is seen', async () => {
    const h = harness();
    await h.cam.setUse('hands', true);
    const interval = h.trackers[0].opts.frameIntervalMs;
    expect(interval()).toBe(PHONE_HAND_FEEL.idleIntervalMs);
    h.trackers[0].onFrame(frame(1));
    expect(interval()).toBe(PHONE_HAND_FEEL.activeIntervalMs);
    h.tick(1500);
    expect(interval()).toBe(PHONE_HAND_FEEL.activeIntervalMs);
    h.tick(600);
    expect(interval()).toBe(PHONE_HAND_FEEL.idleIntervalMs);
  });

  it('a denied camera reports error (and releases nothing it never got)', async () => {
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    const h = harness({ gumFails: denied });
    await h.cam.setUse('hands', true);
    expect(h.cam.status()).toBe('error');
    expect(h.cam.lastError()).toBe(denied);
    expect(h.createTracker).not.toHaveBeenCalled();
  });
});

describe('mc.phoneHands persistence', () => {
  it('off unless explicitly on', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
    expect(readPhoneHands(s)).toBe(false);
    writePhoneHands(true, s);
    expect(m.get(PHONE_HANDS_KEY)).toBe('1');
    expect(readPhoneHands(s)).toBe(true);
    writePhoneHands(false, s);
    expect(readPhoneHands(s)).toBe(false);
  });
});
