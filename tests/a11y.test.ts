// Accessibility checker: deterministic plan geometry checks (door clear width,
// turning circle, corridor width, ramp slope, steps), UI checks (WCAG contrast,
// target size, labels), the explain-response coercion, and the hybrid cloud
// explainer with its rules fallback.

import { afterEach, describe, expect, it } from 'vitest';
import { PlanEngine } from '../src/plan/engine';
import { validatePlanOp } from '../src/plan/ops';
import {
  checkCorridors,
  checkDoorWidths,
  checkPlanAccessibility,
  checkRampsAndSteps,
  checkTurningCircles,
  distToFixture,
  distToSegment,
  pointInPolygon,
  turningCircleFits,
} from '../src/plan/accessibility';
import {
  PLAN_A11Y, coerceA11yExplanations, isAccessibilityRequest, recheckFix,
  type A11yIssue,
} from '../src/core/a11y';
import { coercePlan } from '../src/plan/ai';
import { explainAccessibility, setModelsForTest } from '../src/ai/hybrid';

function run(engine: PlanEngine, env: Record<string, unknown>) {
  const v = validatePlanOp(env);
  if (!v.ok) throw new Error(v.error);
  return engine.apply(v.op);
}

/** A single rectangular room, mm. */
function roomPlan(w: number, h: number, name = 'Room'): PlanEngine {
  const engine = new PlanEngine();
  run(engine, { op: 'add_room', x: 0, y: 0, w, h, name });
  return engine;
}

describe('plan geometry helpers', () => {
  it('measures distance to a segment', () => {
    expect(distToSegment({ x: 0, y: 1000 }, { x: -1000, y: 0 }, { x: 1000, y: 0 })).toBe(1000);
    expect(distToSegment({ x: 2000, y: 0 }, { x: -1000, y: 0 }, { x: 1000, y: 0 })).toBe(1000);
  });

  it('tests point-in-polygon', () => {
    const sq = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }];
    expect(pointInPolygon({ x: 500, y: 500 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 1500, y: 500 }, sq)).toBe(false);
  });

  it('measures clearance to a rotated fixture rect', () => {
    const f = { id: 'f1', kind: 'sofa', x: 0, y: 0, w: 2000, d: 1000, rotation: 0 };
    expect(distToFixture({ x: 0, y: 0 }, f)).toBe(0); // inside
    expect(distToFixture({ x: 2000, y: 0 }, f)).toBe(1000);
    const rot = { ...f, rotation: 90 }; // long side now along y
    expect(distToFixture({ x: 2000, y: 0 }, rot)).toBe(1500);
  });
});

describe('door clear width', () => {
  it('fails below the ADA minimum with a widening fix', () => {
    const engine = roomPlan(4000, 3000);
    const wallId = engine.getState().walls[0].id;
    run(engine, { op: 'add_door', target: wallId, nums: { width: 700 } });
    const issues = checkDoorWidths(engine.getState());
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('fail');
    expect(issues[0].citation).toContain('ADA 2010');
    expect(issues[0].citation).toContain('ISO 21542');
    expect(issues[0].fix).toMatchObject({ op: 'set_width', width: PLAN_A11Y.doorClear.recommended });
  });

  it('warns between the ADA minimum and the ISO recommendation', () => {
    const engine = roomPlan(4000, 3000);
    const wallId = engine.getState().walls[0].id;
    run(engine, { op: 'add_door', target: wallId, nums: { width: 820 } });
    const issues = checkDoorWidths(engine.getState());
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warn');
  });

  it('passes at the recommended width and ignores windows', () => {
    const engine = roomPlan(4000, 3000);
    const wallId = engine.getState().walls[0].id;
    run(engine, { op: 'add_door', target: wallId, nums: { width: 850 } });
    run(engine, { op: 'add_window', target: wallId, nums: { width: 600 } });
    expect(checkDoorWidths(engine.getState())).toHaveLength(0);
  });

  it('applying the fix clears the issue', () => {
    const engine = roomPlan(4000, 3000);
    const wallId = engine.getState().walls[0].id;
    run(engine, { op: 'add_door', target: wallId, nums: { width: 700 } });
    const [issue] = checkDoorWidths(engine.getState());
    run(engine, issue.fix!);
    expect(checkDoorWidths(engine.getState())).toHaveLength(0);
  });
});

describe('turning circle', () => {
  it('fits in an empty 4×3 m room', () => {
    const doc = roomPlan(4000, 3000).getState();
    const fit = turningCircleFits(doc.rooms[0], doc);
    expect(fit?.fits).toBe(true);
    expect(checkTurningCircles(doc)).toHaveLength(0);
  });

  it('fails in a 1.5×1.5 m room (walls alone)', () => {
    const doc = roomPlan(1500, 1500, 'Bathroom').getState();
    const issues = checkTurningCircles(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('fail');
    expect(issues[0].targetIds).toContain(doc.rooms[0].id);
  });

  it('reports the blocking fixture when only furniture is in the way', () => {
    const engine = roomPlan(4000, 3000);
    run(engine, { op: 'add_fixture', kind: 'bed-double', nums: { x: 2000, y: 1500, w: 1500, d: 2000 } });
    const doc = engine.getState();
    const fit = turningCircleFits(doc.rooms[0], doc);
    expect(fit?.fits).toBe(false);
    expect(fit?.blockingFixtureIds).toEqual([doc.fixtures[0].id]);
    const issues = checkTurningCircles(doc);
    expect(issues[0].message).toContain('furniture');
    expect(issues[0].targetIds).toContain(doc.fixtures[0].id);
  });
});

describe('corridor width', () => {
  it('warns between 900 and 1000 mm clear', () => {
    // 1000 mm centreline minus a 100 mm wall band = 900 mm clear.
    const doc = roomPlan(4000, 1000, 'Hall').getState();
    const issues = checkCorridors(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warn');
  });

  it('fails under 900 mm clear and the move fix widens it', () => {
    const engine = roomPlan(4000, 900, 'Corridor');
    const issues = checkCorridors(engine.getState());
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('fail');
    expect(issues[0].fix).toBeDefined();
    run(engine, issues[0].fix!);
    expect(checkCorridors(engine.getState())).toHaveLength(0);
  });

  it('ignores rooms not named like corridors', () => {
    const doc = roomPlan(4000, 900, 'Pantry').getState();
    expect(checkCorridors(doc)).toHaveLength(0);
  });
});

describe('ramps and steps', () => {
  it('flags a ramp shorter than 1:12 for the assumed rise, with a lengthen fix', () => {
    const engine = roomPlan(6000, 4000);
    run(engine, { op: 'add_fixture', kind: 'ramp', nums: { x: 1000, y: 1000, w: 1000, d: 900 } });
    const issues = checkRampsAndSteps(engine.getState());
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe('ramp-slope');
    const requiredRun = Math.ceil(PLAN_A11Y.rampAssumedRise / PLAN_A11Y.rampMaxSlope);
    expect(issues[0].fix).toMatchObject({ op: 'set_size', w: requiredRun });
  });

  it('advises a ramp alongside stairs', () => {
    const engine = roomPlan(6000, 4000);
    run(engine, { op: 'add_fixture', kind: 'stairs', nums: { x: 1000, y: 1000, w: 3000, d: 1000 } });
    const issues = checkRampsAndSteps(engine.getState());
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe('threshold-steps');
    expect(issues[0].severity).toBe('warn');
  });

  it('checkPlanAccessibility aggregates all rules', () => {
    const engine = roomPlan(1500, 1500, 'Bathroom');
    const wallId = engine.getState().walls[0].id;
    run(engine, { op: 'add_door', target: wallId, nums: { width: 700 } });
    const rules = checkPlanAccessibility(engine.getState()).map((i) => i.rule);
    expect(rules).toContain('door-clear-width');
    expect(rules).toContain('turning-circle');
  });
});

// ─── UI mode ────────────────────────────────────────────────────────────────

describe('accessibility request detection', () => {
  it('matches the spec phrasings', () => {
    expect(isAccessibilityRequest('make this house wheelchair friendly')).toBe(true);
    expect(isAccessibilityRequest('check accessibility')).toBe(true);
    expect(isAccessibilityRequest('run an accessibility audit')).toBe(true);
    expect(isAccessibilityRequest('is this ADA compliant?')).toBe(false);
    expect(isAccessibilityRequest('Does the bathroom door leave enough width for a wheelchair, and what is the wall thickness?')).toBe(false);
    expect(isAccessibilityRequest('add a door')).toBe(false);
    expect(isAccessibilityRequest('two bedroom plan')).toBe(false);
  });
});

describe('coerceA11yExplanations', () => {
  const known = ['door-o1', 'turn-r1'];

  it('keeps known ids and validates proposed fixes through the mode coercion', () => {
    const items = coerceA11yExplanations(
      {
        items: [
          { id: 'door-o1', explanation: 'Too narrow.', fix: { op: 'set_width', target: 'o1', nums: { width: 850 } } },
          { id: 'unknown-id', explanation: 'dropped' },
          { id: 'turn-r1', explanation: 'No clear circle.', fix: { clarify: 'which room?' } },
        ],
      },
      known,
      (raw) => coercePlan(raw),
    );
    expect(items).toHaveLength(2);
    expect(items[0].fix).toMatchObject({ op: 'set_width', target: 'o1', width: 850 });
    expect(items[1].fix).toBeUndefined(); // clarify is not an op
  });

  it('rejects malformed payloads', () => {
    expect(coerceA11yExplanations(null, known, () => null)).toEqual([]);
    expect(coerceA11yExplanations({ items: 'nope' }, known, () => null)).toEqual([]);
  });
});

describe('explainAccessibility (hybrid)', () => {
  afterEach(() => setModelsForTest(null));

  const issues = [
    { id: 'door-o1', rule: 'door-clear-width', message: 'Door o1 is 700 mm.', citation: 'ADA 2010 §404.2.3' },
  ];

  it('returns cloud explanations with validated fixes', async () => {
    setModelsForTest({
      enabled: true,
      a11yExplain: {
        generateContent: async () => ({
          response: {
            text: () =>
              JSON.stringify({
                items: [{ id: 'door-o1', explanation: 'Wheelchairs need 815 mm.', fix: { op: 'set_width', target: 'o1', nums: { width: 850 } } }],
              }),
            inferenceSource: 'in_cloud',
          },
        }),
      },
    });
    const res = await explainAccessibility(issues, '{}');
    expect(res.source).toBe('cloud');
    expect(res.items).toHaveLength(1);
    expect(res.items[0].fix).toMatchObject({ op: 'set_width', width: 850 });
  });

  it('falls back to rules (empty items) when no cloud model is available', async () => {
    setModelsForTest({ enabled: false });
    const res = await explainAccessibility(issues, '{}');
    expect(res.source).toBe('rules');
    expect(res.items).toEqual([]);
  });

  it('falls back to rules on a malformed cloud response', async () => {
    setModelsForTest({
      enabled: true,
      a11yExplain: {
        generateContent: async () => ({ response: { text: () => 'not json', inferenceSource: 'in_cloud' } }),
      },
    });
    const res = await explainAccessibility(issues, '{}');
    expect(res.source).toBe('rules');
  });
});

// ─── Fixed rules decide: re-check of a proposed (AI or code) fix ────────────

describe('recheckFix', () => {
  const issue = (id: string, message = id): A11yIssue => ({
    id, rule: 'door-clear-width', severity: 'fail', message,
    citation: 'ADA 2010 §404.2.3', targetIds: [id.replace(/^door-/, '')],
  });

  it('accepts a fix that removes the targeted issue and adds none', () => {
    const before = [issue('door-o1'), issue('door-o2')];
    const after = [issue('door-o2')];
    expect(recheckFix(before, after, ['door-o1'])).toEqual({ ok: true });
  });

  it('rejects a fix that leaves the targeted issue flagged', () => {
    const before = [issue('door-o1')];
    const v = recheckFix(before, before, ['door-o1']);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe('not-fixed');
      expect(v.detail).toContain('door-o1');
    }
  });

  it('rejects a fix that breaks another rule (a new issue appears)', () => {
    const before = [issue('door-o1')];
    const after = [issue('corridor-c1', 'Corridor narrowed to 800 mm')];
    const v = recheckFix(before, after, ['door-o1']);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe('new-issue');
      expect(v.detail).toContain('Corridor narrowed');
    }
  });

  it('a batch fix must clear EVERY targeted issue', () => {
    const before = [issue('door-o1'), issue('door-o2')];
    const after = [issue('door-o2')];
    const v = recheckFix(before, after, ['door-o1', 'door-o2']);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('not-fixed');
  });

  it('pre-existing unrelated issues do not block an ok fix', () => {
    const before = [issue('door-o1'), issue('corridor-c1')];
    const after = [issue('corridor-c1')];
    expect(recheckFix(before, after, ['door-o1'])).toEqual({ ok: true });
  });
});
