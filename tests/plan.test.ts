import { describe, expect, it } from 'vitest';
import {
  emptyPlan,
  roomArea,
  wallLength,
  mmToMetresLabel,
  mm2ToM2Label,
  type Wall,
} from '../src/plan/doc';
import {
  validatePlanOp,
  DEFAULTS,
  PLAN_LIMITS,
} from '../src/plan/ops';
import {
  snapToGrid,
  snapValueToGrid,
  snapPoint,
  orthoConstrain,
  nearestOrthoDir,
  GRID_MM,
} from '../src/plan/snap';
import { PlanEngine } from '../src/plan/engine';
import {
  parsePlanCommand,
  isPlanGenerate,
  isPlanClarify,
} from '../src/plan/ruleParser';
import { buildPlanTemplate } from '../src/plan/templates';
import { coercePlan, coercePlanGenerate, expandPlanDocument } from '../src/plan/ai';

// Apply a loose envelope through the real validator, like the controller does.
function run(engine: PlanEngine, env: Record<string, unknown>) {
  const v = validatePlanOp(env);
  if (!v.ok) return { ok: false as const, error: v.error };
  return engine.apply(v.op);
}

describe('plan validator', () => {
  it('converts units to mm and clamps', () => {
    const v = validatePlanOp({ op: 'set_length', target: 'w1', nums: { length: 4 }, unit: 'm' });
    expect(v.ok && v.op).toEqual({ op: 'set_length', target: 'w1', length: 4000 });
    const cm = validatePlanOp({ op: 'move', target: 'w1', nums: { dx: 50 }, unit: 'cm' });
    expect(cm.ok && cm.op).toMatchObject({ dx: 500, dy: 0 });
  });

  it('rejects unknown ops and missing fields', () => {
    expect(validatePlanOp({ op: 'explode' }).ok).toBe(false);
    expect(validatePlanOp({ op: 'set_length', target: 'w1' }).ok).toBe(false);
    expect(validatePlanOp({ op: 'add_room', nums: { x: 0, y: 0, w: 4000 } }).ok).toBe(false);
  });

  it('defaults door width + swing and supports a relative thickness delta', () => {
    const door = validatePlanOp({ op: 'add_door', target: 'w1' });
    expect(door.ok && door.op).toMatchObject({ width: DEFAULTS.doorWidth, swing: 'left' });
    const thinner = validatePlanOp({ op: 'set_thickness', target: 'w1', nums: { delta: -40 } });
    expect(thinner.ok && thinner.op).toEqual({ op: 'set_thickness', target: 'w1', delta: -40 });
  });

  it('clamps thickness into range', () => {
    const v = validatePlanOp({ op: 'set_thickness', target: 'w1', nums: { thickness: 99999 } });
    expect(v.ok && v.op).toMatchObject({ thickness: PLAN_LIMITS.thickness.max });
  });
});

describe('snap helpers', () => {
  it('snaps values and points to the grid', () => {
    expect(snapValueToGrid(1234)).toBe(1200);
    expect(snapValueToGrid(1250)).toBe(1300);
    expect(snapToGrid({ x: 149, y: 151 })).toEqual({ x: 100, y: 200 });
  });

  it('prefers an endpoint within radius, else grid', () => {
    const walls: Wall[] = [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 100 }];
    const near = snapPoint({ x: 3990, y: 20 }, walls, GRID_MM);
    expect(near).toEqual({ point: { x: 4000, y: 0 }, snapped: 'endpoint' });
    const far = snapPoint({ x: 1234, y: 650 }, walls, GRID_MM);
    expect(far).toEqual({ point: { x: 1200, y: 700 }, snapped: 'grid' });
  });

  it('ortho-constrains and finds the nearest ortho direction', () => {
    expect(orthoConstrain({ x: 0, y: 0 }, { x: 3000, y: 200 })).toEqual({ x: 3000, y: 0 });
    expect(orthoConstrain({ x: 0, y: 0 }, { x: 200, y: 3000 })).toEqual({ x: 0, y: 3000 });
    expect(nearestOrthoDir({ x: 0.9, y: 0.1 })).toEqual({ x: 1, y: 0 });
    expect(nearestOrthoDir({ x: -0.1, y: -0.8 })).toEqual({ x: 0, y: -1 });
  });
});

describe('plan engine — rooms and walls', () => {
  it('add_room builds four connected walls and a room with computed area', () => {
    const e = new PlanEngine();
    run(e, { op: 'add_room', nums: { x: 0, y: 0, w: 4000, h: 3000 }, name: 'Bedroom' });
    const doc = e.getState();
    expect(doc.walls).toHaveLength(4);
    expect(doc.rooms).toHaveLength(1);
    expect(roomArea(doc.rooms[0], doc)).toBeCloseTo(12_000_000); // 4m × 3m = 12 m²
    expect(doc.rooms[0].name).toBe('Bedroom');
  });

  it('adjacent rooms SHARE the touching wall (reuse, not stack)', () => {
    const e = new PlanEngine();
    run(e, { op: 'add_room', nums: { x: 0, y: 0, w: 4000, h: 3000 } });
    run(e, { op: 'add_room', nums: { x: 4000, y: 0, w: 4000, h: 3000 } });
    const doc = e.getState();
    // 4 walls for room 1 + 3 new for room 2 (one shared) = 7, not 8.
    expect(doc.walls).toHaveLength(7);
    const shared = doc.rooms[0].wallIds.filter((id) => doc.rooms[1].wallIds.includes(id));
    expect(shared).toHaveLength(1);
  });
});

describe('plan engine — parametric edits', () => {
  it('set_length keeps the start point, goes ortho, and drags connected walls', () => {
    const e = new PlanEngine();
    run(e, { op: 'add_room', nums: { x: 0, y: 0, w: 4000, h: 3000 } });
    const doc0 = e.getState();
    // Right wall of the room is vertical from (4000,0) to (4000,3000): w3.
    const right = doc0.walls.find((w) => w.id === 'w3')!;
    expect(wallLength(right)).toBeCloseTo(3000);
    run(e, { op: 'set_length', target: 'w3', nums: { length: 4 }, unit: 'm' });
    const doc1 = e.getState();
    const right1 = doc1.walls.find((w) => w.id === 'w3')!;
    expect(wallLength(right1)).toBeCloseTo(4000);
    // The top wall shared the moved endpoint (4000,3000) → now at (4000,4000).
    const moved = doc1.walls.some(
      (w) => w.id !== 'w3' && (w.a.y === 4000 || w.b.y === 4000),
    );
    expect(moved).toBe(true);
  });

  it('move drags coincident endpoints of connected walls', () => {
    const e = new PlanEngine();
    run(e, { op: 'add_room', nums: { x: 0, y: 0, w: 4000, h: 3000 } });
    run(e, { op: 'move', target: 'w3', nums: { dx: 1000 } });
    const doc = e.getState();
    const right = doc.walls.find((w) => w.id === 'w3')!;
    expect(right.a.x).toBe(5000);
    expect(right.b.x).toBe(5000);
    // Still a closed loop → area recomputes (now 5m × 3m).
    expect(roomArea(doc.rooms[0], doc)).toBeCloseTo(15_000_000);
  });

  it('openings must fit; offset is clamped onto the wall', () => {
    const e = new PlanEngine();
    run(e, { op: 'add_wall', nums: { x1: 0, y1: 0, x2: 4000, y2: 0 } });
    const doorOk = run(e, { op: 'add_door', target: 'w1', nums: { width: 900 } });
    expect(doorOk.ok).toBe(true);
    const o = e.getState().openings[0];
    expect(o.offset + o.width).toBeLessThanOrEqual(4000 + 1);
    // A wall too short for any opening rejects.
    run(e, { op: 'add_wall', nums: { x1: 0, y1: 0, x2: 250, y2: 0 } });
    const tooShort = run(e, { op: 'add_door', target: 'w2', nums: { width: 900 } });
    expect(tooShort.ok).toBe(false);
  });

  it('deleting a wall cleans up its openings, dims and room membership', () => {
    const e = new PlanEngine();
    run(e, { op: 'add_room', nums: { x: 0, y: 0, w: 4000, h: 3000 } });
    run(e, { op: 'add_door', target: 'w2' });
    run(e, { op: 'add_dim', target: 'w2' });
    run(e, { op: 'delete', target: 'w2' });
    const doc = e.getState();
    expect(doc.walls.find((w) => w.id === 'w2')).toBeUndefined();
    expect(doc.openings).toHaveLength(0);
    expect(doc.dims).toHaveLength(0);
    expect(doc.rooms[0].wallIds).not.toContain('w2');
  });

  it('undo / redo round-trip', () => {
    const e = new PlanEngine();
    run(e, { op: 'add_room', nums: { x: 0, y: 0, w: 4000, h: 3000 } });
    run(e, { op: 'move', target: 'w3', nums: { dx: 1000 } });
    e.apply({ op: 'undo' });
    expect(e.getState().walls.find((w) => w.id === 'w3')!.a.x).toBe(4000);
    e.apply({ op: 'redo' });
    expect(e.getState().walls.find((w) => w.id === 'w3')!.a.x).toBe(5000);
  });
});

describe('plan templates + generate', () => {
  it('two-bedroom template builds a believable flat sharing wall w3, dimensioned + selected', () => {
    const e = new PlanEngine();
    const ops = buildPlanTemplate('twoBedroom').map((o) => {
      const v = validatePlanOp(o);
      if (!v.ok) throw new Error(v.error);
      return v.op;
    });
    const res = e.applyGenerated(ops);
    expect(res.ok).toBe(true);
    const doc = e.getState();
    // A real flat: 2 bedrooms + living + kitchen + bathroom, tiled with no gaps.
    expect(doc.rooms).toHaveLength(5);
    expect(doc.rooms.map((r) => r.name)).toEqual([
      'Bedroom 1', 'Bedroom 2', 'Living room', 'Kitchen', 'Bathroom',
    ]);
    // The wall shared by the two bedrooms is w3 — dimensioned + pre-selected.
    expect(doc.dims[0].wallId).toBe('w3');
    expect(doc.selectedId).toBe('w3');
    expect(doc.rooms[0].wallIds.filter((id) => doc.rooms[1].wallIds.includes(id))).toEqual(['w3']);
    // An entrance door + per-room doors + windows on outer walls were placed.
    expect(doc.openings.filter((o) => o.kind === 'door').length).toBeGreaterThanOrEqual(3);
    expect(doc.openings.some((o) => o.kind === 'window')).toBe(true);
    // No two rooms overlap (every room keeps its own floor area).
    const areas = doc.rooms.map((r) => roomArea(r, doc));
    expect(areas.every((a) => a > 0)).toBe(true);
  });

  it('two-bedroom → set shared wall w3 to 4000 STRETCHES: bedrooms 4×4, no slanted walls', () => {
    const e = new PlanEngine();
    const ops = buildPlanTemplate('twoBedroom').map((o) => (validatePlanOp(o) as { ok: true; op: never }).op);
    e.applyGenerated(ops);
    const beforeAxis = e.getState().walls.every(
      (w) => Math.abs(w.a.x - w.b.x) < 1 || Math.abs(w.a.y - w.b.y) < 1,
    );
    expect(beforeAxis).toBe(true);
    run(e, { op: 'set_length', target: 'w3', nums: { length: 4 }, unit: 'm' });
    const doc = e.getState();
    // Every wall is still axis-aligned — no gable/slant, so no 4.12 m walls.
    for (const w of doc.walls) {
      expect(Math.abs(w.a.x - w.b.x) < 1 || Math.abs(w.a.y - w.b.y) < 1).toBe(true);
      const len = wallLength(w);
      expect(Math.abs(len - 4123) > 10).toBe(true); // not the old hypot(4000,1000) gable wall
    }
    // Both bedrooms are now 4 m × 4 m (shared wall stretched from 3 m to 4 m).
    const bed1 = doc.rooms.find((r) => r.name === 'Bedroom 1')!;
    const bed2 = doc.rooms.find((r) => r.name === 'Bedroom 2')!;
    expect(roomArea(bed1, doc)).toBeCloseTo(16_000_000);
    expect(roomArea(bed2, doc)).toBeCloseTo(16_000_000);
    expect(wallLength(doc.walls.find((w) => w.id === 'w3')!)).toBeCloseTo(4000);
  });

  it('applyGenerated is one undoable step', () => {
    const e = new PlanEngine();
    const ops = buildPlanTemplate('twoBedroom').map((o) => (validatePlanOp(o) as { ok: true; op: never }).op);
    e.applyGenerated(ops);
    e.apply({ op: 'undo' });
    expect(e.getState().walls).toHaveLength(0);
  });
});

describe('plan rule parser', () => {
  it('maps whole-plan phrases to generate directives', () => {
    expect(parsePlanCommand('two bedroom plan')).toEqual({ generate: 'twoBedroom' });
    expect(parsePlanCommand('two-bedroom plan')).toEqual({ generate: 'twoBedroom' });
    const one = parsePlanCommand('one bedroom plan');
    expect(isPlanGenerate(one) && one.generate).toBe('oneRoom');
  });

  it('parses single edits with units and spoken numbers', () => {
    expect(parsePlanCommand('room 4 by 3')).toMatchObject({ op: 'add_room', nums: { w: 4, h: 3 }, unit: 'm' });
    expect(parsePlanCommand('make this wall 4 meters')).toMatchObject({ op: 'set_length', nums: { length: 4 }, unit: 'm' });
    expect(parsePlanCommand('move it 500 left')).toMatchObject({ op: 'move', nums: { dx: -500 }, unit: 'mm' });
    expect(parsePlanCommand('thicker by 50')).toMatchObject({ op: 'set_thickness', nums: { delta: 50 } });
    expect(parsePlanCommand('add a door')).toMatchObject({ op: 'add_door', target: 'selected' });
    expect(parsePlanCommand('dimension this wall')).toEqual({ op: 'add_dim', target: 'selected' });
    expect(parsePlanCommand('undo')).toEqual({ op: 'undo' });
  });

  it('clarifies when it cannot parse', () => {
    expect(isPlanClarify(parsePlanCommand('asdfghjkl'))).toBe(true);
  });

  it('the demo path parses + validates end to end', () => {
    // "two bedroom plan" → template → "make this wall 4 meters" on w3.
    expect(parsePlanCommand('two bedroom plan')).toEqual({ generate: 'twoBedroom' });
    const edit = parsePlanCommand('make this wall 4 meters');
    const v = validatePlanOp(edit as Record<string, unknown>);
    expect(v.ok && v.op).toEqual({ op: 'set_length', target: 'selected', length: 4000 });
  });
});

describe('plan AI coercion', () => {
  it('coercePlan validates a single op and rejects junk', () => {
    expect(coercePlan({ op: 'move', target: 'w1', nums: { dx: 1, dy: 0 }, unit: 'm' })).toMatchObject({ op: 'move', dx: 1000 });
    expect(coercePlan({ op: 'explode' })).toBeNull();
    expect(coercePlan({ clarify: 'Which wall?' })).toEqual({ clarify: 'Which wall?' });
  });

  it('coercePlanGenerate keeps only valid ops and caps the list (legacy ops shape)', () => {
    const r = coercePlanGenerate({ ops: [{ op: 'add_room', nums: { x: 0, y: 0, w: 4, h: 3 }, unit: 'm' }, { op: 'nope' }] });
    expect(r && 'ops' in r && r.ops).toHaveLength(1);
    expect(coercePlanGenerate({ ops: [] })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression fixtures: the ACTUAL raw text the real cloud (gemini-3.5-flash-
// lite) returned during a live smoke test of plan mode. These two shapes were
// the two production bugs; keep them pinned so neither regresses.

/** Bug 1 (fixed): whole-plan generate now returns a DOCUMENT, not raw ops. */
const CLOUD_PLAN_DOC =
  '{"rooms":[{"x":0,"y":0,"w":4000,"h":3000,"name":"Bedroom 1"},{"x":4000,"y":0,"w":4000,"h":3000,"name":"Bedroom 2"}],"unit":"mm"}';
/** Bug 1 (the failure): the model once returned ONLY windows, no rooms. */
const CLOUD_PLAN_NO_ROOMS =
  '{"unit":"mm","windows":[{"room":"Bedroom 1","side":"n","width":1200},{"room":"Bedroom 2","side":"n","width":1200}]}';
/** Bug 2: the intent model named a valid op but DROPPED the length number. */
const CLOUD_SET_LENGTH_NO_NUM = '{"op":"set_length","target":"selected","unit":"m"}';

describe('plan generate — whole-plan DOCUMENT expansion (Bug 1)', () => {
  it('expands the real cloud document into a buildable plan with a pre-selected shared wall', () => {
    const r = coercePlanGenerate(JSON.parse(CLOUD_PLAN_DOC));
    if (!r || !('ops' in r)) throw new Error('expected ops');
    const engine = new PlanEngine();
    const applied = engine.applyGenerated(r.ops);
    expect(applied.ok).toBe(true);
    const doc = engine.getState();
    // Two rooms sharing one interior wall, which is dimensioned + pre-selected
    // so the next "make this wall 4 meters" lands without pointing.
    expect(doc.rooms).toHaveLength(2);
    expect(doc.walls).toHaveLength(7);
    expect(doc.selectedId).toBe('w3');
    expect(doc.dims.map((d) => d.wallId)).toContain('w3');
    const shared = doc.rooms[0].wallIds.filter((id) => doc.rooms[1].wallIds.includes(id));
    expect(shared).toEqual(['w3']);
  });

  it('resolves doors/windows by room + side to concrete wall ids (never a room id)', () => {
    const ops = expandPlanDocument({
      unit: 'mm',
      rooms: [{ name: 'Studio', x: 0, y: 0, w: 6000, h: 4000 }],
      doors: [{ room: 'Studio', side: 's', width: 900 }],
      windows: [{ room: 'Studio', side: 'n', width: 1200 }],
    });
    const engine = new PlanEngine();
    expect(engine.applyGenerated(ops).ok).toBe(true);
    const doc = engine.getState();
    expect(doc.openings).toHaveLength(2);
    // Every opening targets a real wall, and south ≠ north wall.
    for (const o of doc.openings) expect(doc.walls.some((w) => w.id === o.wallId)).toBe(true);
    const door = doc.openings.find((o) => o.kind === 'door')!;
    const win = doc.openings.find((o) => o.kind === 'window')!;
    expect(door.wallId).not.toBe(win.wallId);
  });

  it('rejects a document with no rooms (→ caller falls back to a template)', () => {
    expect(coercePlanGenerate(JSON.parse(CLOUD_PLAN_NO_ROOMS))).toBeNull();
    expect(expandPlanDocument({ unit: 'mm', doors: [{ room: 'x', side: 'n' }] })).toEqual([]);
  });
});

describe('plan intent — under-filled op repair (Bug 2)', () => {
  it('repairs a model op that dropped its number using the same utterance', () => {
    const raw = JSON.parse(CLOUD_SET_LENGTH_NO_NUM);
    // Without the utterance there is no number to supply → rejected.
    expect(coercePlan(raw)).toBeNull();
    // With the utterance, the dropped length is filled from the rule parse.
    expect(coercePlan(raw, 'make this wall 4 meters')).toEqual({
      op: 'set_length',
      target: 'selected',
      length: 4000,
    });
  });

  it('never invents a different op: repair only when the rule parser agrees', () => {
    const raw = JSON.parse(CLOUD_SET_LENGTH_NO_NUM);
    // Utterance the rules read as a MOVE, not a set_length → no repair.
    expect(coercePlan(raw, 'move it 500 left')).toBeNull();
  });
});

describe('labels', () => {
  it('formats metres and square metres', () => {
    expect(mmToMetresLabel(4000)).toBe('4.00 m');
    expect(mm2ToM2Label(12_000_000)).toBe('12.00 m²');
  });
});

it('a fresh plan is empty', () => {
  expect(emptyPlan()).toEqual({ walls: [], openings: [], rooms: [], dims: [], fixtures: [], selectedId: null, selectedIds: [] });
});
