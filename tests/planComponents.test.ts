// PLAN PART 3 (components): the fixture catalogue + 2D symbols + 3D heights,
// wall-snapping, component op reducers (add_fixture / rotate / set_size / text),
// DXF layer routing, and the component voice commands.

import { describe, expect, it } from 'vitest';
import { PlanEngine } from '../src/plan/engine';
import { validatePlanOp, type PlanOp } from '../src/plan/ops';
import {
  FIXTURES,
  fixtureSpec,
  fixtureHeight,
  fixtureLayer,
  fixtureSymbol,
  fixtureLocalToWorld,
  fixturesInGroup,
  snapFixtureToWall,
  stairStepCount,
} from '../src/plan/fixtures';
import { toDxf } from '../src/plan/export';
import { parsePlanCommand, setPlanCursor } from '../src/plan/ruleParser';
import type { PlanDoc, Wall } from '../src/plan/doc';

const ok = (raw: unknown): PlanOp => {
  const v = validatePlanOp(raw);
  if (!v.ok) throw new Error(v.error);
  return v.op;
};

// ─── Catalogue ──────────────────────────────────────────────────────────────

describe('fixture catalogue', () => {
  it('every entry has sane positive dimensions and a 3D height', () => {
    for (const spec of Object.values(FIXTURES)) {
      expect(spec.w).toBeGreaterThan(0);
      expect(spec.d).toBeGreaterThan(0);
      expect(spec.height).toBeGreaterThan(0);
      expect(['rect', 'round']).toContain(spec.outline);
    }
  });

  it('groups the components into structure / furniture / sanitary', () => {
    expect(fixturesInGroup('structure').map((s) => s.kind)).toEqual(
      expect.arrayContaining(['stairs', 'column-square', 'column-round']),
    );
    expect(fixturesInGroup('furniture').map((s) => s.kind)).toEqual(
      expect.arrayContaining(['bed-single', 'bed-double', 'sofa', 'dining-table', 'chair', 'desk', 'kitchen-counter', 'wardrobe']),
    );
    expect(fixturesInGroup('sanitary').map((s) => s.kind)).toEqual(
      expect.arrayContaining(['toilet', 'sink', 'bathtub', 'shower']),
    );
  });

  it('uses sensible sitting heights (bed low, counter worktop, wardrobe tall)', () => {
    expect(fixtureHeight('bed-double')).toBe(500);
    expect(fixtureHeight('kitchen-counter')).toBe(900);
    expect(fixtureHeight('wardrobe')).toBe(2000);
    expect(fixtureHeight('stairs')).toBe(3000);
  });

  it('an unknown kind falls back without throwing', () => {
    const s = fixtureSpec('totally-made-up');
    expect(s.w).toBeGreaterThan(0);
    expect(s.layer).toBe('A-FURN');
  });
});

describe('fixture symbols', () => {
  it('produces finite primitives for every catalogue kind', () => {
    for (const spec of Object.values(FIXTURES)) {
      for (const prim of fixtureSymbol({ kind: spec.kind, w: spec.w, d: spec.d })) {
        if (prim.t === 'line') {
          for (const p of [prim.a, prim.b]) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        } else if (prim.t === 'circle') {
          expect(prim.r).toBeGreaterThan(0);
        } else {
          expect(prim.pts.length).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('stairs draw a step line per tread plus a direction arrow', () => {
    const steps = stairStepCount(3000); // ~10 treads
    expect(steps).toBe(10);
    const prims = fixtureSymbol({ kind: 'stairs', w: 3000, d: 1000 });
    const lines = prims.filter((p) => p.t === 'line').length;
    // (steps - 1) interior risers + 3 arrow strokes.
    expect(lines).toBe(steps - 1 + 3);
  });

  it('maps a local symbol point through rotation + translation', () => {
    const p = fixtureLocalToWorld({ x: 1000, y: 2000, rotation: 90 }, { x: 100, y: 0 });
    expect(p.x).toBeCloseTo(1000, 5);
    expect(p.y).toBeCloseTo(2100, 5);
  });
});

// ─── Wall snapping ────────────────────────────────────────────────────────────

describe('snapFixtureToWall', () => {
  // A horizontal wall along y=0 from x=0..4000, 100 mm thick.
  const wall: Wall = { id: 'w1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 100 };

  it('backs a sofa against the nearest wall face, parallel to it', () => {
    const snapped = snapFixtureToWall({ x: 2000, y: 300, d: 900 }, [wall], 1000);
    expect(snapped).not.toBeNull();
    // Centre sits half-depth off the +y wall face (face at y=50).
    expect(snapped!.y).toBeCloseTo(50 + 450, 3);
    expect(snapped!.x).toBeCloseTo(2000, 3);
    // Parallel to a horizontal wall → 0° (back edge on the wall).
    expect(snapped!.rotation % 180).toBeCloseTo(0, 3);
  });

  it('flips orientation when the fixture is on the other side of the wall', () => {
    const snapped = snapFixtureToWall({ x: 2000, y: -300, d: 900 }, [wall], 1000);
    expect(snapped!.y).toBeCloseTo(-(50 + 450), 3);
    expect(snapped!.rotation).toBeCloseTo(180, 3);
  });

  it('returns null when no wall is within range', () => {
    expect(snapFixtureToWall({ x: 2000, y: 5000, d: 900 }, [wall], 1000)).toBeNull();
  });
});

// ─── Op reducers ──────────────────────────────────────────────────────────────

function addStairs(e: PlanEngine): string {
  e.apply(ok({ op: 'add_fixture', kind: 'stairs', nums: { x: 0, y: 0, w: 3000, d: 1000, rotation: 0 } }));
  return e.getState().selectedId!;
}

describe('component op reducers', () => {
  it('add_fixture places the component and selects it', () => {
    const e = new PlanEngine();
    const id = addStairs(e);
    const f = e.getState().fixtures.find((x) => x.id === id)!;
    expect(f.kind).toBe('stairs');
    expect(f.w).toBe(3000);
    expect(e.getState().selectedIds).toEqual([id]);
  });

  it('rotate turns a fixture and normalises the angle', () => {
    const e = new PlanEngine();
    const id = addStairs(e);
    e.apply(ok({ op: 'rotate', target: id, nums: { angle: 90 } }));
    expect(e.getState().fixtures[0].rotation).toBe(90);
    e.apply(ok({ op: 'rotate', target: id, nums: { angle: 300 } }));
    expect(e.getState().fixtures[0].rotation).toBe(30); // 390 → 30
  });

  it('set_size resizes width and/or depth independently', () => {
    const e = new PlanEngine();
    const id = addStairs(e);
    e.apply(ok({ op: 'set_size', target: id, nums: { w: 2 }, unit: 'm' }));
    expect(e.getState().fixtures[0].w).toBe(2000);
    expect(e.getState().fixtures[0].d).toBe(1000); // depth untouched
  });

  it('move translates a fixture; delete + undo round-trips', () => {
    const e = new PlanEngine();
    const id = addStairs(e);
    e.apply(ok({ op: 'move', target: id, nums: { dx: 500, dy: -200 } }));
    expect(e.getState().fixtures[0].x).toBe(500);
    e.apply(ok({ op: 'delete', target: id }));
    expect(e.getState().fixtures.length).toBe(0);
    e.apply({ op: 'undo' });
    expect(e.getState().fixtures.length).toBe(1);
  });

  it('text ops add, edit, resize and delete a label', () => {
    const e = new PlanEngine();
    e.apply(ok({ op: 'add_text', nums: { x: 100, y: 200 }, text: 'Kitchen' }));
    const id = e.getState().selectedId!;
    expect(e.getState().texts[0].text).toBe('Kitchen');
    e.apply(ok({ op: 'set_text', target: id, text: 'Living' }));
    expect(e.getState().texts[0].text).toBe('Living');
    e.apply(ok({ op: 'set_font', target: id, nums: { size: 500 } }));
    expect(e.getState().texts[0].size).toBe(500);
    e.apply(ok({ op: 'delete', target: id }));
    expect(e.getState().texts.length).toBe(0);
  });
});

// ─── DXF layers ───────────────────────────────────────────────────────────────

describe('DXF component layers', () => {
  const doc = (): PlanDoc => {
    const e = new PlanEngine();
    e.apply(ok({ op: 'add_fixture', kind: 'stairs', nums: { x: 0, y: 0, w: 3000, d: 1000, rotation: 0 } }));
    e.apply(ok({ op: 'add_fixture', kind: 'column-round', nums: { x: 5000, y: 0, w: 400, d: 400, rotation: 0 } }));
    e.apply(ok({ op: 'add_fixture', kind: 'sofa', nums: { x: 2000, y: 3000, w: 2000, d: 900, rotation: 0 } }));
    e.apply(ok({ op: 'add_fixture', kind: 'toilet', nums: { x: 6000, y: 3000, w: 400, d: 700, rotation: 0 } }));
    e.apply(ok({ op: 'add_text', nums: { x: 0, y: 0 }, text: 'Hall' }));
    return e.getState();
  };

  it('routes each component kind to its CAD layer', () => {
    const dxf = toDxf(doc());
    expect(dxf).toContain('\n8\nA-FLOR-STRS\n'); // stairs
    expect(dxf).toContain('\n8\nA-COLS\n'); // column
    expect(dxf).toContain('\n8\nA-FURN\n'); // sofa
    expect(dxf).toContain('\n8\nA-FLOR-FIXT\n'); // toilet (sanitary)
    expect(dxf).toContain('\nTEXT\n8\nA-ANNO-TEXT\n'); // text label
  });

  it('exports a round column as a CIRCLE on A-COLS', () => {
    expect(toDxf(doc())).toContain('\nCIRCLE\n8\nA-COLS\n');
  });

  it('fixtureLayer agrees with what the exporter emits', () => {
    expect(fixtureLayer('stairs')).toBe('A-FLOR-STRS');
    expect(fixtureLayer('column-square')).toBe('A-COLS');
    expect(fixtureLayer('desk')).toBe('A-FURN');
    expect(fixtureLayer('bathtub')).toBe('A-FLOR-FIXT');
  });
});

// ─── Voice ────────────────────────────────────────────────────────────────────

describe('component voice commands', () => {
  it('"add a bed here" places a double bed at the cursor', () => {
    setPlanCursor({ x: 1234, y: 5678 });
    const r = parsePlanCommand('add a bed here') as Record<string, any>;
    expect(r.op).toBe('add_fixture');
    expect(r.kind).toBe('bed-double');
    expect(r.nums.x).toBe(1234);
    expect(r.nums.y).toBe(5678);
    setPlanCursor(null);
  });

  it('"add a single bed" chooses the single variant', () => {
    expect((parsePlanCommand('add a single bed') as any).kind).toBe('bed-single');
  });

  it('"add a sofa" and "add stairs" resolve the right kinds', () => {
    expect((parsePlanCommand('add a sofa') as any).kind).toBe('sofa');
    expect((parsePlanCommand('add stairs') as any).kind).toBe('stairs');
    expect((parsePlanCommand('add a round column') as any).kind).toBe('column-round');
  });

  it('"rotate it" rotates the selection 90°', () => {
    const r = parsePlanCommand('rotate it') as any;
    expect(r.op).toBe('rotate');
    expect(r.nums.angle).toBe(90);
  });

  it('"make it 2 metres wide" sets the width in metres', () => {
    const r = parsePlanCommand('make it 2 metres wide') as any;
    expect(r.op).toBe('set_size');
    expect(r.nums.w).toBe(2);
    expect(r.unit).toBe('m');
  });

  it('the placed component validates end-to-end into the engine', () => {
    setPlanCursor({ x: 0, y: 0 });
    const e = new PlanEngine();
    e.apply(ok(parsePlanCommand('add a toilet')));
    expect(e.getState().fixtures[0].kind).toBe('toilet');
    setPlanCursor(null);
  });
});
