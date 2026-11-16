import { describe, it, expect, vi } from 'vitest';
import { OPEN, POINT, place } from './helpers/hands';
import { MIDDLE_MCP, WRIST } from '../src/input/handLogic';
import { classifyGesture } from '../src/input/gestures';
import {
  boxAround, createGimbalFollow, handMidpoint, handsCentroid, nudgeAngles,
  pointingTip, NUDGE_RAD,
} from '../src/devices/gimbalFollow';
import { aimAngles } from '../src/devices/native';
import { disableSystemTracking } from '../src/devices/native';

describe('gimbal follow: hand-midpoint centroid', () => {
  it('takes the midpoint of wrist and middle-MCP, not a face box', () => {
    const pts = place(OPEN(), 0.2, 0.7);
    const mid = handMidpoint(pts)!;
    expect(mid.x).toBeCloseTo((pts[WRIST].x + pts[MIDDLE_MCP].x) / 2, 9);
    expect(mid.y).toBeCloseTo((pts[WRIST].y + pts[MIDDLE_MCP].y) / 2, 9);
  });

  it('averages both hands’ midpoints for the camera target', () => {
    const left = place(OPEN(), 0.2, 0.6);
    const right = place(OPEN(), 0.8, 0.6);
    const c = handsCentroid([{ points: left }, { points: right }])!;
    const a = handMidpoint(left)!;
    const b = handMidpoint(right)!;
    expect(c.x).toBeCloseTo((a.x + b.x) / 2, 9);
    expect(c.y).toBeCloseTo((a.y + b.y) / 2, 9);
  });

  it('is null when no complete hand is visible (does not fall back to a face)', () => {
    expect(handsCentroid([])).toBeNull();
    expect(handMidpoint([])).toBeNull();
  });
});

describe('gimbal follow: modes', () => {
  it('in normal use, aims at the hand centroid — not the face', async () => {
    const aim = vi.fn(async () => true);
    const follow = createGimbalFollow({ aim, intervalMs: 0 });
    expect(follow.mode()).toBe('hands');
    const pts = place(OPEN(), 0.8, 0.2);
    follow.onFrame([{ points: pts }], 1000);
    await Promise.resolve();
    expect(aim).toHaveBeenCalledOnce();
    const box = aim.mock.calls[0][0];
    const mid = handMidpoint(pts)!;
    expect(box.x + box.w / 2).toBeCloseTo(mid.x, 5);
    expect(box.y + box.h / 2).toBeCloseTo(mid.y, 5);
    // A face in the centre of the frame would have been (0.5, 0.5); this is not.
    expect(Math.hypot(mid.x - 0.5, mid.y - 0.5)).toBeGreaterThan(0.2);
  });

  it('in Add a device (point mode), aims at the pointing fingertip and ignores a non-pointing hand', async () => {
    const aim = vi.fn(async () => true);
    const follow = createGimbalFollow({ aim, intervalMs: 0 });
    follow.setMode('point');
    const tipHand = place(POINT(), 0.75, 0.4);
    expect(classifyGesture(tipHand)).toBe('point');
    expect(pointingTip([{ points: tipHand }])).toEqual(expect.objectContaining({
      x: tipHand[8].x, y: tipHand[8].y,
    }));
    follow.onFrame([{ points: tipHand }], 1000);
    await Promise.resolve();
    expect(aim).toHaveBeenCalledOnce();
    const box = aim.mock.calls[0][0];
    expect(box.x + box.w / 2).toBeCloseTo(tipHand[8].x, 5);

    aim.mockClear();
    follow.onFrame([{ points: place(OPEN(), 0.2, 0.2) }], 2000);
    await Promise.resolve();
    expect(aim).not.toHaveBeenCalled();
  });

  it('after the device is in frame (hold), does not keep following', async () => {
    const aim = vi.fn(async () => true);
    const follow = createGimbalFollow({ aim, intervalMs: 0 });
    follow.setMode('hold');
    follow.onFrame([{ points: place(OPEN(), 0.8, 0.2) }], 1000);
    follow.onFrame([{ points: place(POINT(), 0.2, 0.2) }], 2000);
    await Promise.resolve();
    expect(aim).not.toHaveBeenCalled();
  });

  it('manual pan/tilt nudges are a fixed gentle step', async () => {
    expect(nudgeAngles('left')).toEqual({ yaw: -NUDGE_RAD, pitch: 0 });
    expect(nudgeAngles('right')).toEqual({ yaw: NUDGE_RAD, pitch: 0 });
    expect(nudgeAngles('up')).toEqual({ yaw: 0, pitch: NUDGE_RAD });
    expect(nudgeAngles('down')).toEqual({ yaw: 0, pitch: -NUDGE_RAD });
    const nudge = vi.fn(async () => true);
    const follow = createGimbalFollow({ aim: async () => true, nudge });
    expect(await follow.nudge('right')).toBe(true);
    expect(nudge).toHaveBeenCalledWith(NUDGE_RAD, 0);
  });

  it('skips a move that is already inside the deadband (stay in frame)', async () => {
    const aim = vi.fn(async () => true);
    const follow = createGimbalFollow({ aim, intervalMs: 0 });
    const centred = place(OPEN(), 0.5, 0.5);
    // Shift so the midpoint itself sits on frame centre.
    const mid = handMidpoint(centred)!;
    const pts = place(OPEN(), 0.5 - (mid.x - centred[0].x), 0.5 - (mid.y - centred[0].y));
    const angles = aimAngles(boxAround(handMidpoint(pts)!));
    expect(angles).toEqual({ yaw: 0, pitch: 0 });
    follow.onFrame([{ points: pts }], 1000);
    await Promise.resolve();
    expect(aim).not.toHaveBeenCalled();
  });
});

describe('DockKit system tracking: off while Mendcraft is open', () => {
  it('disableSystemTracking is a no-op on the web and is called with enabled:false on iOS', async () => {
    expect(await disableSystemTracking({})).toBe(false);
    const set = vi.fn(async () => ({ ok: true }));
    const w = {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        Plugins: { MendcraftGimbal: { isAvailable: async () => ({ available: true }), aim: async () => ({ ok: true }), release: async () => {}, setSystemTrackingEnabled: set } },
      },
    };
    expect(await disableSystemTracking(w)).toBe(true);
    expect(set).toHaveBeenCalledWith({ enabled: false });
  });
});
