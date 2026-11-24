import { describe, expect, it } from 'vitest';
import { stepZoom, wheelIntent, zoomCameraTo } from '../../src/canvas/canvasNav';
import { screenToWorld } from '../../src/canvas/camera';

const base = { deltaX: 0, deltaY: 0, ctrlKey: false, metaKey: false, shiftKey: false, deltaMode: 0 };
describe('stepZoom', () => {
  it('steps and clamps', () => {
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(0.8, -1)).toBe(0.75);
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(0.1, -1)).toBe(0.1);
    expect(stepZoom(0.75, 1)).toBe(1);
  });
});
describe('wheelIntent', () => {
  it('ctrl zooms', () => {
    expect(wheelIntent({ ...base, deltaY: 100, ctrlKey: true })).toEqual({ kind: 'zoom', factor: Math.exp(-1) });
    expect(wheelIntent({ ...base, deltaY: 100, metaKey: true }).kind).toBe('zoom');
  });
  it('plain pans, shift swaps, lines scale', () => {
    expect(wheelIntent({ ...base, deltaX: 5, deltaY: 40 })).toEqual({ kind: 'pan', dx: 5, dy: 40 });
    expect(wheelIntent({ ...base, deltaY: 40, shiftKey: true })).toEqual({ kind: 'pan', dx: 40, dy: 0 });
    expect(wheelIntent({ ...base, deltaY: 2, deltaMode: 1 })).toEqual({ kind: 'pan', dx: 0, dy: 32 });
  });
});
describe('zoomCameraTo', () => {
  it('keeps viewport centre fixed', () => {
    const c = { x: 100, y: 50, z: 1 }, vp = { w: 800, h: 600 };
    const before = screenToWorld(c, { x: 400, y: 300 });
    const n = zoomCameraTo(c, vp, 0.5);
    const after = screenToWorld(n, { x: 400, y: 300 });
    expect(n.z).toBe(0.5);
    expect(after.x).toBeCloseTo(before.x); expect(after.y).toBeCloseTo(before.y);
  });
});
