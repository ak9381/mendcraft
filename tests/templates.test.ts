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

  describe('applyTemplate replaces the plate in one undoable step', () => {
    it('loads cupGrip twice without colliding on same-named parts', () => {
      const engine = new Engine();
      const first = engine.applyTemplate(buildTemplate('cupGrip'));
      expect(first.ok).toBe(true);
      const afterFirst = engine.getState().parts.length;
      expect(afterFirst).toBeGreaterThan(0);

      // Reloading the same template used to fail ("no part for target
      // 'grip sleeve'") and leave a half-built duplicate; now it starts fresh.
      const second = engine.applyTemplate(buildTemplate('cupGrip'));
      expect(second.ok, second.error).toBe(true);
      expect(engine.getState().parts).toHaveLength(afterFirst);
    });

    it('loads cupGrip then phoneStand, then undo restores cupGrip', () => {
      const engine = new Engine();
      engine.applyTemplate(buildTemplate('cupGrip'));
      const cupNames = engine.getState().parts.map((p) => p.name).sort();

      const stand = engine.applyTemplate(buildTemplate('phoneStand'));
      expect(stand.ok, stand.error).toBe(true);
      const standNames = engine.getState().parts.map((p) => p.name).sort();
      expect(standNames).not.toEqual(cupNames);

      // One undo brings the whole previous design back.
      expect(engine.apply({ op: 'undo' }).ok).toBe(true);
      expect(engine.getState().parts.map((p) => p.name).sort()).toEqual(cupNames);
    });

    it('is atomic: a failing op leaves the previous design untouched', () => {
      const engine = new Engine();
      engine.applyTemplate(buildTemplate('cupGrip'));
      const before = engine.getState();

      const bad = engine.applyTemplate([
        { op: 'add', shape: 'box', params: { w: 10, d: 10, h: 10 }, name: 'orphan' },
        { op: 'union', targets: ['orphan', 'missing part'] },
      ]);
      expect(bad.ok).toBe(false);
      // No half-built parts: state is exactly what it was.
      expect(engine.getState()).toBe(before);
    });
  });
});
