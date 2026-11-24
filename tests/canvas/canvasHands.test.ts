import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  autoHandsFromSearch,
  createCanvasHandsAdapter,
  getLastCameraError,
  mountCanvasHands,
  shouldAutoStartHands,
  type CanvasHandEvent,
} from '../../src/canvas/canvasHands';
import type { Pt } from '../../src/input/handLogic';

// Helper to build 21 landmarks for testing poses
function makeHand(pts: Partial<Record<number, Pt>>): Pt[] {
  const res: Pt[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  for (const [idx, pt] of Object.entries(pts)) {
    res[Number(idx)] = pt;
  }
  return res;
}

// Landmark 0: wrist, 4: thumb tip, 8: index tip, 6: index pip, 5: index mcp, 9: middle mcp, 10: middle pip, 12: middle tip, etc.
// In gestures.ts:
// wrist: 0, middle MCP: 9
// thumb: 2, 3, 4
// index: 5, 6, 8
// middle: 9, 10, 12
// ring: 13, 14, 16
// pinky: 17, 18, 20
function makePointingHand(tipX = 0.7, tipY = 0.3): Pt[] {
  // wrist at (0.5, 0.8), index extended, others curled
  const h = makeHand({
    0: { x: 0.5, y: 0.8 },
    5: { x: 0.5, y: 0.5 },
    6: { x: 0.5, y: 0.4 },
    8: { x: tipX, y: tipY }, // tip far from wrist
    9: { x: 0.52, y: 0.5 }, // middle MCP
    10: { x: 0.52, y: 0.6 },
    12: { x: 0.52, y: 0.7 }, // middle tip closer to wrist than pip
    13: { x: 0.54, y: 0.5 },
    14: { x: 0.54, y: 0.6 },
    16: { x: 0.54, y: 0.7 },
    17: { x: 0.56, y: 0.5 },
    18: { x: 0.56, y: 0.6 },
    20: { x: 0.56, y: 0.7 },
    2: { x: 0.45, y: 0.6 },
    3: { x: 0.45, y: 0.65 },
    4: { x: 0.45, y: 0.7 },
  });
  return h;
}

function makeOpenPalmHand(): Pt[] {
  // all fingers extended far from wrist
  return makeHand({
    0: { x: 0.5, y: 0.9 },
    5: { x: 0.45, y: 0.5 }, 6: { x: 0.45, y: 0.3 }, 8: { x: 0.45, y: 0.1 },
    9: { x: 0.5, y: 0.5 }, 10: { x: 0.5, y: 0.3 }, 12: { x: 0.5, y: 0.1 },
    13: { x: 0.55, y: 0.5 }, 14: { x: 0.55, y: 0.3 }, 16: { x: 0.55, y: 0.1 },
    17: { x: 0.6, y: 0.5 }, 18: { x: 0.6, y: 0.3 }, 20: { x: 0.6, y: 0.1 },
    2: { x: 0.35, y: 0.7 }, 3: { x: 0.3, y: 0.6 }, 4: { x: 0.25, y: 0.5 },
  });
}

function makePinchingHand(): Pt[] {
  // thumb tip (4) and index tip (8) very close, index extended
  return makeHand({
    0: { x: 0.5, y: 0.8 },
    2: { x: 0.45, y: 0.6 }, 3: { x: 0.48, y: 0.45 }, 4: { x: 0.5, y: 0.4 },
    5: { x: 0.5, y: 0.6 }, 6: { x: 0.5, y: 0.5 }, 8: { x: 0.502, y: 0.401 },
    9: { x: 0.53, y: 0.6 }, 10: { x: 0.53, y: 0.7 }, 12: { x: 0.53, y: 0.75 },
    13: { x: 0.55, y: 0.6 }, 14: { x: 0.55, y: 0.7 }, 16: { x: 0.55, y: 0.75 },
    17: { x: 0.57, y: 0.6 }, 18: { x: 0.57, y: 0.7 }, 20: { x: 0.57, y: 0.75 },
  });
}

describe('Part 2: src/canvas/canvasHands.ts', () => {
  describe('hand landmark frames processing', () => {
    // Pinch is unwired from camera frames: a held pinch (any length) never
    // keeps — it used to fire by accident while pointing.
    it('pinch frames never emit keep, however long the pinch is held', () => {
      const events: CanvasHandEvent[] = [];
      const adapter = createCanvasHandsAdapter((e) => events.push(e));

      const pinch = makePinchingHand();
      for (let t = 1000; t <= 3000; t += 33) adapter.update({ hands: [pinch], now: t });
      expect(events.filter((e) => e.type === 'keep')).toHaveLength(0);
      expect(events.filter((e) => e.type === 'frame').length).toBeGreaterThan(50); // frames still flow
    });

    it('a 1–2 frame pinch dip never emits keep (hover cannot activate)', () => {
      const events: CanvasHandEvent[] = [];
      const adapter = createCanvasHandsAdapter((e) => events.push(e));
      const pinch = makePinchingHand();
      const point = makePointingHand();
      adapter.update({ hands: [pinch], now: 1000 });
      adapter.update({ hands: [point], now: 1033 }); // dip broken
      adapter.update({ hands: [pinch], now: 1066 });
      adapter.update({ hands: [pinch], now: 1100 });
      expect(events.filter((e) => e.type === 'keep')).toHaveLength(0);
    });

    it('recognizes pointing and emits point with index fingertip', () => {
      const events: CanvasHandEvent[] = [];
      const adapter = createCanvasHandsAdapter((e) => events.push(e));

      const pointing = makePointingHand(0.72, 0.28);
      adapter.update({ hands: [pointing], now: 1000 });
      const ptEv = events.find((e) => e.type === 'point');
      expect(ptEv).toBeDefined();
      if (ptEv && ptEv.type === 'point') {
        expect(ptEv.point.x).toBeCloseTo(0.72, 2);
        expect(ptEv.point.y).toBeCloseTo(0.28, 2);
      }
    });

    // palm now requires a HELD open palm (HAND_FEEL.palmHoldMs = 600 ms) with
    // a refractory period — the per-frame palm event toggled the tools panel
    // every single frame, which was the "hover glitches the tools" bug.
    it('emits palm only after the open palm is held 600 ms, then refractory', () => {
      const events: CanvasHandEvent[] = [];
      const adapter = createCanvasHandsAdapter((e) => events.push(e));

      const palm = makeOpenPalmHand();
      adapter.update({ hands: [palm], now: 1000 });
      adapter.update({ hands: [palm], now: 1300 });
      expect(events.filter((e) => e.type === 'palm')).toHaveLength(0); // not held long enough
      adapter.update({ hands: [palm], now: 1650 });
      expect(events.filter((e) => e.type === 'palm')).toHaveLength(1);
      // Still holding: refractory blocks an immediate second toggle.
      adapter.update({ hands: [palm], now: 2300 });
      expect(events.filter((e) => e.type === 'palm')).toHaveLength(1);
      // After the refractory a fresh hold fires again.
      adapter.update({ hands: [palm], now: 3200 });
      adapter.update({ hands: [palm], now: 3850 });
      expect(events.filter((e) => e.type === 'palm')).toHaveLength(2);
    });

    it('a palm waved past the camera (not held) emits nothing', () => {
      const events: CanvasHandEvent[] = [];
      const adapter = createCanvasHandsAdapter((e) => events.push(e));
      const palm = makeOpenPalmHand();
      const point = makePointingHand();
      adapter.update({ hands: [palm], now: 1000 });
      adapter.update({ hands: [point], now: 1400 }); // hold broken before 600 ms
      adapter.update({ hands: [palm], now: 1500 });
      adapter.update({ hands: [point], now: 1900 });
      expect(events.filter((e) => e.type === 'palm')).toHaveLength(0);
    });

    it('emits a frame event with the raw hands every call', () => {
      const events: CanvasHandEvent[] = [];
      const adapter = createCanvasHandsAdapter((e) => events.push(e));

      const palm = makeOpenPalmHand();
      adapter.update({ hands: [palm], now: 1000 });
      const frameEv = events.find((e) => e.type === 'frame');
      expect(frameEv).toBeDefined();
      if (frameEv && frameEv.type === 'frame') {
        expect(frameEv.hands).toHaveLength(1);
        expect(frameEv.now).toBe(1000);
      }
      // No palm yet — palm needs a 600 ms hold (see the hold tests above).
      expect(events.filter((e) => e.type === 'palm')).toHaveLength(0);
    });

    it('does not emit a frame event when no hands are visible', () => {
      const events: CanvasHandEvent[] = [];
      const adapter = createCanvasHandsAdapter((e) => events.push(e));
      adapter.update({ hands: [], now: 1000 });
      expect(events.find((e) => e.type === 'frame')).toBeUndefined();
    });
  });

  describe('mountCanvasHands DOM helper', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('returns null and does not throw if getUserMedia is unavailable or rejects', async () => {
      // Simulate no mediaDevices
      const fakeRoot = { appendChild: vi.fn(), getBoundingClientRect: () => ({ width: 640, height: 480 }) } as unknown as HTMLElement;

      const originalNav = globalThis.navigator;
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        Object.defineProperty(globalThis, 'navigator', {
          value: { mediaDevices: undefined },
          configurable: true,
          writable: true,
        });

        const res = await mountCanvasHands(fakeRoot, () => {});
        expect(res).toBeNull();
      } finally {
        quiet.mockRestore();
        Object.defineProperty(globalThis, 'navigator', {
          value: originalNav,
          configurable: true,
          writable: true,
        });
      }
    });

    it('returns null and does not throw if camera permission is denied', async () => {
      const fakeRoot = { appendChild: vi.fn(), getBoundingClientRect: () => ({ width: 640, height: 480 }) } as unknown as HTMLElement;

      const originalNav = globalThis.navigator;
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        Object.defineProperty(globalThis, 'navigator', {
          value: {
            mediaDevices: {
              getUserMedia: vi.fn().mockRejectedValue(new Error('Permission denied')),
            },
          },
          configurable: true,
          writable: true,
        });

        const res = await mountCanvasHands(fakeRoot, () => {});
        expect(res).toBeNull();
      } finally {
        quiet.mockRestore();
        Object.defineProperty(globalThis, 'navigator', {
          value: originalNav,
          configurable: true,
          writable: true,
        });
      }
    });

    it('surfaces the real reason via onError + getLastCameraError + console.error', async () => {
      const fakeRoot = { appendChild: vi.fn(), getBoundingClientRect: () => ({ width: 640, height: 480 }) } as unknown as HTMLElement;
      const originalNav = globalThis.navigator;
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onError = vi.fn();
      try {
        Object.defineProperty(globalThis, 'navigator', {
          value: { mediaDevices: undefined },
          configurable: true,
          writable: true,
        });
        const res = await mountCanvasHands(fakeRoot, () => {}, { onError });
        expect(res).toBeNull();
        expect(onError).toHaveBeenCalledTimes(1);
        const [reason] = onError.mock.calls[0]!;
        expect(reason).toBe('Camera needs a secure (https) page — hands stay off.');
        expect(getLastCameraError()).toBe(reason);
        expect(logged).toHaveBeenCalledWith('[mendcraft] camera/hands failed:', expect.anything());
      } finally {
        logged.mockRestore();
        Object.defineProperty(globalThis, 'navigator', {
          value: originalNav,
          configurable: true,
          writable: true,
        });
      }
    });

    it('fails fast with the blocked message when the camera permission is already denied', async () => {
      const fakeRoot = { appendChild: vi.fn(), getBoundingClientRect: () => ({ width: 640, height: 480 }) } as unknown as HTMLElement;
      const originalNav = globalThis.navigator;
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onError = vi.fn();
      const getUserMedia = vi.fn();
      try {
        Object.defineProperty(globalThis, 'navigator', {
          value: {
            mediaDevices: { getUserMedia },
            permissions: { query: vi.fn(async () => ({ state: 'denied' })) },
          },
          configurable: true,
          writable: true,
        });
        const res = await mountCanvasHands(fakeRoot, () => {}, { onError });
        expect(res).toBeNull();
        expect(onError.mock.calls[0]![0]).toBe(
          'Camera blocked — click the camera icon in the address bar, choose Allow, then press Hands.',
        );
        expect(getUserMedia).not.toHaveBeenCalled(); // fail fast, no model loading either
      } finally {
        quiet.mockRestore();
        Object.defineProperty(globalThis, 'navigator', {
          value: originalNav,
          configurable: true,
          writable: true,
        });
      }
    });
  });

  describe('auto-start gating (hands on by default)', () => {
    it('?hands=0 is the only opt-out', () => {
      expect(autoHandsFromSearch('')).toBe(true);
      expect(autoHandsFromSearch('?fresh=1&sim=1')).toBe(true);
      expect(autoHandsFromSearch('?hands=0')).toBe(false);
      expect(autoHandsFromSearch('?fresh=1&hands=0&sim=1')).toBe(false);
      expect(autoHandsFromSearch('?hands=1')).toBe(true);
    });

    it('auto-starts only where getUserMedia exists (silent no-op in jsdom/tests)', () => {
      const withCam = { mediaDevices: { getUserMedia: () => {} } };
      expect(shouldAutoStartHands(undefined, withCam)).toBe(true);
      expect(shouldAutoStartHands(true, withCam)).toBe(true);
      expect(shouldAutoStartHands(false, withCam)).toBe(false); // ?hands=0
      expect(shouldAutoStartHands(true, { mediaDevices: undefined })).toBe(false);
      expect(shouldAutoStartHands(true, {})).toBe(false);
      expect(shouldAutoStartHands(true, null)).toBe(false);
    });
  });

});

describe('C080 thumbs-up is unwired from camera frames (keep is the Approve button or voice)', () => {
  it('neither a brief nor a long-held thumbs-up fires keep', async () => {
    const { buildHandPose } = await import('../../src/dev/trackingSim');
    const thumb = buildHandPose('thumbs-up', { x: 0.5, y: 0.6 }, 0.22) as Pt[];
    const events: CanvasHandEvent[] = [];
    const a = createCanvasHandsAdapter((e) => events.push(e));
    for (let t = 0; t <= 300; t += 33) a.update({ hands: [thumb], now: 1000 + t });
    a.update({ hands: [], now: 1400 });
    expect(events.filter((e) => e.type === 'keep')).toHaveLength(0); // brief thumb
    for (let t = 0; t <= 2000; t += 33) a.update({ hands: [thumb], now: 2000 + t });
    expect(events.filter((e) => e.type === 'keep')).toHaveLength(0); // held thumb
  });
});

describe('C080 a custom gesture taught over thumbs-up silences the built-in keep', () => {
  it('suppressMotion("thumbs-up") → no keep', async () => {
    const { buildHandPose } = await import('../../src/dev/trackingSim');
    const thumb = buildHandPose('thumbs-up', { x: 0.5, y: 0.6 }, 0.22) as Pt[];
    const events: CanvasHandEvent[] = [];
    const a = createCanvasHandsAdapter((e) => events.push(e), { suppressMotion: (id) => id === 'thumbs-up' });
    for (let t = 0; t <= 900; t += 33) a.update({ hands: [thumb], now: 1000 + t });
    expect(events.filter((e) => e.type === 'keep')).toHaveLength(0);
  });
});
