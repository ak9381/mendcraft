// One two-hand edit on a plan board, as ONE undo step. Decides at grab time
// what the two pinches hold (via the pure planner in twoHandEdit.ts, plus a
// fixture twist), applies live per frame so the plan follows the hands, then
// on release collapses the live steps into a single op; on a lost hand it
// rolls everything back. Null at begin() = not an edit (caller zooms/pans).

import type { PlanDoc, Point } from './doc';
import type { PlanOp } from './ops';
import {
  detectTwoHandFixture, detectTwoHandStretch, twoHandFixtureOp, twoHandStretchOps,
  type TwoHandFixture, type TwoHandStretch,
} from './twoHandEdit';

export const TWIST_SNAP_DEG = 15;
/** First-motion thresholds that tell a twist from a resize on a small fixture. */
const TWIST_DECIDE_DEG = 8;
const RESIZE_DECIDE = 0.12;
const FIXTURE_LIMIT = { min: 100, max: 10_000 };
const GRAB_PX = 36;

export interface SessionCtl {
  snapshot(): unknown;
  applyOp(raw: unknown): { ok: boolean };
}
export interface SessionView {
  toWorld?(clientX: number, clientY: number): Point;
  screenScale?(): number;
  render(): void;
}

type Mode =
  | { kind: 'stretch'; grab: TwoHandStretch }
  | { kind: 'fixture'; grab: TwoHandFixture }
  | { kind: 'twist'; id: string; angle0: number };

const deg = (p: Point, q: Point): number => (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;

/** Signed twist (degrees) between the grab-time and current hand vectors,
 *  wrapped to (-180, 180] and snapped to `snap` degrees (0 = no snap). */
export function twistAngle(angle0: number, angleNow: number, snap = TWIST_SNAP_DEG): number {
  let d = angleNow - angle0;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return snap > 0 ? Math.round(d / snap) * snap : d;
}

/** Both pinches on (or within `slackMm` of) one fixture's footprint. */
export function bothOnFixture(doc: PlanDoc, id: string, p: Point, q: Point, slackMm: number): boolean {
  const f = doc.fixtures.find((x) => x.id === id);
  if (!f) return false;
  const reach = Math.hypot(f.w, f.d) / 2 + slackMm;
  return Math.hypot(p.x - f.x, p.y - f.y) <= reach && Math.hypot(q.x - f.x, q.y - f.y) <= reach;
}

export interface TwoHandSession {
  readonly kind: Mode['kind'] | 'twist-or-resize';
  move(a: Point, b: Point): void;
  /** Release: the live steps become one undoable op. */
  end(): void;
  /** A hand was lost: undo the live steps; nothing is applied. */
  cancel(): void;
}

export function beginTwoHandSession(ctl: SessionCtl, view: SessionView, a: Point, b: Point): TwoHandSession | null {
  if (!view.toWorld) return null;
  const doc = ctl.snapshot() as PlanDoc;
  const sel = doc.selectedIds?.length ? doc.selectedIds : doc.selectedId ? [doc.selectedId] : [];
  if (!sel.length) return null;
  const w0 = view.toWorld(a.x, a.y), w1 = view.toWorld(b.x, b.y);
  const grabMm = GRAB_PX / (view.screenScale?.() || 1);
  let mode: Mode | null = null;
  const stretch = detectTwoHandStretch(doc, sel, w0, w1, grabMm);
  if (stretch) mode = { kind: 'stretch', grab: stretch };
  const fx = mode ? null : detectTwoHandFixture(doc, sel, w0, w1, grabMm);
  const twist: Mode | null = !mode && sel.length === 1 && bothOnFixture(doc, sel[0], w0, w1, grabMm) ? { kind: 'twist', id: sel[0], angle0: deg(w0, w1) } : null;
  // On a small fixture both hands sit on its corners, so resize and twist both
  // fit the grab: let the first clear motion decide (turn → twist, spread or
  // squeeze → resize). Nothing is applied until it does.
  let undecided: { fx: TwoHandFixture; span0: number; angle0: number } | null = null;
  if (fx && twist) undecided = { fx, span0: Math.max(1, Math.hypot(w1.x - w0.x, w1.y - w0.y)), angle0: deg(w0, w1) };
  else if (fx) mode = { kind: 'fixture', grab: fx };
  else if (twist) mode = twist;
  if (!mode && !undecided) return null;
  let m: Mode = mode ?? twist!;

  let steps = 0;        // live engine steps to collapse on release
  let turned = 0;       // twist: rotation applied so far (deg)
  let last: PlanOp[] = []; // the latest absolute ops (stretch/fixture)
  let done = false;

  const apply = (op: PlanOp): void => { if (ctl.applyOp(op).ok) steps++; };
  const rollback = (): void => { for (; steps > 0; steps--) ctl.applyOp({ op: 'undo' }); };

  return {
    get kind() { return undecided ? 'twist-or-resize' : m.kind; },
    move(pa, pb) {
      if (done) return;
      const p = view.toWorld!(pa.x, pa.y), q = view.toWorld!(pb.x, pb.y);
      if (undecided) {
        const turn = Math.abs(twistAngle(undecided.angle0, deg(p, q), 0));
        const spread = Math.abs(Math.hypot(q.x - p.x, q.y - p.y) / undecided.span0 - 1);
        if (turn >= TWIST_DECIDE_DEG) { m = twist!; undecided = null; }
        else if (spread >= RESIZE_DECIDE) { m = { kind: 'fixture', grab: undecided.fx }; undecided = null; }
        else return;
      }
      if (m.kind === 'stretch') { last = twoHandStretchOps(m.grab, p, q); last.forEach(apply); }
      else if (m.kind === 'fixture') { const op = twoHandFixtureOp(ctl.snapshot() as PlanDoc, m.grab, p, q, FIXTURE_LIMIT); last = op ? [op] : []; last.forEach(apply); }
      else {
        const want = twistAngle(m.angle0, deg(p, q));
        if (want !== turned) { apply({ op: 'rotate', target: m.id, angle: want - turned } as PlanOp); turned = want; }
      }
      view.render();
    },
    end() {
      if (done) return;
      done = true;
      const final: PlanOp[] = m.kind === 'twist' ? (turned ? [{ op: 'rotate', target: m.id, angle: turned } as PlanOp] : []) : last;
      rollback();
      if (final.length === 1) ctl.applyOp(final[0]);
      else if (final.length > 1) ctl.applyOp({ op: 'batch', ops: final });
      view.render();
    },
    cancel() {
      if (done) return;
      done = true;
      rollback();
      view.render();
    },
  };
}
