import { describe, it, expect } from 'vitest';
import {
  solveSimilarity,
  applyTransform,
  span,
  midpoint,
  createTwoHandGesture,
  type Vec,
} from '../src/input/twoHandTransform';

// Helpers: build collinear horizontal pinch points so scale / pan / anchor are
// exact and trivially checkable (the no-rotation least-squares pins the
// midpoint; on a line every point is pinned proportionally).
const P = (x: number, y = 0): Vec => ({ x, y });
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('solveSimilarity (pure math)', () => {
  it('pulls apart symmetrically -> scale up, midpoint anchored', () => {
    // start fingers at 40 and 60 (mid 50, span 20); pull to 30 and 70 (span 40)
    const t = solveSimilarity(P(40), P(60), P(30), P(70), { rotate: false });
    expect(near(t.scale, 2)).toBe(true);
    expect(near(t.rotation, 0)).toBe(true);
    // the world point under the midpoint stays under the midpoint
    const mStart = midpoint(P(40), P(60));
    const mNow = applyTransform(t, mStart);
    expect(near(mNow.x, 50)).toBe(true);
    expect(near(mNow.y, 0)).toBe(true);
  });

  it('brings fingers together -> scale down', () => {
    const t = solveSimilarity(P(20), P(80), P(35), P(65), { rotate: false });
    expect(near(t.scale, 0.5)).toBe(true);
  });

  it('translates both hands equally -> pure pan, scale 1', () => {
    const t = solveSimilarity(P(40), P(60), P(55), P(75), { rotate: false });
    expect(near(t.scale, 1)).toBe(true);
    const moved = applyTransform(t, P(40));
    expect(near(moved.x, 55)).toBe(true);
  });

  it('one hand still, the other moves (collinear) -> scale about the still hand', () => {
    // left hand fixed at 40; right moves 60 -> 80. Still point must stay put.
    const t = solveSimilarity(P(40), P(60), P(40), P(80), { rotate: false });
    const still = applyTransform(t, P(40));
    expect(near(still.x, 40, 1e-9)).toBe(true);
  });

  it('is order-independent: swapping the two hands gives the same transform', () => {
    const a = solveSimilarity(P(40), P(60), P(30), P(70), { rotate: false });
    const b = solveSimilarity(P(60), P(40), P(70), P(30), { rotate: false });
    expect(near(a.scale, b.scale)).toBe(true);
    expect(near(a.tx, b.tx)).toBe(true);
    expect(near(a.ty, b.ty)).toBe(true);
  });

  it('rotation OFF by default: rotating the finger line does not rotate', () => {
    // same span, rotated 90deg: horizontal -> vertical
    const t = solveSimilarity(P(40, 0), P(60, 0), { x: 50, y: -10 }, { x: 50, y: 10 }, {});
    expect(near(t.scale, 1)).toBe(true);
    expect(near(t.rotation, 0)).toBe(true);
  });

  it('rotation ON: maps both start points exactly onto the current points', () => {
    const p0 = P(40, 0), q0 = P(60, 0);
    const p1 = { x: 50, y: -10 }, q1 = { x: 50, y: 10 };
    const t = solveSimilarity(p0, q0, p1, q1, { rotate: true });
    const mp = applyTransform(t, p0), mq = applyTransform(t, q0);
    expect(near(mp.x, p1.x, 1e-9) && near(mp.y, p1.y, 1e-9)).toBe(true);
    expect(near(mq.x, q1.x, 1e-9) && near(mq.y, q1.y, 1e-9)).toBe(true);
    expect(near(Math.abs(t.rotation), Math.PI / 2, 1e-9)).toBe(true);
  });

  it('degenerate zero start span -> identity (never divides by zero)', () => {
    const t = solveSimilarity(P(50), P(50), P(40), P(70), {});
    expect(Number.isFinite(t.scale)).toBe(true);
    expect(near(t.scale, 1)).toBe(true);
  });

  it('span and midpoint helpers', () => {
    expect(span(P(10), P(40))).toBe(30);
    expect(midpoint(P(10), P(40))).toEqual({ x: 25, y: 0 });
  });
});

describe('createTwoHandGesture (controller)', () => {
  it('starts on the first frame with both hands, emitting identity', () => {
    const g = createTwoHandGesture();
    const r = g.update({ p: P(40), q: P(60), now: 0 });
    expect(r.started).toBe(true);
    expect(r.active).toBe(true);
    expect(near(r.transform.scale, 1)).toBe(true);
  });

  it('pull apart beyond the dead zone -> scale up', () => {
    const g = createTwoHandGesture({ smoothing: 0 });
    g.update({ p: P(40), q: P(60), now: 0 });
    const r = g.update({ p: P(20), q: P(80), now: 16 });
    expect(r.transform.scale).toBeGreaterThan(1.5);
  });

  it('tremor inside the dead zone produces no change (identity held)', () => {
    const g = createTwoHandGesture({ smoothing: 0, scaleDeadZone: 0.05, transDeadZone: 6 });
    g.update({ p: P(40), q: P(60), now: 0 });
    // jitter the fingers by <1px; span barely changes
    const r = g.update({ p: P(40.3, 0.2), q: P(59.6, -0.3), now: 16 });
    expect(near(r.transform.scale, 1, 1e-9)).toBe(true);
    expect(near(r.transform.tx, 0, 1e-9)).toBe(true);
  });

  it('clamps the cumulative scale to maxScale', () => {
    const g = createTwoHandGesture({ smoothing: 0, maxScale: 3 });
    g.update({ p: P(49), q: P(51), now: 0 }); // tiny start span
    const r = g.update({ p: P(0), q: P(100), now: 16 }); // huge -> would be 50x
    expect(r.transform.scale).toBeLessThanOrEqual(3 + 1e-9);
  });

  it('clamps the cumulative scale to minScale', () => {
    const g = createTwoHandGesture({ smoothing: 0, minScale: 0.5 });
    g.update({ p: P(0), q: P(100), now: 0 });
    const r = g.update({ p: P(49), q: P(51), now: 16 });
    expect(r.transform.scale).toBeGreaterThanOrEqual(0.5 - 1e-9);
  });

  it('one hand briefly drops within the grace window -> stays active, holds last stable', () => {
    const g = createTwoHandGesture({ smoothing: 0, graceMs: 150 });
    g.update({ p: P(40), q: P(60), now: 0 });
    const moved = g.update({ p: P(20), q: P(80), now: 16 });
    const dropped = g.update({ p: P(20), q: null, now: 100 }); // right hand gone 84ms
    expect(dropped.active).toBe(true);
    expect(dropped.ended).toBe(false);
    expect(near(dropped.transform.scale, moved.transform.scale)).toBe(true);
  });

  it('a hand leaving past the grace window ends the gesture and keeps the last stable transform (no snap back)', () => {
    const g = createTwoHandGesture({ smoothing: 0, graceMs: 150 });
    g.update({ p: P(40), q: P(60), now: 0 });
    const moved = g.update({ p: P(20), q: P(80), now: 16 });
    const gone = g.update({ p: P(20), q: null, now: 400 }); // 384ms > grace
    expect(gone.active).toBe(false);
    expect(gone.ended).toBe(true);
    // last stable transform, NOT reset to identity
    expect(near(gone.transform.scale, moved.transform.scale)).toBe(true);
  });

  it('a very slow drag (many sub-pixel steps) still converges to the target scale', () => {
    const g = createTwoHandGesture({ smoothing: 0.3, scaleDeadZone: 0.02, transDeadZone: 2 });
    g.update({ p: P(40), q: P(60), now: 0 });
    let r = g.update({ p: P(40), q: P(60), now: 16 });
    // creep the right hand out one pixel at a time to span 120 (scale 6)
    for (let i = 1; i <= 60; i++) {
      r = g.update({ p: P(40 - i), q: P(60 + i), now: 16 + i * 16 });
    }
    expect(r.transform.scale).toBeGreaterThan(5);
  });

  it('a very fast jump is clamped and smoothed, never NaN', () => {
    const g = createTwoHandGesture({ smoothing: 0.5, maxScale: 8 });
    g.update({ p: P(49), q: P(51), now: 0 });
    const r = g.update({ p: P(0), q: P(1000), now: 16 });
    expect(Number.isFinite(r.transform.scale)).toBe(true);
    expect(r.transform.scale).toBeLessThanOrEqual(8 + 1e-9);
  });

  it('reset clears the gesture so the next both-hands frame starts fresh', () => {
    const g = createTwoHandGesture({ smoothing: 0 });
    g.update({ p: P(40), q: P(60), now: 0 });
    g.update({ p: P(20), q: P(80), now: 16 });
    g.reset();
    const r = g.update({ p: P(40), q: P(60), now: 32 });
    expect(r.started).toBe(true);
    expect(near(r.transform.scale, 1)).toBe(true);
  });
});
