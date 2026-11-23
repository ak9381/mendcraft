// B-014: the old editor's palette sits on the top edge. With a small calibrated
// reach box, the hand point is remapped (and clamped) so the box's edges are the
// screen's edges: every palette button along the top row is reachable, and
// overshooting past the box edge pins the cursor to that edge instead of losing it.
import { describe, expect, it } from 'vitest';
import { isFullReach, remapToReach } from '../../src/setup/calibration';

const small = { x0: 0.35, y0: 0.3, x1: 0.65, y1: 0.6 }; // a 30% x 30% reach
const toPx = (p: { x: number; y: number }) => ({ x: p.x * 1440, y: p.y * 900 });

describe('B-014 palette at the screen edge with a constrained reach box', () => {
  it('a small box is remapped, not ignored', () => expect(isFullReach(small)).toBe(false));
  it('the box top edge lands on the topbar row, at both ends', () => {
    for (const x of [small.x0, (small.x0 + small.x1) / 2, small.x1]) {
      const s = toPx(remapToReach({ x, y: small.y0 }, small));
      expect(s.y).toBe(0);
      expect(s.x).toBeGreaterThanOrEqual(0); expect(s.x).toBeLessThanOrEqual(1440);
    }
  });
  it('overshooting past the edge (or tremor around it) stays pinned to the edge', () => {
    for (const dy of [0.001, 0.02, 0.2]) expect(remapToReach({ x: 0.5, y: small.y0 - dy }, small).y).toBe(0);
    expect(remapToReach({ x: small.x1 + 0.1, y: 0.4 }, small).x).toBe(1);
    expect(remapToReach({ x: small.x0 - 0.1, y: 0.4 }, small).x).toBe(0);
  });
  it('a 48px topbar is a usable band in hand space (not a sub-pixel sliver)', () => {
    const band = (48 / 900) * (small.y1 - small.y0); // hand-space height of the topbar
    expect(band).toBeGreaterThan(0.01); // >1% of the camera frame
  });
});
