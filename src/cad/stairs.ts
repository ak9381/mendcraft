// "Build me a staircase": pure math that picks risers / rise / tread from the
// floor-to-floor height inside the active guideline range, then turns that into
// plan ops (one stairs component + its legend) for a confirm card. One batch op
// = one undo.

import { planBounds, roomPolygon, type PlanDoc } from '../plan/doc';
import { guidelineSet, type GuidelineSet } from './guidelines';

export interface StairPlan {
  floorHeight: number;
  risers: number;
  rise: number;
  tread: number;
  /** Horizontal run (going) = risers × tread, mm. */
  run: number;
  width: number;
  /** 2R + T comfort value, mm. */
  stepRule: number;
}

/** Pick the riser count whose rise sits in range and is closest to a
 *  comfortable target (~ 172 mm), with the tread from the 2R + T rule. */
export function planStair(floorHeight: number, g: GuidelineSet, width?: number): StairPlan {
  const h = Math.min(6000, Math.max(600, floorHeight));
  const s = g.stair;
  const target = Math.min(s.riseMax, Math.max(s.riseMin, 172));
  let best = Math.max(2, Math.round(h / target));
  // Nudge until the rise is inside the range.
  while (h / best > s.riseMax) best++;
  while (best > 2 && h / (best - 1) <= s.riseMax && h / best < s.riseMin) best--;
  const rise = h / best;
  const comfortMid = (s.stepRuleMin + s.stepRuleMax) / 2;
  const tread = Math.max(s.treadMin, Math.round((comfortMid - 2 * rise) / 5) * 5);
  const run = Math.round(tread * best);
  const w = Math.max(s.widthMin, width ?? 1000);
  return { floorHeight: h, risers: best, rise, tread, run, width: w, stepRule: 2 * rise + tread };
}

/** "3 metres" / "3.2 m" / "10 feet" / "3000 mm" / "9'6\"" → mm. Null if none. */
export function parseFloorHeight(text: string): number | null {
  const t = text.toLowerCase();
  const ftIn = t.match(/(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches))?/);
  if (ftIn) return Math.round(Number(ftIn[1]) * 304.8 + (ftIn[2] ? Number(ftIn[2]) * 25.4 : 0));
  const m = t.match(/(\d+(?:\.\d+)?)\s*(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|m\b|met(?:er|re)s?)/);
  if (m) {
    const n = Number(m[1]);
    const u = m[2];
    if (u.startsWith('mm') || u.startsWith('milli')) return Math.round(n);
    if (u.startsWith('c')) return Math.round(n * 10);
    return Math.round(n * 1000);
  }
  return null;
}

/** "Stairs: 17 risers × 176 mm, tread 280 mm, UP" */
export function stairLegend(p: StairPlan, dir: 'up' | 'down' = 'up'): string {
  return `${dir === 'up' ? 'UP' : 'DN'} · ${p.risers} risers × ${Math.round(p.rise)} mm · tread ${p.tread} mm · going ${(p.run / 1000).toFixed(2)} m`;
}

export interface StairProposal {
  plan: StairPlan;
  legend: string;
  /** One batch op: the stairs component + the legend text. */
  op: Record<string, unknown>;
  at: { x: number; y: number };
  /** Room the stair was placed in, if any. */
  roomName?: string;
  summary: string;
}

/** Where to put the stair: inside the selected room (or the largest room)
 *  near its first wall, else just right of the drawing. */
function placement(doc: PlanDoc, p: StairPlan): { x: number; y: number; roomName?: string } {
  const sel = doc.selectedId;
  const room = doc.rooms.find((r) => r.id === sel || r.wallIds.includes(sel ?? ''))
    ?? [...doc.rooms].sort((a, b) => (roomPolygon(b, doc)?.length ?? 0) - (roomPolygon(a, doc)?.length ?? 0))[0];
  const poly = room ? roomPolygon(room, doc) : null;
  if (room && poly) {
    const xs = poly.map((q) => q.x);
    const ys = poly.map((q) => q.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    if (maxX - minX >= p.run + 200) {
      return { x: minX + 150 + p.run / 2, y: minY + 150 + p.width / 2, roomName: room.name };
    }
  }
  const b = planBounds(doc);
  if (b) return { x: b.max.x + 1000 + p.run / 2, y: b.min.y + p.width / 2 };
  return { x: p.run / 2, y: p.width / 2 };
}

export function proposeStair(
  doc: PlanDoc,
  opts: { floorHeight?: number | null; region?: string | null; width?: number; dir?: 'up' | 'down' } = {},
): StairProposal {
  const g = guidelineSet(opts.region);
  const plan = planStair(opts.floorHeight ?? 3000, g, opts.width);
  const dir = opts.dir ?? 'up';
  const legend = stairLegend(plan, dir);
  const at = placement(doc, plan);
  const op = {
    op: 'batch',
    ops: [
      {
        op: 'add_fixture', kind: 'stairs', x: Math.round(at.x), y: Math.round(at.y),
        w: plan.run, d: plan.width, rotation: dir === 'up' ? 0 : 180,
        steps: plan.risers, rise: Math.round(plan.rise * 10) / 10,
      },
      { op: 'add_text', x: Math.round(at.x - plan.run / 2), y: Math.round(at.y - plan.width / 2 - 350), text: legend, size: 180 },
    ],
  };
  const summary = `A straight stair for a ${(plan.floorHeight / 1000).toFixed(2)} m floor height: ` +
    `${plan.risers} steps of ${Math.round(plan.rise)} mm, ${plan.tread} mm treads, ` +
    `${(plan.run / 1000).toFixed(2)} m long and ${(plan.width / 1000).toFixed(2)} m wide` +
    `${at.roomName ? `, in the ${at.roomName}` : ''}.`;
  return { plan, legend, op, at: { x: at.x, y: at.y }, roomName: at.roomName, summary };
}
