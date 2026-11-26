// The canvas HAND GATE: only an actually turned head locks the hands.
// Looking down at the keyboard / your own hands is fine; a face that just
// (re)appeared is unknown until it settles; no face is unknown.
import { describe, expect, it } from 'vitest';
import { createHandGate, handGatePoseOk, HAND_GATE } from '../src/input/faceLogic';

const feed = (g: ReturnType<typeof createHandGate>, pose: { yaw: number; pitch: number } | null, from: number, to: number, step = 200) => {
  let last: boolean | null = null;
  for (let t = from; t <= to; t += step) last = g.update(pose, t);
  return last;
};

describe('hand gate thresholds (looser than look-to-sync facing)', () => {
  it('locks only past |yaw| 30°, pitch up 25° or pitch down 45° (pitch > 0 = down)', () => {
    expect(HAND_GATE.yawOut).toBe(30);
    expect(HAND_GATE.pitchUpOut).toBe(25);
    expect(HAND_GATE.pitchDownOut).toBe(45);
    // While facing: these all stay facing.
    expect(handGatePoseOk({ yaw: 28, pitch: 0 }, true)).toBe(true);
    expect(handGatePoseOk({ yaw: 0, pitch: 40 }, true)).toBe(true); // looking down at the keyboard
    expect(handGatePoseOk({ yaw: 0, pitch: -22 }, true)).toBe(true);
    // …and these turn it off.
    expect(handGatePoseOk({ yaw: 35, pitch: 0 }, true)).toBe(false);
    expect(handGatePoseOk({ yaw: -35, pitch: 0 }, true)).toBe(false);
    expect(handGatePoseOk({ yaw: 0, pitch: 50 }, true)).toBe(false);
    expect(handGatePoseOk({ yaw: 0, pitch: -30 }, true)).toBe(false);
    // Hysteresis: coming back needs the tighter *In band.
    expect(handGatePoseOk({ yaw: 28, pitch: 0 }, false)).toBe(false);
    expect(handGatePoseOk({ yaw: 20, pitch: 0 }, false)).toBe(true);
  });
});

describe('createHandGate', () => {
  it('no face → unknown (null); the laptop hands read that as NOT facing (handFacing)', () => {
    const g = createHandGate();
    expect(feed(g, null, 0, 2000)).toBeNull();
  });

  it('a (re)appearing face is unknown for 500 ms, even if turned, then reports its real state', () => {
    const g = createHandGate();
    // Face appears already turned (e.g. right after a hand passed in front of it).
    expect(g.update({ yaw: 60, pitch: 0 }, 0)).toBeNull();
    expect(g.update({ yaw: 60, pitch: 0 }, 200)).toBeNull();
    expect(g.update({ yaw: 60, pitch: 0 }, 400)).toBeNull(); // < 500 ms: still unknown
    expect(g.update({ yaw: 60, pitch: 0 }, 600)).toBe(false); // settled and actually turned
  });

  it('a frontal face settles to facing; ONE turned frame does not flip it; two (≥150 ms) do', () => {
    const g = createHandGate();
    expect(HAND_GATE.leaveDebounceMs).toBe(150);
    expect(feed(g, { yaw: 0, pitch: 10 }, 0, 600)).toBe(true);
    expect(g.update({ yaw: 50, pitch: 0 }, 800)).toBe(true); // just turned (one face frame)
    expect(g.update({ yaw: 0, pitch: 0 }, 1000)).toBe(true); // back on the next frame
    expect(g.update({ yaw: 50, pitch: 0 }, 1200)).toBe(true);
    expect(g.update({ yaw: 50, pitch: 0 }, 1400)).toBe(false); // second turned frame: 200 ms ≥ 150 ms
    // Turning back still needs the 250 ms debounce.
    expect(g.update({ yaw: 0, pitch: 0 }, 1600)).toBe(false);
    expect(g.update({ yaw: 0, pitch: 0 }, 1800)).toBe(false); // 200 ms
    expect(g.update({ yaw: 0, pitch: 0 }, 2000)).toBe(true); // 400 ms ≥ 250 ms
  });

  it('looking down at your hands (pitch 40°) keeps the hands unlocked', () => {
    const g = createHandGate();
    feed(g, { yaw: 0, pitch: 0 }, 0, 600);
    expect(feed(g, { yaw: 5, pitch: 40 }, 800, 3000)).toBe(true);
  });

  it('losing the face (past the 250 ms grace) resets: the next appearance is unknown again', () => {
    const g = createHandGate();
    feed(g, { yaw: 60, pitch: 0 }, 0, 1000);
    expect(g.update(null, 1200)).toBe(false); // one missed face frame: kept
    expect(g.update(null, 1400)).toBeNull(); // two: gone
    expect(g.update({ yaw: 60, pitch: 0 }, 1600)).toBeNull();
  });

  it('one missed face frame (a hand passing in front of it) keeps "facing"; a longer loss does not', () => {
    const g = createHandGate();
    expect(HAND_GATE.lostGraceMs).toBe(250);
    feed(g, { yaw: 0, pitch: 0 }, 0, 1000);
    expect(g.update(null, 1200)).toBe(true);
    expect(g.update({ yaw: 0, pitch: 0 }, 1400)).toBe(true); // back: no 500 ms re-settle
    expect(g.update(null, 1600)).toBe(true);
    expect(g.update(null, 1800)).toBeNull();
  });
});
