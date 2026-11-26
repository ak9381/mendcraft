// EDIT JOURNAL for one plan board: groups the plan engine's undo steps into
// the edits a person made ("Drew a wall 3.00 m"), so the canvas's one Undo
// can take a whole edit back by sending the engine its own `undo` op the
// right number of times. No second state: the journal only COUNTS the steps
// that controller.applyOp already pushed on the engine's undo stack.
//
// Selection changes are engine steps too; they ride along with the next real
// edit (or are dropped by the next undo) and never make a history line.

export interface JournalCtl {
  applyOp(raw: unknown): { ok: boolean; message?: string; error?: string };
}

export interface JournalEntry {
  /** Engine undo steps this edit is made of (selection steps before it included). */
  steps: number;
  summary: string;
}

export interface PlanJournal {
  /** A gesture finished: everything since the last entry is one edit. */
  note(summary: string): void;
  /** Mouse / keyboard edits: close the open edit, named by its last op. */
  flush(): void;
  /** Take back the newest `steps` engine steps (plus any loose selection
   *  steps after them). Returns how many engine steps were undone. */
  undo(steps: number): number;
  /** Uncommitted engine steps (selection changes, or an edit in progress). */
  pending(): number;
  dirty(): boolean;
  dispose(): void;
}

const QUIET = new Set(['select', 'select_set']);

export function createPlanJournal(ctl: JournalCtl, onEntry: (e: JournalEntry) => void): PlanJournal {
  const inner = ctl.applyOp.bind(ctl);
  // One flag per uncommitted engine step: true = it changed the plan.
  let stack: boolean[] = [];
  let lastMessage = '';
  let muted = false;

  ctl.applyOp = (raw: unknown) => {
    const r = inner(raw);
    if (!r.ok || muted) return r;
    const op = String((raw as { op?: unknown } | null)?.op ?? '');
    if (op === 'undo') stack.pop();
    else if (op === 'redo') stack.push(true);
    else {
      const real = !QUIET.has(op);
      stack.push(real);
      if (real && r.message) lastMessage = r.message;
    }
    return r;
  };

  function close(summary: string): void {
    if (!stack.some(Boolean)) return;
    const steps = stack.length;
    stack = [];
    onEntry({ steps, summary });
  }

  return {
    note: (summary) => close(summary),
    flush: () => close(lastMessage.replace(/\.$/, '') || 'Edited the plan'),
    undo(steps) {
      muted = true;
      let n = 0;
      try {
        for (let i = stack.length + Math.max(0, steps); i > 0; i--) {
          if (!inner({ op: 'undo' }).ok) break;
          n++;
        }
      } finally { muted = false; }
      stack = [];
      return n;
    },
    pending: () => stack.length,
    dirty: () => stack.some(Boolean),
    dispose() { ctl.applyOp = inner; },
  };
}
