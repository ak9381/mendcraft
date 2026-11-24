import { describe, expect, it } from 'vitest';
import {
  CAMERA_EDGE_EPS,
  EDGE_CLICK_COOLDOWN_MS,
  EDGE_EASE_MS,
  createEdgeGuard,
  easeBack,
  isAtScreenEdge,
  isEdgeFrame,
  isHandClipped,
} from '../../src/canvas/handEdge';
import { HAND_FEEL } from '../../src/canvas/handFeel';
import { SCREEN_MARGIN_PX } from '../../src/canvas/handPointer';

describe('edge detection', () => {
  it('flags a hand when any landmark sits near the camera frame edge', () => {
    const ok = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
    expect(isHandClipped(ok)).toBe(false);
    expect(isEdgeFrame(ok, ok[8], 1000, 800, false)).toBe(false);
    const clipped = ok.map((p) => ({ ...p }));
    clipped[16] = { x: 0.01, y: 0.5 };
    expect(isHandClipped(clipped)).toBe(true);
    expect(isEdgeFrame(clipped, clipped[8], 1000, 800, false)).toBe(true);
    expect(CAMERA_EDGE_EPS).toBeGreaterThan(0);
    expect(CAMERA_EDGE_EPS).toBeLessThanOrEqual(0.08);
  });

  it('flags a tip that has reached the screen clamp, even if landmarks are still inside the frame', () => {
    // Unclamped map of the reach-box edge (no selfie mirror) is x=0 or x=w.
    const tip = { x: HAND_FEEL.reach.x0, y: 0.5 };
    expect(isAtScreenEdge(tip, 1000, 800, false)).toBe(true);
    const mid = { x: 0.5, y: 0.5 };
    expect(isAtScreenEdge(mid, 1000, 800, false)).toBe(false);
    expect(SCREEN_MARGIN_PX).toBe(24);
  });
});

describe('edge guard: pose freeze, click cooldown, cursor hold and ease-in', () => {
  it('freezes the last stable pose while the hand is at the edge (no fist/pinch/scroll flap)', () => {
    const g = createEdgeGuard();
    g.observe(false, 'point', { x: 200, y: 200 }, 0);
    expect(g.pose('point')).toBe('point');
    g.observe(true, 'fist', { x: 24, y: 200 }, 100);
    expect(g.atEdge).toBe(true);
    expect(g.pose('fist')).toBe('point');
    expect(g.pose('pinch')).toBe('point');
    expect(g.pose('open-palm')).toBe('point');
    g.observe(true, 'pinch', { x: 10, y: 200 }, 130);
    expect(g.pose('pinch')).toBe('point');
  });

  it('blocks clicks at the edge and for 300 ms after leaving, then allows them', () => {
    const g = createEdgeGuard();
    g.observe(false, 'point', { x: 200, y: 200 }, 0);
    expect(g.blockClicks(50)).toBe(false);
    g.observe(true, 'point', { x: 24, y: 200 }, 100);
    expect(g.blockClicks(100)).toBe(true);
    expect(g.blockClicks(250)).toBe(true);
    g.observe(false, 'point', { x: 200, y: 200 }, 400);
    expect(g.blockClicks(400)).toBe(true);
    expect(g.blockClicks(400 + EDGE_CLICK_COOLDOWN_MS - 1)).toBe(true);
    expect(g.blockClicks(400 + EDGE_CLICK_COOLDOWN_MS)).toBe(false);
  });

  it('holds the cursor at the clamp while clipped, then eases back in with no jump', () => {
    const g = createEdgeGuard();
    const mid = { x: 400, y: 300 };
    const clamp = { x: 24, y: 300 };
    g.observe(false, 'point', mid, 0);
    expect(g.applyCursor(mid, 0)).toEqual(mid);
    g.observe(true, 'point', clamp, 100);
    // Distorted live points must not move the cursor off the held clamp.
    expect(g.applyCursor({ x: 0, y: 80 }, 116)).toEqual(clamp);
    expect(g.applyCursor({ x: 80, y: 900 }, 132)).toEqual(clamp);
    // Re-entry eases from the held point toward the new interior tip.
    const back = { x: 400, y: 300 };
    g.observe(false, 'point', back, 200);
    const midEase = g.applyCursor(back, 200 + EDGE_EASE_MS / 2);
    expect(midEase.x).toBeGreaterThan(clamp.x);
    expect(midEase.x).toBeLessThan(back.x);
    expect(midEase.y).toBe(300);
    const end = g.applyCursor(back, 200 + EDGE_EASE_MS);
    expect(end).toEqual(back);
  });

  it('easeBack reaches the target at the end of the window and does not overshoot', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 50 };
    expect(easeBack(a, b, 0, 0).p).toEqual(a);
    expect(easeBack(a, b, 0, 0).done).toBe(false);
    const mid = easeBack(a, b, 0, EDGE_EASE_MS / 2).p;
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(100);
    expect(easeBack(a, b, 0, EDGE_EASE_MS).p).toEqual(b);
    expect(easeBack(a, b, 0, EDGE_EASE_MS).done).toBe(true);
  });
});
