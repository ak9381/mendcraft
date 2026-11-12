// Deterministic plan-mode accessibility checks (pure geometry, no DOM, no AI):
// door clear width, a wheelchair turning circle per room, corridor clear width,
// ramp slope, and stair/threshold advisories. Thresholds + citations live in
// core/a11y.ts. Each issue carries highlightable target ids and, where a safe
// automatic fix exists, a raw op envelope (re-validated on apply like all ops).
// The cloud model (hybrid.explainAccessibility) adds explanations and may
// propose alternative fixes; it never bypasses these code checks.

import { PLAN_A11Y, PLAN_CITATIONS, type A11yIssue } from '../core/a11y';
import {
  roomPolygon,
  wallMidpoint,
  wallNormal,
  type Fixture,
  type PlanDoc,
  type Point,
  type Room,
  type Wall,
} from './doc';

const mmLabel = (mm: number) => `${Math.round(mm)} mm`;

// ─── Geometry helpers (pure) ───────────────────────────────────────────────

/** Distance from point p to segment a-b. */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** Ray-cast point-in-polygon (boundary counts as inside for our purposes). */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from a point to a fixture's rotated rectangle (0 when inside). */
export function distToFixture(p: Point, f: Fixture): number {
  const rad = (-f.rotation * Math.PI) / 180;
  const dx = p.x - f.x;
  const dy = p.y - f.y;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  const qx = Math.max(0, Math.abs(lx) - f.w / 2);
  const qy = Math.max(0, Math.abs(ly) - f.d / 2);
  return Math.hypot(qx, qy);
}

export interface TurningFit {
  fits: boolean;
  /** A clear circle centre when it fits. */
  center?: Point;
  /** Fixture ids that block the circle when walls alone would allow it. */
  blockingFixtureIds: string[];
}

/**
 * Can a turning circle of `diameter` fit anywhere in the room? Grid-samples
 * candidate centres inside the room polygon; a centre is clear when it keeps
 * radius clearance from every wall band (centreline + thickness/2) and every
 * fixture inside the room. When only furniture prevents a fit, the blocking
 * fixtures are reported so they can be highlighted.
 */
export function turningCircleFits(
  room: Room,
  doc: PlanDoc,
  diameter: number = PLAN_A11Y.turningCircleDiameter,
  step: number = PLAN_A11Y.turningGridStep,
): TurningFit | null {
  const poly = roomPolygon(room, doc);
  if (!poly) return null; // open loop — cannot judge
  const r = diameter / 2;
  const minX = Math.min(...poly.map((p) => p.x)) + r;
  const maxX = Math.max(...poly.map((p) => p.x)) - r;
  const minY = Math.min(...poly.map((p) => p.y)) + r;
  const maxY = Math.max(...poly.map((p) => p.y)) - r;
  if (maxX < minX || maxY < minY) return { fits: false, blockingFixtureIds: [] };

  const walls = room.wallIds
    .map((id) => doc.walls.find((w) => w.id === id))
    .filter((w): w is Wall => !!w);
  const fixtures = doc.fixtures.filter((f) => pointInPolygon({ x: f.x, y: f.y }, poly));

  const wallsClear = (p: Point) =>
    pointInPolygon(p, poly) && walls.every((w) => distToSegment(p, w.a, w.b) >= r + w.thickness / 2);

  let wallOnlyCenter: Point | null = null;
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      const p = { x, y };
      if (!wallsClear(p)) continue;
      wallOnlyCenter ??= p;
      if (fixtures.every((f) => distToFixture(p, f) >= r)) {
        return { fits: true, center: p, blockingFixtureIds: [] };
      }
    }
  }
  // Walls alone would allow the circle — name the furniture in the way at the
  // first wall-clear spot so the canvas highlight points at something movable.
  const blockingFixtureIds = wallOnlyCenter
    ? fixtures.filter((f) => distToFixture(wallOnlyCenter!, f) < r).map((f) => f.id)
    : [];
  return { fits: false, blockingFixtureIds };
}

// ─── Individual checks ─────────────────────────────────────────────────────

export function checkDoorWidths(doc: PlanDoc): A11yIssue[] {
  const issues: A11yIssue[] = [];
  const { min, recommended } = PLAN_A11Y.doorClear;
  for (const o of doc.openings) {
    if (o.kind !== 'door' && o.kind !== 'opening') continue;
    if (o.width >= recommended) continue;
    const fail = o.width < min;
    issues.push({
      id: `door-${o.id}`,
      rule: 'door-clear-width',
      severity: fail ? 'fail' : 'warn',
      message: fail
        ? `Door ${o.id} is ${mmLabel(o.width)} clear — below the ${mmLabel(min)} minimum.`
        : `Door ${o.id} is ${mmLabel(o.width)} — meets ADA but below the ${mmLabel(recommended)} recommended width.`,
      citation: PLAN_CITATIONS.doorClear,
      targetIds: [o.id],
      fix: { op: 'set_width', target: o.id, width: recommended },
      fixLabel: `Widen to ${mmLabel(recommended)}`,
    });
  }
  return issues;
}

export function checkTurningCircles(doc: PlanDoc): A11yIssue[] {
  const issues: A11yIssue[] = [];
  const d = PLAN_A11Y.turningCircleDiameter;
  for (const room of doc.rooms) {
    const fit = turningCircleFits(room, doc);
    if (!fit || fit.fits) continue;
    const blocked = fit.blockingFixtureIds.length > 0;
    issues.push({
      id: `turn-${room.id}`,
      rule: 'turning-circle',
      severity: 'fail',
      message: blocked
        ? `No clear ${mmLabel(d)} turning circle in "${room.name}" — furniture is in the way.`
        : `"${room.name}" is too tight for a ${mmLabel(d)} wheelchair turning circle.`,
      citation: PLAN_CITATIONS.turningCircle,
      targetIds: [room.id, ...fit.blockingFixtureIds],
      // No one-op fix when the ROOM is too small; when furniture blocks the
      // circle the cloud can propose a move — deleting it is too destructive
      // to be the default.
    });
  }
  return issues;
}

const CORRIDOR_RE = /corridor|hallway|\bhall\b|passage|lobby/i;

export function checkCorridors(doc: PlanDoc): A11yIssue[] {
  const issues: A11yIssue[] = [];
  const { min, recommended } = PLAN_A11Y.corridor;
  for (const room of doc.rooms) {
    if (!CORRIDOR_RE.test(room.name)) continue;
    const poly = roomPolygon(room, doc);
    if (!poly) continue;
    const spanX = Math.max(...poly.map((p) => p.x)) - Math.min(...poly.map((p) => p.x));
    const spanY = Math.max(...poly.map((p) => p.y)) - Math.min(...poly.map((p) => p.y));
    const walls = room.wallIds
      .map((id) => doc.walls.find((w) => w.id === id))
      .filter((w): w is Wall => !!w);
    const t = walls.length ? Math.max(...walls.map((w) => w.thickness)) : 0;
    // Clear width = short centreline span minus half a wall band each side.
    const clear = Math.min(spanX, spanY) - t;
    if (clear >= recommended) continue;
    const fail = clear < min;
    const issue: A11yIssue = {
      id: `corridor-${room.id}`,
      rule: 'corridor-width',
      severity: fail ? 'fail' : 'warn',
      message: `Corridor "${room.name}" is ${mmLabel(clear)} clear — ${
        fail ? `below the ${mmLabel(min)} minimum` : `below the ${mmLabel(recommended)} recommended width`
      }.`,
      citation: PLAN_CITATIONS.corridor,
      targetIds: [room.id],
    };
    // Safe fix for an axis-aligned 4-wall corridor: push one long wall outward
    // (away from the centroid — shared endpoints follow, keeping the loop
    // closed) until the clear width reaches the recommended value.
    const longWall = widenableWall(walls, spanX, spanY);
    if (longWall) {
      const delta = recommended - clear;
      const n = wallNormal(longWall.wall);
      const sign = longWall.outwardSign;
      issue.fix = {
        op: 'move',
        target: longWall.wall.id,
        dx: Math.round(n.x * sign * delta),
        dy: Math.round(n.y * sign * delta),
      };
      issue.fixLabel = `Widen to ${mmLabel(recommended)} clear`;
    }
    issues.push(issue);
  }
  return issues;
}

/** For a 4-wall axis-aligned corridor: the wall running along the LONG axis
 *  plus the normal sign that moves it away from the room centroid. */
function widenableWall(
  walls: Wall[],
  spanX: number,
  spanY: number,
): { wall: Wall; outwardSign: 1 | -1 } | null {
  if (walls.length !== 4) return null;
  const longIsX = spanX >= spanY;
  const axisAligned = (w: Wall) => Math.abs(w.a.x - w.b.x) < 1 || Math.abs(w.a.y - w.b.y) < 1;
  if (!walls.every(axisAligned)) return null;
  const wall = walls.find((w) =>
    longIsX ? Math.abs(w.a.y - w.b.y) < 1 : Math.abs(w.a.x - w.b.x) < 1,
  );
  if (!wall) return null;
  const cx = walls.reduce((s, w) => s + wallMidpoint(w).x, 0) / walls.length;
  const cy = walls.reduce((s, w) => s + wallMidpoint(w).y, 0) / walls.length;
  const mid = wallMidpoint(wall);
  const n = wallNormal(wall);
  const toCentre = { x: cx - mid.x, y: cy - mid.y };
  const outwardSign: 1 | -1 = n.x * toCentre.x + n.y * toCentre.y > 0 ? -1 : 1;
  return { wall, outwardSign };
}

export function checkRampsAndSteps(doc: PlanDoc): A11yIssue[] {
  const issues: A11yIssue[] = [];
  const { rampMaxSlope, rampAssumedRise, thresholdMax } = PLAN_A11Y;
  const requiredRun = Math.ceil(rampAssumedRise / rampMaxSlope); // e.g. 150 × 12
  for (const f of doc.fixtures) {
    const kind = f.kind.toLowerCase();
    if (kind.includes('ramp')) {
      const run = Math.max(f.w, f.d);
      if (run >= requiredRun) continue;
      issues.push({
        id: `ramp-${f.id}`,
        rule: 'ramp-slope',
        severity: 'fail',
        message:
          `Ramp ${f.id} runs ${mmLabel(run)} for an assumed ${mmLabel(rampAssumedRise)} rise — ` +
          `steeper than 1:12 (needs ≥ ${mmLabel(requiredRun)}).`,
        citation: PLAN_CITATIONS.ramp,
        targetIds: [f.id],
        fix: f.w >= f.d
          ? { op: 'set_size', target: f.id, w: requiredRun }
          : { op: 'set_size', target: f.id, d: requiredRun },
        fixLabel: `Lengthen to ${mmLabel(requiredRun)}`,
      });
    } else if (kind.includes('stair') || kind.includes('step')) {
      issues.push({
        id: `step-${f.id}`,
        rule: 'threshold-steps',
        severity: 'warn',
        message:
          `Stairs/step ${f.id}: level changes over ${mmLabel(thresholdMax)} need a ramp ` +
          `(slope ≤ 1:12) or lift alongside for step-free access.`,
        citation: PLAN_CITATIONS.threshold,
        targetIds: [f.id],
      });
    }
  }
  return issues;
}

/** All plan-mode accessibility checks, in display order. Pure and deterministic. */
export function checkPlanAccessibility(doc: PlanDoc): A11yIssue[] {
  return [
    ...checkDoorWidths(doc),
    ...checkCorridors(doc),
    ...checkTurningCircles(doc),
    ...checkRampsAndSteps(doc),
  ];
}
