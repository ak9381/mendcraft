import { describe, expect, it } from 'vitest';
import { createOneEuroFilter, paramsFromSmoothing } from '../src/input/oneEuro';
import { createClickCooldown } from '../src/input/clickCooldown';
import { parseListenPhrase } from '../src/input/listening';
import { CALIBRATION_TARGETS, reachFromTargetHits, targetHit, TARGET_HOLD_MS } from '../src/setup/targets';
import { defaultSetup } from '../src/setup/setupState';

describe('One-Euro filter', () => {
  it('passes the first sample through and damps a noisy hold', () => {
    const f = createOneEuroFilter({ minCutoff: 0.8, beta: 3, dCutoff: 1 });
    const first = f.filter(0.5, 0.5, 0);
    expect(first.x).toBeCloseTo(0.5, 5);
    expect(first.y).toBeCloseTo(0.5, 5);
    // Jitter around the hold. The filtered path should stay closer to the
    // centre than the raw spikes.
    let maxRaw = 0;
    let maxFilt = 0;
    let x = 0.5;
    let y = 0.5;
    for (let i = 1; i <= 40; i++) {
      const rawX = 0.5 + (i % 2 === 0 ? 0.02 : -0.02);
      const rawY = 0.5 + (i % 3 === 0 ? 0.015 : -0.015);
      maxRaw = Math.max(maxRaw, Math.hypot(rawX - 0.5, rawY - 0.5));
      const out = f.filter(rawX, rawY, i * 16);
      x = out.x;
      y = out.y;
      maxFilt = Math.max(maxFilt, Math.hypot(x - 0.5, y - 0.5));
    }
    expect(maxFilt).toBeLessThan(maxRaw);
    expect(maxFilt).toBeLessThan(0.02);
  });

  it('tracks a fast move without freezing on the start point', () => {
    const f = createOneEuroFilter({ minCutoff: 1, beta: 4, dCutoff: 1 });
    f.filter(0.1, 0.1, 0);
    let out = { x: 0.1, y: 0.1 };
    for (let i = 1; i <= 12; i++) {
      out = f.filter(0.1 + i * 0.06, 0.1, i * 16);
    }
    expect(out.x).toBeGreaterThan(0.55);
  });

  it('maps more smoothing to a lower still cutoff', () => {
    expect(paramsFromSmoothing(0.8).minCutoff).toBeLessThan(paramsFromSmoothing(0.3).minCutoff);
  });

  it('reset clears history so the next sample is raw', () => {
    const f = createOneEuroFilter();
    f.filter(0.1, 0.1, 0);
    f.filter(0.9, 0.9, 16);
    f.reset();
    const next = f.filter(0.2, 0.3, 100);
    expect(next.x).toBeCloseTo(0.2, 5);
    expect(next.y).toBeCloseTo(0.3, 5);
  });
});

describe('click cooldown', () => {
  it('blocks a second click inside the window and allows one after', () => {
    const c = createClickCooldown(500);
    expect(c.ready(0)).toBe(true);
    c.arm(1000);
    expect(c.ready(1499)).toBe(false);
    expect(c.ready(1500)).toBe(true);
    c.reset();
    expect(c.ready(1501)).toBe(true);
  });
});

describe('Mendcraft sleep / wake', () => {
  it('recognises the exact sleep and wake phrases, with punctuation', () => {
    expect(parseListenPhrase('Mendcraft sleep')).toBe('sleep');
    expect(parseListenPhrase('mendcraft, sleep!')).toBe('sleep');
    expect(parseListenPhrase('Mendcraft wake')).toBe('wake');
    expect(parseListenPhrase('Mendcraft wake up')).toBe('wake');
  });

  it('does not treat gesture rest phrases or ordinary speech as sleep/wake', () => {
    expect(parseListenPhrase('sleep')).toBeNull();
    expect(parseListenPhrase('wake up')).toBeNull();
    expect(parseListenPhrase('rest')).toBeNull();
    expect(parseListenPhrase('make the kitchen bigger')).toBeNull();
  });
});

describe('five-point calibration targets', () => {
  it('has five large-layout points: four corners and the centre', () => {
    expect(CALIBRATION_TARGETS).toHaveLength(5);
    const ids = CALIBRATION_TARGETS.map((t) => t.id);
    expect(ids).toEqual(['tl', 'tr', 'c', 'bl', 'br']);
    const centre = CALIBRATION_TARGETS.find((t) => t.id === 'c')!;
    expect(centre.nx).toBeCloseTo(0.5);
    expect(centre.ny).toBeCloseTo(0.5);
    expect(TARGET_HOLD_MS).toBeGreaterThanOrEqual(500);
  });

  it('hits when the cursor is on a target and misses when it is far', () => {
    const tl = CALIBRATION_TARGETS[0];
    expect(targetHit({ x: tl.nx, y: tl.ny }, tl)).toBe(true);
    expect(targetHit({ x: tl.nx + 0.05, y: tl.ny + 0.04 }, tl)).toBe(true);
    expect(targetHit({ x: 0.9, y: 0.9 }, tl)).toBe(false);
  });

  it('builds a reach box from the five holds', () => {
    const hits = CALIBRATION_TARGETS.map((t) => ({ x: t.nx, y: t.ny }));
    const box = reachFromTargetHits(hits);
    expect(box.x0).toBeLessThan(0.2);
    expect(box.x1).toBeGreaterThan(0.8);
    expect(box.y0).toBeLessThan(0.25);
    expect(box.y1).toBeGreaterThan(0.75);
  });
});

describe('dwell is first-class by default', () => {
  it('turns hover-and-wait on for a fresh setup', () => {
    expect(defaultSetup().dwellClick).toBe(true);
  });
});
