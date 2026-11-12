import { describe, expect, it } from 'vitest';
import { Engine, BED } from '../src/core/scene';
import type { Op } from '../src/core/ops';

const addBox = (w = 20, d = 20, h = 10): Op => ({ op: 'add', shape: 'box', params: { w, d, h } });

describe('Engine', () => {
  it('applies add and selects the new part, resting it on the floor', () => {
    const e = new Engine();
    const r = e.apply(addBox());
    expect(r.ok).toBe(true);
    const s = e.getState();
    expect(s.parts).toHaveLength(1);
    expect(s.selectedId).toBe(s.parts[0].id);
    expect(s.parts[0].transform.position.z).toBeCloseTo(5);
    expect(r.warnings).toHaveLength(0);
  });

  it('moves the selected part', () => {
    const e = new Engine();
    e.apply(addBox());
    const r = e.apply({ op: 'move', target: 'selected', dx: 10, dy: 0, dz: 0 });
    expect(r.ok).toBe(true);
    expect(e.getState().parts[0].transform.position.x).toBe(10);
  });

  it('undo and redo round-trip', () => {
    const e = new Engine();
    e.apply(addBox());
    e.apply({ op: 'move', target: 'selected', dx: 10, dy: 0, dz: 0 });
    expect(e.apply({ op: 'undo' }).ok).toBe(true);
    expect(e.getState().parts[0].transform.position.x).toBe(0);
    expect(e.apply({ op: 'redo' }).ok).toBe(true);
    expect(e.getState().parts[0].transform.position.x).toBe(10);
    // Drain the undo stack: move, add, then nothing.
    expect(e.apply({ op: 'undo' }).ok).toBe(true);
    expect(e.apply({ op: 'undo' }).ok).toBe(true);
    expect(e.apply({ op: 'undo' }).ok).toBe(false);
  });

  it('flags printability problems: bed fit, floating, thin wall', () => {
    const e = new Engine();
    e.apply(addBox(300, 20, 10)); // w clamps upstream normally; engine just reports
    const bed = e.printability();
    expect(bed.some((w) => w.kind === 'bed-fit')).toBe(Number(300) > BED.x);

    const e2 = new Engine();
    e2.apply(addBox());
    e2.apply({ op: 'move', target: 'selected', dx: 0, dy: 0, dz: 15 });
    expect(e2.printability().some((w) => w.kind === 'floating')).toBe(true);

    const e3 = new Engine();
    e3.apply(addBox(20, 20, 0.5));
    expect(e3.printability().some((w) => w.kind === 'thin-wall')).toBe(true);
  });

  it('summary is compact valid JSON with parts and warnings', () => {
    const e = new Engine();
    e.apply(addBox());
    const s = JSON.parse(e.summary());
    expect(s.parts).toHaveLength(1);
    expect(s.parts[0].sizeMm).toEqual({ x: 20, y: 20, z: 10 });
    expect(Array.isArray(s.warnings)).toBe(true);
    expect(s.selected).toBe(s.parts[0].id);
  });
});
