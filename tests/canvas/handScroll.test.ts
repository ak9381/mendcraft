import { describe, it, expect } from 'vitest';
import { createDragVelocity, createMomentum, scrollableAncestor, pickPalmScroller, palmCentroid, createCriticalSpring, createPalmScroll, PALM_GAIN, PALM_HOLD_MS, PALM_INTENT_MS, PALM_STILL_MS, PALM_DEADZONE_PX } from '../../src/canvas/handScroll';

// Node-env fake (the suite doesn't use jsdom): just the layout props + the
// getComputedStyle path that scrollableAncestor reads.
function fakeEl(overflowY: string, scrollH: number, clientH: number): any {
  const el: any = {
    overflowY, scrollHeight: scrollH, clientHeight: clientH,
    scrollWidth: 0, clientWidth: 0, parentElement: null,
  };
  el.ownerDocument = { defaultView: { getComputedStyle: (e: any) => ({ overflowY: e.overflowY, overflowX: 'visible' }) } };
  return el;
}
function overflowing(overflowY: string, scrollH: number, clientH: number): any {
  return fakeEl(overflowY, scrollH, clientH);
}

describe('handScroll — drag velocity + momentum fling (A2-025 / C156)', () => {
  describe('createDragVelocity', () => {
    it('measures a steady drag rate in px/ms over the recent window', () => {
      const v = createDragVelocity({ windowMs: 100 });
      v.push(0, 0, 0);
      v.push(0, 10, 10);
      v.push(0, 20, 20);
      v.push(0, 30, 30); // 30px over 30ms => 1 px/ms downward
      const { vy } = v.velocity(30);
      expect(vy).toBeCloseTo(1, 1);
    });

    it('drops samples older than the window so a pause before release flings slowly', () => {
      const v = createDragVelocity({ windowMs: 50 });
      v.push(0, 0, 0);
      v.push(0, 100, 10); // fast early move, but it ages out...
      v.push(0, 105, 200); // ...only this + the window remains near release
      expect(Math.abs(v.velocity(200).vy)).toBeLessThan(0.5);
    });

    it('reset clears the samples (no velocity carried into the next gesture)', () => {
      const v = createDragVelocity();
      v.push(0, 0, 0);
      v.push(0, 50, 10);
      v.reset();
      expect(v.velocity(10)).toEqual({ vx: 0, vy: 0 });
    });
  });

  describe('createMomentum', () => {
    it('decays the fling and emits shrinking deltas until it stops', () => {
      const m = createMomentum({ friction: 0.9, minSpeed: 0.01 });
      m.start(0, 1); // 1 px/ms downward
      expect(m.active).toBe(true);
      const first = m.tick(16);
      const second = m.tick(16);
      expect(first.dy).toBeGreaterThan(0);
      expect(second.dy).toBeGreaterThan(0);
      expect(second.dy).toBeLessThan(first.dy); // friction shrinks each tick
    });

    it('goes inactive once speed falls under minSpeed', () => {
      const m = createMomentum({ friction: 0.5, minSpeed: 0.1 });
      m.start(0, 1);
      let guard = 0;
      while (m.active && guard++ < 100) m.tick(16);
      expect(m.active).toBe(false);
      expect(m.tick(16)).toEqual({ dx: 0, dy: 0 });
    });

    it('stop() halts a fling immediately (e.g. a new pinch grabs the list)', () => {
      const m = createMomentum();
      m.start(0, 2);
      m.stop();
      expect(m.active).toBe(false);
      expect(m.tick(16)).toEqual({ dx: 0, dy: 0 });
    });
  });

  describe('scrollableAncestor', () => {
    it('finds the nearest overflowing ancestor of the pinch target', () => {
      const list = overflowing('auto', 500, 100);
      const row = overflowing('visible', 0, 0); // a button that itself doesn't scroll
      row.parentElement = list;
      const hit = scrollableAncestor(row);
      expect(hit?.el).toBe(list);
      expect(hit?.y).toBe(true);
    });

    it('returns null when nothing in the chain overflows (so taps stay taps)', () => {
      const box = overflowing('auto', 100, 100); // content fits — not scrollable
      const row = overflowing('visible', 0, 0);
      row.parentElement = box;
      expect(scrollableAncestor(row)).toBeNull();
    });

    it('ignores overflowing content whose overflow style forbids scrolling', () => {
      const clipped = overflowing('hidden', 500, 100);
      expect(scrollableAncestor(clipped)).toBeNull();
    });
  });

  describe('pickPalmScroller', () => {
    it('prefers the nearest overflow-y ancestor under the cursor', () => {
      const list = overflowing('auto', 800, 200);
      const row = overflowing('visible', 0, 0);
      row.parentElement = list;
      expect(pickPalmScroller(row, [])).toBe(list);
    });

    it('falls back to the first provided vertical scroller (review / AI / term)', () => {
      const review = overflowing('auto', 900, 300);
      const row = overflowing('visible', 0, 0);
      expect(pickPalmScroller(row, [review])).toBe(review);
    });

    it('skips a fallback that cannot scroll and returns null when nothing qualifies', () => {
      const fitted = overflowing('auto', 100, 100);
      const row = overflowing('visible', 0, 0);
      expect(pickPalmScroller(row, [fitted])).toBeNull();
    });
  });

  describe('palmCentroid', () => {
    it('is the midpoint of wrist (0) and middle MCP (9)', () => {
      const h = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
      h[0] = { x: 0, y: 0 };
      h[9] = { x: 2, y: 4 };
      expect(palmCentroid(h)).toEqual({ x: 1, y: 2 });
    });
  });
});

describe('palm scroll smoothness', () => {
  it('engages on ~80 ms of vertical motion, not pose alone, and uses 3× gain with a small deadzone', () => {
    expect(PALM_INTENT_MS).toBe(80);
    expect(PALM_HOLD_MS).toBe(PALM_INTENT_MS);
    expect(PALM_STILL_MS).toBe(250);
    expect(PALM_GAIN).toBe(3);
    expect(PALM_DEADZONE_PX).toBeLessThanOrEqual(6);
  });

  it('the critically-damped spring approaches a step target without overshooting', () => {
    const s = createCriticalSpring({ freqHz: 7 });
    let v = 0;
    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      v = s.tick(1, 16);
      samples.push(v);
    }
    expect(Math.max(...samples)).toBeLessThanOrEqual(1 + 1e-6);
    expect(v).toBeGreaterThan(0.95);
    expect(v).toBeLessThanOrEqual(1 + 1e-6);
    // Monotone from rest toward the target (no jerk / reverse).
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]! - 1e-9);
    }
  });

  it('maps a small wrist move to a ~3× scroll once the spring settles', () => {
    const p = createPalmScroll({ freqHz: 12, deadzonePx: 4, gain: 3 });
    let scrolled = 0;
    let t = 0;
    p.sample(100, 0);
    // 10 px of wrist motion over 100 ms, sampled along the way, then a hold
    // so target velocity returns to 0. Integrated scroll ≈ 10 × 3.
    for (let i = 1; i <= 10; i++) {
      t = i * 10;
      p.sample(100 + i, t);
      scrolled += p.tick(10);
    }
    for (let i = 0; i < 20; i++) {
      t += 16;
      p.sample(110, t); // hand held still
      scrolled += p.tick(16);
    }
    expect(scrolled).toBeGreaterThan(10 * 2);
    expect(scrolled).toBeLessThan(10 * 3 * 1.25 + 8);
  });

  it('swallows sub-deadzone jitter and still flings gently on release', () => {
    const p = createPalmScroll({ freqHz: 10, deadzonePx: 4, gain: 3 });
    p.sample(50, 0);
    p.sample(51, 50); // 1 px / 50 ms = 0.02 px/ms, under the velocity deadzone
    expect(Math.abs(p.tick(16))).toBeLessThan(0.2);
    p.sample(80, 133); // 28 px over 100 ms → vy = 0.84
    for (let i = 0; i < 10; i++) p.tick(16);
    const vy = p.release();
    expect(vy).toBeGreaterThan(0.2);
    const fling = createMomentum({ friction: 0.94, minSpeed: 0.01 });
    fling.start(0, vy);
    let gone = 0;
    for (let i = 0; i < 40 && fling.active; i++) gone += Math.abs(fling.tick(16).dy);
    expect(gone).toBeGreaterThan(0);
  });
});
