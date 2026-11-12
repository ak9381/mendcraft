import { describe, expect, it } from 'vitest';
import {
  headPoseFromMatrix,
  headPoseFromLandmarks,
  headPose,
  computeSignature,
  signatureDistance,
  createFacingTracker,
  createOperatorTracker,
  createPresenceGate,
  FACE,
  type FaceLandmarks,
  type Pt3,
} from '../src/input/faceLogic';

// Column-major 4x4 for R = Ry(yaw)·Rx(pitch), the exact inverse of the
// extraction in headPoseFromMatrix (so round-trips are lossless).
function rotMatrix(yawDeg: number, pitchDeg: number): number[] {
  const y = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p);
  return [
    cy, 0, -sy, 0,
    sy * sp, cp, cy * sp, 0,
    sy * cp, -sp, cy * cp, 0,
    0, 0, 0, 1,
  ];
}

/** A frontal synthetic face; pass overrides to turn/tilt or change geometry. */
function makeFace(over: Record<number, Pt3> = {}): FaceLandmarks {
  const a: Pt3[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  a[FACE.LEFT_EYE_OUTER] = { x: 0.42, y: 0.40 };
  a[FACE.RIGHT_EYE_OUTER] = { x: 0.58, y: 0.40 };
  a[FACE.LEFT_EYE_INNER] = { x: 0.47, y: 0.40 };
  a[FACE.RIGHT_EYE_INNER] = { x: 0.53, y: 0.40 };
  a[FACE.NOSE_TIP] = { x: 0.50, y: 0.54 };
  a[FACE.CHIN] = { x: 0.50, y: 0.68 };
  a[FACE.FOREHEAD] = { x: 0.50, y: 0.30 };
  a[FACE.LEFT_CHEEK] = { x: 0.40, y: 0.50 };
  a[FACE.RIGHT_CHEEK] = { x: 0.60, y: 0.50 };
  a[FACE.MOUTH_LEFT] = { x: 0.45, y: 0.60 };
  a[FACE.MOUTH_RIGHT] = { x: 0.55, y: 0.60 };
  for (const k of Object.keys(over)) a[Number(k)] = over[Number(k)];
  return a;
}

function shift(lm: FaceLandmarks, dx: number, dy: number): FaceLandmarks {
  return lm.map((p) => ({ x: p.x + dx, y: p.y + dy, z: p.z }));
}

describe('head pose from transformation matrix', () => {
  it('identity is frontal', () => {
    const pose = headPoseFromMatrix(rotMatrix(0, 0));
    expect(pose.yaw).toBeCloseTo(0, 5);
    expect(pose.pitch).toBeCloseTo(0, 5);
  });

  it('round-trips yaw and pitch', () => {
    expect(headPoseFromMatrix(rotMatrix(30, 0)).yaw).toBeCloseTo(30, 4);
    expect(headPoseFromMatrix(rotMatrix(-25, 0)).yaw).toBeCloseTo(-25, 4);
    expect(headPoseFromMatrix(rotMatrix(0, 18)).pitch).toBeCloseTo(18, 4);
    const both = headPoseFromMatrix(rotMatrix(15, -12));
    expect(both.yaw).toBeCloseTo(15, 4);
    expect(both.pitch).toBeCloseTo(-12, 4);
  });

  it('headPose prefers the matrix, falls back to landmarks', () => {
    const lm = makeFace();
    expect(headPose(lm, rotMatrix(40, 0)).yaw).toBeCloseTo(40, 3);
    expect(headPose(lm, null).yaw).toBeCloseTo(0, 1); // landmark fallback, frontal
  });
});

describe('head pose from landmarks (fallback)', () => {
  it('frontal face is near zero', () => {
    const pose = headPoseFromLandmarks(makeFace());
    expect(Math.abs(pose.yaw)).toBeLessThan(5);
    expect(Math.abs(pose.pitch)).toBeLessThan(5);
  });

  it('turned head yields large yaw', () => {
    const pose = headPoseFromLandmarks(makeFace({ [FACE.NOSE_TIP]: { x: 0.58, y: 0.54 } }));
    expect(Math.abs(pose.yaw)).toBeGreaterThan(28);
  });

  it('tilted head yields large pitch', () => {
    const pose = headPoseFromLandmarks(makeFace({ [FACE.NOSE_TIP]: { x: 0.50, y: 0.44 } }));
    expect(Math.abs(pose.pitch)).toBeGreaterThan(28);
  });
});

describe('facing hysteresis + debounce', () => {
  it('enters facing below 20deg and only leaves above 28deg', () => {
    const t = createFacingTracker({ debounceMs: 0 });
    expect(t.update({ yaw: 10, pitch: 5 }, 0)).toBe(true); // frontal -> facing
    expect(t.update({ yaw: 24, pitch: 0 }, 1)).toBe(true); // hysteresis zone: stays
    expect(t.update({ yaw: 30, pitch: 0 }, 2)).toBe(false); // past leave threshold
    expect(t.update({ yaw: 22, pitch: 0 }, 3)).toBe(false); // zone again: stays not-facing
    expect(t.update({ yaw: 15, pitch: 0 }, 4)).toBe(true); // back under enter
  });

  it('debounces a transition', () => {
    const t = createFacingTracker({ debounceMs: 100 });
    expect(t.update({ yaw: 0, pitch: 0 }, 0)).toBe(false); // pending, not yet
    expect(t.update({ yaw: 0, pitch: 0 }, 50)).toBe(false); // still within debounce
    expect(t.update({ yaw: 0, pitch: 0 }, 120)).toBe(true); // persisted -> facing
  });

  it('a brief glance away is ignored (debounce resets the timer)', () => {
    const t = createFacingTracker({ debounceMs: 100 });
    t.update({ yaw: 0, pitch: 0 }, 0);
    t.update({ yaw: 0, pitch: 0 }, 200); // now facing
    expect(t.isFacing).toBe(true);
    expect(t.update({ yaw: 40, pitch: 0 }, 220)).toBe(true); // pending leave
    expect(t.update({ yaw: 5, pitch: 0 }, 250)).toBe(true); // glanced back before debounce
  });
});

describe('signature compute + distance', () => {
  it('identical geometry -> zero distance, invariant to translation', () => {
    const a = computeSignature(makeFace());
    const b = computeSignature(shift(makeFace(), 0.1, -0.05));
    expect(signatureDistance(a, a)).toBe(0);
    expect(signatureDistance(a, b)).toBeCloseTo(0, 6);
  });

  it('different geometry -> clearly larger distance', () => {
    const me = computeSignature(makeFace());
    const stranger = computeSignature(
      makeFace({
        [FACE.MOUTH_LEFT]: { x: 0.37, y: 0.64 },
        [FACE.MOUTH_RIGHT]: { x: 0.63, y: 0.64 },
        [FACE.CHIN]: { x: 0.50, y: 0.82 },
        [FACE.LEFT_CHEEK]: { x: 0.44, y: 0.50 },
        [FACE.RIGHT_CHEEK]: { x: 0.56, y: 0.50 },
        [FACE.FOREHEAD]: { x: 0.50, y: 0.26 },
      }),
    );
    expect(signatureDistance(me, stranger)).toBeGreaterThan(0.35);
  });
});

describe('operator matching across frames', () => {
  const me = computeSignature(makeFace());
  const stranger = computeSignature(
    makeFace({
      [FACE.MOUTH_LEFT]: { x: 0.37, y: 0.64 },
      [FACE.MOUTH_RIGHT]: { x: 0.63, y: 0.64 },
      [FACE.CHIN]: { x: 0.50, y: 0.82 },
      [FACE.LEFT_CHEEK]: { x: 0.44, y: 0.50 },
      [FACE.RIGHT_CHEEK]: { x: 0.56, y: 0.50 },
      [FACE.FOREHEAD]: { x: 0.50, y: 0.26 },
    }),
  );

  it('picks the operator regardless of candidate order', () => {
    const op = createOperatorTracker();
    op.register(me);
    expect(op.update([stranger, me], 0).index).toBe(1);
    expect(op.update([me, stranger], 16).index).toBe(0);
  });

  it('rejects a frame with only strangers', () => {
    const op = createOperatorTracker();
    op.register(me);
    expect(op.update([stranger], 0).index).toBeNull();
  });

  it('re-acquires by signature after a brief loss', () => {
    const op = createOperatorTracker();
    op.register(me);
    expect(op.update([me], 0).index).toBe(0); // locked
    expect(op.update([stranger], 100).index).toBeNull(); // operator gone briefly
    // Operator returns in a different position (box continuity broken) -> signature re-acquires.
    const movedMe = computeSignature(shift(makeFace(), 0.2, 0.0));
    expect(op.update([stranger, movedMe], 2000).index).toBe(1);
  });

  it('is inert until registered', () => {
    const op = createOperatorTracker();
    expect(op.registered).toBe(false);
    expect(op.update([me, stranger], 0).index).toBeNull();
  });
});

describe('presence timeout gate', () => {
  it('pauses after the operator is absent past the timeout, resumes on return', () => {
    const gate = createPresenceGate(2500);
    expect(gate.update(true, 0).paused).toBe(false);
    expect(gate.update(false, 1000).paused).toBe(false); // within timeout
    expect(gate.update(false, 2000).paused).toBe(false);
    const paused = gate.update(false, 3600); // >2.5s since last seen
    expect(paused.paused).toBe(true);
    expect(paused.justPaused).toBe(true);
    const resumed = gate.update(true, 4000);
    expect(resumed.paused).toBe(false);
    expect(resumed.justResumed).toBe(true);
  });

  it('does not re-fire justPaused every frame', () => {
    const gate = createPresenceGate(2500);
    gate.update(true, 0);
    expect(gate.update(false, 3000).justPaused).toBe(true);
    expect(gate.update(false, 4000).justPaused).toBe(false);
    expect(gate.paused).toBe(true);
  });
});
