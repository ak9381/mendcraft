// Plan-mode controller: wraps PlanEngine behind the generic ModeController.
// Pure-ish (no three.js) but kept behind createController()'s dynamic import so
// the registry stays light and symmetric with the part controller.

import { PlanEngine } from './engine';
import { validatePlanOp, type PlanOp } from './ops';
import { buildPlanTemplate, isPlanTemplateName } from './templates';
import { toDxf, toJson } from './export';
import { mmToMetresLabel } from './doc';
import { generatePlan } from '../ai/hybrid';
import type { ListItem, ModeController, StepResult } from '../core/controller';

function download(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** A short spoken confirmation for a just-applied op. */
function opMessage(op: PlanOp): string {
  switch (op.op) {
    case 'add_room': return 'Room added.';
    case 'add_wall': return 'Wall added.';
    case 'add_door': return 'Door added.';
    case 'add_window': return 'Window added.';
    case 'add_dim': return 'Dimension added.';
    case 'set_length': return `Wall is now ${mmToMetresLabel(op.length)}.`;
    case 'move': return 'Wall moved.';
    case 'offset': return 'Wall offset.';
    case 'set_thickness': return 'Thickness changed.';
    case 'rename': return 'Renamed.';
    case 'delete': return 'Deleted.';
    case 'select': return 'Selected.';
    default: return 'Done.';
  }
}

export function createPlanController(): ModeController {
  const engine = new PlanEngine();

  const controller: ModeController = {
    dragRangeMm: 6000,
    summary: () => engine.summary(),
    selectedId: () => engine.getState().selectedId,
    warnings: () => engine.warnings(),
    snapshot: () => engine.getState(),
    listItems: (): ListItem[] => engine.listItems(),

    applyResult(result): StepResult {
      const r = result as Record<string, unknown>;
      if (typeof r.clarify === 'string') return { ok: false, error: r.clarify, warnings: [] };
      if (typeof r.generate === 'string') return expandTemplate(r.generate);
      return controller.applyOp(result);
    },

    applyOp(raw): StepResult {
      const v = validatePlanOp(raw);
      if (!v.ok) return { ok: false, error: v.error, warnings: [] };
      const applied = engine.apply(v.op);
      if (!applied.ok) return { ok: false, error: applied.error, warnings: [] };
      return { ok: true, message: opMessage(v.op), warnings: applied.warnings, op: v.op };
    },

    selectId: (id) => engine.apply({ op: 'select', target: id }).ok,

    isDesignRequest(utterance) {
      const t = utterance.trim().toLowerCase();
      if (/\b(plan|bedroom|studio|apartment|flat|house)\b/.test(t)) return true;
      return /\bdesign\b/.test(t) && /\b(room|plan|flat|house)\b/.test(t);
    },

    async generate(utterance) {
      const res = await generatePlan(utterance);
      if (res.ops) {
        const applied = engine.applyGenerated(res.ops);
        if (!applied.ok) return { source: res.source, step: { ok: false, error: applied.error, warnings: [] } };
        return { source: res.source, step: { ok: true, message: res.note ?? 'Plan created.', warnings: applied.warnings } };
      }
      return { source: res.source, step: { ok: false, warnings: [] }, clarify: res.clarify };
    },

    dragSelectedMm(dxMm, dyMm): StepResult {
      return controller.applyOp({ op: 'move', target: 'selected', nums: { dx: dxMm, dy: dyMm } });
    },

    export() {
      const doc = engine.getState();
      download('mendcraft-plan.dxf', toDxf(doc), 'application/dxf');
      download('mendcraft-plan.json', toJson(doc), 'application/json');
    },
  };

  function expandTemplate(name: string): StepResult {
    if (!isPlanTemplateName(name)) return { ok: false, error: `Unknown plan "${name}".`, warnings: [] };
    const ops: PlanOp[] = [];
    for (const env of buildPlanTemplate(name)) {
      const v = validatePlanOp(env);
      if (v.ok) ops.push(v.op);
    }
    const applied = engine.applyGenerated(ops);
    if (!applied.ok) return { ok: false, error: applied.error, warnings: [] };
    return { ok: true, message: 'Plan created.', warnings: applied.warnings };
  }

  return controller;
}
