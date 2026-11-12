import { afterEach, describe, expect, it } from 'vitest';
import { createPlanController } from '../src/plan/controller';
import { parsePlanCommand } from '../src/plan/ruleParser';
import { setModelsForTest } from '../src/ai/hybrid';
import { roomArea, roomPolygon, planBounds, wallLength, type PlanDoc } from '../src/plan/doc';

// The controller's generate() routes through hybrid; with no Firebase key it
// falls back to the deterministic rules path (no network), which is exactly the
// frozen demo contract: "two bedroom plan" must work with no AI.
afterEach(() => setModelsForTest(null));

describe('plan controller — frozen demo path', () => {
  it('generates a two-bedroom plan from rules, then edits the shared wall', async () => {
    setModelsForTest({ enabled: false });
    const c = createPlanController();

    expect(c.isDesignRequest('two bedroom plan')).toBe(true);
    const gen = await c.generate('two bedroom plan');
    expect(gen.source).toBe('rules');
    expect(gen.step.ok).toBe(true);
    // The shared wall is pre-selected + dimensioned (see plan/templates).
    expect(c.selectedId()).toBe('w3');
    const doc0 = c.snapshot() as PlanDoc;
    expect(doc0.rooms).toHaveLength(5); // believable flat: 2 beds + living + kitchen + bath
    expect(doc0.dims).toHaveLength(1);
    expect(wallLength(doc0.walls.find((w) => w.id === 'w3')!)).toBeCloseTo(3000);

    // "make this wall 4 meters" → set_length on the selected shared wall.
    const step = c.applyResult(parsePlanCommand('make this wall 4 meters') as Record<string, unknown>);
    expect(step.ok).toBe(true);
    expect(step.op).toMatchObject({ op: 'set_length', length: 4000 });
    const doc1 = c.snapshot() as PlanDoc;
    expect(wallLength(doc1.walls.find((w) => w.id === 'w3')!)).toBeCloseTo(4000);

    // Undo returns to the generated plan in one step.
    c.applyOp({ op: 'undo' });
    expect(wallLength((c.snapshot() as PlanDoc).walls.find((w) => w.id === 'w3')!)).toBeCloseTo(3000);
  });

  it('stretching the shared wall to 4 m is a believable edit (both bedrooms grow, no stale geometry)', async () => {
    setModelsForTest({ enabled: false });
    const c = createPlanController();
    await c.generate('two bedroom plan');

    const doc0 = c.snapshot() as PlanDoc;
    const beds0 = doc0.rooms.filter((r) => /bedroom/i.test(r.name));
    expect(beds0).toHaveLength(2);
    for (const b of beds0) expect(roomArea(b, doc0) / 1_000_000).toBeCloseTo(12); // 4 m × 3 m
    const h0 = planBounds(doc0)!;
    expect((h0.max.y - h0.min.y) / 1000).toBeCloseTo(6); // 6 m tall

    c.applyResult(parsePlanCommand('make this wall 4 meters') as Record<string, unknown>);
    const doc1 = c.snapshot() as PlanDoc;

    // The shared wall is now 4 m and still shared by BOTH bedrooms (one wall,
    // not a stray wall poking through a room).
    const w3 = doc1.walls.find((w) => w.id === 'w3')!;
    expect(wallLength(w3)).toBeCloseTo(4000);
    const sharedBy = doc1.rooms.filter((r) => r.wallIds.includes('w3'));
    expect(sharedBy.map((r) => r.name).filter((n) => /bedroom/i.test(n))).toHaveLength(2);

    // Both bedrooms grew to 4 m × 4 m = 16 m², every room stays a closed loop
    // (areas still computable — nothing was left dangling), and the plan is 7 m
    // tall (the top edge translated; it did not shear or self-intersect).
    const beds1 = doc1.rooms.filter((r) => /bedroom/i.test(r.name));
    for (const b of beds1) expect(roomArea(b, doc1) / 1_000_000).toBeCloseTo(16);
    for (const r of doc1.rooms) expect(roomPolygon(r, doc1)).not.toBeNull();
    const h1 = planBounds(doc1)!;
    expect((h1.max.y - h1.min.y) / 1000).toBeCloseTo(7);

    // The single dimension now reads 4 m — there is no second (stale) dim.
    expect(doc1.dims).toHaveLength(1);
    expect(wallLength(doc1.walls.find((w) => w.id === doc1.dims[0].wallId)!)).toBeCloseTo(4000);
  });

  it('lists rooms and walls for the accessible panel', async () => {
    setModelsForTest({ enabled: false });
    const c = createPlanController();
    await c.generate('two bedroom plan');
    const items = c.listItems();
    expect(items.some((i) => i.label.includes('Bedroom 1'))).toBe(true);
    expect(items.some((i) => i.label.startsWith('Wall w3'))).toBe(true);
  });
});
