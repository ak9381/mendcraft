// The hand-feel machines: everything that makes camera hands deliberate
// instead of hair-trigger. Pure, clock-injected, no camera needed.
import { describe, expect, it } from 'vitest';
import {
  HAND_FEEL,
  createDeadZone,
  createHoldGesture,
  createToggleLatch,
  TOOLS_TOGGLE_GAP_MS,
  createPinchMachine,
  createPositionHistory,
  createScalarEuro,
  createStickyTarget,
  cursorAnchor,
  handScale,
  palmCenter,
  pickPrimaryHand,
  pickForegroundHands,
  assignHandSlots,
} from '../../src/canvas/handFeel';
import { DEFAULT_PINCH_ON, DEFAULT_PINCH_OFF, type Pt } from '../../src/input/handLogic';
import { PINCH_CLASSIFY } from '../../src/input/gestures';
import { REACH } from '../../src/canvas/handPointer';

function handAt(cx: number, cy: number, scale = 0.2): Pt[] {
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  // d0 = -9*dm keeps the anchor exactly at (cx, cy); |d0-dm| = hand scale.
  const dm = -scale / 10;
  lm[0] = { x: cx, y: cy + 9 * -dm };
  for (const i of [5, 9, 13, 17]) lm[i] = { x: cx, y: cy + dm };
  return lm;
}

describe('one pinch definition everywhere', () => {
  it('handLogic, gestures and HAND_FEEL agree on the pinch thresholds', () => {
    expect(DEFAULT_PINCH_ON).toBe(HAND_FEEL.pinchOn);
    expect(DEFAULT_PINCH_OFF).toBe(HAND_FEEL.pinchOff);
    expect(PINCH_CLASSIFY).toBe(HAND_FEEL.pinchOn);
    expect(HAND_FEEL.pinchOff).toBeGreaterThan(HAND_FEEL.pinchOn); // hysteresis
  });
  it('the reach box maps the 12–88% camera centre to the screen', () => {
    expect(REACH).toEqual(HAND_FEEL.reach);
    expect(HAND_FEEL.reach.x0).toBeCloseTo(0.12);
    expect(HAND_FEEL.reach.x1).toBeCloseTo(0.88);
    expect(HAND_FEEL.reach.y0).toBeCloseTo(0.12);
    expect(HAND_FEEL.reach.y1).toBeCloseTo(0.88);
  });
});

describe('pinch machine (debounce + hysteresis + refractory)', () => {
  const OPEN = 0.8;
  const CLOSED = 0.02;
  const BETWEEN = (HAND_FEEL.pinchOn + HAND_FEEL.pinchOff) / 2;

  it('needs engageFrames consecutive closed frames to engage', () => {
    const m = createPinchMachine();
    expect(m.update(CLOSED, 0).pinched).toBe(false); // one-frame debounce
    const second = m.update(CLOSED, 33);
    expect(second.pinched).toBe(true);
    expect(second.justDown).toBe(true);
  });

  it('a 1–2 frame dip never engages (no click from tracking noise)', () => {
    const m = createPinchMachine();
    m.update(CLOSED, 0);
    m.update(OPEN, 33); // dip broken before the confirming frame
    m.update(CLOSED, 66);
    const r = m.update(OPEN, 100);
    expect(r.pinched).toBe(false);
  });

  it('does not chatter around the threshold (hysteresis band holds)', () => {
    const m = createPinchMachine();
    for (const t of [0, 33]) m.update(CLOSED, t);
    expect(m.pinched).toBe(true);
    // Drifting into the between-band must NOT release…
    for (const t of [100, 133, 166, 200]) expect(m.update(BETWEEN, t).pinched).toBe(true);
    // …and needs releaseFrames above off to let go.
    m.update(OPEN, 233);
    const r = m.update(OPEN, 266);
    expect(r.pinched).toBe(false);
    expect(r.justUp).toBe(true);
  });

  it('refractory: no new engage right after a click', () => {
    const m = createPinchMachine();
    for (const t of [0, 33]) m.update(CLOSED, t);
    m.update(OPEN, 100);
    m.update(OPEN, 133); // released → click at t=133
    for (const t of [166, 200, 233, 266]) m.update(CLOSED, t);
    expect(m.pinched).toBe(false); // still inside refractoryMs
    for (const t of [700, 733]) m.update(CLOSED, t);
    expect(m.pinched).toBe(true); // refractory over
  });
});

describe('cursor smoothing + dead zone', () => {
  it('one-euro on the pinch ratio damps jitter without hiding a real close', () => {
    const f = createScalarEuro();
    for (let i = 0; i < 30; i++) f.filter(0.8, i * 33);
    // Noisy hold around 0.8 (±0.06): the filtered band is tighter than raw.
    let min = Infinity, max = -Infinity;
    for (let i = 30; i < 60; i++) {
      const v = f.filter(0.8 + (i % 2 === 0 ? 0.06 : -0.06), i * 33);
      min = Math.min(min, v); max = Math.max(max, v);
    }
    expect(max - min).toBeLessThan(0.12 * 0.7); // ≥30% jitter reduction
    expect(min).toBeGreaterThan(HAND_FEEL.pinchOff); // never dips toward "pinch"
    // A deliberate close still comes through within a couple of frames.
    f.filter(0.02, 61 * 33);
    expect(f.filter(0.02, 62 * 33)).toBeLessThan(HAND_FEEL.pinchOn);
  });

  it('a single-frame ratio spike cannot engage the pinch machine', () => {
    const f = createScalarEuro();
    const m = createPinchMachine();
    for (let i = 0; i < 30; i++) m.update(f.filter(0.8, i * 33), i * 33);
    m.update(f.filter(0.1, 30 * 33), 30 * 33); // one bogus tracking frame
    const r = m.update(f.filter(0.8, 31 * 33), 31 * 33);
    expect(r.pinched).toBe(false); // engageFrames debounce absorbs it
  });

  it('dead zone swallows micro-jitter but passes real movement', () => {
    const dz = createDeadZone(3);
    const a = dz.apply({ x: 100, y: 100 });
    expect(dz.apply({ x: 101, y: 101 })).toEqual(a); // < 3px: held
    expect(dz.apply({ x: 100.5, y: 99.5 })).toEqual(a);
    const moved = dz.apply({ x: 110, y: 100 });
    expect(moved).toEqual({ x: 110, y: 100 });
  });
});

describe('position history (cursor freeze on pinch)', () => {
  it('returns the position from before the pinch began', () => {
    const h = createPositionHistory(400);
    h.push({ x: 100, y: 100 }, 0);
    h.push({ x: 102, y: 101 }, 50);
    h.push({ x: 160, y: 140 }, 120); // the pinch jerk
    h.push({ x: 180, y: 160 }, 150);
    // Looking back 100 ms from t=150 lands on the pre-jerk position.
    expect(h.at(50)).toEqual({ x: 102, y: 101 });
  });
  it('clamps to the oldest kept position', () => {
    const h = createPositionHistory(400);
    h.push({ x: 7, y: 8 }, 1000);
    expect(h.at(0)).toEqual({ x: 7, y: 8 });
    expect(createPositionHistory().at(0)).toBeNull();
  });
});

describe('sticky target', () => {
  type T = { name: string; rect: { left: number; top: number; width: number; height: number } };
  const a: T = { name: 'a', rect: { left: 0, top: 0, width: 100, height: 40 } };
  const b: T = { name: 'b', rect: { left: 110, top: 0, width: 100, height: 40 } };

  it('keeps the current target while the pointer is within the margin', () => {
    const s = createStickyTarget<T>((t) => t.rect);
    expect(s.update(a, { x: 50, y: 20 }, 0)).toBe(a);
    // Resolver flickers to b, but the pointer is still on a: no switch — ever.
    for (let t = 16; t < 2000; t += 16) expect(s.update(b, { x: 60, y: 20 }, t)).toBe(a);
  });

  it('switches only after stickyMs outside the old target', () => {
    const s = createStickyTarget<T>((t) => t.rect);
    s.update(a, { x: 50, y: 20 }, 0);
    // Pointer genuinely over b (outside a + margin): old target holds briefly…
    expect(s.update(b, { x: 160, y: 20 }, 10)).toBe(a);
    expect(s.update(b, { x: 160, y: 20 }, 80)).toBe(a);
    // …then hands over after stickyMs.
    expect(s.update(b, { x: 160, y: 20 }, 10 + HAND_FEEL.stickyMs)).toBe(b);
  });
});

describe('open-palm hold', () => {
  it('fires only after the palm is held, once, with a refractory', () => {
    const g = createHoldGesture(600, 1500);
    expect(g.update(true, 0)).toBe(false);
    expect(g.update(true, 300)).toBe(false);
    expect(g.update(true, 620)).toBe(true); // held ≥600 ms
    expect(g.update(true, 700)).toBe(false); // refractory
    expect(g.update(true, 1300)).toBe(false); // re-held but refractory still on
    expect(g.update(true, 2200)).toBe(true); // fresh hold, refractory over
  });
  it('a wave (pose broken before the hold) never fires', () => {
    const g = createHoldGesture(600, 1500);
    g.update(true, 0);
    g.update(false, 400);
    expect(g.update(true, 450)).toBe(false);
    expect(g.update(true, 1000)).toBe(false); // only held 550 ms since 450
  });
});

describe('background-hand filter + anchor', () => {
  it('ignores small background hands and picks the largest', () => {
    const near = handAt(0.5, 0.5, 0.2);
    const far = handAt(0.2, 0.2, 0.04); // below minHandScale
    expect(handScale(far)).toBeLessThan(HAND_FEEL.minHandScale);
    expect(pickPrimaryHand([far])).toBeNull();
    expect(pickPrimaryHand([far, near])).toBe(near);
    const mid = handAt(0.7, 0.5, 0.1);
    expect(pickPrimaryHand([mid, near])).toBe(near); // largest wins
    const both = pickForegroundHands([far, mid, near], 2);
    expect(both).toEqual([near, mid]);
    expect(pickForegroundHands([far], 2)).toEqual([]);
  });

  it('assignHandSlots keeps a hand on its previous slot and does not swap', () => {
    const left = handAt(0.2, 0.5, 0.2);
    const right = handAt(0.8, 0.5, 0.2);
    const first = assignHandSlots([left, right], [null, null]);
    expect(first[0]).toBe(left); // smaller tip-x fills slot 0
    expect(first[1]).toBe(right);
    // Swap the input order — slots must hold by previous tips, not array order.
    const again = assignHandSlots([right, left], [left[8], right[8]]);
    expect(again[0]).toBe(left);
    expect(again[1]).toBe(right);
    // Losing the left hand clears only slot 0.
    const one = assignHandSlots([right], [left[8], right[8]]);
    expect(one[0]).toBeNull();
    expect(one[1]).toBe(right);
  });

  it('the anchor sits on the palm/index-MCP blend and ignores fingertip motion', () => {
    const h = handAt(0.5, 0.5);
    const anchor = cursorAnchor(h);
    expect(anchor.x).toBeCloseTo(0.5, 5);
    expect(anchor.y).toBeCloseTo(0.5, 5);
    // Move the thumb + index TIPS (a pinch close) — the anchor must not move.
    h[4] = { x: 0.9, y: 0.9 };
    h[8] = { x: 0.95, y: 0.95 };
    const after = cursorAnchor(h);
    expect(after.x).toBeCloseTo(anchor.x, 5);
    expect(after.y).toBeCloseTo(anchor.y, 5);
    expect(palmCenter(h).x).toBeCloseTo(0.5, 5);
  });
});

describe('createToggleLatch (Tools flicker)', () => {
  it('allows the first call and ignores another inside the gap', () => {
    const latch = createToggleLatch(TOOLS_TOGGLE_GAP_MS);
    expect(latch.allow(0)).toBe(true);
    expect(latch.allow(TOOLS_TOGGLE_GAP_MS - 1)).toBe(false);
    expect(latch.allow(TOOLS_TOGGLE_GAP_MS)).toBe(true);
  });
});
