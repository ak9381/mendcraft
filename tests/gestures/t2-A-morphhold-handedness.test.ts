// Round 2: morph pinch-hold — handedness and slow-drift-vs-fast-jerk tests
// against the real pure classifier (src/canvas/morphHold.ts). createMorphHold
// already has a thorough suite at tests/canvas/morphHold.test.ts; this file
// adds the two angles the round-2 checklist flagged as still unverified
// (A4-030 left/right-hand parity, A4-031 slow drift vs fast jerk) plus two
// quick confirmations (A4-023 tap, A4-024 slop-cancel) of rows the checklist
// listed as GAP-UNTESTED "per agent" even though morphHold.test.ts already
// covers their exact scenario.
import { describe, expect, it } from 'vitest';
import { createMorphHold } from '../../src/canvas/morphHold';

describe('A4-023 release before holdMs is a tap, never fires (confirms existing coverage)', () => {
  it('releasing at 600ms (holdMs=900) returns tap and leaves fired false', () => {
    const hold = createMorphHold();
    hold.arm({ x: 0, y: 0 }, 'hand', 0);
    expect(hold.update({ x: 0, y: 0 }, 500)).toBe('none');
    expect(hold.release(600)).toBe('tap');
    expect(hold.fired).toBe(false);
  });
});

describe('A4-024 movement past slop mid-hold cancels (confirms existing coverage)', () => {
  it('a hand drifting 29px (> 28px hand slop) mid-hold cancels before the fire', () => {
    const hold = createMorphHold();
    hold.arm({ x: 100, y: 100 }, 'hand', 0);
    expect(hold.update({ x: 100, y: 100 }, 400)).toBe('none');
    expect(hold.update({ x: 129, y: 100 }, 500)).toBe('cancelled');
    expect(hold.armed).toBe(false);
  });
});

describe('A4-030 left hand vs right hand do the same move/hold identically', () => {
  // morphHold has no handedness concept at all — arm() takes a pointer
  // *type* ('hand'|'mouse'|'touch'), not a left/right side. A left-hand
  // pinch at mirrored on-screen coordinates must classify exactly the same
  // as a right-hand pinch at its own coordinates: same slop, same hold time.
  it('two independent holds, one at a "left hand" origin and one at a mirrored "right hand" origin, fire at the same elapsed time', () => {
    const left = createMorphHold();
    const right = createMorphHold();
    const leftOrigin = { x: 40, y: 300 };   // reaching with the left hand, screen-left
    const rightOrigin = { x: 760, y: 300 }; // mirrored reach with the right hand, screen-right

    left.arm(leftOrigin, 'hand', 0);
    right.arm(rightOrigin, 'hand', 0);

    // Identical small within-slop wobble on both sides.
    expect(left.update({ x: leftOrigin.x + 10, y: leftOrigin.y }, 450)).toBe('none');
    expect(right.update({ x: rightOrigin.x - 10, y: rightOrigin.y }, 450)).toBe('none');

    expect(left.update(leftOrigin, 900)).toBe('fired');
    expect(right.update(rightOrigin, 900)).toBe('fired');
    expect(left.fired).toBe(true);
    expect(right.fired).toBe(true);
  });

  it('the same magnitude of drift cancels both sides equally — no hand gets a bigger allowance', () => {
    const left = createMorphHold();
    const right = createMorphHold();
    const leftOrigin = { x: 40, y: 300 };
    const rightOrigin = { x: 760, y: 300 };
    left.arm(leftOrigin, 'hand', 0);
    right.arm(rightOrigin, 'hand', 0);
    // +29px on the left, -29px on the right (mirrored direction, same magnitude).
    expect(left.update({ x: leftOrigin.x + 29, y: leftOrigin.y }, 300)).toBe('cancelled');
    expect(right.update({ x: rightOrigin.x - 29, y: rightOrigin.y }, 300)).toBe('cancelled');
  });
});

describe('A4-031 slow natural drift vs a fast jerk during a hold', () => {
  // morphHold's only discriminator is total displacement from the origin
  // (slop), checked on every update() call — there is no velocity or time
  // window involved. So a slow wobble that happens to cross the slop radius
  // cancels exactly like a fast jerk that crosses the same radius; only the
  // DISTANCE matters, not how quickly it was covered.
  it('a fast jerk that crosses slop in 20ms cancels', () => {
    const hold = createMorphHold();
    hold.arm({ x: 100, y: 100 }, 'hand', 0);
    expect(hold.update({ x: 140, y: 100 }, 20)).toBe('cancelled'); // 40px in 20ms, well past 28px slop
  });

  it('a slow drift that crosses the same slop distance over 800ms also cancels — identical outcome, no velocity discrimination', () => {
    const hold = createMorphHold();
    hold.arm({ x: 100, y: 100 }, 'hand', 0);
    // Several small steps, each individually tiny, but the cumulative
    // distance from the ORIGIN (not step-to-step) is what's checked.
    expect(hold.update({ x: 110, y: 100 }, 200)).toBe('none');
    expect(hold.update({ x: 120, y: 100 }, 400)).toBe('none');
    expect(hold.update({ x: 140, y: 100 }, 800)).toBe('cancelled'); // 40px from origin, same as the fast jerk
  });

  it('a slow drift that stays within slop the whole 900ms does NOT cancel and still fires — confirms the natural-wobble tolerance', () => {
    const hold = createMorphHold();
    hold.arm({ x: 100, y: 100 }, 'hand', 0);
    expect(hold.update({ x: 105, y: 100 }, 300)).toBe('none');
    expect(hold.update({ x: 110, y: 100 }, 600)).toBe('none'); // 10px, well under 28px slop
    expect(hold.update({ x: 110, y: 100 }, 900)).toBe('fired');
  });
});
