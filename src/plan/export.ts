// PLAN exporters. `toDxf` writes a tiny R12-compatible DXF (opens in AutoCAD /
// LibreCAD / QCAD) with layers WALLS / OPENINGS / DIMS / LABELS; `toJson`
// writes the raw document. Both are pure strings so they can be unit-tested;
// the DOM download helper is separate.
//
// This is a hand-rolled writer (no dependency): the subset we emit — LINE,
// CIRCLE, ARC, TEXT grouped onto named layers — is all a floor plan needs, and
// a vendored DXF lib would be far more surface than the task warrants.

import {
  mm2ToM2Label,
  mmToMetresLabel,
  pointAlong,
  roomArea,
  roomCentroid,
  wallDir,
  wallLength,
  wallNormal,
  type Opening,
  type PlanDoc,
  type Point,
  type Wall,
} from './doc';

export const DXF_LAYERS = ['WALLS', 'OPENINGS', 'DIMS', 'LABELS'] as const;
export type DxfLayer = (typeof DXF_LAYERS)[number];

const DEG = 180 / Math.PI;

class DxfBuilder {
  private body: string[] = [];
  private add(...pairs: Array<[number, string | number]>): void {
    for (const [code, value] of pairs) {
      this.body.push(String(code));
      this.body.push(String(value));
    }
  }
  line(layer: DxfLayer, a: Point, b: Point): void {
    this.add([0, 'LINE'], [8, layer], [10, a.x], [20, a.y], [30, 0], [11, b.x], [21, b.y], [31, 0]);
  }
  circle(layer: DxfLayer, c: Point, r: number): void {
    this.add([0, 'CIRCLE'], [8, layer], [10, c.x], [20, c.y], [30, 0], [40, r]);
  }
  arc(layer: DxfLayer, c: Point, r: number, startDeg: number, endDeg: number): void {
    this.add([0, 'ARC'], [8, layer], [10, c.x], [20, c.y], [30, 0], [40, r], [50, startDeg], [51, endDeg]);
  }
  text(layer: DxfLayer, at: Point, height: number, value: string): void {
    this.add([0, 'TEXT'], [8, layer], [10, at.x], [20, at.y], [30, 0], [40, height], [1, value]);
  }
  entities(): string {
    return this.body.join('\n');
  }
}

function layerTable(): string {
  const colors: Record<DxfLayer, number> = { WALLS: 7, OPENINGS: 5, DIMS: 3, LABELS: 2 };
  const lines: string[] = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', String(DXF_LAYERS.length)];
  for (const name of DXF_LAYERS) {
    lines.push('0', 'LAYER', '2', name, '70', '0', '62', String(colors[name]), '6', 'CONTINUOUS');
  }
  lines.push('0', 'ENDTAB', '0', 'ENDSEC');
  return lines.join('\n');
}

/** The two face polylines of a wall (centreline offset by ±thickness/2). */
function wallFaces(w: Wall): [[Point, Point], [Point, Point]] {
  const n = wallNormal(w);
  const half = w.thickness / 2;
  const off = (p: Point, s: number): Point => ({ x: p.x + n.x * half * s, y: p.y + n.y * half * s });
  return [
    [off(w.a, 1), off(w.b, 1)],
    [off(w.a, -1), off(w.b, -1)],
  ];
}

function drawOpening(dxf: DxfBuilder, o: Opening, wall: Wall): void {
  const start = pointAlong(wall, o.offset);
  const end = pointAlong(wall, o.offset + o.width);
  dxf.line('OPENINGS', start, end); // the sill / threshold
  if (o.kind === 'window') {
    // A second line offset slightly gives the familiar double-glazing symbol.
    const n = wallNormal(wall);
    const t = Math.min(wall.thickness / 2, 60);
    dxf.line('OPENINGS', { x: start.x + n.x * t, y: start.y + n.y * t }, { x: end.x + n.x * t, y: end.y + n.y * t });
    return;
  }
  if (o.kind !== 'door') return; // plain opening: just the threshold line

  // Door: a swing arc of radius = width, hinged at the near (or far) edge.
  const d = wallDir(wall);
  const baseDeg = Math.atan2(d.y, d.x) * DEG;
  if (o.swing === 'right') {
    dxf.arc('OPENINGS', end, o.width, baseDeg + 90, baseDeg + 180);
  } else {
    dxf.arc('OPENINGS', start, o.width, baseDeg, baseDeg + 90);
  }
}

/** Serialize the plan to an R12-compatible DXF string. */
export function toDxf(doc: PlanDoc): string {
  const dxf = new DxfBuilder();

  for (const w of doc.walls) {
    const [f1, f2] = wallFaces(w);
    dxf.line('WALLS', f1[0], f1[1]);
    dxf.line('WALLS', f2[0], f2[1]);
    // Cap the ends so each wall reads as a closed band.
    dxf.line('WALLS', f1[0], f2[0]);
    dxf.line('WALLS', f1[1], f2[1]);
  }

  for (const o of doc.openings) {
    const wall = doc.walls.find((w) => w.id === o.wallId);
    if (wall) drawOpening(dxf, o, wall);
  }

  for (const dim of doc.dims) {
    const wall = doc.walls.find((w) => w.id === dim.wallId);
    if (!wall) continue;
    const n = wallNormal(wall);
    const gap = wall.thickness / 2 + 300;
    const a = { x: wall.a.x + n.x * gap, y: wall.a.y + n.y * gap };
    const b = { x: wall.b.x + n.x * gap, y: wall.b.y + n.y * gap };
    dxf.line('DIMS', a, b); // dimension line
    dxf.line('DIMS', wall.a, a); // witness lines
    dxf.line('DIMS', wall.b, b);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    dxf.text('DIMS', mid, 200, mmToMetresLabel(wallLength(wall)));
  }

  for (const room of doc.rooms) {
    const c = roomCentroid(room, doc);
    if (!c) continue;
    dxf.text('LABELS', { x: c.x, y: c.y + 120 }, 240, room.name);
    dxf.text('LABELS', { x: c.x, y: c.y - 200 }, 180, mm2ToM2Label(roomArea(room, doc)));
  }

  return [layerTable(), '0', 'SECTION', '2', 'ENTITIES', dxf.entities(), '0', 'ENDSEC', '0', 'EOF'].join('\n');
}

/** Serialize the raw plan document to pretty JSON. */
export function toJson(doc: PlanDoc): string {
  return JSON.stringify(doc, null, 2);
}
