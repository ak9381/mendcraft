import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createCanvasHandsAdapter,
  mapGestureToCanvasEvent,
  mountCanvasHands,
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
    it('recognizes pinch pose and emits keep', () => {
      const events: CanvasHandEvent[] = [];
      const adapter = createCanvasHandsAdapter((e) => events.push(e));

      const pinch = makePinchingHand();
      adapter.update({ hands: [pinch], now: 1000 });
      expect(events).toContainEqual({ type: 'keep' });

      // Immediate next frame does not duplicate keep
      adapter.update({ hands: [pinch], now: 1200 });
      expect(events.filter((e) => e.type === 'keep')).toHaveLength(1);
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

    it('recognizes open palm and emits palm', () => {
      const events: CanvasHandEvent[] = [];
      const adapter = createCanvasHandsAdapter((e) => events.push(e));

      const palm = makeOpenPalmHand();
      adapter.update({ hands: [palm], now: 1000 });
      expect(events).toContainEqual({ type: 'palm' });
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
      try {
        Object.defineProperty(globalThis, 'navigator', {
          value: { mediaDevices: undefined },
          configurable: true,
          writable: true,
        });

        const res = await mountCanvasHands(fakeRoot, () => {});
        expect(res).toBeNull();
      } finally {
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
        Object.defineProperty(globalThis, 'navigator', {
          value: originalNav,
          configurable: true,
          writable: true,
        });
      }
    });
  });
});
