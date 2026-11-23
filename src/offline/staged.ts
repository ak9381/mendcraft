// Staged-result restore helpers (pure).
//
// A `ready` job (cloud already answered, awaiting Apply/Reject) persists its
// cloud result on the job (`QueuedJob.staged`) so the ready state survives a
// reload. On reload we rehydrate the in-memory staged map from this field. But a
// persisted payload can be missing or structurally wrong (an older build that
// didn't persist it, a partial IndexedDB write, a hand-edited record). Rather
// than leave such a job stuck with no button, we shape-check the payload and, if
// it can't be applied, offer Re-run instead of Apply.

/** The restore action a `ready` job can offer the user. */
export type RestoredAction = 'apply' | 'rerun';

/** Shape-check a persisted staged cloud result against the two kinds the shell
 *  can apply ('plan' → `{ payload.ops: [] }`, 'a11y' → `{ items: [] }`), both
 *  carrying a `source` string. Anything else (missing, wrong kind, no ops/items)
 *  is treated as not-applyable so the caller offers Re-run. */
export function isValidStaged(staged: unknown): boolean {
  if (!staged || typeof staged !== 'object') return false;
  const s = staged as { kind?: unknown; source?: unknown; payload?: unknown; items?: unknown };
  if (typeof s.source !== 'string') return false;
  if (s.kind === 'plan') {
    return !!s.payload
      && typeof s.payload === 'object'
      && Array.isArray((s.payload as { ops?: unknown }).ops);
  }
  if (s.kind === 'a11y') return Array.isArray(s.items);
  return false;
}

/** What a restored `ready` job can offer: Apply (valid staged result present) or
 *  Re-run (missing / corrupt payload — re-queue rather than stay stuck). A job
 *  that isn't `ready` has no restore action and returns 'rerun' by convention
 *  (callers only consult this for ready jobs). */
export function restoredReadyAction(job: { status: string; staged?: unknown }): RestoredAction {
  return job.status === 'ready' && isValidStaged(job.staged) ? 'apply' : 'rerun';
}
