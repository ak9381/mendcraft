import { describe, expect, it } from 'vitest';
import { PlanEngine } from '../src/plan/engine';
import { validatePlanOp, type PlanOp } from '../src/plan/ops';
import { buildPlanTemplate } from '../src/plan/templates';
import { toDxf, toJson, DXF_LAYERS } from '../src/plan/export';

function validated(env: Record<string, unknown>): PlanOp {
  const v = validatePlanOp(env);
  if (!v.ok) throw new Error(`${JSON.stringify(env)} => ${v.error}`);
  return v.op;
}

function buildTwoBedroom(): PlanEngine {
  const e = new PlanEngine();
  e.applyGenerated(buildPlanTemplate('twoBedroom').map(validated));
  // Add a door + window so OPENINGS entities appear.
  e.apply(validated({ op: 'add_door', target: 'w2' }));
  e.apply(validated({ op: 'add_window', target: 'w4' }));
  return e;
}

describe('DXF export', () => {
  const dxf = toDxf(buildTwoBedroom().getState());

  it('is a well-formed R12-ish DXF with TABLES + ENTITIES + EOF', () => {
    expect(dxf.startsWith('0\nSECTION\n2\nTABLES')).toBe(true);
    expect(dxf).toContain('2\nENTITIES');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
  });

  it('declares all four layers', () => {
    for (const layer of DXF_LAYERS) {
      expect(dxf).toContain(`\nLAYER\n2\n${layer}\n`);
    }
  });

  it('emits wall LINEs, an opening ARC, a dimension TEXT and a room LABEL', () => {
    expect(dxf).toContain('\nLINE\n8\nWALLS\n');
    expect(dxf).toContain('\nARC\n8\nOPENINGS\n'); // door swing
    expect(dxf).toContain('\nLINE\n8\nOPENINGS\n'); // window
    expect(dxf).toContain('\nTEXT\n8\nDIMS\n'); // dimension label
    expect(dxf).toContain('\nTEXT\n8\nLABELS\n'); // room name/area
  });

  it('dimension text reads in metres', () => {
    expect(dxf).toMatch(/\bm\b/);
    expect(dxf).toContain('Bedroom 1');
  });
});

describe('JSON export', () => {
  it('round-trips the document', () => {
    const doc = buildTwoBedroom().getState();
    const parsed = JSON.parse(toJson(doc));
    expect(parsed.walls.length).toBe(doc.walls.length);
    expect(parsed.rooms[0].name).toBe('Bedroom 1');
  });
});
