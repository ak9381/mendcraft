import { describe, expect, it } from 'vitest';
import { DEFAULT_PINCH_ON, DEFAULT_PINCH_OFF } from '../../src/input/handLogic';
import {
  createPinchBaseline,
  createPinchTwiceSession,
  PINCH_TWICE_MS,
  thresholdsFromMinOpen,
} from '../../src/input/pinchBaseline';

describe('thresholdsFromMinOpen (trace units)', () => {
  it('places enter between a real close (~0.18) and a real open (~0.90)', () => {
    // Akash's Chrome trace on ed616aa: p1=0.18, p5=0.20, p50=0.50, max=1.26.
    const { pinchOn, pinchOff } = thresholdsFromMinOpen(0.18, 0.90);
    expect(pinchOn).toBeGreaterThan(0.18);
    expect(pinchOn).toBeLessThanOrEqual(0.40);
    expect(pinchOff).toBeGreaterThan(pinchOn);
    expect(0.20).toBeLessThan(pinchOn); // the measured close still enters
    expect(0.18).toBeLessThan(pinchOn);
    // A relaxed mid-open hand at ~0.50 should not sit under enter once clamped.
    expect(pinchOn).toBeLessThan(0.50);
    expect(pinchOff).toBeLessThan(0.60);
  });

  it('defaults sit in the same units as the trace (not the old 0.045 band)', () => {
    expect(DEFAULT_PINCH_ON).toBeCloseTo(0.20);
    expect(DEFAULT_PINCH_OFF).toBeCloseTo(0.30);
    expect(DEFAULT_PINCH_OFF).toBeGreaterThan(DEFAULT_PINCH_ON);
  });
});

describe('createPinchBaseline', () => {
  it('stays on defaults until it has seen a close and an open', () => {
    const b = createPinchBaseline({ windowMs: 2000, minFrames: 10, minSpan: 0.15 });
    for (let i = 0; i < 20; i++) b.push(0.55, i * 33);
    expect(b.snapshot().ready).toBe(false);
    expect(b.snapshot().pinchOn).toBe(DEFAULT_PINCH_ON);
  });

  it('refines enter from a rolling min/open once the span is wide enough', () => {
    const b = createPinchBaseline({ windowMs: 4000, minFrames: 20, minSpan: 0.15 });
    let t = 0;
    for (let i = 0; i < 15; i++) { t += 33; b.push(0.85, t); }
    for (let i = 0; i < 10; i++) { t += 33; b.push(0.18, t); }
    for (let i = 0; i < 15; i++) { t += 33; b.push(0.85, t); }
    const s = b.snapshot();
    expect(s.ready).toBe(true);
    expect(s.pinchOn).toBeGreaterThan(0.16);
    expect(s.pinchOn).toBeLessThanOrEqual(0.40);
    expect(s.pinchOff).toBeGreaterThan(s.pinchOn);
  });
});

describe('createPinchTwiceSession', () => {
  it('finishes after two closes, or after 3 seconds with enough samples', () => {
    const s = createPinchTwiceSession();
    s.start(0);
    let now = 0;
    const step = (r: number, n = 1) => {
      let last = { elapsed: 0, count: 0, done: false, ready: false };
      for (let i = 0; i < n; i++) { now += 50; last = s.push(r, now); }
      return last;
    };
    expect(step(0.8, 4).count).toBe(0);
    expect(step(0.18, 3).count).toBe(1);
    expect(step(0.8, 3).count).toBe(1);
    const second = step(0.18, 3);
    expect(second.count).toBe(2);
    const open = step(0.8, 2);
    expect(open.done).toBe(true);
    const band = s.result();
    expect(band.pinchOn).toBeGreaterThan(0.16);
    expect(band.pinchOff).toBeGreaterThan(band.pinchOn);
  });

  it('times out at 3 seconds', () => {
    const s = createPinchTwiceSession();
    s.start(0);
    s.push(0.8, 0);
    const last = s.push(0.8, PINCH_TWICE_MS);
    expect(last.done).toBe(true);
  });
});
