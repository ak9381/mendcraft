import type { Actor, ChangeEntry, ChangeStatus } from '../cad/changeLog';
import { actorByLine } from './wording';

export type HistoryFilter =
  | { kind: 'all' }
  | { kind: 'waiting' }
  | { kind: 'actor'; actor: Actor | 'quick' | 'deep' | 'you' }
  | { kind: 'status'; status: ChangeStatus };

export const FILTER_PHRASES: { phrase: string; filter: HistoryFilter }[] = [
  { phrase: 'show all', filter: { kind: 'all' } },
  { phrase: 'show everything', filter: { kind: 'all' } },
  { phrase: 'show waiting', filter: { kind: 'waiting' } },
  { phrase: 'show mine', filter: { kind: 'actor', actor: 'you' } },
  { phrase: 'show yours', filter: { kind: 'actor', actor: 'you' } },
  { phrase: 'show my changes', filter: { kind: 'actor', actor: 'you' } },
  { phrase: 'show quick', filter: { kind: 'actor', actor: 'quick' } },
  { phrase: 'show deep', filter: { kind: 'actor', actor: 'deep' } },
  { phrase: 'show dropped', filter: { kind: 'status', status: 'rejected' } },
  { phrase: 'show kept', filter: { kind: 'status', status: 'applied' } },
  { phrase: 'show undone', filter: { kind: 'status', status: 'reverted' } },
];

function matchesActor(e: ChangeEntry, actor: Actor | 'quick' | 'deep' | 'you'): boolean {
  if (actor === 'you') return e.actor === 'her';
  if (actor === 'quick') return e.actor === 'nano' || e.actor === 'rules';
  if (actor === 'deep') return e.actor === 'gemini';
  return e.actor === actor;
}

export function parseHistoryFilter(utterance: string): HistoryFilter | null {
  const t = utterance.trim().toLowerCase().replace(/[?.!]+$/g, '');
  for (const row of FILTER_PHRASES) {
    if (t === row.phrase || t.endsWith(row.phrase)) return row.filter;
  }
  return null;
}

export function applyHistoryFilter(entries: readonly ChangeEntry[], filter: HistoryFilter): ChangeEntry[] {
  if (filter.kind === 'all') return [...entries];
  if (filter.kind === 'waiting') return entries.filter((e) => e.status === 'pending');
  if (filter.kind === 'actor') return entries.filter((e) => matchesActor(e, filter.actor));
  return entries.filter((e) => e.status === filter.status);
}

export function filterLabel(filter: HistoryFilter): string {
  if (filter.kind === 'all') return 'All changes';
  if (filter.kind === 'waiting') return 'Waiting for you';
  if (filter.kind === 'actor') {
    if (filter.actor === 'you') return 'Your changes';
    if (filter.actor === 'quick') return 'By Quick';
    if (filter.actor === 'deep') return 'By Deep';
    return `By ${actorByLine(filter.actor)}`;
  }
  if (filter.status === 'rejected') return 'Dropped';
  if (filter.status === 'applied') return 'Kept';
  if (filter.status === 'reverted') return 'Undone';
  return 'Waiting for you';
}

/** Turning a kept change back is itself a Proposal she pinches. */
export function undoProposalTitle(entry: Pick<ChangeEntry, 'title'>): string {
  return `Undo: ${entry.title}`;
}

export function waitingCount(entries: readonly ChangeEntry[]): number {
  return entries.reduce((n, e) => n + (e.status === 'pending' ? 1 : 0), 0);
}

export function reviewTrayLabel(count: number): string {
  if (count <= 0) return 'Review & History';
  return `Review · ${count} waiting`;
}
