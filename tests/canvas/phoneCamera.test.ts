// The phone's ONE front camera (phoneCamera.ts): hands and look-to-edit share
// one getUserMedia and one tracker; nothing opens until a use is turned on;
// hiding the app stops the camera and showing it resumes; the idle throttle.
import { describe, expect, it, vi } from 'vitest';
import { CameraLostError, CAMERA_LOST_RETRIES, CAMERA_LOST_RETRY_MS, createPhoneCamera, PHONE_CAMERA_CONSTRAINTS, readPhoneHands, writePhoneHands, PHONE_HANDS_KEY, type PhoneTrackerOptions } from '../../src/canvas/phoneCamera';
import { PHONE_FACING, PHONE_HAND_GATE } from '../../src/input/faceLogic';
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
  type Made = { opts: PhoneTrackerOptions; onFrame: (f: PresenceFrame) => void; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
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
  const winListeners = new Map<string, () => void>();
  const win = {
    addEventListener: vi.fn((type: string, fn: () => void) => { winListeners.set(type, fn); }),
    removeEventListener: vi.fn(),
  };
  const appListeners = new Map<string, () => void>();
  const appRemove = vi.fn();
  const app = {
    addListener: vi.fn((ev: 'pause' | 'resume', fn: () => void) => { appListeners.set(ev, fn); return Promise.resolve({ remove: appRemove }); }),
  };
  const timers: { fn: () => void; ms: number }[] = [];
  const cam = createPhoneCamera({
    getUserMedia, createTracker, doc: doc as unknown as Document, now: () => clock,
    win: win as unknown as Window, app,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => undefined,
  });
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
  const setVisible = async (v: boolean) => {
    doc.visibilityState = v ? 'visible' : 'hidden';
    listeners.get('visibilitychange')?.();
    await settle();
  };
  const runTimers = async () => { const due = timers.splice(0); for (const t of due) t.fn(); await settle(); };
  return {
    cam, getUserMedia, createTracker, trackers, streams, doc, setVisible, settle, timers, runTimers,
    winListeners, appListeners, appRemove, tick: (ms: number) => { clock += ms; },
  };
}

const frame = (hands = 0, handGate: boolean | null = null): PresenceFrame => ({
  hands: Array.from({ length: hands }, () => ({ points: [], label: 'Right' })) as unknown as PresenceFrame['hands'],
  rejectedHands: [], faces: [{ box: { x: 0, y: 0, w: 1, h: 1, cx: 0.5, cy: 0.5 }, isOperator: true, facing: true, handGate, dim: false }],
  facing: true, registered: false, paused: false, aspect: 640 / 480,
});

describe('phone camera hub', () => {
  it('setYield: the lens goes to native code (stream stopped, uses kept), then comes back as it was', async () => {
    const h = harness();
    await h.cam.setUse('sense', true);
    expect(h.cam.status()).toBe('live');
    await h.cam.setYield!(true);
    expect(h.streams[0].track.stop).toHaveBeenCalled();
    expect(h.cam.status()).toBe('off');
    expect(h.cam.uses()).toEqual(['sense']);
    // A use turned on meanwhile does not open the camera while yielded.
    await h.cam.setUse('hands', true);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    await h.cam.setYield!(false);
    expect(h.getUserMedia).toHaveBeenCalledTimes(2);
    expect(h.cam.status()).toBe('live');
    // Yield with nothing on → nothing reopens afterwards.
    const g = harness();
    await g.cam.setYield!(true);
    await g.cam.setYield!(false);
    expect(g.getUserMedia).not.toHaveBeenCalled();
  });

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

  it('after a denial, turning Hands off with look-to-edit on never asks for the camera again', async () => {
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    const h = harness({ gumFails: denied });
    await h.cam.setUse('face', true);
    await h.cam.setUse('hands', true);
    const calls = h.getUserMedia.mock.calls.length;
    await h.cam.setUse('hands', false);
    await h.setVisible(false);
    await h.setVisible(true);
    expect(h.getUserMedia).toHaveBeenCalledTimes(calls);
    expect(h.cam.status()).toBe('error');
    // Turning a use ON again is an explicit retry.
    await h.cam.setUse('hands', true);
    expect(h.getUserMedia).toHaveBeenCalledTimes(calls + 1);
  });

  it('the tracker gets the phone head-pose thresholds (camera below the face)', async () => {
    const h = harness();
    await h.cam.setUse('hands', true);
    expect(h.trackers[0].opts.handGate).toBe(PHONE_HAND_GATE);
    expect(h.trackers[0].opts.facing).toBe(PHONE_FACING);
  });

  it('pagehide / pageshow stop and resume the camera', async () => {
    const h = harness();
    await h.cam.setUse('hands', true);
    h.winListeners.get('pagehide')!();
    expect(h.streams[0].track.stop).toHaveBeenCalled();
    expect(h.cam.status()).toBe('off');
    h.winListeners.get('pageshow')!();
    await h.settle();
    expect(h.getUserMedia).toHaveBeenCalledTimes(2);
    expect(h.cam.status()).toBe('live');
  });

  it('Capacitor App pause / resume stop and resume the camera (visibility unchanged)', async () => {
    const h = harness();
    await h.settle();
    expect(h.appListeners.has('pause') && h.appListeners.has('resume')).toBe(true);
    await h.cam.setUse('hands', true);
    h.appListeners.get('pause')!();
    expect(h.streams[0].track.stop).toHaveBeenCalled();
    expect(h.cam.status()).toBe('off');
    await h.settle();
    expect(h.getUserMedia).toHaveBeenCalledTimes(1); // still paused: nothing reopens
    h.appListeners.get('resume')!();
    await h.settle();
    expect(h.getUserMedia).toHaveBeenCalledTimes(2);
    expect(h.cam.status()).toBe('live');
    h.cam.destroy();
    expect(h.appRemove).toHaveBeenCalledTimes(2);
  });

  it('a camera lost to the OS while visible is retried, then reported as CameraLostError', async () => {
    const h = harness();
    await h.cam.setUse('hands', true);
    // First loss: comes back on the retry.
    h.trackers[0].opts.onCameraLost();
    expect(h.cam.status()).toBe('starting');
    expect(h.timers[0].ms).toBe(CAMERA_LOST_RETRY_MS);
    await h.runTimers();
    expect(h.getUserMedia).toHaveBeenCalledTimes(2);
    expect(h.cam.status()).toBe('live');
    // Keeps getting taken: bounded retries, then error.
    for (let i = 1; i < CAMERA_LOST_RETRIES; i++) {
      h.trackers.at(-1)!.opts.onCameraLost();
      await h.runTimers();
    }
    h.trackers.at(-1)!.opts.onCameraLost();
    expect(h.timers).toHaveLength(0);
    expect(h.cam.status()).toBe('error');
    expect(h.cam.lastError()).toBeInstanceOf(CameraLostError);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1 + CAMERA_LOST_RETRIES);
  });
});

describe('point-to-connect reuses the phone stream', () => {
  it('findLiveVideo picks the hand tracker’s live <video> (no second getUserMedia)', async () => {
    const { findLiveVideo } = await import('../../src/canvas/pointCapture');
    const live = fakeStream().stream;
    const tracker = { srcObject: live, readyState: 4, videoWidth: 640 };
    const doc = {
      querySelectorAll: (sel: string) => (sel === 'video[data-mc-hand-tracker]' ? [tracker] : [tracker]),
    } as unknown as Document;
    expect(findLiveVideo(doc)).toBe(tracker);
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

describe('a start cancelled mid-way is not a failure', () => {
  it('stop during the tracker start (video.play pending) leaves look-to-edit usable', async () => {
    const h = harness();
    let rejectStart: (e: unknown) => void = () => {};
    h.createTracker.mockImplementationOnce((_e, onFrame, o) => {
      const m = { opts: o, onFrame, start: vi.fn(() => new Promise<void>((_r, rej) => { rejectStart = rej; })), stop: vi.fn() };
      h.trackers.push(m as never);
      return m;
    });
    const on = h.cam.setUse('face', true);
    await h.settle();
    expect(h.trackers).toHaveLength(1);
    // The app hides while video.play() is still pending: the camera stops...
    h.doc.visibilityState = 'hidden';
    const hide = h.setVisible(false);
    // ...and the pending play() rejects because it was interrupted.
    rejectStart(new DOMException('The play() request was interrupted', 'AbortError'));
    await on; await hide; await h.settle();
    expect(h.cam.status()).not.toBe('error');
    expect(h.cam.lastError()).toBeNull();
    // Shown again: look-to-edit starts for real.
    await h.setVisible(true);
    expect(h.cam.status()).toBe('live');
  });
});
