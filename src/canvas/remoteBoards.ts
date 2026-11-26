// A phone shows each board the laptop sends ONCE. A board arriving again (a
// replay on hello after re-pairing, a republish) goes to the frame that
// already shows it; any other frame showing the same board is a duplicate
// and goes. A phone that saved boards from an older build (a dashboard whose
// plan tile was lifted onto its own "Floor plan" board on load) otherwise
// showed the laptop's Floor plan twice. Pure.
import { planBoardIds } from './planDocs';
import type { SurfacePlan } from './surfacePlan';

/** The same board: a floor plan by its plan board id or its title, any other
 *  board by kind + title. */
export function sameRemoteBoard(a: SurfacePlan | undefined, b: SurfacePlan): boolean {
  if (!a) return false;
  const pa = planBoardIds(a), pb = planBoardIds(b);
  const plan = (p: SurfacePlan, ids: string[]) => p.kind === 'plan' || ids.length > 0;
  if (plan(a, pa) && plan(b, pb)) return pa.some((id) => pb.includes(id)) || a.title === b.title;
  return a.kind === b.kind && a.title === b.title;
}

/** Where a received board goes, and which other frames already show it.
 *  `preferred`: the focused / last focused / first frame (null: make one). */
export function remoteBoardTarget(
  frames: readonly { id: string }[],
  surfaces: Record<string, SurfacePlan | undefined>,
  plan: SurfacePlan,
  preferred: string | null,
): { id: string | null; duplicates: string[] } {
  const showing = frames.map((f) => f.id).filter((id) => sameRemoteBoard(surfaces[id], plan));
  const id = preferred && showing.includes(preferred) ? preferred : showing[0] ?? preferred;
  return { id, duplicates: showing.filter((x) => x !== id) };
}

/** Frames on a phone that repeat an earlier frame's board (saved that way by
 *  an older build): the first (or the focused) copy stays. */
export function duplicateBoards(
  frames: readonly { id: string }[],
  surfaces: Record<string, SurfacePlan | undefined>,
  focusId: string | null,
): string[] {
  const order = [...frames.map((f) => f.id)].sort((x, y) => (x === focusId ? -1 : y === focusId ? 1 : 0));
  const kept: string[] = [];
  const drop: string[] = [];
  for (const id of order) {
    const s = surfaces[id];
    if (s && kept.some((k) => sameRemoteBoard(surfaces[k], s))) drop.push(id);
    else if (s) kept.push(id);
  }
  return drop;
}
