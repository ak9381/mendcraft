// Owner registration: the hand-driven face → right-pinch → left-pinch flow,
// its persistence, and the lock behaviour it switches on (other-person hand
// rejection, stable identity, re-acquire) via the presence building blocks.
import { describe, expect, it, vi } from 'vitest';
import {
  REG_PROMPTS,
  REG_STORAGE_KEY,
  createRegistrationFlow,
  loadStoredSignature,
  storeSignature,
} from '../../src/canvas/registration';
import { createOperatorTracker, type FaceSignature } from '../../src/input/faceLogic';
import { createHandBinder } from '../../src/input/handBinding';

const sig = (r: number): FaceSignature => ({
  ratios: [r, r, r, r, r, r, r, r],
  box: { x: 0.4, y: 0.3, w: 0.2, h: 0.25, cx: 0.5, cy: 0.42 },
});

describe('registration state machine', () => {
  it('walks face → right → left → done on held inputs', () => {
    const f = createRegistrationFlow();
    expect(f.step).toBe('face');
    // Face must be continuously visible for faceHoldMs.
    f.update({ faceVisible: true, hands: [], now: 0 });
    expect(f.update({ faceVisible: true, hands: [], now: 400 }).step).toBe('face');
    const captured = f.update({ faceVisible: true, hands: [], now: 850 });
    expect(captured.step).toBe('right');
    expect(captured.justAdvanced).toBe(true);
    expect(captured.prompt).toBe(REG_PROMPTS.right);

    // Right pinch, held.
    f.update({ faceVisible: true, hands: [{ label: 'Right', pinching: true }], now: 1000 });
    const right = f.update({ faceVisible: true, hands: [{ label: 'Right', pinching: true }], now: 1400 });
    expect(right.step).toBe('left');

    // Left pinch, held.
    f.update({ faceVisible: true, hands: [{ label: 'Left', pinching: true }], now: 1500 });
    const done = f.update({ faceVisible: true, hands: [{ label: 'Left', pinching: true }], now: 1900 });
    expect(done.step).toBe('done');
    expect(done.prompt).toBe('Locked: you · L+R hands');
  });

  it('a face that ducks away restarts the face hold', () => {
    const f = createRegistrationFlow();
    f.update({ faceVisible: true, hands: [], now: 0 });
    f.update({ faceVisible: false, hands: [], now: 500 });
    expect(f.update({ faceVisible: true, hands: [], now: 600 }).step).toBe('face');
    expect(f.update({ faceVisible: true, hands: [], now: 1200 }).step).toBe('face'); // only 600 ms again
    expect(f.update({ faceVisible: true, hands: [], now: 1450 }).step).toBe('right');
  });

  it('the wrong hand does not advance quickly, but the fallback hold rescues a bad label', () => {
    const f = createRegistrationFlow();
    f.complete(); // jump helper works
    expect(f.step).toBe('done');
    f.reset();
    // Reach the 'right' step.
    f.update({ faceVisible: true, hands: [], now: 0 });
    f.update({ faceVisible: true, hands: [], now: 900 });
    expect(f.step).toBe('right');
    // A LEFT-labelled pinch held for pinchHoldMs does NOT advance…
    f.update({ faceVisible: true, hands: [{ label: 'Left', pinching: true }], now: 1000 });
    expect(f.update({ faceVisible: true, hands: [{ label: 'Left', pinching: true }], now: 1500 }).step).toBe('right');
    // …but if it stays held past fallbackHoldMs (labels can be wrong), it does.
    expect(f.update({ faceVisible: true, hands: [{ label: 'Left', pinching: true }], now: 2600 }).step).toBe('left');
  });

  it('an unlabelled pinch counts for the asked-for hand', () => {
    const f = createRegistrationFlow();
    f.update({ faceVisible: true, hands: [], now: 0 });
    f.update({ faceVisible: true, hands: [], now: 900 });
    f.update({ faceVisible: true, hands: [{ pinching: true }], now: 1000 });
    expect(f.update({ faceVisible: true, hands: [{ pinching: true }], now: 1400 }).step).toBe('left');
  });
});

describe('registration persistence (sessionStorage)', () => {
  function memStorage() {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  }

  it('round-trips a signature and clears it on re-register', () => {
    const s = memStorage();
    storeSignature(s, sig(1.2));
    expect(loadStoredSignature(s)).toEqual(sig(1.2));
    storeSignature(s, null);
    expect(loadStoredSignature(s)).toBeNull();
  });

  it('rejects junk in storage instead of locking onto garbage', () => {
    const s = memStorage();
    s.setItem(REG_STORAGE_KEY, '{"nope":1}');
    expect(loadStoredSignature(s)).toBeNull();
    s.setItem(REG_STORAGE_KEY, 'not json');
    expect(loadStoredSignature(s)).toBeNull();
    expect(loadStoredSignature(null)).toBeNull();
    const throwing = { getItem: vi.fn(() => { throw new Error('denied'); }) };
    expect(loadStoredSignature(throwing)).toBeNull();
  });
});

describe('lock behaviour after registration', () => {
  it('a stranger’s face never matches; the owner re-acquires after a loss', () => {
    const op = createOperatorTracker();
    op.register(sig(1.2));
    // Stranger alone: no operator present.
    expect(op.update([sig(2.4)], 0).index).toBeNull();
    // Owner reappears (slightly different measurement): re-acquired.
    expect(op.update([sig(2.4), sig(1.25)], 4000).index).toBe(1);
  });

  it('rejects another person’s hands by wrist-to-face geometry', () => {
    const binder = createHandBinder();
    const ownerBox = { x: 0.4, y: 0.2, w: 0.2, h: 0.25, cx: 0.5, cy: 0.32 };
    const accepted = binder.bind(
      [
        { index: 0, wrist: { x: 0.52, y: 0.75 } },           // below the owner's face: theirs
        { index: 1, wrist: { x: 0.52, y: 0.78 } },           // second own hand
        { index: 2, wrist: { x: 3.5, y: 0.8 } },             // far across the room: not theirs
      ],
      ownerBox,
    );
    expect(accepted).toContain(0);
    expect(accepted).toContain(1);
    expect(accepted).not.toContain(2);
  });
});
