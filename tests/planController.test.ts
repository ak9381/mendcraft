import { afterEach, describe, expect, it } from 'vitest';
import { createPlanController } from '../src/plan/controller';
import { parsePlanCommand } from '../src/plan/ruleParser';
import { setModelsForTest } from '../src/ai/hybrid';
import { wallLength, type PlanDoc } from '../src/plan/doc';

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
    expect(doc0.rooms).toHaveLength(2);
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

  it('lists rooms and walls for the accessible panel', async () => {
    setModelsForTest({ enabled: false });
    const c = createPlanController();
    await c.generate('two bedroom plan');
    const items = c.listItems();
    expect(items.some((i) => i.label.includes('Bedroom 1'))).toBe(true);
    expect(items.some((i) => i.label.startsWith('Wall w3'))).toBe(true);
  });
});
