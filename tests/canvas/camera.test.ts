import { describe, expect, it } from 'vitest';
import { MAX_Z, MIN_Z, cameraTransform, fitRects, focusOn, panBy, screenToWorld, worldToScreen, zoomAbout } from '../../src/canvas/camera';

const vp = { w: 1280, h: 800 };

describe('camera', () => {
  it('round-trips screen <-> world at any zoom', () => {
    for (const c of [{ x: 0, y: 0, z: 1 }, { x: -340, y: 120, z: 0.37 }, { x: 5000, y: -2000, z: 0.12 }]) {
      const s = { x: 413, y: 222 };
      const w = screenToWorld(c, s);
      const back = worldToScreen(c, w);
      expect(back.x).toBeCloseTo(s.x, 9);
      expect(back.y).toBeCloseTo(s.y, 9);
    }
  });

  it('zoomAbout keeps the world point under the cursor fixed and clamps zoom', () => {
    const c = { x: 100, y: 50, z: 0.5 };
    const p = { x: 600, y: 300 };
    const before = screenToWorld(c, p);
    const z2 = zoomAbout(c, p, 0.5);
    const after = screenToWorld(z2, p);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(zoomAbout(c, p, 100).z).toBe(MAX_Z);
    expect(zoomAbout(c, p, 0.0001).z).toBe(MIN_Z);
  });

  it('panBy moves the world opposite to the drag, scaled by zoom', () => {
    const c = panBy({ x: 0, y: 0, z: 0.5 }, 100, -50);
    expect(c).toEqual({ x: -200, y: 100, z: 0.5 });
  });

  it('focusOn centres a frame at exactly 1:1 (editing scale)', () => {
    const rect = { x: 2000, y: 400, w: 1200, h: 760 };
    const c = focusOn(rect, vp);
    expect(c.z).toBe(1);
    const centre = worldToScreen(c, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
    expect(centre.x).toBeCloseTo(vp.w / 2, 9);
    expect(centre.y).toBeCloseTo(vp.h / 2, 9);
  });

  it('focusOn uses whole pixels so the plan engine hit-tests stay exact', () => {
    const c = focusOn({ x: 10.3, y: 7.7, w: 999, h: 501 }, vp);
    const t = worldToScreen(c, { x: 0, y: 0 });
    expect(Number.isInteger(t.x)).toBe(true);
    expect(Number.isInteger(t.y)).toBe(true);
  });

  it('fitRects shows every frame inside the viewport with padding, never above 1:1', () => {
    const rects = [{ x: 0, y: 0, w: 1200, h: 800 }, { x: 1400, y: 0, w: 1200, h: 800 }, { x: 0, y: 1000, w: 1200, h: 800 }];
    const c = fitRects(rects, vp, 48);
    expect(c.z).toBeLessThanOrEqual(1);
    for (const r of rects) {
      const a = worldToScreen(c, { x: r.x, y: r.y });
      const b = worldToScreen(c, { x: r.x + r.w, y: r.y + r.h });
      expect(a.x).toBeGreaterThanOrEqual(48 - 1e-9);
      expect(a.y).toBeGreaterThanOrEqual(48 - 1e-9);
      expect(b.x).toBeLessThanOrEqual(vp.w - 48 + 1e-9);
      expect(b.y).toBeLessThanOrEqual(vp.h - 48 + 1e-9);
    }
    expect(fitRects([], vp, 48)).toEqual({ x: -vp.w / 2, y: -vp.h / 2, z: 1 });
    expect(fitRects([{ x: 0, y: 0, w: 100, h: 100 }], vp, 48).z).toBe(1);
  });

  it('cameraTransform is a CSS translate+scale string', () => {
    expect(cameraTransform({ x: 10, y: 20, z: 0.5 })).toBe('translate(-5px, -10px) scale(0.5)');
  });
});

describe('twoHandCamera (anchored two-finger pinch)', () => {
  it('pulling the fingers apart zooms in and keeps the world under the midpoint fixed', async () => {
    const { twoHandCamera } = await import('../../src/canvas/camera');
    const c0 = { x: 100, y: 50, z: 0.5 };
    const p0 = { x: 500, y: 400 }, q0 = { x: 700, y: 400 }; // span 200, mid (600,400)
    const p1 = { x: 400, y: 400 }, q1 = { x: 800, y: 400 }; // span 400 -> 2x
    const mid0 = { x: 600, y: 400 }, mid1 = { x: 600, y: 400 };
    const wMid = screenToWorld(c0, mid0);
    const c1 = twoHandCamera(c0, p0, q0, p1, q1);
    expect(c1.z).toBeCloseTo(1, 9); // 0.5 * 2
    const after = worldToScreen(c1, wMid);
    expect(after.x).toBeCloseTo(mid1.x, 6);
    expect(after.y).toBeCloseTo(mid1.y, 6);
  });

  it('translating both fingers pans without changing zoom', async () => {
    const { twoHandCamera } = await import('../../src/canvas/camera');
    const c0 = { x: 0, y: 0, z: 0.5 };
    const p0 = { x: 500, y: 400 }, q0 = { x: 700, y: 400 };
    const p1 = { x: 560, y: 440 }, q1 = { x: 760, y: 440 }; // shifted +60,+40, same span
    const c1 = twoHandCamera(c0, p0, q0, p1, q1);
    expect(c1.z).toBeCloseTo(0.5, 9);
    // world under mid0 should now sit under mid1
    const wMid = screenToWorld(c0, { x: 600, y: 400 });
    const after = worldToScreen(c1, wMid);
    expect(after.x).toBeCloseTo(660, 6);
    expect(after.y).toBeCloseTo(440, 6);
  });

  it('clamps zoom to MIN_Z / MAX_Z', async () => {
    const { twoHandCamera } = await import('../../src/canvas/camera');
    const c0 = { x: 0, y: 0, z: 1 };
    const inUp = twoHandCamera(c0, { x: 590, y: 400 }, { x: 610, y: 400 }, { x: 100, y: 400 }, { x: 1100, y: 400 });
    expect(inUp.z).toBe(MAX_Z);
    const c1 = { x: 0, y: 0, z: 0.1 };
    const out = twoHandCamera(c1, { x: 100, y: 400 }, { x: 1100, y: 400 }, { x: 590, y: 400 }, { x: 610, y: 400 });
    expect(out.z).toBe(MIN_Z);
  });
});

describe('lerpCamera', () => {
  it('starts at a, ends at b, and keeps zoom between them', async () => {
    const { lerpCamera } = await import('../../src/canvas/camera');
    const a = { x: 0, y: 0, z: 1 }, b = { x: 3000, y: 900, z: 0.2 };
    expect(lerpCamera(a, b, 0, vp)).toEqual(a);
    const end = lerpCamera(a, b, 1, vp);
    expect(end.x).toBeCloseTo(b.x, 6); expect(end.y).toBeCloseTo(b.y, 6); expect(end.z).toBeCloseTo(b.z, 9);
    const mid = lerpCamera(a, b, 0.5, vp);
    expect(mid.z).toBeLessThan(1); expect(mid.z).toBeGreaterThan(0.2);
  });
});
