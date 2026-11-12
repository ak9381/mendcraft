// Part-mode controller: wraps the existing 3D Engine (core/scene) behind the
// generic ModeController the shell drives. Heavy (three.js geometry + STL), so
// it is only ever loaded via EditorMode.createController()'s dynamic import.

import { Engine } from './scene';
import { validateOp } from './ops';
import { buildTemplate, isTemplateName } from './templates';
import { buildScene } from './geometry';
import { meshesToSTL, downloadSTL } from './stl';
import { generateTemplate } from '../ai/hybrid';
import type { ListItem, ModeController, StepResult } from './controller';

export function createPartController(): ModeController {
  const engine = new Engine();

  const warnings = (): string[] => engine.printability().map((w) => w.message);

  function applyTemplateResult(template: string, params: Record<string, number>): StepResult {
    if (!isTemplateName(template)) return { ok: false, error: `Unknown template "${template}".`, warnings: [] };
    const applied = engine.applyTemplate(buildTemplate(template, params));
    if (!applied.ok) return { ok: false, error: applied.error, warnings: warnings() };
    return { ok: true, message: `Built ${template}.`, warnings: applied.warnings.map((w) => w.message) };
  }

  const controller: ModeController = {
    dragRangeMm: 300,
    summary: () => engine.summary(),
    selectedId: () => engine.getState().selectedId,
    warnings,
    snapshot: () => engine.getState(),

    listItems(): ListItem[] {
      const state = engine.getState();
      return state.parts.map((p) => ({
        id: p.id,
        label: p.name,
        selected: p.id === state.selectedId,
      }));
    },

    applyResult(result): StepResult {
      const r = result as Record<string, unknown>;
      if (typeof r.clarify === 'string') return { ok: false, error: r.clarify, warnings: [] };
      if (typeof r.template === 'string')
        return applyTemplateResult(r.template, (r.params as Record<string, number>) ?? {});
      return controller.applyOp(result);
    },

    applyOp(raw): StepResult {
      const v = validateOp(raw);
      if (!v.ok) return { ok: false, error: v.error, warnings: [] };
      const applied = engine.apply(v.op);
      if (!applied.ok) return { ok: false, error: applied.error, warnings: [] };
      return { ok: true, warnings: applied.warnings.map((w) => w.message), op: v.op };
    },

    selectId: (id) => engine.apply({ op: 'select', target: id }).ok,

    isDesignRequest(utterance) {
      const t = utterance.trim().toLowerCase();
      if (/\bdesign\b/.test(t)) return true;
      if (/\b(i need|i want|something to|something for)\b/.test(t)) return true;
      if (/\bfor my\b/.test(t)) return true;
      if (/\b(create|build me|make me)\b/.test(t) && t.split(/\s+/).length >= 5) return true;
      return false;
    },

    async generate(utterance) {
      const tmpl = await generateTemplate(utterance);
      if ('clarify' in tmpl) return { source: tmpl.source, step: { ok: false, warnings: [] }, clarify: tmpl.clarify };
      return { source: tmpl.source, step: applyTemplateResult(tmpl.template, tmpl.params) };
    },

    dragSelectedMm(dxMm, dyMm): StepResult {
      return controller.applyOp({ op: 'move', target: 'selected', dx: dxMm, dy: dyMm, dz: 0 });
    },

    export() {
      const meshes = buildScene(engine.getState());
      if (meshes.length === 0) return;
      downloadSTL(meshesToSTL(meshes), 'mendcraft.stl');
    },
  };

  return controller;
}
