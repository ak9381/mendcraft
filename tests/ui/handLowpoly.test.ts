import { describe, expect, it } from 'vitest';
import {
  buildLowpolyHand,
  drawLowpolyHand,
  CORAL_TIP_COLOR,
  CORAL_TIP_RGB,
  LOWPOLY_FILL_ALPHA,
  VERTEX_COUNT,
  TRIANGLE_COUNT,
} from '../../src/ui/handLowpoly';

/** A 21-landmark pointing hand: index extended, other fingers curled. */
function pointingHandLandmarks(): { x: number; y: number }[] {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  lm[0] = { x: 0.5, y: 0.9 };
  lm[1] = { x: 0.4, y: 0.85 }; lm[2] = { x: 0.35, y: 0.78 }; lm[3] = { x: 0.32, y: 0.7 }; lm[4] = { x: 0.3, y: 0.63 };
  lm[5] = { x: 0.5, y: 0.75 }; lm[6] = { x: 0.5, y: 0.6 }; lm[7] = { x: 0.5, y: 0.45 }; lm[8] = { x: 0.5, y: 0.3 };
  lm[9] = { x: 0.56, y: 0.75 }; lm[10] = { x: 0.58, y: 0.68 }; lm[11] = { x: 0.57, y: 0.72 }; lm[12] = { x: 0.56, y: 0.76 };
  lm[13] = { x: 0.62, y: 0.76 }; lm[14] = { x: 0.64, y: 0.7 }; lm[15] = { x: 0.63, y: 0.74 }; lm[16] = { x: 0.62, y: 0.78 };
  lm[17] = { x: 0.68, y: 0.78 }; lm[18] = { x: 0.7, y: 0.73 }; lm[19] = { x: 0.69, y: 0.76 }; lm[20] = { x: 0.68, y: 0.8 };
  return lm;
}

describe('buildLowpolyHand', () => {
  it('produces a fixed-size mesh with triangles and a closed outline', () => {
    const mesh = buildLowpolyHand(pointingHandLandmarks());
    expect(mesh.indices.length).toBe(TRIANGLE_COUNT * 3);
    expect(mesh.verts.length).toBe(VERTEX_COUNT * 2);
    expect(mesh.outline.length).toBeGreaterThan(10);
    for (const idx of mesh.outline) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(VERTEX_COUNT);
    }
    for (const idx of mesh.indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(VERTEX_COUNT);
    }
  });

  it('places a vertex exactly at the index fingertip landmark', () => {
    const lm = pointingHandLandmarks();
    const mesh = buildLowpolyHand(lm);
    const vx = mesh.verts[mesh.tipVertex * 2];
    const vy = mesh.verts[mesh.tipVertex * 2 + 1];
    expect(vx).toBeCloseTo(lm[8].x, 5);
    expect(vy).toBeCloseTo(lm[8].y, 5);
  });

  it('colours the index fingertip coral', () => {
    const mesh = buildLowpolyHand(pointingHandLandmarks());
    const r = mesh.vertColors[mesh.tipVertex * 3];
    const g = mesh.vertColors[mesh.tipVertex * 3 + 1];
    const b = mesh.vertColors[mesh.tipVertex * 3 + 2];
    expect(Math.abs(r - CORAL_TIP_RGB[0])).toBeLessThan(12);
    expect(Math.abs(g - CORAL_TIP_RGB[1])).toBeLessThan(12);
    expect(Math.abs(b - CORAL_TIP_RGB[2])).toBeLessThan(12);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    expect(CORAL_TIP_COLOR.startsWith('#')).toBe(true);
  });

  it('gives a pointing hand a wide filled palm, not a sliver fan', () => {
    const lm = pointingHandLandmarks();
    const mesh = buildLowpolyHand(lm);
    const handScale = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y);
    // Ring vertices 0..5 (wrist + 4 finger roots) — the palm pad's silhouette.
    const ringXs: number[] = [];
    const ringYs: number[] = [];
    for (let i = 0; i < 6; i++) {
      ringXs.push(mesh.verts[i * 2]);
      ringYs.push(mesh.verts[i * 2 + 1]);
    }
    const spanX = Math.max(...ringXs) - Math.min(...ringXs);
    const spanY = Math.max(...ringYs) - Math.min(...ringYs);
    expect(Math.hypot(spanX, spanY)).toBeGreaterThan(handScale * 0.5);
  });

  it('sits every fingertip landmark (4, 8, 12, 16, 20) exactly on its vertex', () => {
    const lm = pointingHandLandmarks();
    const mesh = buildLowpolyHand(lm);
    const tipLandmarks = [4, 8, 12, 16, 20];
    // Fingers are ordered thumb..pinky starting right after the palm block.
    for (let f = 0; f < 5; f++) {
      const base = 6 + 6 + 1 + f * 10; // RING_COUNT*2 + 1 + f*FINGER_STRIDE
      const centerVertex = base + 8; // vCenter3(f)
      const vx = mesh.verts[centerVertex * 2];
      const vy = mesh.verts[centerVertex * 2 + 1];
      expect(vx).toBeCloseTo(lm[tipLandmarks[f]].x, 5);
      expect(vy).toBeCloseTo(lm[tipLandmarks[f]].y, 5);
    }
  });

  it('clamps the tip apex so a fist pose produces no spike', () => {
    const fistLm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
    fistLm[0] = { x: 0.5, y: 0.9 };
    // Every finger curled back near the palm (tip landmarks close to their
    // own PIP joints, as a real fist reports them).
    const curl = (mcp: number, pip: number, dip: number, tip: number, x: number) => {
      fistLm[mcp] = { x, y: 0.6 };
      fistLm[pip] = { x, y: 0.68 };
      fistLm[dip] = { x, y: 0.72 };
      fistLm[tip] = { x, y: 0.705 }; // tip folded back past the DIP
    };
    curl(2, 3, 3, 4, 0.4);
    curl(5, 6, 7, 8, 0.46);
    curl(9, 10, 11, 12, 0.5);
    curl(13, 14, 15, 16, 0.54);
    curl(17, 18, 19, 20, 0.58);
    const mesh = buildLowpolyHand(fistLm);
    const handScale = Math.hypot(fistLm[0].x - fistLm[9].x, fistLm[0].y - fistLm[9].y);
    for (let f = 0; f < 5; f++) {
      const base = 6 + 6 + 1 + f * 10;
      const centerVertex = base + 8;
      const apexVertex = base + 9;
      const d = Math.hypot(
        mesh.verts[apexVertex * 2] - mesh.verts[centerVertex * 2],
        mesh.verts[apexVertex * 2 + 1] - mesh.verts[centerVertex * 2 + 1],
      );
      expect(d).toBeLessThanOrEqual(handScale * 0.05 + 1e-6);
    }
  });

  it('reuses the same buffers across calls — no per-frame reallocation', () => {
    const mesh = buildLowpolyHand(pointingHandLandmarks());
    const verts = mesh.verts;
    const indices = mesh.indices;
    const outline = mesh.outline;
    const moved = pointingHandLandmarks();
    moved[8] = { x: 0.52, y: 0.28 };
    buildLowpolyHand(moved, mesh);
    expect(mesh.verts).toBe(verts);
    expect(mesh.indices).toBe(indices);
    expect(mesh.outline).toBe(outline);
    expect(mesh.verts[mesh.tipVertex * 2]).toBeCloseTo(0.52, 5);
  });
});

describe('drawLowpolyHand', () => {
  it('draws without throwing using only canvas 2d path calls', () => {
    const calls: string[] = [];
    const ctx: any = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'canvas') return {};
          return (...args: unknown[]) => { calls.push(String(prop)); return undefined; };
        },
        set() { return true; },
      },
    );
    const mesh = buildLowpolyHand(pointingHandLandmarks());
    expect(() => drawLowpolyHand(ctx, mesh)).not.toThrow();
    expect(calls).toContain('fill');
    expect(calls).toContain('stroke');
  });

  it('defaults to a more-transparent fill than fully opaque', () => {
    expect(LOWPOLY_FILL_ALPHA).toBeGreaterThanOrEqual(0.55);
    expect(LOWPOLY_FILL_ALPHA).toBeLessThanOrEqual(0.65);
  });
});
