import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createGimbalCanvasController,
  FACE_ON_KEEPALIVE_STATUS,
  FACE_ON_STATUS,
  followWhileBuilding,
  HANDS_NEED_TRACKER,
  HANDS_ON_STATUS,
  HOLD_STATUS,
  parseGimbalSpeech,
  SCAN_LIVE_WHY,
  type GimbalCanvasController,
} from '../../src/canvas/gimbalCanvas';
import type { GimbalPlugin } from '../../src/devices/native';
import { MAX_STEP_RAD } from '../../src/devices/native';
import type { Pt } from '../../src/input/handLogic';

/** A 21-landmark hand whose wrist–middle-MCP midpoint sits at (x, y), camera space. */
const OPEN_AT = (x: number, y: number): Pt[] => Array.from({ length: 21 }, () => ({ x, y }));

describe('Part 3: src/canvas/gimbalCanvas.ts', () => {
  describe('pure parser for gimbal speech', () => {
    it('parses speech commands correctly', () => {
      expect(parseGimbalSpeech('follow my hands')).toBe('hands');
      expect(parseGimbalSpeech('Please, follow my hands!')).toBe('hands');
      expect(parseGimbalSpeech('track my hands')).toBe('hands');

      expect(parseGimbalSpeech('follow me')).toBe('face');
      expect(parseGimbalSpeech('Follow my face.')).toBe('face');
      expect(parseGimbalSpeech('track me')).toBe('face');

      expect(parseGimbalSpeech('keep alive on')).toBe('keepAliveOn');
      expect(parseGimbalSpeech('gimbal keep-alive off')).toBe('keepAliveOff');

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
    let trackingCalls: Array<{ enabled: boolean; keepAlive?: boolean }>;
    let tracking: boolean;

    beforeEach(() => {
      aimCalls = [];
      trackingCalls = [];
      tracking = false;
      fakePlugin = {
        isAvailable: vi.fn().mockResolvedValue({ available: true }),
        aim: vi.fn().mockImplementation((opts) => {
          aimCalls.push(opts);
          return Promise.resolve({ ok: true });
        }),
        release: vi.fn().mockResolvedValue(undefined),
        setSystemTrackingEnabled: vi.fn().mockImplementation(async (o: { enabled: boolean; keepAlive?: boolean }) => {
          trackingCalls.push(o);
          tracking = o.enabled;
          return { ok: true, enabled: tracking, keepAlive: !!o.keepAlive };
        }),
      };
    });

    it('face: turns DockKit system tracking ON and never aims; status says what is on', async () => {
      const c = createGimbalCanvasController({ plugin: fakePlugin });
      const r = await c.setMode('face');
      expect(r).toEqual({ ok: true, status: FACE_ON_STATUS });
      expect(trackingCalls).toEqual([{ enabled: true, keepAlive: false }]);
      expect(c.mode()).toBe('face');
      await c.onHandsFrame([{ points: OPEN_AT(0.95, 0.9) }], 10_000);
      expect(aimCalls).toEqual([]);
    });

    it('face: does not claim following when the plugin does not report tracking enabled, and passes its error through', async () => {
      fakePlugin.setSystemTrackingEnabled = vi.fn(async () => ({ ok: false, enabled: false, error: 'Accessory not connected' }));
      const c = createGimbalCanvasController({ plugin: fakePlugin });
      const r = await c.setMode('face');
      expect(r.ok).toBe(false);
      expect(r.why).toBe('DockKit tracking didn’t turn on: Accessory not connected');
      expect(r.status).toBeUndefined();
      expect(c.mode()).toBe('hold');
    });

    it('face: an older native build without enabled read-back is not claimed as following', async () => {
      fakePlugin.setSystemTrackingEnabled = vi.fn(async () => ({ ok: true }));
      const c = createGimbalCanvasController({ plugin: fakePlugin });
      const r = await c.setMode('face');
      expect(r.ok).toBe(false);
      expect(c.mode()).toBe('hold');
    });

    it('face with the opt-in keep-alive asks native for it and says so', async () => {
      const c = createGimbalCanvasController({ plugin: fakePlugin, keepAlive: true });
      const r = await c.setMode('face');
      expect(trackingCalls).toEqual([{ enabled: true, keepAlive: true }]);
      expect(r.status).toBe(FACE_ON_KEEPALIVE_STATUS);
      const off = await c.setKeepAlive!(false);
      expect(trackingCalls[1]).toEqual({ enabled: true, keepAlive: false });
      expect(off.status).toBe(FACE_ON_STATUS);
    });

    it('hands without a hand tracker: says so plainly and follows the face instead', async () => {
      const c = createGimbalCanvasController({ plugin: fakePlugin, handsRunning: () => false });
      const r = await c.setMode('hands');
      expect(r.ok).toBe(true);
      expect(r.status).toBe(`${HANDS_NEED_TRACKER}. ${FACE_ON_STATUS}`);
      expect(c.mode()).toBe('face');
      expect(tracking).toBe(true);
    });

    it('hands with a tracker: system tracking OFF and the custom aim runs on camera-space frames', async () => {
      const c = createGimbalCanvasController({ plugin: fakePlugin, handsRunning: () => true });
      const r = await c.setMode('hands');
      expect(r).toEqual({ ok: true, status: HANDS_ON_STATUS });
      expect(trackingCalls).toEqual([{ enabled: false, keepAlive: false }]);
      // Hand on the camera's right → pan right (+yaw).
      await c.onHandsFrame([{ points: OPEN_AT(0.85, 0.5) }], 10_000);
      await Promise.resolve();
      expect(aimCalls).toHaveLength(1);
      expect(aimCalls[0].yaw).toBeGreaterThan(0);
      expect(Math.abs(aimCalls[0].yaw)).toBeLessThanOrEqual(MAX_STEP_RAD + 1e-9);
    });

    it('hold: system tracking OFF, no aiming', async () => {
      const c = createGimbalCanvasController({ plugin: fakePlugin, handsRunning: () => true });
      await c.setMode('face');
      const r = await c.setMode('hold');
      expect(r).toEqual({ ok: true, status: HOLD_STATUS });
      expect(tracking).toBe(false);
      await c.onHandsFrame([{ points: OPEN_AT(0.9, 0.9) }], 10_000);
      expect(aimCalls).toEqual([]);
    });

    it('hold: surfaces the native error when tracking could not be turned off', async () => {
      fakePlugin.setSystemTrackingEnabled = vi.fn(async () => ({ ok: false, enabled: true, error: 'DockKit busy' }));
      const c = createGimbalCanvasController({ plugin: fakePlugin });
      const r = await c.setMode('hold');
      expect(r).toEqual({ ok: false, why: 'Couldn’t turn DockKit tracking off: DockKit busy' });
    });

    it('point mode holds the stand: no aim during the steady hold, and no second hold/target event', async () => {
      const c = createGimbalCanvasController({ plugin: fakePlugin });
      await c.setMode('point');
      expect(tracking).toBe(false);
      for (let t = 0; t <= 3000; t += 100) {
        expect(await c.onPoint({ x: 1.0, y: 1.0 }, t)).toEqual({ ok: true });
      }
      expect(aimCalls).toEqual([]);
    });

    it('live room scan is not available and never moves the stand', async () => {
      const c = createGimbalCanvasController({ plugin: fakePlugin });
      const r = await c.scan();
      expect(r).toEqual({ ok: false, why: SCAN_LIVE_WHY });
      expect(aimCalls).toEqual([]);
    });

    it('caches isAvailable() instead of crossing the bridge every frame', async () => {
      let now = 0;
      const c = createGimbalCanvasController({ plugin: fakePlugin, handsRunning: () => true, now: () => now, availabilityTtlMs: 5000 });
      await c.setMode('hands');
      for (let i = 0; i < 50; i++) { now += 30; await c.onHandsFrame([{ points: OPEN_AT(0.5, 0.5) }], now); }
      expect(fakePlugin.isAvailable).toHaveBeenCalledTimes(1);
      now += 6000;
      await c.onHandsFrame([{ points: OPEN_AT(0.5, 0.5) }], now);
      expect(fakePlugin.isAvailable).toHaveBeenCalledTimes(2);
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

    it('switches to face mode for the duration of the build, then restores the prior mode', async () => {
      const controller = fakeController('hold');
      const calls: string[] = [];

      const result = await followWhileBuilding(controller, async () => {
        calls.push('building');
        return 'plan';
      });

      expect(result).toBe('plan');
      expect(controller.setMode).toHaveBeenNthCalledWith(1, 'face');
      expect(controller.setMode).toHaveBeenNthCalledWith(2, 'hold');
      expect(calls).toEqual(['building']);
    });

    it('still restores the prior mode when the build throws', async () => {
      const controller = fakeController('point');

      await expect(followWhileBuilding(controller, async () => { throw new Error('model error'); }))
        .rejects.toThrow('model error');

      expect(controller.setMode).toHaveBeenNthCalledWith(1, 'face');
      expect(controller.setMode).toHaveBeenNthCalledWith(2, 'point');
    });

    it('leaves an already-following gimbal alone (no bridge churn)', async () => {
      for (const m of ['face', 'hands']) {
        const controller = fakeController(m);
        expect(await followWhileBuilding(controller, async () => 1)).toBe(1);
        expect(controller.setMode).not.toHaveBeenCalled();
      }
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
