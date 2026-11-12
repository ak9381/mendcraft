import { describe, expect, it } from 'vitest';
import {
  getActiveMode,
  getMode,
  listModes,
  setActiveMode,
  partMode,
} from '../src/core/modes';
import { isClarify, isTemplateCommand } from '../src/core/ruleParser';
import { TEMPLATE_NAMES } from '../src/core/templates';

describe('mode registry', () => {
  it('hosts the part, plan, and ui modes', () => {
    const ids = listModes().map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(['part', 'plan', 'ui']));
  });

  it('defaults to the ready 3D part mode', () => {
    expect(getActiveMode().id).toBe('part');
    expect(getActiveMode().status).toBe('ready');
  });

  it('marks plan and ui as coming-soon and refuses to activate them', () => {
    expect(getMode('plan')?.status).toBe('coming-soon');
    expect(getMode('ui')?.status).toBe('coming-soon');
    expect(setActiveMode('plan')).toBe(false);
    expect(setActiveMode('ui')).toBe(false);
    expect(setActiveMode('nope')).toBe(false);
    // Still on part after the failed switches.
    expect(getActiveMode().id).toBe('part');
    // The ready mode can be (re)activated.
    expect(setActiveMode('part')).toBe(true);
  });

  it('exposes the 3D mode with starter items and quick-start hints', () => {
    const part = getMode('part');
    expect(part).toBe(partMode);
    expect(part?.label).toBe('3D part');
    expect(part?.starterItems).toEqual(TEMPLATE_NAMES);
    expect(part?.hints.length).toBeGreaterThan(0);
    // The input placeholder + example come from the mode, not hard-coded.
    expect(part?.inputPlaceholder).toMatch(/cup grip/i);
    expect(part?.exampleCommand).toBe('cup grip');
  });

  it("hints drive the UI helpers: every quick-start button parses to a buildable command", () => {
    // The empty-plate buttons and onboarding "try a command" examples send
    // hint.command through the mode parser; each must resolve (not clarify).
    for (const h of partMode.hints) {
      const parsed = partMode.parse(h.command);
      expect(isClarify(parsed), `hint "${h.command}" should not clarify`).toBe(false);
    }
    // The canonical starter resolves to its template.
    const cup = partMode.parse('cup grip');
    expect(isTemplateCommand(cup) && cup.template).toBe('cupGrip');
  });

  it('coming-soon modes are inert: parse clarifies and exposes no starter items', () => {
    const plan = getMode('plan')!;
    expect(plan.starterItems).toEqual([]);
    expect(isClarify(plan.parse('anything'))).toBe(true);
  });
});
