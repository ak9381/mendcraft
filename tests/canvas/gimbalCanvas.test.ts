import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  createGimbalCanvasController,
  followWhileBuilding,
  parseGimbalSpeech,
  type GimbalCanvasController,
  type GimbalCanvasOptions,
} from '../../src/canvas/gimbalCanvas';
import type { GimbalPlugin } from '../../src/devices/native';
import { MAX_STEP_RAD } from '../../src/devices/native';

describe('Part 3: src/canvas/gimbalCanvas.ts', () => {
  describe('pure parser for gimbal speech', () => {
    it('parses speech commands correctly', () => {
      expect(parseGimbalSpeech('follow my hands')).toBe('hands');
      expect(parseGimbalSpeech('Please, follow my hands!')).toBe('hands');
      expect(parseGimbalSpeech('track my hands')).toBe('hands');

      expect(parseGimbalSpeech('stop following')).toBe('hold');
      expect(parseGimbalSpeech('stop tracking')).toBe('hold');
      expect(parseGimbalSpeech('hold still')).toBe('hold');

      expect(parseGimbalSpeech("connect to what I'm pointing at")).toBe('point');
      expect(parseGimbalSpeech('connect this')).toBe('point');
      expect(parseGimbalSpeech('connect what I am pointing at')).toBe('point');

      expect(parseGimbalSpeech('scan the room')).toBe('scan');
      expect(parseGimbalSpeech('scan room')).toBe('scan');

      expect(parseGimbalSpeech('turn on the lamp')).toBeNull();
      expect(parseGimbalSpeech('')).toBeNull();
    });
  });

  describe('no gimbal plugin (web environment)', () => {
    it('resolves with { ok: false, why: "The gimbal works in the iPhone app" }', async () => {
      const controller = createGimbalCanvasController({ plugin: null });

      const resMode = await controller.setMode('hands');
      expect(resMode).toEqual({ ok: false, why: 'The gimbal works in the iPhone app' });

      const resScan = await controller.scan();
      expect(resScan).toEqual({ ok: false, why: 'The gimbal works in the iPhone app' });

      const resPoint = await controller.onPoint({ x: 0.5, y: 0.5 });
      expect(resPoint).toEqual({ ok: false, why: 'The gimbal works in the iPhone app' });
    });
  });

  describe('with fake GimbalPlugin', () => {
    let fakePlugin: GimbalPlugin;
    let aimCalls: Array<{ yaw: number; pitch: number; seconds?: number }>;

    beforeEach(() => {
      aimCalls = [];
      fakePlugin = {
        isAvailable: vi.fn().mockResolvedValue({ available: true }),
        aim: vi.fn().mockImplementation((opts) => {
          aimCalls.push(opts);
          return Promise.resolve({ ok: true });
        }),
        release: vi.fn().mockResolvedValue(undefined),
      };
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('clamps aim angles to MAX_STEP_RAD in point mode', async () => {
      const controller = createGimbalCanvasController({ plugin: fakePlugin });
      await controller.setMode('point');

      // Extreme point at corner (1.0, 1.0)
      await controller.onPoint({ x: 1.0, y: 1.0 });

      expect(aimCalls.length).toBeGreaterThan(0);
      const last = aimCalls[aimCalls.length - 1];
      expect(Math.abs(last.yaw)).toBeLessThanOrEqual(MAX_STEP_RAD + 0.0001);
      expect(Math.abs(last.pitch)).toBeLessThanOrEqual(MAX_STEP_RAD + 0.0001);
    });

    it('holds for 2 seconds steady in point mode before firing onPointTarget', async () => {
      const onPointTarget = vi.fn();
      const controller = createGimbalCanvasController({
        plugin: fakePlugin,
        onPointTarget,
      });
      await controller.setMode('point');

      // Point at (0.6, 0.4)
      await controller.onPoint({ x: 0.6, y: 0.4 }, 1000);
      expect(onPointTarget).not.toHaveBeenCalled();

      // Small jitter at 1.5s (still steady within tolerance)
      await vi.advanceTimersByTimeAsync(1500);
      await controller.onPoint({ x: 0.61, y: 0.41 }, 2500);
      expect(onPointTarget).not.toHaveBeenCalled();

      // At 2000 ms after start (t=3000), steady 2s hold is reached
      await vi.advanceTimersByTimeAsync(600);
      await controller.onPoint({ x: 0.61, y: 0.41 }, 3100);
      expect(onPointTarget).toHaveBeenCalledTimes(1);

      const targetBox = onPointTarget.mock.calls[0][0];
      expect(targetBox).toHaveProperty('x');
      expect(targetBox).toHaveProperty('y');
      expect(targetBox).toHaveProperty('w');
      expect(targetBox).toHaveProperty('h');
    });

    it('resets steady hold if point moves away significantly', async () => {
      const onPointTarget = vi.fn();
      const controller = createGimbalCanvasController({
        plugin: fakePlugin,
        onPointTarget,
      });
      await controller.setMode('point');

      // Point at (0.2, 0.2)
      await controller.onPoint({ x: 0.2, y: 0.2 }, 1000);
      await vi.advanceTimersByTimeAsync(1500);

      // Huge jump at 2500ms
      await controller.onPoint({ x: 0.8, y: 0.8 }, 2500);
      expect(onPointTarget).not.toHaveBeenCalled();

      // Advancing only 1s from jump should not fire target
      await vi.advanceTimersByTimeAsync(1000);
      await controller.onPoint({ x: 0.8, y: 0.8 }, 3500);
      expect(onPointTarget).not.toHaveBeenCalled();

      // Advancing full 2s after jump should fire target
      await vi.advanceTimersByTimeAsync(1100);
      await controller.onPoint({ x: 0.8, y: 0.8 }, 4600);
      expect(onPointTarget).toHaveBeenCalledTimes(1);
    });

    it('performs 5 scan steps across +-60 degrees with 600 ms hold each', async () => {
      const scanFrames: number[] = [];
      const controller = createGimbalCanvasController({
        plugin: fakePlugin,
        onScanFrame: (i) => scanFrames.push(i),
      });

      const scanPromise = controller.scan();

      // 5 steps: step 0 (-60°), step 1 (-30°), step 2 (0°), step 3 (+30°), step 4 (+60°)
      // Each step holds 600 ms
      for (let step = 0; step < 5; step++) {
        await vi.advanceTimersByTimeAsync(600);
      }

      const res = await scanPromise;
      expect(res).toEqual({ ok: true });
      expect(scanFrames).toEqual([0, 1, 2, 3, 4]);
      expect(aimCalls.length).toBe(5);

      const rad60 = (60 * Math.PI) / 180;
      expect(aimCalls[0].yaw).toBeCloseTo(-rad60, 2);
      expect(aimCalls[2].yaw).toBeCloseTo(0, 2);
      expect(aimCalls[4].yaw).toBeCloseTo(rad60, 2);
    });
  });

  describe('followWhileBuilding (gimbal follows the user while a board is built)', () => {
    function fakeController(mode: string, overrides: Partial<GimbalCanvasController> = {}): GimbalCanvasController {
      return {
        mode: vi.fn(() => mode as never),
        setMode: vi.fn(async () => ({ ok: true })),
        onPoint: vi.fn(async () => ({ ok: true })),
        onHandsFrame: vi.fn(async () => ({ ok: true })),
        scan: vi.fn(async () => ({ ok: true })),
        release: vi.fn(async () => ({ ok: true })),
        ...overrides,
      };
    }

    it('switches to hands mode for the duration of the build, then restores the prior mode', async () => {
      const controller = fakeController('hold');
      const calls: string[] = [];

      const result = await followWhileBuilding(controller, async () => {
        calls.push('building');
        return 'plan';
      });

      expect(result).toBe('plan');
      expect(controller.setMode).toHaveBeenNthCalledWith(1, 'hands');
      expect(controller.setMode).toHaveBeenNthCalledWith(2, 'hold');
      expect(calls).toEqual(['building']);
    });

    it('still restores the prior mode when the build throws', async () => {
      const controller = fakeController('point');

      await expect(followWhileBuilding(controller, async () => { throw new Error('model error'); }))
        .rejects.toThrow('model error');

      expect(controller.setMode).toHaveBeenNthCalledWith(1, 'hands');
      expect(controller.setMode).toHaveBeenNthCalledWith(2, 'point');
    });

    it('never throws even when the gimbal is unavailable (web soft-fail)', async () => {
      const controller = fakeController('hold', {
        setMode: vi.fn(async () => ({ ok: false, why: 'The gimbal works in the iPhone app' })),
      });

      const result = await followWhileBuilding(controller, async () => 42);
      expect(result).toBe(42);
    });
  });
});
