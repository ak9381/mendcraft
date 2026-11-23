import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  autoHandsFromSearch,
  createCanvasHandsAdapter,
  getLastCameraError,
  mapGestureToCanvasEvent,
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
    5: { x: 0.5, y: 0.6 }, 6: { x: 0.5, y: 0.5 }, 8: { x: 0.51, y: 0.41 },
    9: { x: 0.53, y: 0.6 }, 10: { x: 0.53, y: 0.7 }, 12: { x: 0.53, y: 0.75 },
    13: { x: 0.55, y: 0.6 }, 14: { x: 0.55, y: 0.7 }, 16: { x: 0.55, y: 0.75 },
    17: { x: 0.57, y: 0.6 }, 18: { x: 0.57, y: 0.7 }, 20: { x: 0.57, y: 0.75 },
  });
}

describe('Part 2: src/canvas/canvasHands.ts', () => {
  describe('pure gesture mapping and debounce', () => {
    it('maps discrete gestures directly', () => {
      expect(mapGestureToCanvasEvent('pinch')).toEqual({ type: 'keep' });
      expect(mapGestureToCanvasEvent('brush')).toEqual({ type: 'drop' });
      expect(mapGestureToCanvasEvent('palm-swipe-left')).toEqual({ type: 'drop' });
      expect(mapGestureToCanvasEvent('palm-swipe-right')).toEqual({ type: 'drop' });
      expect(mapGestureToCanvasEvent('open-palm')).toEqual({ type: 'palm' });
      expect(mapGestureToCanvasEvent('point', { x: 0.6, y: 0.4 })).toEqual({
        type: 'point',
        point: { x: 0.6, y: 0.4 },
      });
      expect(mapGestureToCanvasEvent('unknown')).toBeNull();
    });

    it('debounces keep with 600 ms refractory period', () => {
      const events: CanvasHandEvent[] = [];
      const adapter = createCanvasHandsAdapter((e) => events.push(e));

      // First pinch at t=100
      adapter.feedGesture('pinch', { now: 100 });
      expect(events).toEqual([{ type: 'keep' }]);

      // Repeated pinch at t=300 (< 600 ms refractory) is debounced
      adapter.feedGesture('pinch', { now: 300 });
      expect(events).toHaveLength(1);

      // Repeated pinch at t=699 is still within 600 ms of 100
      adapter.feedGesture('pinch', { now: 699 });
      expect(events).toHaveLength(1);

      // Pinch at t=701 (>= 600 ms since first keep) fires keep
      adapter.feedGesture('pinch', { now: 701 });
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ type: 'keep' });
    });

    it('emits drop on brush without refractory blocking other events', () => {
      const events: CanvasHandEvent[] = [];
      const adapter = createCanvasHandsAdapter((e) => events.push(e));

      adapter.feedGesture('pinch', { now: 100 });
      adapter.feedGesture('brush', { now: 200 });
      adapter.feedGesture('open-palm', { now: 300 });

      expect(events).toEqual([
        { type: 'keep' },
        { type: 'drop' },
        { type: 'palm' },
      ]);
    });
  });

  describe('hand landmark frames processing', () => {
    // keep now needs HAND_FEEL.keepFrames (3) consecutive pinch frames — a
    // single-frame tracking dip can no longer keep a proposal by accident.
    it('emits keep only after 3 consecutive pinch frames, once', () => {
      const events: CanvasHandEvent[] = [];
      const adapter = createCanvasHandsAdapter((e) => events.push(e));

      const pinch = makePinchingHand();
      adapter.update({ hands: [pinch], now: 1000 });
      adapter.update({ hands: [pinch], now: 1033 });
      expect(events.filter((e) => e.type === 'keep')).toHaveLength(0); // 2 frames: not yet
      adapter.update({ hands: [pinch], now: 1066 });
      expect(events.filter((e) => e.type === 'keep')).toHaveLength(1);

      // Holding the pinch does not re-fire within the refractory window.
      adapter.update({ hands: [pinch], now: 1100 });
      adapter.update({ hands: [pinch], now: 1200 });
      expect(events.filter((e) => e.type === 'keep')).toHaveLength(1);
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

  describe('twoHandPinchPoints (both hands pinching -> screen px pair)', () => {
    it('returns null with fewer than two pinching hands', async () => {
      const { twoHandPinchPoints } = await import('../../src/canvas/canvasHands');
      expect(twoHandPinchPoints([], 1000, 800)).toBeNull();
      expect(twoHandPinchPoints([makePinchingHand()], 1000, 800)).toBeNull();
      expect(twoHandPinchPoints([makePinchingHand(), makeOpenPalmHand()], 1000, 800)).toBeNull();
    });

    it('returns both pinch midpoints in screen px when two hands pinch', async () => {
      const { twoHandPinchPoints } = await import('../../src/canvas/canvasHands');
      const left = makePinchingHand();
      const right = makePinchingHand().map((p) => ({ x: p.x + 0.2, y: p.y })); // shifted
      const pts = twoHandPinchPoints([left, right], 1000, 800);
      expect(pts).not.toBeNull();
      expect(pts!.p.x).toBeGreaterThanOrEqual(0);
      expect(pts!.p.x).toBeLessThanOrEqual(1000);
      expect(pts!.q.x).toBeGreaterThanOrEqual(0);
      // the two hands sit at different screen x (mirrored, but still distinct)
      expect(Math.abs(pts!.p.x - pts!.q.x)).toBeGreaterThan(1);
    });
  });

  describe('oneHandPinchPoint (exactly one pinching hand -> screen px) [A1-012]', () => {
    it('returns null with zero or two+ pinching hands (two-hand path is untouched)', async () => {
      const { oneHandPinchPoint } = await import('../../src/canvas/canvasHands');
      expect(oneHandPinchPoint([], 1000, 800)).toBeNull();
      expect(oneHandPinchPoint([makeOpenPalmHand()], 1000, 800)).toBeNull();
      const right = makePinchingHand().map((p) => ({ x: p.x + 0.2, y: p.y }));
      expect(oneHandPinchPoint([makePinchingHand(), right], 1000, 800)).toBeNull();
    });

    it('returns the single pinch midpoint in screen px', async () => {
      const { oneHandPinchPoint } = await import('../../src/canvas/canvasHands');
      const pt = oneHandPinchPoint([makePinchingHand()], 1000, 800);
      expect(pt).not.toBeNull();
      expect(pt!.x).toBeGreaterThanOrEqual(0);
      expect(pt!.x).toBeLessThanOrEqual(1000);
      expect(pt!.y).toBeGreaterThanOrEqual(0);
      expect(pt!.y).toBeLessThanOrEqual(800);
    });
  });
});

describe('C080 a held thumbs-up keeps the pending proposal (Approve twin)', () => {
  it('fires keep once after ~600ms of thumbs-up, never on a brief thumb', async () => {
    const { buildHandPose } = await import('../../src/dev/trackingSim');
    const thumb = buildHandPose('thumbs-up', { x: 0.5, y: 0.6 }, 0.22) as Pt[];
    const events: CanvasHandEvent[] = [];
    const a = createCanvasHandsAdapter((e) => events.push(e));
    for (let t = 0; t <= 300; t += 33) a.update({ hands: [thumb], now: 1000 + t });
    a.update({ hands: [], now: 1400 });
    expect(events.filter((e) => e.type === 'keep')).toHaveLength(0); // brief thumb
    for (let t = 0; t <= 800; t += 33) a.update({ hands: [thumb], now: 2000 + t });
    expect(events.filter((e) => e.type === 'keep')).toHaveLength(1);
  });
});
