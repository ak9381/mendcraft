import { describe, expect, it } from 'vitest';
import { focusOnInsets, worldToScreen } from '../../src/canvas/camera';

describe('focusOnInsets', () => {
  it('centres a board 1:1 in the space left of a dock and below the bar', () => {
    const rect = { x: 0, y: 0, w: 1000, h: 680 };
    const vp = { w: 1440, h: 900 };
    const c = focusOnInsets(rect, vp, { top: 120, left: 300, right: 0 });
    expect(c.z).toBe(1);
    const centre = worldToScreen(c, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
    expect(centre.x).toBeCloseTo(300 + (1440 - 300) / 2, 6);
    expect(centre.y).toBeCloseTo(120 + (900 - 120) / 2, 6);
  });

  it('with no insets it centres like a plain focus', () => {
    const rect = { x: 50, y: 50, w: 800, h: 500 };
    const vp = { w: 1200, h: 800 };
    const c = focusOnInsets(rect, vp, { top: 0, left: 0, right: 0 });
    const centre = worldToScreen(c, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
    expect(centre.x).toBeCloseTo(600, 6);
    expect(centre.y).toBeCloseTo(400, 6);
  });
});
