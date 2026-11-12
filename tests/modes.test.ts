import { describe, expect, it } from 'vitest';
import {
  getActiveMode,
  getMode,
  listModes,
  setActiveMode,
  partMode,
  planMode,
} from '../src/core/modes';
import { isTemplateCommand } from '../src/core/ruleParser';
import { TEMPLATE_NAMES } from '../src/core/templates';

const isClarify = (r: object): boolean => 'clarify' in r;

describe('mode registry', () => {
  it('hosts the part, plan, and ui modes', () => {
    const ids = listModes().map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(['part', 'plan', 'ui']));
  });

  it('defaults to the ready 2D plan mode (the hero)', () => {
    expect(getActiveMode().id).toBe('plan');
    expect(getActiveMode().status).toBe('ready');
  });

  it('plan and part are ready; ui is coming-soon and refuses to activate', () => {
    expect(getMode('plan')?.status).toBe('ready');
    expect(getMode('part')?.status).toBe('ready');
    expect(getMode('ui')?.status).toBe('coming-soon');
    expect(setActiveMode('ui')).toBe(false);
    expect(setActiveMode('nope')).toBe(false);
    // Part stays reachable (mode switch / ?mode=part).
    expect(setActiveMode('part')).toBe(true);
    expect(getActiveMode().id).toBe('part');
    // Restore the default.
    expect(setActiveMode('plan')).toBe(true);
  });

  it('exposes the 3D part mode with starter items and quick-start hints', () => {
    const part = getMode('part');
    expect(part).toBe(partMode);
    expect(part?.label).toBe('3D part');
    expect(part?.starterItems).toEqual(TEMPLATE_NAMES);
    expect(part?.hints.length).toBeGreaterThan(0);
    expect(part?.inputPlaceholder).toMatch(/cup grip/i);
    expect(part?.exampleCommand).toBe('cup grip');
  });

  it('exposes the plan mode with a DXF export label and plan hints', () => {
    expect(getMode('plan')).toBe(planMode);
    expect(planMode.label).toBe('2D plan');
    expect(planMode.exportLabel).toMatch(/dxf/i);
    expect(planMode.exampleCommand).toBe('two bedroom plan');
    expect(planMode.starterItems.length).toBeGreaterThan(0);
  });

  it("every plan quick-start button parses to something buildable (not a clarify)", () => {
    for (const h of planMode.hints) {
      expect(isClarify(planMode.parse(h.command)), `hint "${h.command}" should not clarify`).toBe(false);
    }
  });

  it("every part quick-start button parses to a buildable command", () => {
    for (const h of partMode.hints) {
      expect(isClarify(partMode.parse(h.command)), `hint "${h.command}" should not clarify`).toBe(false);
    }
    const cup = partMode.parse('cup grip');
    expect(isTemplateCommand(cup as never) && (cup as { template: string }).template).toBe('cupGrip');
  });

  it('the coming-soon ui mode is inert: parse clarifies and exposes no starter items', () => {
    const ui = getMode('ui')!;
    expect(ui.status).toBe('coming-soon');
    expect(ui.starterItems).toEqual([]);
    expect(isClarify(ui.parse('anything'))).toBe(true);
  });
});
