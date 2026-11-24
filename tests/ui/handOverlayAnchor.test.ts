// The glass-hand overlay is drawn with its palm centre exactly on the hand's
// cursor (the cursor uses palm + active box + smoothing; the raw overlay
// mapping alone drifted below-left of it).
import { describe, expect, it } from 'vitest';
import { anchorPalmAt, nearestCursor, overlayPalm } from '../../src/ui/handOverlay';
import { palmCenter } from '../../src/canvas/handFeel';
import { mapToScreen } from '../../src/canvas/handPointer';
import { synthHand } from '../helpers/synthHands';

describe('overlay palm anchoring', () => {
  it('anchorPalmAt translates (never scales) the hand so its palm centre lands on the target', () => {
    const pts = Array.from({ length: 21 }, (_, i) => ({ x: 100 + i * 3, y: 200 + (i % 5) * 7 }));
    const before = pts.map((p) => ({ ...p }));
    const { dx, dy } = anchorPalmAt(pts, { x: 640, y: 360 });
    const c = overlayPalm(pts);
    expect(c.x).toBeCloseTo(640, 9);
    expect(c.y).toBeCloseTo(360, 9);
    pts.forEach((p, i) => {
      expect(p.x - before[i].x).toBeCloseTo(dx, 9);
      expect(p.y - before[i].y).toBeCloseTo(dy, 9);
    });
    // Shape (and so scale) is preserved.
    expect(Math.hypot(pts[0].x - pts[12].x, pts[0].y - pts[12].y))
      .toBeCloseTo(Math.hypot(before[0].x - before[12].x, before[0].y - before[12].y), 9);
  });

  it('overlayPalm is the same palm the cursor uses (mean of 0/5/9/13/17)', () => {
    const h = synthHand(300, 200, false, 1000, 800);
    const a = overlayPalm(h);
    const b = palmCenter(h);
    expect(a.x).toBeCloseTo(b.x, 12);
    expect(a.y).toBeCloseTo(b.y, 12);
  });

  it('nearestCursor matches each overlay hand to the pointer slot whose mapped palm is closest (position, not handedness)', () => {
    const W = 1000, H = 800;
    // Overlay points are selfie-mirrored; the pointer maps camera space with mirror=true — same screen point.
    const camLeft = synthHand(250, 400, false, W, H);
    const camRight = synthHand(750, 400, false, W, H);
    const selfie = (h: { x: number; y: number }[]) => h.map((p) => ({ x: 1 - p.x, y: p.y }));
    const cursors = [
      { palm: mapToScreen(palmCenter(camRight), W, H), cursor: { x: 760, y: 410 } },
      { palm: mapToScreen(palmCenter(camLeft), W, H), cursor: { x: 240, y: 395 } },
    ];
    const pL = mapToScreen(palmCenter(selfie(camLeft)), W, H, false);
    const pR = mapToScreen(palmCenter(selfie(camRight)), W, H, false);
    expect(nearestCursor(pL, cursors)).toEqual({ x: 240, y: 395 });
    expect(nearestCursor(pR, cursors)).toEqual({ x: 760, y: 410 });
    expect(nearestCursor(pL, [])).toBeNull();
    expect(nearestCursor(pL, [{ palm: pL, cursor: { x: -1, y: -1 } }])).toBeNull(); // a lost slot
  });
});
