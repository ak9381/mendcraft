import { describe, expect, it } from 'vitest';
import {
  getActiveMode,
  getMode,
  listModes,
  setActiveMode,
  planMode,
} from '../src/core/modes';

const isClarify = (r: object): boolean => 'clarify' in r;

describe('mode registry', () => {
  it('is CAD-only: plan is the single registered mode', () => {
    expect(listModes().map((m) => m.id)).toEqual(['plan']);
  });

  it('defaults to the ready 2D plan mode (the hero)', () => {
    expect(getActiveMode().id).toBe('plan');
    expect(getActiveMode().status).toBe('ready');
  });

  it('UI design and 3D part modes are gone; unknown ids refuse to activate', () => {
    expect(getMode('ui')).toBeUndefined();
    expect(getMode('part')).toBeUndefined();
    expect(setActiveMode('ui')).toBe(false);
    expect(setActiveMode('part')).toBe(false);
    expect(setActiveMode('nope')).toBe(false);
    expect(getActiveMode().id).toBe('plan');
  });

  it('exposes the plan mode with a DXF export label and plan hints', () => {
    expect(getMode('plan')).toBe(planMode);
    expect(planMode.label).toBe('2D plan');
    expect(planMode.exportLabel).toMatch(/dxf/i);
    expect(planMode.exampleCommand).toBe('two bedroom plan');
    expect(planMode.starterItems.length).toBeGreaterThan(0);
  });

  // A whole plan ("two bedroom plan") is drawn by the model, never from a
  // template in the code: the rules only build single edits.
  it("every plan quick-start button is a single edit the rules build, or a whole plan for the model", () => {
    for (const h of planMode.hints) {
      if (planMode.isDesignRequest(h.command)) continue;
      expect(isClarify(planMode.parse(h.command)), `hint "${h.command}" should not clarify`).toBe(false);
    }
    expect(planMode.hints.some((h) => !planMode.isDesignRequest(h.command))).toBe(true);
  });
});
