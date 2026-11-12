import { describe, expect, it } from 'vitest';
import { Engine } from '../src/core/scene';
import { buildTemplate, isTemplateName } from '../src/core/templates';
import { parseCommand, isTemplateCommand, isClarify } from '../src/core/ruleParser';
import type { Op } from '../src/core/ops';

describe('/?sim=1 demo script via the rule parser', () => {
  it('builds, warns on a thin wall, then fixes it', () => {
    const e = new Engine();
    const warn: number[] = [];
    for (const u of ['cup grip', 'select sleeve', 'make it narrower by 7', 'make it wider by 7']) {
      const r = parseCommand(u);
      expect(isClarify(r), u).toBe(false);
      if (isTemplateCommand(r)) {
        expect(isTemplateName(r.template)).toBe(true);
        for (const op of buildTemplate(r.template as never, r.params as never)) expect(e.apply(op).ok).toBe(true);
        warn.push(0);
      } else {
        const res = e.apply(r as Op);
        expect(res.ok, `${u}: ${res.error}`).toBe(true);
        warn.push(res.warnings.filter((w) => w.kind === 'thin-wall').length);
      }
    }
    expect(warn).toEqual([0, 0, 1, 0]);
  });

  it('resolves spoken partial names, including parts merged by union', () => {
    const e = new Engine();
    for (const op of buildTemplate('cupGrip')) e.apply(op);
    expect(e.apply({ op: 'select', target: 'handle' } as Op).ok).toBe(true);
  });
});
