// Phone head-pose thresholds: a phone held normally sits BELOW the face, so
// the head reads as pitched UP (pitch < 0) while the user looks straight at
// it. PHONE_HAND_GATE (hands) and PHONE_FACING (look-to-edit) allow that; a
// clearly turned head still locks.
import { describe, expect, it } from 'vitest';
import { createFacingTracker, createHandGate, HAND_GATE, PHONE_FACING, PHONE_HAND_GATE } from '../src/input/faceLogic';
import { shouldSync } from '../src/input/gazeSync';

type Pose = { yaw: number; pitch: number } | null;
function gateAfter(g: ReturnType<typeof createHandGate>, pose: Pose, ms = 2000): boolean | null {
  let r: boolean | null = null;
  for (let t = 0; t <= ms; t += 100) r = g.update(pose, t);
  return r;
}
function facingAfter(opts: Parameters<typeof createFacingTracker>[0], pose: { yaw: number; pitch: number }, ms = 2000): boolean {
  const f = createFacingTracker(opts);
  let r = false;
  for (let t = 0; t <= ms; t += 100) r = f.update(pose, t);
  return r;
}

describe('PHONE_HAND_GATE', () => {
  it('has the agreed numbers', () => {
    expect(PHONE_HAND_GATE).toMatchObject({ yawOut: 30, pitchUpOut: 50, pitchDownOut: 30, yawIn: 25, pitchUpIn: 45, pitchDownIn: 25 });
  });

  it('a below-camera pose (pitch −30°) stays unlocked on the phone (the laptop gate would lock it)', () => {
    expect(gateAfter(createHandGate(PHONE_HAND_GATE), { yaw: 0, pitch: -30 })).toBe(true);
    expect(gateAfter(createHandGate(PHONE_HAND_GATE), { yaw: 5, pitch: -42 })).toBe(true);
    expect(gateAfter(createHandGate(HAND_GATE), { yaw: 0, pitch: -30 })).toBe(false);
  });

  it('a clearly turned head still locks', () => {
    expect(gateAfter(createHandGate(PHONE_HAND_GATE), { yaw: 45, pitch: -20 })).toBe(false);
    expect(gateAfter(createHandGate(PHONE_HAND_GATE), { yaw: 0, pitch: -60 })).toBe(false); // looking over the phone
    expect(gateAfter(createHandGate(PHONE_HAND_GATE), { yaw: 0, pitch: 40 })).toBe(false); // looking down past it
  });

  it('no face is still unknown (allowed)', () => {
    expect(gateAfter(createHandGate(PHONE_HAND_GATE), null)).toBeNull();
  });
});

describe('PHONE_FACING (look-to-edit)', () => {
  it('a low grip (pitch −30°/−40°) reads facing on the phone, not with the symmetric default', () => {
    expect(facingAfter(PHONE_FACING, { yaw: 0, pitch: -30 })).toBe(true);
    expect(facingAfter(PHONE_FACING, { yaw: 0, pitch: -40 })).toBe(true);
    expect(facingAfter({}, { yaw: 0, pitch: -30 })).toBe(false);
  });
  it('turned away still reads not facing', () => {
    expect(facingAfter(PHONE_FACING, { yaw: 40, pitch: -20 })).toBe(false);
    expect(facingAfter(PHONE_FACING, { yaw: 0, pitch: -60 })).toBe(false);
    expect(facingAfter(PHONE_FACING, { yaw: 0, pitch: 30 })).toBe(false); // down is not widened
  });
});

describe('mobile.html evaluateSync with face-only frames now arriving (~5 fps)', () => {
  it('stays rate-limited: at most one re-sync per 4 s while facing', () => {
    let lastSyncAt: number | null = null;
    let syncs = 0;
    for (let now = 0; now <= 20_000; now += 200) {
      const r = shouldSync({ visible: true, facing: true, focused: false, lastSyncAt, now, minIntervalMs: 4000 });
      if (r.sync) { syncs++; lastSyncAt = now; }
    }
    expect(syncs).toBeLessThanOrEqual(6);
  });
});
