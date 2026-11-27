// Records every successful drawing change made through the controller (her
// pinch / mouse / voice edits) into the change log, without touching the
// renderer or tools. Selection is a view change and is not logged. Rapid
// repeats of the same op on the same target (a drag) fold into one entry.
// While `suppressed()` is true (an accepted AI proposal or a revert is being
// applied), nothing is recorded here — the change log records those itself.

import type { ModeController, StepResult } from '../core/controller';
import type { Actor, ChangeLog, ChangeEntry } from './changeLog';
import { planDigest } from './changeLog';

const SKIP = new Set(['select', 'select_set']);

export interface RecordingHooks {
  log: ChangeLog;
  suppressed(): boolean;
  /** Why: her last words if recent, else "Direct edit". */
  why(): string;
  /** Where the interpretation ran for the current command. */
  source(): ChangeEntry['source'];
  now?: () => number;
}

function opName(raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.op === 'string') return o.op;
    if (typeof o.template === 'string' || typeof o.generate === 'string') return 'generate';
  }
  return 'edit';
}

function targetOf(raw: unknown): string {
  return raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).target === 'string'
    ? String((raw as Record<string, unknown>).target) : '';
}

const TITLES: Record<string, string> = {
  add_room: 'Draw a room', add_wall: 'Draw a wall', add_door: 'Add a door', add_window: 'Add a window',
  add_opening: 'Add an opening', add_fixture: 'Place an item', add_dim: 'Add a dimension', add_text: 'Add a note',
  move: 'Move', move_many: 'Move items', move_end: 'Move a wall end', move_opening: 'Slide an opening',
  set_length: 'Change wall length', set_thickness: 'Change wall thickness', set_width: 'Change width',
  set_size: 'Resize', set_height: 'Change height', set_sill: 'Change sill height', rotate: 'Rotate',
  rename: 'Rename', delete: 'Delete', offset: 'Offset a wall', set_swing: 'Flip door swing',
  set_text: 'Edit a note', set_font: 'Change note size', batch: 'Several changes', undo: 'Undo', redo: 'Redo',
  generate: 'New plan',
};

export function titleFor(raw: unknown, step: StepResult): string {
  const name = opName(raw);
  const base = TITLES[name] ?? name.replace(/_/g, ' ');
  const tgt = targetOf(raw);
  const msg = step.message && step.message.length < 70 ? ` — ${step.message.replace(/\.$/, '')}` : '';
  return `${base}${tgt && tgt !== 'selected' ? ` (${tgt})` : ''}${msg}`;
}

export function withChangeRecording(c: ModeController, hooks: RecordingHooks): ModeController {
  const now = hooks.now ?? Date.now;
  let last: { id: string; key: string; at: number } | null = null;

  function wrap(raw: unknown, run: () => StepResult): StepResult {
    const name = opName(raw);
    if (hooks.suppressed() || SKIP.has(name)) return run();
    const before = planDigest(c.snapshot());
    const beforeDoc = c.snapshot();
    const step = run();
    if (!step.ok) return step;
    return note(raw, name, step, before, beforeDoc, 'her');
  }

  function note(raw: unknown, name: string, step: StepResult, before: string, beforeDoc: unknown, actor: Actor): StepResult {
    const key = `${name}:${targetOf(raw)}`;
    const t = now();
    const after = planDigest(c.snapshot());
    if (last && last.key === key && t - last.at < 1500 && name !== 'undo' && name !== 'redo') {
      hooks.log.amend(last.id, { after, decidedAt: t });
      last.at = t;
      return step;
    }
    const e = hooks.log.recordApplied({
      actor, tool: name, title: titleFor(raw, step), why: hooks.why(),
      op: raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null,
      before, after, source: hooks.source(), beforeDoc,
    });
    last = { id: e.id, key, at: t };
    return step;
  }

  // Assignments to the wrapper (e.g. main.ts layering a teach-recorder hook
  // over applyOp) stay on the wrapper. Writing them through to the target
  // would make the target call the wrapper, which calls the target: a loop.
  const overrides = new Map<PropertyKey, unknown>();
  const applyOp = c.applyOp.bind(c);
  const applyResult = c.applyResult.bind(c);
  const applyGenerated = c.applyGenerated?.bind(c);
  const generate = c.generate.bind(c);
  // A whole new plan (her template, Nano or Gemini) is logged with who made it,
  // so it can be reverted from History like any other change.
  async function recordGenerate(utterance: string) {
    if (hooks.suppressed()) return generate(utterance);
    const before = planDigest(c.snapshot());
    const beforeDoc = c.snapshot();
    const res = await generate(utterance);
    if (res.step.ok) {
      const actor: Actor = res.source === 'cloud' ? 'gemini' : res.source === 'on-device' ? 'nano' : 'her';
      note({ op: 'generate' }, 'generate', res.step, before, beforeDoc, actor);
    }
    return res;
  }
  return new Proxy(c, {
    get(target, prop, receiver) {
      if (overrides.has(prop)) return overrides.get(prop);
      if (prop === 'applyOp') return (raw: unknown) => wrap(raw, () => applyOp(raw));
      if (prop === 'applyResult') return (raw: Record<string, unknown>) => wrap(raw, () => applyResult(raw));
      if (prop === 'generate') return recordGenerate;
      if (prop === 'applyGenerated' && applyGenerated) {
        return (payload: unknown) => wrap({ op: 'generate' }, () => applyGenerated(payload));
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
    set(_target, prop, value) {
      overrides.set(prop, value);
      return true;
    },
  });
}
