import { describe, expect, it } from 'vitest';
import { TEMPLATE_NAMES, buildTemplate, isTemplateName } from '../src/core/templates';
import { validateOp } from '../src/core/ops';
import { Engine } from '../src/core/scene';

describe('templates', () => {
  for (const name of TEMPLATE_NAMES) {
    it(`${name}: every op validates and applies`, () => {
      const ops = buildTemplate(name);
      expect(ops.length).toBeGreaterThan(0);
      const engine = new Engine();
      for (const op of ops) {
        const v = validateOp(op);
        expect(v.ok, `op failed validation: ${JSON.stringify(op)}`).toBe(true);
        if (v.ok) {
          const r = engine.apply(v.op);
          expect(r.ok, `op failed to apply: ${JSON.stringify(op)} -> ${r.error}`).toBe(true);
        }
      }
      expect(engine.getState().parts.length).toBeGreaterThan(0);
    });
  }

  it('isTemplateName guards correctly', () => {
    expect(isTemplateName('cupGrip')).toBe(true);
    expect(isTemplateName('rocket')).toBe(false);
    expect(isTemplateName(42)).toBe(false);
  });
});
