// Plan-mode controller: wraps PlanEngine behind the generic ModeController.
// Pure-ish (no three.js) but kept behind createController()'s dynamic import so
// the registry stays light and symmetric with the part controller.

import { PlanEngine } from './engine';
import { validatePlanOp, type PlanOp } from './ops';
import { buildPlanTemplate, isPlanTemplateName } from './templates';
import { toDxf, toJson } from './export';
import { mmToMetresLabel, wallLength } from './doc';
import { generatePlan } from '../ai/hybrid';
import type { DeixisTargetInfo } from '../ai/deixis';
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

/** A short confirmation for a just-applied op, naming the affected wall and its
 *  actual resulting value so the verifier always reflects the LAST command
 *  (e.g. "Wall w3 set to 4.00 m"). `id` is the resolved target; `engine` is read
 *  AFTER the op so lengths reflect the real geometry (stretch can snap them). */
function opMessage(op: PlanOp, id: string | undefined, engine: PlanEngine): string {
  const wall = id ? engine.getState().walls.find((w) => w.id === id) : undefined;
  const len = wall ? mmToMetresLabel(wallLength(wall)) : undefined;
  const who = id ? `Wall ${id}` : 'Wall';
  switch (op.op) {
    case 'add_room': return 'Room added.';
    case 'add_wall': return 'Wall added.';
    case 'add_door': return `Door added${id ? ` on ${id}` : ''}.`;
    case 'add_window': return `Window added${id ? ` on ${id}` : ''}.`;
    case 'add_dim': return `Dimension added${id ? ` on ${id}` : ''}.`;
    case 'set_length': return `${who} set to ${len ?? mmToMetresLabel(op.length)}`;
    case 'move': return len ? `${who} moved (now ${len})` : `${who} moved.`;
    case 'offset': return len ? `${who} offset (now ${len})` : `${who} offset.`;
    case 'set_thickness': return wall ? `${who} thickness ${Math.round(wall.thickness)} mm` : 'Thickness changed.';
    case 'rename': return 'Renamed.';
    case 'delete': return 'Deleted.';
    case 'select': return `${who} selected.`;
    case 'select_set': return op.ids.length ? `${op.ids.length} selected.` : 'Selection cleared.';
    case 'batch': return `${op.ops.length} edits applied (one step).`;
    case 'move_many': return `${op.ids.length} item${op.ids.length > 1 ? 's' : ''} moved.`;
    case 'rotate': return 'Rotated.';
    case 'add_fixture': return `${op.kind.replace(/-/g, ' ')} added.`;
    case 'set_sill': return 'Sill height set.';
    case 'set_height': return 'Height set.';
    case 'set_size': return 'Resized.';
    case 'add_text': return 'Label added.';
    case 'set_text': return 'Label updated.';
    case 'set_font': return 'Font size set.';
    default: return 'Done.';
  }
}

export function createPlanController(): ModeController {
  const engine = new PlanEngine();

  const controller: ModeController = {
    dragRangeMm: 6000,
    summary: () => engine.summary(),
    // Point-and-say: the sizeable property of the pointed element (geometry only
    // — a plan has no brightness/colour, deixisToOp says so honestly).
    deixisInfo(id): DeixisTargetInfo | null {
      const doc = engine.getState();
      const wall = doc.walls.find((w) => w.id === id);
      if (wall) return { id, space: 'plan', kind: 'wall', lengthMm: wallLength(wall) };
      const opening = doc.openings.find((o) => o.id === id);
      if (opening) return { id, space: 'plan', kind: opening.kind, widthMm: opening.width };
      const fixture = doc.fixtures.find((f) => f.id === id);
      if (fixture) return { id, space: 'plan', kind: fixture.kind };
      const text = doc.texts.find((t) => t.id === id);
      if (text) return { id, space: 'plan', kind: 'text' };
      return null;
    },
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
      // Resolve the target BEFORE applying ('selected' refers to the pre-edit
      // selection) so the confirmation can name the concrete wall it changed.
      const ref = 'target' in v.op && typeof v.op.target === 'string' ? v.op.target : undefined;
      const id = ref ? engine.resolveRef(ref) : undefined;
      const applied = engine.apply(v.op);
      if (!applied.ok) return { ok: false, error: applied.error, warnings: [] };
      return { ok: true, message: opMessage(v.op, id, engine), warnings: applied.warnings, op: v.op };
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

    applyGenerated(payload): StepResult {
      const ops = (payload as { ops?: unknown }).ops;
      if (!Array.isArray(ops)) return { ok: false, error: 'No plan ops to apply.', warnings: [] };
      // Re-validate every op before it touches the engine — the ops came from a
      // (possibly stale) queued cloud response, same untrusted-input discipline.
      const valid: PlanOp[] = [];
      for (const raw of ops) {
        const v = validatePlanOp(raw);
        if (v.ok) valid.push(v.op);
      }
      if (!valid.length) return { ok: false, error: 'Queued plan had no valid ops.', warnings: [] };
      const applied = engine.applyGenerated(valid);
      if (!applied.ok) return { ok: false, error: applied.error, warnings: [] };
      return { ok: true, message: 'Plan created.', warnings: applied.warnings };
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
