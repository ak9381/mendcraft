// MORPH HOLD: the pure tap/hold/drag classifier behind "pinch-and-hold a
// tile, speak a change". Pure state machine with an injected clock — no DOM.
import { describe, expect, it } from 'vitest';
import { createMorphHold, MORPH_FEEL } from '../../src/canvas/morphHold';

const ORIGIN = { x: 100, y: 100 };

describe('createMorphHold — tap vs hold', () => {
  it('a quick release before holdMs (900ms) returns tap, and never fires', () => {
    const hold = createMorphHold();
    expect(hold.arm(ORIGIN, 'mouse', 0)).toBe(true);
    expect(hold.update(ORIGIN, 500)).toBe('none');
    expect(hold.release(600)).toBe('tap');
    expect(hold.fired).toBe(false);
  });

  it('a continuous hold >= holdMs fires exactly once, then release is after-fire', () => {
    const hold = createMorphHold();
    hold.arm(ORIGIN, 'mouse', 0);
    expect(hold.update(ORIGIN, 500)).toBe('none');
    expect(hold.update(ORIGIN, 900)).toBe('fired');
    // Continuing to feed updates after the fire must not fire again.
    expect(hold.update(ORIGIN, 950)).toBe('none');
    expect(hold.fired).toBe(true);
    expect(hold.release(1000)).toBe('after-fire');
  });
});

describe('createMorphHold — movement past slop cancels', () => {
  const CASES: Array<{ type: 'hand' | 'mouse' | 'touch'; slop: number }> = [
    { type: 'hand', slop: 28 },
    { type: 'mouse', slop: 8 },
    { type: 'touch', slop: 12 },
  ];

  for (const { type, slop } of CASES) {
    it(`${type}: movement past its slop (${slop}px) cancels the hold`, () => {
      const hold = createMorphHold();
      hold.arm(ORIGIN, type, 0);
      const moved = { x: ORIGIN.x + slop + 1, y: ORIGIN.y };
      expect(hold.update(moved, 100)).toBe('cancelled');
      expect(hold.armed).toBe(false);
      expect(hold.release(200)).toBe('idle');
    });

    it(`${type}: movement under its slop (${slop}px) does not cancel`, () => {
      const hold = createMorphHold();
      hold.arm(ORIGIN, type, 0);
      const moved = { x: ORIGIN.x + slop - 1, y: ORIGIN.y };
      expect(hold.update(moved, 100)).toBe('none');
      expect(hold.armed).toBe(true);
    });
  }
});

describe('createMorphHold — refractory period after a fire', () => {
  it('arm() within refractoryMs (500ms) of the last fire returns false', () => {
    const hold = createMorphHold();
    hold.arm(ORIGIN, 'mouse', 0);
    hold.update(ORIGIN, MORPH_FEEL.holdMs); // fires at t=900
    hold.release(MORPH_FEEL.holdMs + 1);
    expect(hold.arm(ORIGIN, 'mouse', MORPH_FEEL.holdMs + 1 + 100)).toBe(false); // t=1001, < 500ms since fire
  });

  it('arm() after refractoryMs has elapsed arms again', () => {
    const hold = createMorphHold();
    const firedAt = MORPH_FEEL.holdMs;
    hold.arm(ORIGIN, 'mouse', 0);
    hold.update(ORIGIN, firedAt);
    hold.release(firedAt + 1);
    const after = firedAt + MORPH_FEEL.refractoryMs + 1;
    expect(hold.arm(ORIGIN, 'mouse', after)).toBe(true);
  });
});

describe('createMorphHold — cancel()', () => {
  it('cancel() aborts silently: a subsequent release reports idle', () => {
    const hold = createMorphHold();
    hold.arm(ORIGIN, 'mouse', 0);
    hold.cancel();
    expect(hold.armed).toBe(false);
    expect(hold.release(100)).toBe('idle');
  });

  it('cancel() before any arm() is a harmless no-op', () => {
    const hold = createMorphHold();
    expect(() => hold.cancel()).not.toThrow();
    expect(hold.release(0)).toBe('idle');
  });
});

describe('createMorphHold — progress()', () => {
  it('is 0 before fillStartMs (250ms)', () => {
    const hold = createMorphHold();
    hold.arm(ORIGIN, 'mouse', 0);
    expect(hold.progress(0)).toBe(0);
    expect(hold.progress(MORPH_FEEL.fillStartMs - 1)).toBe(0);
  });

  it('is strictly between 0 and 1 mid-hold (after fillStartMs, before holdMs)', () => {
    const hold = createMorphHold();
    hold.arm(ORIGIN, 'mouse', 0);
    const mid = (MORPH_FEEL.fillStartMs + MORPH_FEEL.holdMs) / 2;
    const p = hold.progress(mid);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });

  it('is 1 once the hold has fired', () => {
    const hold = createMorphHold();
    hold.arm(ORIGIN, 'mouse', 0);
    hold.update(ORIGIN, MORPH_FEEL.holdMs);
    expect(hold.progress(MORPH_FEEL.holdMs)).toBe(1);
    expect(hold.progress(MORPH_FEEL.holdMs + 10000)).toBe(1);
  });

  it('is 0 when never armed', () => {
    const hold = createMorphHold();
    expect(hold.progress(1000)).toBe(0);
  });
});
