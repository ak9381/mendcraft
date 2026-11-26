// A phone shows each board the laptop sends ONCE. A board arriving again (a
// replay on hello after re-pairing, a republish) goes to the frame that
// already shows it; any other frame showing the same board is a copy and
// goes. A phone that saved boards from an older build (a dashboard whose
// plan tile was lifted onto its own "Floor plan" board on load) otherwise
// showed the laptop's Floor plan twice.
//
// "The same board" is strict, so her own boards are never taken:
//  - floor plans by plan board id (by title only when one side has no id);
//  - any other board only when BOTH were received from the laptop
//    (Frame.from === 'laptop') and kind + title match.
// Pure.
import { planBoardIds } from './planDocs';
import type { SurfacePlan } from './surfacePlan';

export interface BoardRef { plan: SurfacePlan | undefined; fromLaptop: boolean }

export function sameRemoteBoard(a: BoardRef, b: BoardRef): boolean {
  if (!a.plan || !b.plan) return false;
  const pa = planBoardIds(a.plan), pb = planBoardIds(b.plan);
  const isPlan = (p: SurfacePlan, ids: string[]) => p.kind === 'plan' || ids.length > 0;
  const planA = isPlan(a.plan, pa), planB = isPlan(b.plan, pb);
  if (planA !== planB) return false;
  if (planA) {
    if (pa.length && pb.length) return pa.some((id) => pb.includes(id));
    return a.plan.title === b.plan.title;
  }
  return a.fromLaptop && b.fromLaptop && a.plan.kind === b.plan.kind && a.plan.title === b.plan.title;
}

type FrameLike = { id: string; from?: 'laptop' };
const ref = (f: FrameLike, surfaces: Record<string, SurfacePlan | undefined>): BoardRef => ({ plan: surfaces[f.id], fromLaptop: f.from === 'laptop' });

/** Where a board received from the laptop goes, and which other frames
 *  already show it. `preferred`: the focused / last focused / first frame
 *  (null: make one). */
export function remoteBoardTarget(
  frames: readonly FrameLike[],
  surfaces: Record<string, SurfacePlan | undefined>,
  plan: SurfacePlan,
  preferred: string | null,
): { id: string | null; duplicates: string[] } {
  const incoming: BoardRef = { plan, fromLaptop: true };
  const showing = frames.filter((f) => sameRemoteBoard(ref(f, surfaces), incoming)).map((f) => f.id);
  const id = preferred && showing.includes(preferred) ? preferred : showing[0] ?? preferred;
  return { id, duplicates: showing.filter((x) => x !== id) };
}

/** Frames on the phone app that repeat an earlier frame's board (saved that
 *  way by an older build): the focused (else first) copy stays. */
export function duplicateBoards(
  frames: readonly FrameLike[],
  surfaces: Record<string, SurfacePlan | undefined>,
  focusId: string | null,
): string[] {
  const order = [...frames].sort((x, y) => (x.id === focusId ? -1 : y.id === focusId ? 1 : 0));
  const kept: FrameLike[] = [];
  const drop: string[] = [];
  for (const f of order) {
    if (!surfaces[f.id]) continue;
    if (kept.some((k) => sameRemoteBoard(ref(k, surfaces), ref(f, surfaces)))) drop.push(f.id);
    else kept.push(f);
  }
  return drop;
}

/** The native phone app (Capacitor iOS / Android) — not a narrow laptop
 *  window, not a phone browser: only there does the load-time clean-up run. */
export function isNativePhoneApp(cap: { isNativePlatform?: () => boolean; getPlatform?: () => string } | null | undefined): boolean {
  try {
    if (cap?.isNativePlatform?.() !== true) return false;
    const p = cap.getPlatform?.();
    return p === 'ios' || p === 'android';
  } catch { return false; }
}
