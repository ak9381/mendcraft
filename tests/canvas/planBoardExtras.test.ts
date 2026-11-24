import { describe, expect, it } from 'vitest';
import { emptyPlan, type PlanDoc } from '../../src/plan/doc';
import { NOTHING_TO_CHECK, accessibilityReport, exportPlanDxf, parsePlanExtra } from '../../src/canvas/planExtras';

const narrowDoorPlan = (): PlanDoc => ({
  ...emptyPlan(),
  walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 }],
  openings: [{ id: 'o1', kind: 'door', wallId: 'w1', offset: 1000, width: 600 }],
});

describe('plan board extras: routing', () => {
  it.each([
    ['check accessibility', 'check'],
    ['Check the accessibility', 'check'],
    ['make it wheelchair friendly', 'check'],
    ['show 3d', '3d'],
    ['3d', '3d'],
    ['toggle 3D view', '3d'],
    ['export dxf', 'dxf'],
    ['export plan', 'dxf'],
    ['download the dxf', 'dxf'],
  ])('%s -> %s', (text, want) => {
    expect(parsePlanExtra(text)).toBe(want);
  });
  it.each(['new board', 'zoom in', 'export', 'does the door leave enough width for a wheelchair?'])('%s -> null', (text) => {
    expect(parsePlanExtra(text)).toBeNull();
  });
});

describe('plan board extras: accessibility', () => {
  it('lists the door-width finding locally', () => {
    const r = accessibilityReport(narrowDoorPlan());
    expect(r.empty).toBe(false);
    expect(r.issues.some((i) => i.rule === 'door-clear-width')).toBe(true);
    expect(r.text).toMatch(/door/i);
    expect(r.text).toMatch(/issue/);
  });
  it('an empty plan says there is nothing to check', () => {
    const r = accessibilityReport(emptyPlan());
    expect(r.empty).toBe(true);
    expect(r.text).toBe(NOTHING_TO_CHECK);
    expect(NOTHING_TO_CHECK).toBe('Nothing to check yet — draw or generate a plan first.');
  });
  it('a wide door raises no door-width finding', () => {
    const doc = narrowDoorPlan();
    doc.openings[0].width = 900;
    const r = accessibilityReport(doc);
    expect(r.issues.filter((i) => i.rule === 'door-clear-width')).toHaveLength(0);
    expect(r.text).not.toMatch(/undefined/);
  });
});

describe('plan board extras: DXF', () => {
  it('downloads mendcraft-plan.dxf with DXF content', () => {
    const calls: Array<{ name: string; text: string; mime: string }> = [];
    const name = exportPlanDxf(narrowDoorPlan(), (n, t, m) => calls.push({ name: n, text: t, mime: m }));
    expect(name).toBe('mendcraft-plan.dxf');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('mendcraft-plan.dxf');
    expect(calls[0].mime).toBe('application/dxf');
    expect(calls[0].text).toMatch(/SECTION/);
  });
  it('refuses to export an empty plan', () => {
    const calls: unknown[] = [];
    expect(exportPlanDxf(emptyPlan(), () => calls.push(1))).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
