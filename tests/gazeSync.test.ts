import { describe, it, expect } from 'vitest';
import {
  shouldSync, createGazeWatcher, type GazeProbe, type SyncReason,
} from '../src/input/gazeSync';

describe('gazeSync shouldSync', () => {
  const base = { visible: true, facing: false, focused: false, lastSyncAt: null, now: 1000, minIntervalMs: 4000 };
  it('hidden page never syncs', () => {
    expect(shouldSync({ ...base, visible: false, facing: true })).toEqual({ sync: false, reason: 'hidden' });
  });
  it('facing triggers a face sync', () => {
    expect(shouldSync({ ...base, facing: true })).toEqual({ sync: true, reason: 'face' });
  });
  it('focused+visible (no face) triggers a focus sync', () => {
    expect(shouldSync({ ...base, focused: true })).toEqual({ sync: true, reason: 'focus' });
  });
  it('idle when visible but neither facing nor focused', () => {
    expect(shouldSync(base)).toEqual({ sync: false, reason: 'idle' });
  });
  it('throttles inside minInterval', () => {
    expect(shouldSync({ ...base, facing: true, lastSyncAt: 500, now: 1000 })).toEqual({ sync: false, reason: 'throttled' });
    expect(shouldSync({ ...base, facing: true, lastSyncAt: 500, now: 5000 }).sync).toBe(true);
  });
});

function fakeProbe(facing: boolean): GazeProbe {
  let stopped = false;
  return { facing: () => facing && !stopped, stop: () => { stopped = true; } };
}

describe('gazeSync watcher camera gating', () => {
  it('does NOT open the front camera when a live stream exists', () => {
    let opened = 0;
    const reasons: SyncReason[] = [];
    const w = createGazeWatcher({
      openGaze: () => { opened++; return fakeProbe(true); },
      hasLiveCameraStream: () => true,
      gimbalActive: () => false,
      isVisible: () => true,
      isFocused: () => true,
      now: () => 10000,
      onSync: (r) => reasons.push(r),
    });
    w.tick();
    expect(opened).toBe(0);
    expect(w.usingCamera()).toBe(false);
    // Falls back to focus sync (visible + focused), not face.
    expect(reasons).toEqual(['focus']);
  });

  it('does NOT open the camera when the gimbal is active', () => {
    let opened = 0;
    const w = createGazeWatcher({
      openGaze: () => { opened++; return fakeProbe(true); },
      hasLiveCameraStream: () => false,
      gimbalActive: () => true,
      isVisible: () => true,
      isFocused: () => false,
      now: () => 0,
      onSync: () => {},
    });
    w.tick();
    expect(opened).toBe(0);
    expect(w.usingCamera()).toBe(false);
  });

  it('opens the gaze camera and records an on-device start (no frames)', async () => {
    let starts = 0;
    const reasons: SyncReason[] = [];
    const w = createGazeWatcher({
      openGaze: () => fakeProbe(true),
      hasLiveCameraStream: () => false,
      gimbalActive: () => false,
      isVisible: () => true,
      isFocused: () => false,
      now: () => 50000,
      onSync: (r) => reasons.push(r),
      onGazeStart: () => { starts++; },
    });
    w.tick(); // kicks off async openGaze
    await Promise.resolve();
    await Promise.resolve();
    expect(starts).toBe(1);
    w.tick(); // now the probe exists → face sync
    expect(reasons).toContain('face');
    w.stop();
  });
});
