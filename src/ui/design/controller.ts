// UI-mode controller: wraps UiEngine behind the generic ModeController. Pure of
// three.js; loaded via createController()'s dynamic import so the registry stays
// light, symmetric with the plan/part controllers. Also exposes the active
// frame's HTML so the shell can offer "Download HTML" + "Copy HTML".

import { UiEngine } from './engine';
import { validateUiOp, type UiOp } from './ops';
import { buildUiTemplate, isUiTemplateName } from './templates';
import { activeFrame, locate, nodeLabel, type Frame, type FramePreset } from './doc';
import { toHtml, toSvg } from './export';
import { generateUi } from '../../ai/hybrid';
import type { DeixisTargetInfo } from '../../ai/deixis';
import type { ListItem, ModeController, StepResult } from '../../core/controller';

function download(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** A short confirmation naming the just-affected node, read AFTER the op. */
function opMessage(op: UiOp, id: string | undefined, engine: UiEngine): string {
  const loc = id ? locate(engine.getState(), id) : null;
  const who = loc ? nodeLabel(loc.node) : 'Node';
  switch (op.op) {
    case 'add_frame': return `${op.preset === 'mobile' ? 'Mobile' : 'Desktop'} frame added.`;
    case 'add_node': return `Added a ${op.nodeType}.`;
    case 'set_text': return 'Text updated.';
    case 'set_size': return `${who} resized.`;
    case 'set_fill': return `${who} recoloured.`;
    case 'set_style': return `${who} restyled.`;
    case 'set_layout': return 'Layout updated.';
    case 'move': return `${who} moved.`;
    case 'delete': return 'Deleted.';
    case 'select': return `${who} selected.`;
    default: return 'Done.';
  }
}

export function createUiController(): ModeController {
  const engine = new UiEngine();

  const controller: ModeController = {
    dragRangeMm: 0, // UI mode uses the renderer's own pixel-space drag, not mm.
    summary: () => engine.summary(),
    selectedId: () => engine.getState().selectedId,
    warnings: () => engine.warnings(),
    snapshot: () => engine.getState(),
    // Point-and-say: the pointed node's current paint/size so deixisToOp can
    // build "brighter"/"bigger" from real values (engine re-validates the op).
    deixisInfo(id): DeixisTargetInfo | null {
      const loc = locate(engine.getState(), id);
      if (!loc) return null;
      const n = loc.node;
      const info: DeixisTargetInfo = { id, space: 'ui', kind: n.type };
      switch (n.type) {
        case 'text': info.fill = n.color; info.fontSize = n.size; break;
        case 'button': info.fill = n.fill; info.h = n.height; break;
        case 'rect': info.fill = n.fill; info.w = n.w; info.h = n.h; break;
        case 'image': info.w = n.w; info.h = n.h; break;
        case 'icon': info.fill = n.fill; break;
        case 'stack': info.fill = n.fill; break;
        case 'divider': info.fill = n.color; break;
        case 'input': info.h = n.height; break;
      }
      return info;
    },
    listItems: (): ListItem[] =>
      engine.listItems().map((i) => ({ id: i.id, label: `${'· '.repeat(i.depth)}${i.label}`, selected: i.selected })),

    applyResult(result): StepResult {
      const r = result as Record<string, unknown>;
      if (typeof r.clarify === 'string') return { ok: false, error: r.clarify, warnings: [] };
      if (r.export === true) { controller.export(); return { ok: true, message: 'Exported HTML.', warnings: [] }; }
      if (typeof r.generate === 'string') return expandTemplate(r.generate, r.preset);
      if (r.op === 'undo') { const u = engine.undo(); return { ok: u.ok, error: u.error, message: u.ok ? 'Undone.' : undefined, warnings: u.warnings ?? [] }; }
      if (r.op === 'redo') { const u = engine.redo(); return { ok: u.ok, error: u.error, message: u.ok ? 'Redone.' : undefined, warnings: u.warnings ?? [] }; }
      return controller.applyOp(result);
    },

    applyOp(raw): StepResult {
      const asObj = raw as Record<string, unknown>;
      if (asObj?.op === 'undo') { const u = engine.undo(); return { ok: u.ok, error: u.error, warnings: u.warnings ?? [] }; }
      if (asObj?.op === 'redo') { const u = engine.redo(); return { ok: u.ok, error: u.error, warnings: u.warnings ?? [] }; }
      const v = validateUiOp(raw);
      if (!v.ok) return { ok: false, error: v.error, warnings: [] };
      const ref = 'target' in v.op && typeof v.op.target === 'string' ? v.op.target : undefined;
      const id = ref ? engine.resolveRef(ref) : undefined;
      const applied = engine.apply(v.op);
      if (!applied.ok) return { ok: false, error: applied.error, warnings: [] };
      return { ok: true, message: opMessage(v.op, id, engine), warnings: applied.warnings, op: v.op };
    },

    selectId: (id) => engine.apply({ op: 'select', target: id }).ok,

    isDesignRequest(utterance) {
      const t = utterance.trim().toLowerCase();
      if (/\b(login|sign in|signup|sign up|landing|hero|pricing|screen|page|dashboard|form|checkout|profile|settings|onboarding)\b/.test(t)) return true;
      return /\bdesign\b/.test(t) && /\b(screen|page|ui|app|site|layout)\b/.test(t);
    },

    async generate(utterance) {
      const res = await generateUi(utterance);
      if (res.frame) {
        const applied = engine.loadFrame(res.frame);
        if (!applied.ok) return { source: res.source, step: { ok: false, error: applied.error, warnings: [] } };
        return { source: res.source, step: { ok: true, message: res.note ?? 'Screen created.', warnings: applied.warnings } };
      }
      return { source: res.source, step: { ok: false, warnings: [] }, clarify: res.clarify };
    },

    applyGenerated(payload): StepResult {
      const frame = (payload as { frame?: Frame }).frame;
      if (!frame || typeof frame !== 'object') return { ok: false, error: 'No screen to apply.', warnings: [] };
      const applied = engine.loadFrame(frame);
      if (!applied.ok) return { ok: false, error: applied.error, warnings: [] };
      return { ok: true, message: 'Screen created.', warnings: applied.warnings };
    },

    dragSelectedMm: () => null,

    export() {
      const frame = activeFrame(engine.getState());
      if (!frame) return;
      download('mendcraft-ui.html', toHtml(frame), 'text/html');
      download('mendcraft-ui.svg', toSvg(frame), 'image/svg+xml');
    },
  };

  function expandTemplate(name: string, presetRaw: unknown): StepResult {
    if (!isUiTemplateName(name)) return { ok: false, error: `Unknown template "${name}".`, warnings: [] };
    const preset: FramePreset = presetRaw === 'mobile' ? 'mobile' : 'desktop';
    const frame = buildUiTemplate(name, preset);
    if (!frame) return { ok: false, error: 'Could not build that screen.', warnings: [] };
    const applied = engine.loadFrame(frame);
    if (!applied.ok) return { ok: false, error: applied.error, warnings: [] };
    return { ok: true, message: 'Screen created.', warnings: applied.warnings };
  }

  return controller;
}

/** The active frame's single-file HTML (for the shell's Copy HTML button). */
export function uiHtmlOf(controller: ModeController): string | null {
  const frame = activeFrame(controller.snapshot() as import('./doc').UiDoc);
  return frame ? toHtml(frame) : null;
}

/** The active frame's flat SVG (for the export panel's Download SVG button). */
export function uiSvgOf(controller: ModeController): string | null {
  const frame = activeFrame(controller.snapshot() as import('./doc').UiDoc);
  return frame ? toSvg(frame) : null;
}

/** The active frame's pixel size (lets the export panel scale the preview to fit). */
export function uiFrameSizeOf(controller: ModeController): { w: number; h: number } | null {
  const frame = activeFrame(controller.snapshot() as import('./doc').UiDoc);
  return frame ? { w: frame.w, h: frame.h } : null;
}
