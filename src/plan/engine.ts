// Pure-data PLAN engine: applies validated PlanOps immutably with undo/redo,
// a revision counter, and an op log (future Firestore sync — same shape as the
// 3D Engine in core/scene.ts). All geometry is mm, Y-up.
//
// Junction topology is kept deliberately simple: endpoints that share a
// coordinate (within COINCIDENT_MM) are treated as connected, so moving a wall
// drags the matching endpoints of walls that touch it. There is no T-junction
// or wall-trimming logic — a known, documented limit (see README/summary).

import {
  emptyPlan,
  findObject,
  mm2ToM2Label,
  mmToMetresLabel,
  roomArea,
  roomPolygon,
  wallDir,
  wallLength,
  wallNormal,
  type Dimension,
  type Opening,
  type PlanDoc,
  type Point,
  type Room,
  type Wall,
} from './doc';
import { nearestOrthoDir } from './snap';
import type { PlanOp } from './ops';
import { DEFAULTS, PLAN_LIMITS } from './ops';

const COINCIDENT_MM = 1;

export interface PlanApplyResult {
  ok: boolean;
  error?: string;
  warnings: string[];
}

export interface PlanListItem {
  id: string;
  label: string;
  selected: boolean;
}

const same = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) <= COINCIDENT_MM;
const r1 = (n: number) => Math.round(n * 10) / 10;

export class PlanEngine {
  private state: PlanDoc = emptyPlan();
  private undoStack: PlanDoc[] = [];
  private redoStack: PlanDoc[] = [];
  private idCounter = 0;
  revision = 0;
  readonly opLog: Array<{ rev: number; op: PlanOp }> = [];

  getState(): PlanDoc {
    return this.state;
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}${this.idCounter}`;
  }

  /** Resolve 'selected' / an explicit id / a room name to a concrete object id,
   *  against the document currently being reduced (not necessarily this.state —
   *  applyGenerated reduces a separate working doc). */
  private resolveId(doc: PlanDoc, ref: string, kind?: 'wall'): string | undefined {
    if (ref === 'selected') {
      const id = doc.selectedId ?? undefined;
      if (!id) return undefined;
      if (kind === 'wall') return doc.walls.some((w) => w.id === id) ? id : undefined;
      return id;
    }
    const found = findObject(doc, ref);
    if (found) return found.obj.id;
    // Rooms are often addressed by name in speech.
    const want = ref.trim().toLowerCase();
    const room = doc.rooms.find((rm) => rm.name.toLowerCase() === want);
    if (room) return room.id;
    return undefined;
  }

  apply(op: PlanOp): PlanApplyResult {
    if (op.op === 'undo') {
      const prev = this.undoStack.pop();
      if (!prev) return { ok: false, error: 'nothing to undo', warnings: [] };
      this.redoStack.push(this.state);
      this.state = prev;
      this.bump(op);
      return { ok: true, warnings: this.warnings() };
    }
    if (op.op === 'redo') {
      const next = this.redoStack.pop();
      if (!next) return { ok: false, error: 'nothing to redo', warnings: [] };
      this.undoStack.push(this.state);
      this.state = next;
      this.bump(op);
      return { ok: true, warnings: this.warnings() };
    }
    const result = this.reduce(this.state, op);
    if (typeof result === 'string') return { ok: false, error: result, warnings: [] };
    this.undoStack.push(this.state);
    this.redoStack = [];
    this.state = result;
    this.bump(op);
    return { ok: true, warnings: this.warnings() };
  }

  /** Apply a whole generated plan atomically from a blank document (one undo). */
  applyGenerated(ops: PlanOp[]): PlanApplyResult {
    let working: PlanDoc = emptyPlan();
    const savedCounter = this.idCounter;
    this.idCounter = 0;
    for (const op of ops) {
      if (op.op === 'undo' || op.op === 'redo') continue;
      const result = this.reduce(working, op);
      if (typeof result === 'string') {
        this.idCounter = savedCounter;
        return { ok: false, error: result, warnings: [] };
      }
      working = result;
    }
    this.undoStack.push(this.state);
    this.redoStack = [];
    this.state = working;
    this.revision += 1;
    for (const op of ops) this.opLog.push({ rev: this.revision, op });
    return { ok: true, warnings: this.warnings() };
  }

  private bump(op: PlanOp): void {
    this.revision += 1;
    this.opLog.push({ rev: this.revision, op });
  }

  /** Move a target wall's endpoints and drag any coincident endpoints with them. */
  private moveEndpoints(doc: PlanDoc, wallId: string, newA: Point, newB: Point): PlanDoc {
    const target = doc.walls.find((w) => w.id === wallId)!;
    const oldA = target.a;
    const oldB = target.b;
    const walls = doc.walls.map((w) => {
      if (w.id === wallId) return { ...w, a: { ...newA }, b: { ...newB } };
      let a = w.a;
      let b = w.b;
      if (same(a, oldA)) a = { ...newA };
      else if (same(a, oldB)) a = { ...newB };
      if (same(b, oldA)) b = { ...newA };
      else if (same(b, oldB)) b = { ...newB };
      return a === w.a && b === w.b ? w : { ...w, a, b };
    });
    return { ...doc, walls };
  }

  /** Pure reducer: new document, or an error string (state untouched). */
  private reduce(state: PlanDoc, op: PlanOp): PlanDoc | string {
    switch (op.op) {
      case 'add_room': {
        const x0 = op.x;
        const y0 = op.y;
        const x1 = op.x + op.w;
        const y1 = op.y + op.h;
        const corners: Point[] = [
          { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
        ];
        const roomId = this.nextId('r');
        // Reuse an existing wall when an edge coincides with it (either
        // direction), so adjacent rooms SHARE a single wall rather than
        // stacking two — this is what lets "select the shared wall → set
        // length" edit both rooms at once.
        const edgeMatches = (w: Wall, p: Point, q: Point) =>
          (same(w.a, p) && same(w.b, q)) || (same(w.a, q) && same(w.b, p));
        const newWalls: Wall[] = [];
        const wallIds: string[] = [];
        for (let i = 0; i < 4; i++) {
          const p = corners[i];
          const q = corners[(i + 1) % 4];
          const existing =
            state.walls.find((w) => edgeMatches(w, p, q)) ?? newWalls.find((w) => edgeMatches(w, p, q));
          if (existing) {
            wallIds.push(existing.id);
          } else {
            const w: Wall = { id: this.nextId('w'), a: p, b: q, thickness: DEFAULTS.thickness };
            newWalls.push(w);
            wallIds.push(w.id);
          }
        }
        const room: Room = {
          id: roomId,
          name: op.name ?? `Room ${state.rooms.length + 1}`,
          wallIds,
        };
        return {
          ...state,
          walls: [...state.walls, ...newWalls],
          rooms: [...state.rooms, room],
          selectedId: roomId,
        };
      }
      case 'add_wall': {
        const id = this.nextId('w');
        const wall: Wall = { id, a: { ...op.a }, b: { ...op.b }, thickness: op.thickness };
        return { ...state, walls: [...state.walls, wall], selectedId: id };
      }
      case 'add_door':
      case 'add_window': {
        const wallId = this.resolveId(state, op.target, 'wall');
        if (!wallId) return `no wall for target "${op.target}"`;
        const wall = state.walls.find((w) => w.id === wallId)!;
        const len = wallLength(wall);
        if (len < PLAN_LIMITS.openingWidth.min)
          return `wall ${wall.id} (${mmToMetresLabel(len)}) is too short for an opening`;
        const width = Math.min(op.width, len);
        const offset = op.offset === undefined
          ? (len - width) / 2
          : Math.max(0, Math.min(op.offset, len - width));
        const id = this.nextId('o');
        const opening: Opening =
          op.op === 'add_door'
            ? { id, kind: 'door', wallId, offset, width, swing: op.swing }
            : { id, kind: 'window', wallId, offset, width };
        return { ...state, openings: [...state.openings, opening], selectedId: id };
      }
      case 'add_dim': {
        const wallId = this.resolveId(state, op.target, 'wall');
        if (!wallId) return `no wall for target "${op.target}"`;
        if (state.dims.some((d) => d.wallId === wallId))
          return { ...state, selectedId: wallId }; // already dimensioned — no-op change
        const dim: Dimension = { id: this.nextId('m'), wallId };
        return { ...state, dims: [...state.dims, dim], selectedId: dim.id };
      }
      case 'set_length': {
        const wallId = this.resolveId(state, op.target, 'wall');
        if (!wallId) return `no wall for target "${op.target}"`;
        const wall = state.walls.find((w) => w.id === wallId)!;
        // Keep the start point `a`; snap the direction to the nearest axis (ortho).
        const dir = nearestOrthoDir(wallDir(wall));
        const newB: Point = { x: wall.a.x + dir.x * op.length, y: wall.a.y + dir.y * op.length };
        return this.moveEndpoints(state, wallId, wall.a, newB);
      }
      case 'move': {
        const wallId = this.resolveId(state, op.target, 'wall');
        if (!wallId) return `no wall for target "${op.target}"`;
        const wall = state.walls.find((w) => w.id === wallId)!;
        const newA = { x: wall.a.x + op.dx, y: wall.a.y + op.dy };
        const newB = { x: wall.b.x + op.dx, y: wall.b.y + op.dy };
        return { ...this.moveEndpoints(state, wallId, newA, newB), selectedId: wallId };
      }
      case 'offset': {
        const wallId = this.resolveId(state, op.target, 'wall');
        if (!wallId) return `no wall for target "${op.target}"`;
        const wall = state.walls.find((w) => w.id === wallId)!;
        const n = wallNormal(wall);
        const newA = { x: wall.a.x + n.x * op.dist, y: wall.a.y + n.y * op.dist };
        const newB = { x: wall.b.x + n.x * op.dist, y: wall.b.y + n.y * op.dist };
        return { ...this.moveEndpoints(state, wallId, newA, newB), selectedId: wallId };
      }
      case 'set_thickness': {
        const wallId = this.resolveId(state, op.target, 'wall');
        if (!wallId) return `no wall for target "${op.target}"`;
        const wall = state.walls.find((w) => w.id === wallId)!;
        const raw = op.thickness ?? wall.thickness + (op.delta ?? 0);
        const thickness = Math.min(PLAN_LIMITS.thickness.max, Math.max(PLAN_LIMITS.thickness.min, raw));
        return {
          ...state,
          walls: state.walls.map((w) => (w.id === wallId ? { ...w, thickness } : w)),
          selectedId: wallId,
        };
      }
      case 'rename': {
        const id = this.resolveId(state, op.target);
        if (!id) return `no object for target "${op.target}"`;
        const room = state.rooms.find((rm) => rm.id === id);
        if (!room) return `rename only applies to rooms (target "${op.target}")`;
        return {
          ...state,
          rooms: state.rooms.map((rm) => (rm.id === id ? { ...rm, name: op.name } : rm)),
          selectedId: id,
        };
      }
      case 'delete': {
        const id = this.resolveId(state, op.target);
        if (!id) return `no object for target "${op.target}"`;
        const found = findObject(state, id)!;
        if (found.kind === 'wall') {
          const walls = state.walls.filter((w) => w.id !== id);
          return {
            walls,
            openings: state.openings.filter((o) => o.wallId !== id),
            dims: state.dims.filter((d) => d.wallId !== id),
            rooms: state.rooms.map((rm) => ({ ...rm, wallIds: rm.wallIds.filter((w) => w !== id) })),
            selectedId: null,
          };
        }
        if (found.kind === 'room') {
          const room = found.obj as Room;
          const wallIds = new Set(room.wallIds);
          const walls = state.walls.filter((w) => !wallIds.has(w.id));
          return {
            walls,
            openings: state.openings.filter((o) => !wallIds.has(o.wallId)),
            dims: state.dims.filter((d) => !wallIds.has(d.wallId)),
            rooms: state.rooms.filter((rm) => rm.id !== id),
            selectedId: null,
          };
        }
        if (found.kind === 'opening')
          return { ...state, openings: state.openings.filter((o) => o.id !== id), selectedId: null };
        return { ...state, dims: state.dims.filter((d) => d.id !== id), selectedId: null };
      }
      case 'select': {
        const id = this.resolveId(state, op.target);
        if (!id) return `no object for target "${op.target}"`;
        return { ...state, selectedId: id };
      }
      case 'undo':
      case 'redo':
        return 'handled by apply()';
    }
  }

  /** Non-fatal hints for the panel (kept short). */
  warnings(): string[] {
    const out: string[] = [];
    for (const o of this.state.openings) {
      const wall = this.state.walls.find((w) => w.id === o.wallId);
      if (!wall) continue;
      if (o.offset + o.width > wallLength(wall) + COINCIDENT_MM) {
        out.push(`${o.kind} overflows ${wall.id} — it no longer fits.`);
      }
    }
    for (const room of this.state.rooms) {
      if (room.wallIds.length >= 3 && !roomPolygon(room, this.state)) {
        out.push(`${room.name} is not a closed loop (area unavailable).`);
      }
    }
    return out;
  }

  /** Accessible list of plan objects for the panel + keyboard selection. */
  listItems(): PlanListItem[] {
    const items: PlanListItem[] = [];
    for (const room of this.state.rooms) {
      items.push({
        id: room.id,
        label: `${room.name} · ${mm2ToM2Label(roomArea(room, this.state))}`,
        selected: this.state.selectedId === room.id,
      });
    }
    for (const w of this.state.walls) {
      items.push({
        id: w.id,
        label: `Wall ${w.id} · ${mmToMetresLabel(wallLength(w))} · ${r1(w.thickness)} mm`,
        selected: this.state.selectedId === w.id,
      });
    }
    for (const o of this.state.openings) {
      items.push({
        id: o.id,
        label: `${o.kind === 'door' ? 'Door' : 'Window'} on ${o.wallId} · ${mmToMetresLabel(o.width)}`,
        selected: this.state.selectedId === o.id,
      });
    }
    for (const d of this.state.dims) {
      const w = this.state.walls.find((x) => x.id === d.wallId);
      items.push({
        id: d.id,
        label: `Dimension ${w ? mmToMetresLabel(wallLength(w)) : '—'}`,
        selected: this.state.selectedId === d.id,
      });
    }
    return items;
  }

  /** Compact JSON scene summary for AI prompts. */
  summary(): string {
    return JSON.stringify({
      rev: this.revision,
      selected: this.state.selectedId,
      walls: this.state.walls.map((w) => ({
        id: w.id,
        lenMm: r1(wallLength(w)),
        thick: w.thickness,
      })),
      openings: this.state.openings.map((o) => ({ id: o.id, kind: o.kind, wall: o.wallId })),
      rooms: this.state.rooms.map((r) => ({
        id: r.id,
        name: r.name,
        areaM2: r1(roomArea(r, this.state) / 1_000_000),
      })),
      dims: this.state.dims.length,
    });
  }
}
