import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SLAB,
  DEFAULT_WALL_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  extrudeScene,
  frameCamera,
} from '../src/relay/sceneExtrude';
import type { ScenePrimitive } from '../src/relay/controlSnapshot';

describe('extrudeScene — walls', () => {
  it('extrudes a horizontal segment into a z-up wall box', () => {
    const { boxes } = extrudeScene([{ t: 'seg', x1: 0, y1: 0, x2: 400, y2: 0 }]);
    expect(boxes).toHaveLength(1);
    const b = boxes[0];
    expect(b.kind).toBe('wall');
    expect(b.len).toBeCloseTo(400);
    expect(b.width).toBe(DEFAULT_WALL_THICKNESS);
    expect(b.depth).toBe(DEFAULT_WALL_HEIGHT);
    expect(b.cx).toBeCloseTo(200);
    expect(b.cy).toBeCloseTo(0);
    expect(b.cz).toBeCloseTo(DEFAULT_WALL_HEIGHT / 2); // sits on the floor
    expect(b.angle).toBeCloseTo(0);
  });

  it('rotates a vertical segment a quarter turn about z', () => {
    const { boxes } = extrudeScene([{ t: 'seg', x1: 10, y1: 0, x2: 10, y2: 300 }]);
    expect(boxes[0].angle).toBeCloseTo(Math.PI / 2);
    expect(boxes[0].len).toBeCloseTo(300);
  });

  it('honours custom height/thickness and drops zero-length walls', () => {
    const prims: ScenePrimitive[] = [
      { t: 'seg', x1: 0, y1: 0, x2: 0, y2: 0 }, // degenerate — skipped
      { t: 'seg', x1: 0, y1: 0, x2: 100, y2: 0 },
    ];
    const { boxes } = extrudeScene(prims, { wallHeight: 2000, wallThickness: 90 });
    expect(boxes).toHaveLength(1);
    expect(boxes[0].depth).toBe(2000);
    expect(boxes[0].width).toBe(90);
    expect(boxes[0].cz).toBeCloseTo(1000);
  });
});

describe('extrudeScene — boxes (part/ui snapshot)', () => {
  it('extrudes a box primitive into a low floor slab centred on the rect', () => {
    const { boxes } = extrudeScene([{ t: 'box', x: 100, y: 200, w: 60, h: 40 }]);
    expect(boxes).toHaveLength(1);
    const b = boxes[0];
    expect(b.kind).toBe('slab');
    expect(b.len).toBe(60);
    expect(b.width).toBe(40);
    expect(b.depth).toBe(DEFAULT_SLAB);
    expect(b.cx).toBeCloseTo(130);
    expect(b.cy).toBeCloseTo(220);
    expect(b.cz).toBeCloseTo(DEFAULT_SLAB / 2);
    expect(b.angle).toBe(0);
  });
});

describe('extrudeScene — camera framing', () => {
  it('centres the orbit target on a rectangular footprint', () => {
    const walls: ScenePrimitive[] = [
      { t: 'seg', x1: 0, y1: 0, x2: 400, y2: 0 },
      { t: 'seg', x1: 400, y1: 0, x2: 400, y2: 300 },
      { t: 'seg', x1: 400, y1: 300, x2: 0, y2: 300 },
      { t: 'seg', x1: 0, y1: 300, x2: 0, y2: 0 },
    ];
    const { boxes, frame } = extrudeScene(walls);
    expect(boxes).toHaveLength(4);
    expect(frame.target.x).toBeCloseTo(200);
    expect(frame.target.y).toBeCloseTo(150);
    expect(frame.target.z).toBeCloseTo(DEFAULT_WALL_HEIGHT / 2);
    expect(frame.radius).toBeGreaterThan(0);
    // Eye sits off to the south-east and above the target.
    expect(frame.position.x).toBeGreaterThan(frame.target.x);
    expect(frame.position.y).toBeLessThan(frame.target.y);
    expect(frame.position.z).toBeGreaterThan(frame.target.z);
  });

  it('gives an empty scene a stable default frame (still orbitable)', () => {
    const { boxes, frame } = extrudeScene([]);
    expect(boxes).toHaveLength(0);
    expect(frame.radius).toBeGreaterThan(0);
    expect(Number.isFinite(frame.position.x)).toBe(true);
    const direct = frameCamera(null, DEFAULT_WALL_HEIGHT);
    expect(direct.target).toEqual(frame.target);
  });
});
