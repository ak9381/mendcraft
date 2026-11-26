// Guideline check for floor plans. Deterministic CODE measures the drawing
// against one swappable set of typical design values (stairs, doors, rooms,
// corridors, wheelchair space). Gemini only explains and suggests fixes; the
// numbers always come from here. This is a design aid, not certified code
// compliance — every surface that shows it carries GUIDELINE_NOTE.

import { checkCorridors, checkTurningCircles } from '../plan/accessibility';
import {
  polygonArea, roomPolygon, wallLength,
  type Fixture, type PlanDoc, type Room,
} from '../plan/doc';
import { stairStepCount } from '../plan/fixtures';
import type { A11yIssue } from '../core/a11y';

export const GUIDELINE_LABEL = 'Guideline check';
export const GUIDELINE_NOTE = 'A design aid using typical values. Not certified code compliance.';

export type RegionId = 'international' | 'india' | 'us';

export interface RoomRule {
  /** Minimum floor area, m². */
  minArea: number;
  /** Minimum clear width (shorter side), mm. */
  minWidth: number;
}

export interface GuidelineSet {
  id: RegionId;
  label: string;
  /** Where the typical values come from, shown as the citation. */
  source: string;
  stair: {
    riseMin: number; riseMax: number; treadMin: number;
    /** Comfort rule 2R + T, mm. */
    stepRuleMin: number; stepRuleMax: number;
    widthMin: number;
  };
  doorClearMin: number;
  corridorMin: number;
  turningCircle: number;
  rooms: { habitable: RoomRule; kitchen: RoomRule; bathroom: RoomRule; wc: RoomRule };
}

/** One layer of values per region. Products are global; swap the region,
 *  nothing else changes. Values are typical residential design figures. */
export const GUIDELINE_SETS: Record<RegionId, GuidelineSet> = {
  international: {
    id: 'international',
    label: 'International (typical)',
    source: 'Typical international values (ISO 21542 for access)',
    stair: { riseMin: 150, riseMax: 180, treadMin: 280, stepRuleMin: 600, stepRuleMax: 650, widthMin: 900 },
    doorClearMin: 850,
    corridorMin: 1000,
    turningCircle: 1500,
    rooms: {
      habitable: { minArea: 9, minWidth: 2400 },
      kitchen: { minArea: 5, minWidth: 1800 },
      bathroom: { minArea: 2.5, minWidth: 1200 },
      wc: { minArea: 1.1, minWidth: 900 },
    },
  },
  india: {
    id: 'india',
    label: 'India (NBC 2016, residential)',
    source: 'India NBC 2016 Part 3 (typical residential values)',
    stair: { riseMin: 150, riseMax: 190, treadMin: 250, stepRuleMin: 580, stepRuleMax: 650, widthMin: 900 },
    doorClearMin: 800,
    corridorMin: 1000,
    turningCircle: 1500,
    rooms: {
      habitable: { minArea: 9.5, minWidth: 2400 },
      kitchen: { minArea: 5, minWidth: 1800 },
      bathroom: { minArea: 1.8, minWidth: 1200 },
      wc: { minArea: 1.1, minWidth: 900 },
    },
  },
  us: {
    id: 'us',
    label: 'United States (IRC, typical)',
    source: 'US IRC residential values (ADA for access)',
    stair: { riseMin: 100, riseMax: 196, treadMin: 254, stepRuleMin: 600, stepRuleMax: 660, widthMin: 914 },
    doorClearMin: 815,
    corridorMin: 914,
    turningCircle: 1525,
    rooms: {
      habitable: { minArea: 6.5, minWidth: 2134 },
      kitchen: { minArea: 4.6, minWidth: 1800 },
      bathroom: { minArea: 2.3, minWidth: 1200 },
      wc: { minArea: 1.1, minWidth: 762 },
    },
  },
};

export const REGION_IDS = Object.keys(GUIDELINE_SETS) as RegionId[];

export function guidelineSet(region: string | null | undefined): GuidelineSet {
  return GUIDELINE_SETS[(region ?? '') as RegionId] ?? GUIDELINE_SETS.international;
}

/** Room name → which room rule applies (null = no size rule, e.g. "Store"). */
export function roomKind(name: string): keyof GuidelineSet['rooms'] | null {
  const n = name.toLowerCase();
  if (/\b(wc|toilet|powder)\b/.test(n)) return 'wc';
  if (/\b(bath|bathroom|shower|washroom)\b/.test(n)) return 'bathroom';
  if (/\b(kitchen|pantry)\b/.test(n)) return 'kitchen';
  if (/\b(bed|bedroom|living|lounge|hall|study|dining|family|room|guest|master)\b/.test(n)) return 'habitable';
  return null;
}

/** Shorter side of the room's bounding box (mm) and its area (m²). */
export function roomSize(room: Room, doc: PlanDoc): { area: number; width: number; length: number } | null {
  const poly = roomPolygon(room, doc);
  if (!poly) return null;
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const bw = Math.max(...xs) - Math.min(...xs);
  const bh = Math.max(...ys) - Math.min(...ys);
  return { area: polygonArea(poly) / 1e6, width: Math.min(bw, bh), length: Math.max(bw, bh) };
}

/** Rise / tread / step count of a stair fixture. */
export function stairGeometry(f: Fixture): { risers: number; rise: number; tread: number } {
  const risers = f.steps ?? stairStepCount(f.w);
  const rise = f.rise ?? 3000 / risers;
  return { risers, rise, tread: f.w / risers };
}

const m2 = (v: number) => `${v.toFixed(1)} m²`;
const mm = (v: number) => `${Math.round(v)} mm`;

/** A single guideline finding (same shape as the accessibility issues, so the
 *  panel, highlight and fix pipeline are shared). */
export type GuidelineIssue = A11yIssue & { category: 'stairs' | 'doors' | 'rooms' | 'access' };

export function checkStairs(doc: PlanDoc, g: GuidelineSet): GuidelineIssue[] {
  const out: GuidelineIssue[] = [];
  const s = g.stair;
  for (const f of doc.fixtures) {
    if (!f.kind.toLowerCase().includes('stair')) continue;
    const { risers, rise, tread } = stairGeometry(f);
    const base = { citation: g.source, targetIds: [f.id], category: 'stairs' as const };
    if (rise > s.riseMax || rise < s.riseMin) {
      out.push({
        ...base, id: `stair-rise-${f.id}`, rule: 'stair-rise', severity: 'fail',
        message: `Stair ${f.id}: each step rises ${mm(rise)}. Typical range is ${s.riseMin}–${s.riseMax} mm.`,
      });
    }
    if (tread < s.treadMin) {
      const w = Math.ceil(s.treadMin * risers);
      out.push({
        ...base, id: `stair-tread-${f.id}`, rule: 'stair-tread', severity: 'fail',
        message: `Stair ${f.id}: treads are ${mm(tread)} deep. Aim for at least ${s.treadMin} mm.`,
        fix: { op: 'set_size', target: f.id, w },
        fixLabel: `Lengthen the stair to ${(w / 1000).toFixed(2)} m`,
      });
    }
    const rule = 2 * rise + tread;
    if (rise <= s.riseMax && tread >= s.treadMin && (rule < s.stepRuleMin || rule > s.stepRuleMax)) {
      out.push({
        ...base, id: `stair-comfort-${f.id}`, rule: 'stair-comfort', severity: 'warn',
        message: `Stair ${f.id}: 2 × rise + tread is ${mm(rule)}. Comfortable stairs land between ${s.stepRuleMin} and ${s.stepRuleMax} mm.`,
      });
    }
    if (f.d < s.widthMin) {
      out.push({
        ...base, id: `stair-width-${f.id}`, rule: 'stair-width', severity: 'warn',
        message: `Stair ${f.id} is ${mm(f.d)} wide. Typical minimum is ${s.widthMin} mm.`,
        fix: { op: 'set_size', target: f.id, d: s.widthMin },
        fixLabel: `Widen the stair to ${s.widthMin} mm`,
      });
    }
  }
  return out;
}

export function checkDoors(doc: PlanDoc, g: GuidelineSet): GuidelineIssue[] {
  const out: GuidelineIssue[] = [];
  for (const o of doc.openings) {
    if (o.kind !== 'door' || o.width >= g.doorClearMin) continue;
    out.push({
      id: `door-${o.id}`, rule: 'door-width', severity: 'fail', category: 'doors',
      message: `Door ${o.id} is ${mm(o.width)} wide. Aim for at least ${g.doorClearMin} mm so a wheelchair or walker fits.`,
      citation: g.source, targetIds: [o.id],
      fix: { op: 'set_width', target: o.id, width: g.doorClearMin },
      fixLabel: `Widen to ${g.doorClearMin} mm`,
    });
  }
  return out;
}

export function checkRooms(doc: PlanDoc, g: GuidelineSet): GuidelineIssue[] {
  const out: GuidelineIssue[] = [];
  for (const r of doc.rooms) {
    const kind = roomKind(r.name);
    if (!kind) continue;
    const size = roomSize(r, doc);
    if (!size) continue;
    const rule = g.rooms[kind];
    const base = { citation: g.source, targetIds: [r.id, ...r.wallIds], category: 'rooms' as const };
    if (size.area + 1e-6 < rule.minArea) {
      out.push({
        ...base, id: `room-area-${r.id}`, rule: 'room-area', severity: 'fail',
        message: `${r.name} is ${m2(size.area)}. A ${kind === 'habitable' ? 'living room or bedroom' : kind} usually needs at least ${rule.minArea} m².`,
      });
    }
    if (size.width + 0.5 < rule.minWidth) {
      out.push({
        ...base, id: `room-width-${r.id}`, rule: 'room-width', severity: 'warn',
        message: `${r.name} is only ${(size.width / 1000).toFixed(2)} m across. Typical minimum is ${(rule.minWidth / 1000).toFixed(2)} m.`,
      });
    }
  }
  return out;
}

/** Corridor width + wheelchair turning circle: the shared accessibility checks,
 *  relabelled into the guideline categories. */
export function checkAccess(doc: PlanDoc): GuidelineIssue[] {
  return [...checkCorridors(doc), ...checkTurningCircles(doc)].map((i) => ({ ...i, category: 'access' as const }));
}

export interface GuidelineReport {
  region: GuidelineSet;
  issues: GuidelineIssue[];
  /** How many things were measured (doors, stairs, rooms, walls). */
  measured: { doors: number; stairs: number; rooms: number; walls: number };
  label: string;
  note: string;
}

/** Run every guideline check. Pure and deterministic. */
export function checkGuidelines(doc: PlanDoc, region?: string | null): GuidelineReport {
  const g = guidelineSet(region);
  return {
    region: g,
    issues: [...checkStairs(doc, g), ...checkDoors(doc, g), ...checkRooms(doc, g), ...checkAccess(doc)],
    measured: {
      doors: doc.openings.filter((o) => o.kind === 'door').length,
      stairs: doc.fixtures.filter((f) => f.kind.includes('stair')).length,
      rooms: doc.rooms.length,
      walls: doc.walls.length,
    },
    label: GUIDELINE_LABEL,
    note: GUIDELINE_NOTE,
  };
}

/** One spoken/visible line summarising a report. */
export function summarizeReport(r: GuidelineReport): string {
  const fails = r.issues.filter((i) => i.severity === 'fail').length;
  const warns = r.issues.length - fails;
  if (r.issues.length === 0) return `${GUIDELINE_LABEL} (${r.region.label}): nothing flagged.`;
  return `${GUIDELINE_LABEL} (${r.region.label}): ${fails} to fix, ${warns} to look at.`;
}

/** Total wall length, used by plan Q&A. */
export function totalWallLength(doc: PlanDoc): number {
  return doc.walls.reduce((s, w) => s + wallLength(w), 0);
}
