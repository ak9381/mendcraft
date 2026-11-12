// Pure-data scene model + Engine that applies validated ops immutably,
// with undo/redo, revision counter, and an op log (future Firestore sync).
// Z is up; the floor (print bed) is z = 0. All lengths are mm.

import type {
  Axis,
  BoxParams,
  ConeParams,
  CylinderParams,
  Op,
  Shape,
  ShapeParams,
  SphereParams,
  TorusParams,
  Vec3,
} from './ops';
import { resolveTarget } from './ops';

export interface Transform {
  position: Vec3;
  /** Euler XYZ, degrees. */
  rotationDeg: Vec3;
  scale: Vec3;
  mirror: { x: boolean; y: boolean; z: boolean };
}

export interface HoleFeature {
  kind: 'hole';
  diameter: number;
  depth: number | 'through';
  axis: Axis;
  /** Offset from part centre, part-local mm. */
  offset: Vec3;
}
export interface SubtractFeature {
  kind: 'subtract';
  /** Snapshot of the removed tool part (world transform preserved). */
  tool: Part;
}
export interface UnionFeature {
  kind: 'union';
  part: Part;
}
export type CsgFeature = HoleFeature | SubtractFeature | UnionFeature;

export interface Part {
  id: string;
  name: string;
  shape: Shape;
  params: ShapeParams;
  transform: Transform;
  csg: CsgFeature[];
  /** Fillet-lite edge radius (honoured on boxes by the geometry builder). */
  filletRadius?: number;
}

export interface SceneState {
  parts: Part[];
  selectedId: string | null;
  lastId: string | null;
}

export interface BBox {
  min: Vec3;
  max: Vec3;
}

export interface Warning {
  partId: string | null;
  kind: 'thin-wall' | 'bed-fit' | 'floating' | 'below-floor';
  message: string;
}

export interface ApplyResult {
  ok: boolean;
  error?: string;
  warnings: Warning[];
}

export const BED = { x: 220, y: 220, z: 250 } as const;
export const MIN_WALL_MM = 1.2;
const FLOOR_EPS = 0.1;

export function emptyScene(): SceneState {
  return { parts: [], selectedId: null, lastId: null };
}

function defaultTransform(position: Vec3): Transform {
  return {
    position,
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    mirror: { x: false, y: false, z: false },
  };
}

/** Axis-aligned half extents of the untransformed shape, centred at origin. */
export function localHalfExtents(shape: Shape, params: ShapeParams): Vec3 {
  switch (shape) {
    case 'box': {
      const p = params as BoxParams;
      return { x: p.w / 2, y: p.d / 2, z: p.h / 2 };
    }
    case 'cylinder': {
      const p = params as CylinderParams;
      return { x: p.diameter / 2, y: p.diameter / 2, z: p.height / 2 };
    }
    case 'sphere': {
      const r = (params as SphereParams).diameter / 2;
      return { x: r, y: r, z: r };
    }
    case 'cone': {
      const p = params as ConeParams;
      const r = Math.max(p.diameter, p.topDiameter ?? 0) / 2;
      return { x: r, y: r, z: p.height / 2 };
    }
    case 'torus': {
      const p = params as TorusParams;
      const outer = p.diameter / 2 + p.tube / 2;
      return { x: outer, y: outer, z: p.tube / 2 };
    }
  }
}

const DEG = Math.PI / 180;

function rotatePoint(p: Vec3, rotDeg: Vec3): Vec3 {
  // XYZ-order Euler rotation.
  let { x, y, z } = p;
  const rx = rotDeg.x * DEG;
  const ry = rotDeg.y * DEG;
  const rz = rotDeg.z * DEG;
  let c = Math.cos(rx);
  let s = Math.sin(rx);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry);
  s = Math.sin(ry);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz);
  s = Math.sin(rz);
  [x, y] = [x * c - y * s, x * s + y * c];
  return { x, y, z };
}

/** World-space axis-aligned bounding box of a part (base shape; CSG holes ignored). */
export function partBBox(part: Part): BBox {
  const h = localHalfExtents(part.shape, part.params);
  const { position, rotationDeg, scale } = part.transform;
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const corner = rotatePoint(
          { x: sx * h.x * scale.x, y: sy * h.y * scale.y, z: sz * h.z * scale.z },
          rotationDeg,
        );
        min.x = Math.min(min.x, corner.x + position.x);
        min.y = Math.min(min.y, corner.y + position.y);
        min.z = Math.min(min.z, corner.z + position.z);
        max.x = Math.max(max.x, corner.x + position.x);
        max.y = Math.max(max.y, corner.y + position.y);
        max.z = Math.max(max.z, corner.z + position.z);
      }
  return { min, max };
}

function bboxSize(b: BBox): Vec3 {
  return { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z };
}

/** Thinnest remaining wall (mm) around a hole in a part, lateral to the hole axis. */
function wallAroundHole(part: Part, hole: HoleFeature): number {
  const h = localHalfExtents(part.shape, part.params);
  const s = part.transform.scale;
  const lateral: Axis[] = (['x', 'y', 'z'] as Axis[]).filter((a) => a !== hole.axis);
  let minWall = Infinity;
  for (const a of lateral) {
    const extent = h[a] * s[a] * 2;
    const off = Math.abs(hole.offset[a]);
    minWall = Math.min(minWall, (extent - hole.diameter) / 2 - off);
  }
  return minWall;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export class Engine {
  private state: SceneState = emptyScene();
  private undoStack: SceneState[] = [];
  private redoStack: SceneState[] = [];
  private idCounter = 0;
  revision = 0;
  readonly opLog: Array<{ rev: number; op: Op }> = [];

  getState(): SceneState {
    return this.state;
  }

  private find(state: SceneState, ref: string): Part | undefined {
    const id = resolveTarget(ref, {
      selectedId: state.selectedId,
      lastId: state.lastId,
      ids: state.parts.map((p) => p.id),
    });
    if (id) return state.parts.find((p) => p.id === id);
    // Fall back to a unique part name (templates and voice refer to parts by name).
    const want = ref.trim().toLowerCase();
    const byName = state.parts.filter((p) => p.name.toLowerCase() === want);
    if (byName.length === 1) return byName[0];
    // Spoken references are partial ("the handle" for "grip handle").
    const words = (n: string) => n.toLowerCase().split(/\s+/);
    const partial = state.parts.filter((p) => words(p.name).includes(want));
    if (partial.length === 1) return partial[0];
    // A part merged by union keeps its name inside the parent's features.
    const merged = state.parts.filter((p) =>
      p.csg.some((f) => f.kind === 'union' && (f.part.name.toLowerCase() === want || words(f.part.name).includes(want))),
    );
    return merged.length === 1 ? merged[0] : undefined;
  }

  /** Apply a validated op. On success the previous state is undoable. */
  apply(op: Op): ApplyResult {
    if (op.op === 'undo') {
      const prev = this.undoStack.pop();
      if (!prev) return { ok: false, error: 'nothing to undo', warnings: [] };
      this.redoStack.push(this.state);
      this.state = prev;
      this.bump(op);
      return { ok: true, warnings: this.printability() };
    }
    if (op.op === 'redo') {
      const next = this.redoStack.pop();
      if (!next) return { ok: false, error: 'nothing to redo', warnings: [] };
      this.undoStack.push(this.state);
      this.state = next;
      this.bump(op);
      return { ok: true, warnings: this.printability() };
    }

    const result = this.reduce(this.state, op);
    if (typeof result === 'string') return { ok: false, error: result, warnings: [] };
    this.undoStack.push(this.state);
    this.redoStack = [];
    this.state = result;
    this.bump(op);
    return { ok: true, warnings: this.printability() };
  }

  private bump(op: Op): void {
    this.revision += 1;
    this.opLog.push({ rev: this.revision, op });
  }

  /**
   * Load a template as a single undoable step, starting from a fresh plate.
   * Template ops refer to parts by name ('grip sleeve', ...), so applying them
   * onto an existing design would collide with same-named parts; starting fresh
   * avoids that. Applied atomically: if any op fails, the scene is untouched
   * (no half-built parts), and a single undo restores the previous design.
   */
  applyTemplate(ops: Op[]): ApplyResult {
    let working: SceneState = emptyScene();
    for (const op of ops) {
      const result = this.reduce(working, op);
      if (typeof result === 'string') return { ok: false, error: result, warnings: [] };
      working = result;
    }
    this.undoStack.push(this.state);
    this.redoStack = [];
    this.state = working;
    this.revision += 1;
    for (const op of ops) this.opLog.push({ rev: this.revision, op });
    return { ok: true, warnings: this.printability() };
  }

  /** Pure reducer: new state, or an error string (state untouched). */
  private reduce(state: SceneState, op: Op): SceneState | string {
    const replace = (part: Part): SceneState => ({
      ...state,
      parts: state.parts.map((p) => (p.id === part.id ? part : p)),
    });

    switch (op.op) {
      case 'add': {
        this.idCounter += 1;
        const id = `p${this.idCounter}`;
        const half = localHalfExtents(op.shape, op.params);
        const position = op.position ?? { x: 0, y: 0, z: half.z };
        const part: Part = {
          id,
          name: op.name ?? `${op.shape} ${this.idCounter}`,
          shape: op.shape,
          params: { ...op.params },
          transform: defaultTransform({ ...position }),
          csg: [],
        };
        return { parts: [...state.parts, part], selectedId: id, lastId: id };
      }
      case 'move': {
        const part = this.find(state, op.target);
        if (!part) return `no part for target "${op.target}"`;
        const p = part.transform.position;
        return replace({
          ...part,
          transform: {
            ...part.transform,
            position: { x: p.x + op.dx, y: p.y + op.dy, z: p.z + op.dz },
          },
        });
      }
      case 'rotate': {
        const part = this.find(state, op.target);
        if (!part) return `no part for target "${op.target}"`;
        const r = { ...part.transform.rotationDeg };
        r[op.axis] = ((r[op.axis] + op.deg) % 360 + 360) % 360;
        return replace({ ...part, transform: { ...part.transform, rotationDeg: r } });
      }
      case 'scale': {
        const part = this.find(state, op.target);
        if (!part) return `no part for target "${op.target}"`;
        const s = { ...part.transform.scale };
        if (op.factor !== undefined) {
          s.x *= op.factor;
          s.y *= op.factor;
          s.z *= op.factor;
        }
        if (op.factors) {
          for (const a of ['x', 'y', 'z'] as const) s[a] *= op.factors[a] ?? 1;
        }
        if (op.deltaMm) {
          const half = localHalfExtents(part.shape, part.params);
          for (const a of ['x', 'y', 'z'] as const) {
            const delta = op.deltaMm[a];
            if (delta === undefined) continue;
            const size = half[a] * 2 * s[a];
            if (size <= 0) continue;
            const next = Math.max(0.5, size + delta);
            s[a] *= next / size;
          }
        }
        return replace({ ...part, transform: { ...part.transform, scale: s } });
      }
      case 'hole': {
        const part = this.find(state, op.target);
        if (!part) return `no part for target "${op.target}"`;
        const feature: HoleFeature = {
          kind: 'hole',
          diameter: op.diameter,
          depth: op.depth,
          axis: op.axis,
          offset: op.offset ? { ...op.offset } : { x: 0, y: 0, z: 0 },
        };
        return replace({ ...part, csg: [...part.csg, feature] });
      }
      case 'subtract': {
        const part = this.find(state, op.target);
        const tool = this.find(state, op.tool);
        if (!part) return `no part for target "${op.target}"`;
        if (!tool) return `no part for tool "${op.tool}"`;
        if (part.id === tool.id) return 'subtract target and tool must differ';
        const updated: Part = { ...part, csg: [...part.csg, { kind: 'subtract', tool }] };
        const parts = state.parts
          .filter((p) => p.id !== tool.id)
          .map((p) => (p.id === part.id ? updated : p));
        return {
          parts,
          selectedId: state.selectedId === tool.id ? part.id : state.selectedId,
          lastId: state.lastId === tool.id ? part.id : state.lastId,
        };
      }
      case 'union': {
        const resolved: Part[] = [];
        for (const t of op.targets) {
          const part = this.find(state, t);
          if (!part) return `no part for target "${t}"`;
          if (!resolved.some((p) => p.id === part.id)) resolved.push(part);
        }
        if (resolved.length < 2) return 'union needs 2 distinct parts';
        const [head, ...rest] = resolved;
        const merged: Part = {
          ...head,
          csg: [...head.csg, ...rest.map((part): UnionFeature => ({ kind: 'union', part }))],
        };
        const dropIds = new Set(rest.map((p) => p.id));
        return {
          parts: state.parts.filter((p) => !dropIds.has(p.id)).map((p) => (p.id === head.id ? merged : p)),
          selectedId: dropIds.has(state.selectedId ?? '') ? head.id : state.selectedId,
          lastId: dropIds.has(state.lastId ?? '') ? head.id : state.lastId,
        };
      }
      case 'align': {
        const part = this.find(state, op.target);
        if (!part) return `no part for target "${op.target}"`;
        const box = partBBox(part);
        const pos = { ...part.transform.position };
        if (op.to === 'floor') {
          pos.z -= box.min.z;
        } else {
          const ref = this.find(state, op.to);
          if (!ref) return `no part for align reference "${op.to}"`;
          if (ref.id === part.id) return 'cannot align a part to itself';
          const refBox = partBBox(ref);
          const refCenter = {
            x: (refBox.min.x + refBox.max.x) / 2,
            y: (refBox.min.y + refBox.max.y) / 2,
          };
          switch (op.mode) {
            case 'center':
              pos.x += refCenter.x - (box.min.x + box.max.x) / 2;
              pos.y += refCenter.y - (box.min.y + box.max.y) / 2;
              break;
            case 'top':
              pos.x += refCenter.x - (box.min.x + box.max.x) / 2;
              pos.y += refCenter.y - (box.min.y + box.max.y) / 2;
              pos.z += refBox.max.z - box.min.z;
              break;
            case 'left':
              pos.x += refBox.min.x - box.max.x;
              break;
            case 'right':
              pos.x += refBox.max.x - box.min.x;
              break;
            case 'front':
              pos.y += refBox.min.y - box.max.y;
              break;
            case 'back':
              pos.y += refBox.max.y - box.min.y;
              break;
          }
        }
        return replace({ ...part, transform: { ...part.transform, position: pos } });
      }
      case 'mirror': {
        const part = this.find(state, op.target);
        if (!part) return `no part for target "${op.target}"`;
        const mirror = { ...part.transform.mirror, [op.axis]: !part.transform.mirror[op.axis] };
        const pos = { ...part.transform.position, [op.axis]: -part.transform.position[op.axis] };
        return replace({ ...part, transform: { ...part.transform, mirror, position: pos } });
      }
      case 'array': {
        const part = this.find(state, op.target);
        if (!part) return `no part for target "${op.target}"`;
        const clones: Part[] = [];
        for (let i = 1; i < op.count; i++) {
          this.idCounter += 1;
          const id = `p${this.idCounter}`;
          const pos = { ...part.transform.position };
          pos[op.axis] += op.spacing * i;
          clones.push({
            ...part,
            id,
            name: `${part.name} (${i + 1})`,
            params: { ...part.params },
            transform: { ...part.transform, position: pos },
            csg: part.csg.slice(),
          });
        }
        const lastId = clones.length ? clones[clones.length - 1].id : state.lastId;
        return { parts: [...state.parts, ...clones], selectedId: state.selectedId, lastId };
      }
      case 'fillet': {
        const part = this.find(state, op.target);
        if (!part) return `no part for target "${op.target}"`;
        return replace({ ...part, filletRadius: op.radius });
      }
      case 'delete': {
        const part = this.find(state, op.target);
        if (!part) return `no part for target "${op.target}"`;
        const parts = state.parts.filter((p) => p.id !== part.id);
        const fallback = parts.length ? parts[parts.length - 1].id : null;
        return {
          parts,
          selectedId: state.selectedId === part.id ? fallback : state.selectedId,
          lastId: state.lastId === part.id ? fallback : state.lastId,
        };
      }
      case 'select': {
        const part = this.find(state, op.target);
        if (!part) return `no part for target "${op.target}"`;
        return { ...state, selectedId: part.id };
      }
      case 'undo':
      case 'redo':
        return 'handled by apply()';
    }
  }

  /** Printability warnings for the current scene. */
  printability(): Warning[] {
    const warnings: Warning[] = [];
    for (const part of this.state.parts) {
      const box = partBBox(part);
      const size = bboxSize(box);
      if (size.x > BED.x || size.y > BED.y || size.z > BED.z) {
        warnings.push({
          partId: part.id,
          kind: 'bed-fit',
          message: `${part.name} (${r1(size.x)}x${r1(size.y)}x${r1(size.z)} mm) exceeds the ${BED.x}x${BED.y}x${BED.z} mm bed`,
        });
      }
      if (box.min.z > FLOOR_EPS) {
        warnings.push({
          partId: part.id,
          kind: 'floating',
          message: `${part.name} floats ${r1(box.min.z)} mm above the floor`,
        });
      } else if (box.min.z < -FLOOR_EPS) {
        warnings.push({
          partId: part.id,
          kind: 'below-floor',
          message: `${part.name} sits ${r1(-box.min.z)} mm below the floor`,
        });
      }
      const h = localHalfExtents(part.shape, part.params);
      const s = part.transform.scale;
      const minDim = Math.min(h.x * s.x, h.y * s.y, h.z * s.z) * 2;
      if (minDim < MIN_WALL_MM) {
        warnings.push({
          partId: part.id,
          kind: 'thin-wall',
          message: `${part.name} is only ${r1(minDim)} mm thick (min ${MIN_WALL_MM} mm)`,
        });
      }
      for (const f of part.csg) {
        if (f.kind !== 'hole') continue;
        const wall = wallAroundHole(part, f);
        if (wall < MIN_WALL_MM) {
          warnings.push({
            partId: part.id,
            kind: 'thin-wall',
            message: `${part.name}: wall around the ${f.diameter} mm hole is ${r1(Math.max(0, wall))} mm (min ${MIN_WALL_MM} mm)`,
          });
        }
      }
    }
    return warnings;
  }

  /** Compact JSON scene summary for AI prompts. */
  summary(): string {
    const parts = this.state.parts.map((p) => {
      const box = partBBox(p);
      const size = bboxSize(box);
      return {
        id: p.id,
        name: p.name,
        shape: p.shape,
        sizeMm: { x: r1(size.x), y: r1(size.y), z: r1(size.z) },
        posMm: { x: r1(p.transform.position.x), y: r1(p.transform.position.y), z: r1(p.transform.position.z) },
        holes: p.csg.filter((f) => f.kind === 'hole').length,
      };
    });
    return JSON.stringify({
      rev: this.revision,
      selected: this.state.selectedId,
      parts,
      warnings: this.printability().map((w) => w.message),
    });
  }
}
