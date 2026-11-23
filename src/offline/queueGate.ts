// B-195/B-214: a queued cloud job's Apply changes the drawing (plan ops). While an
// AI proposal is still waiting for her Accept/Reject, applying it would pull
// the drawing out from under that open review (the proposal was made against
// the old drawing) — the same rule the canvas uses so nothing buries an open
// review's Approve/Reject. Accessibility explanations only fill a panel, so
// they are never blocked; Discard/Remove never changes the drawing.

export type QueuedKind = 'a11y' | string;

/** The message to say when Apply must wait, or null when it may go ahead. */
export function queueApplyBlocked(kind: QueuedKind, pendingReviews: number): string | null {
  if (kind === 'a11y') return null;
  if (pendingReviews <= 0) return null;
  return pendingReviews === 1
    ? 'A suggestion is waiting for you. Accept or reject it first, then apply the queued design.'
    : `${pendingReviews} suggestions are waiting for you. Accept or reject them first, then apply the queued design.`;
}
