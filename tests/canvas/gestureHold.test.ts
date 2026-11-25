// The 2-second hold engine for the fixed button gestures (fake clock).
import { describe, expect, it } from 'vitest';
import { createHoldEngine, gestureKeyOf, GESTURE_HOLD, type GestureHand } from '../../src/canvas/gestureHold';
import type { HandShape, HandSide } from '../../src/canvas/handShape';

const hand = (shape: HandShape, side: HandSide, x = side === 'R' ? 0.7 : 0.3, y = 0.6): GestureHand => ({
  shape, hand: side, palm: { x, y }, scale: 0.1,
});

/** Feed the same hands every 33 ms from t0 to t1; returns every fired key. */
function hold(engine: ReturnType<typeof createHoldEngine>, hands: (t: number) => GestureHand[], t0: number, t1: number, facing: boolean | null = true) {
  const fired: string[] = [];
  let last = engine.state;
  for (let t = t0; t <= t1; t += 33) {
    last = engine.update({ hands: hands(t), facing, now: t });
    if (last.fired) fired.push(last.fired);
  }
  return { fired, last };
}

describe('gestureKeyOf', () => {
  it('one hand in a fixed shape → side:shape', () => {
    expect(gestureKeyOf([hand('thumbsUp', 'R')])).toBe('R:thumbsUp');
    expect(gestureKeyOf([hand('peace', 'L'), hand('open', 'R')])).toBe('L:peace');
  });
  it('both hands, same shape → 2:shape', () => {
    expect(gestureKeyOf([hand('three', 'L'), hand('three', 'R')])).toBe('2:three');
  });
  it('two different fixed shapes, or two "right" hands → ambiguous (null)', () => {
    expect(gestureKeyOf([hand('one', 'L'), hand('peace', 'R')])).toBeNull();
    expect(gestureKeyOf([hand('one', 'R'), hand('one', 'R')])).toBeNull();
  });
  it('open palm, fist and other are never gestures', () => {
    expect(gestureKeyOf([hand('open', 'R'), hand('fist', 'L')])).toBeNull();
    expect(gestureKeyOf([hand('other', 'R')])).toBeNull();
  });
});

describe('createHoldEngine', () => {
  it('fires once after 2 s held still, with progress rising to it', () => {
    const e = createHoldEngine();
    const progress: number[] = [];
    let fired: string | null = null;
    let firedAt = -1;
    for (let t = 0; t <= 2500; t += 33) {
      const s = e.update({ hands: [hand('thumbsUp', 'R')], facing: true, now: t });
      progress.push(s.progress);
      if (s.fired) { fired = s.fired; firedAt = t; }
    }
    expect(fired).toBe('R:thumbsUp');
    expect(firedAt).toBeGreaterThanOrEqual(GESTURE_HOLD.holdMs);
    expect(firedAt).toBeLessThan(GESTURE_HOLD.holdMs + 40);
    const before = progress.slice(0, Math.floor(firedAt / 33));
    expect(before.every((p, i) => i === 0 || p >= before[i - 1])).toBe(true);
    expect(Math.max(...before)).toBeGreaterThan(0.95);
  });

  it('does not fire before 2 s', () => {
    const e = createHoldEngine();
    const { fired, last } = hold(e, () => [hand('peace', 'L')], 0, 1900);
    expect(fired).toEqual([]);
    expect(last.key).toBe('L:peace');
    expect(last.progress).toBeGreaterThan(0.9);
  });

  it('one fire per hold: keeping the thumb up never fires again', () => {
    const e = createHoldEngine();
    const { fired } = hold(e, () => [hand('thumbsUp', 'R')], 0, 7000);
    expect(fired).toEqual(['R:thumbsUp']);
  });

  it('re-fires only after a release (no fixed shape for releaseMs)', () => {
    const e = createHoldEngine();
    expect(hold(e, () => [hand('thumbsUp', 'R')], 0, 2100).fired).toEqual(['R:thumbsUp']);
    // A brief drop (shorter than releaseMs) is not a release.
    hold(e, () => [hand('open', 'R')], 2133, 2133 + 150);
    expect(hold(e, () => [hand('thumbsUp', 'R')], 2300, 4500).fired).toEqual([]);
    // A real release, then a fresh 2 s hold fires again.
    hold(e, () => [hand('open', 'R')], 4533, 5000);
    expect(hold(e, () => [hand('thumbsUp', 'R')], 5033, 7200).fired).toEqual(['R:thumbsUp']);
  });

  it('after a two-hand fire, keeping one thumb up does not fire the one-hand gesture', () => {
    const e = createHoldEngine();
    expect(hold(e, () => [hand('thumbsUp', 'L'), hand('thumbsUp', 'R')], 0, 2100).fired).toEqual(['2:thumbsUp']);
    expect(hold(e, () => [hand('thumbsUp', 'R')], 2133, 5000).fired).toEqual([]);
  });

  it('changing shape cancels (progress back to 0) and the new shape starts its own 2 s', () => {
    const e = createHoldEngine();
    hold(e, () => [hand('one', 'R')], 0, 1500);
    const r = hold(e, () => [hand('peace', 'R')], 1533, 3400);
    expect(r.fired).toEqual([]); // peace began ~1.7 s after 1533 plus grace — not yet 2 s
    expect(hold(e, () => [hand('peace', 'R')], 3433, 3800).fired).toEqual(['R:peace']);
  });

  it('a one-frame misread inside the grace does not cancel', () => {
    const e = createHoldEngine();
    const { fired } = hold(e, (t) => [hand(t === 990 ? 'other' : 'thumbsDown', 'L')], 0, 2100);
    expect(fired).toEqual(['L:thumbsDown']);
  });

  it('a lost hand (longer than the grace) cancels', () => {
    const e = createHoldEngine();
    hold(e, () => [hand('thumbsUp', 'R')], 0, 1500);
    const lost = hold(e, () => [], 1533, 1800);
    expect(lost.last.progress).toBe(0);
    expect(lost.last.key).toBeNull();
    expect(hold(e, () => [hand('thumbsUp', 'R')], 1833, 3500).fired).toEqual([]);
  });

  it('motion cancels: a hand drifting across the frame never fires', () => {
    const e = createHoldEngine();
    // 0.3 hand scales per 100 ms → 3 scales/s: well over the speed limit.
    const { fired } = hold(e, (t) => [hand('thumbsUp', 'R', 0.5 + t * 0.0003)], 0, 5000);
    expect(fired).toEqual([]);
  });

  it('a slow drift past maxDrift restarts the hold', () => {
    const e = createHoldEngine();
    // 0.05 hand scales per second: slow, but 2 s × … stays under drift; 0.5/s crosses it.
    const ok = hold(createHoldEngine(), (t) => [hand('one', 'R', 0.7 + (t / 1000) * 0.005)], 0, 2100);
    expect(ok.fired).toEqual(['R:one']);
    const { fired } = hold(e, (t) => [hand('one', 'R', 0.7 + (t / 1000) * 0.05)], 0, 2600);
    expect(fired).toEqual([]);
  });

  it('small jitter is still', () => {
    const e = createHoldEngine();
    const { fired } = hold(e, (t) => [hand('three', 'L', 0.3 + Math.sin(t) * 0.002, 0.6 + Math.cos(t) * 0.002)], 0, 2100);
    expect(fired).toEqual(['L:three']);
  });

  it('not facing (false) cancels at once; unknown (null) is allowed', () => {
    const e = createHoldEngine();
    hold(e, () => [hand('thumbsUp', 'R')], 0, 1500);
    const away = e.update({ hands: [hand('thumbsUp', 'R')], facing: false, now: 1533 });
    expect(away).toMatchObject({ key: null, progress: 0, fired: null });
    expect(hold(e, () => [hand('thumbsUp', 'R')], 1566, 3400).fired).toEqual([]);
    expect(hold(createHoldEngine(), () => [hand('thumbsUp', 'R')], 0, 2100, null).fired).toEqual(['R:thumbsUp']);
    expect(hold(createHoldEngine(), () => [hand('thumbsUp', 'R')], 0, 5000, false).fired).toEqual([]);
  });

  it('blocked (a fist grab, a capture step) holds nothing', () => {
    const e = createHoldEngine();
    let fired = 0;
    for (let t = 0; t < 3000; t += 33) if (e.update({ hands: [hand('one', 'R')], facing: true, now: t, blocked: true }).fired) fired++;
    expect(fired).toBe(0);
  });

  it('two-hand gestures need both hands the same shape; the second hand joining restarts the 2 s', () => {
    const e = createHoldEngine();
    hold(e, () => [hand('peace', 'L')], 0, 1000); // left alone first
    const both = hold(e, () => [hand('peace', 'L'), hand('peace', 'R')], 1033, 2900);
    expect(both.fired).toEqual([]); // not yet 2 s since BOTH formed
    expect(both.last.key).toBe('2:peace');
    expect(hold(e, () => [hand('peace', 'L'), hand('peace', 'R')], 2933, 3400).fired).toEqual(['2:peace']);
    // Mixed shapes never fire anything.
    expect(hold(createHoldEngine(), () => [hand('peace', 'L'), hand('three', 'R')], 0, 4000).fired).toEqual([]);
  });

  it('reset clears a running hold and the spent latch', () => {
    const e = createHoldEngine();
    hold(e, () => [hand('thumbsUp', 'R')], 0, 2100);
    e.reset();
    expect(hold(e, () => [hand('thumbsUp', 'R')], 2133, 4200).fired).toEqual(['R:thumbsUp']);
  });

  it('two-hand stillness follows each HAND, not its slot in the frame array (the tracker may swap them)', () => {
    const e = createHoldEngine();
    const L = hand('thumbsUp', 'L', 0.3), R = hand('thumbsUp', 'R', 0.7);
    // The array order flips every frame; the hands themselves never move.
    const { fired } = hold(e, (t) => (Math.round(t / 33) % 2 ? [L, R] : [R, L]), 0, 2100);
    expect(fired).toEqual(['2:thumbsUp']);
  });
});
