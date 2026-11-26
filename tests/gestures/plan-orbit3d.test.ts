// Pure spherical-orbit math for hand-driven 3D camera (B-160 orbit, B-161 dolly).
import { describe, expect, it } from 'vitest';
import { orbitOffset, dollyOffset } from '../../src/plan/orbit3d';

describe('B-160 orbitOffset (hand orbit of the 3D camera)', () => {
  it('a +90° azimuth rotates a +x offset to +y, preserving radius and height', () => {
    const o = orbitOffset({ x: 1000, y: 0, z: 0 }, Math.PI / 2, 0);
    expect(o.x).toBeCloseTo(0, 6);
    expect(o.y).toBeCloseTo(1000, 6);
    expect(o.z).toBeCloseTo(0, 6);
  });

  it('raising elevation lifts the camera (+z) while keeping radius', () => {
    const before = { x: 1000, y: 0, z: 0 };
    const after = orbitOffset(before, 0, 0.5);
    expect(Math.hypot(after.x, after.y, after.z)).toBeCloseTo(1000, 3);
    expect(after.z).toBeGreaterThan(0);
  });

  it('clamps elevation so the view never flips over the pole', () => {
    const after = orbitOffset({ x: 1000, y: 0, z: 0 }, 0, 10, -1.45, 1.45);
    const phi = Math.asin(after.z / Math.hypot(after.x, after.y, after.z));
    expect(phi).toBeCloseTo(1.45, 3);
  });
});

describe('B-161 dollyOffset (hand zoom of the 3D camera)', () => {
  it('factor > 1 moves the camera closer (shorter radius), clamped', () => {
    const o = dollyOffset({ x: 2000, y: 0, z: 0 }, 2, 100, 10000);
    expect(Math.hypot(o.x, o.y, o.z)).toBeCloseTo(1000, 3);
  });

  it('respects the min/max radius clamp', () => {
    const near = dollyOffset({ x: 2000, y: 0, z: 0 }, 100, 500, 10000);
    expect(Math.hypot(near.x, near.y, near.z)).toBeCloseTo(500, 3);
    const far = dollyOffset({ x: 2000, y: 0, z: 0 }, 0.01, 100, 3000);
    expect(Math.hypot(far.x, far.y, far.z)).toBeCloseTo(3000, 3);
  });
});
