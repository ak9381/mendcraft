// HAND EDIT for the floor plan (design: docs/plan/2026-11-26-plan-hands-design.md).
// No DOM. Turns the hand pointer's fist strokes, fist taps and peace travel
// into the plan's OWN ops, sent through the same ToolContext.apply a mouse
// edit uses (controller.applyOp: validated, undoable, op-logged):
//
//  - a held fist is "pen down": Wall / Room / Dimension / Opening / Measure
//    draw from where the fist closed to where the hand opens, with a live
//    preview and the length in metres; Stairs and the placing tools hand the
//    stroke to their own tool; Select moves the selected element;
//  - a fist tap places (door / window / opening on the nearest wall, a
//    component at the palm point, a pinned dimension, a "Note" label);
//  - resize in 10 cm steps (peace-and-move, or the size steppers);
//  - rotate / flip and remove for the selected element.
//
// One gesture = one undo step: live frames are applied so the plan follows
// the hand, then rolled back and re-applied as one op (or one batch) when the
// gesture ends. A cancelled gesture leaves nothing behind (no Redo either).

import type { OverlayDraw, ToolContext, ToolController, ToolPointer } from '../core/tools';
import { ortho45, normRect } from './drawTools';
import { clampOpeningOffset, nearestWall, projectToWall } from './hosting';
import { pointInPolygon } from './hitTest';
import { fixtureSpec } from './fixtures';
import { fixturePolygon } from './editing';
import { fixtureKindOf } from './tools';
import { GRID_MM, measureSnap, snapToGrid, snapToObjects, snapValueToGrid } from './snap';
import {
  dimLength, findObject, mmToMetresLabel, pointAlong, roomCentroid, roomPolygon, wallDir, wallLength, wallMidpoint,
  type Dimension, type Fixture, type Opening, type PlanDoc, type Point, type Room, type TextLabel, type Wall,
} from './doc';
import { DEFAULTS, PLAN_LIMITS } from './ops';

/** Endpoint / wall snap reach for a hand, in screen px (a mouse gets 14). */
export const HAND_SNAP_PX = 28;
/** How far from a wall a hand may be and still place a door on it. */
export const HAND_WALL_REACH_PX = 160;
/** Magnet reach when a fist closes near (not on) an element. */
export const HAND_AIM_PX = 56;
/** One resize step, and the hand travel that earns it. */
export const RESIZE_STEP_MM = GRID_MM;
export const RESIZE_STEP_PX = 30;
const MIN_WALL_MM = 300;
/** A stroke must travel this far on screen to draw anything: a fist that
 *  closes and opens in place draws nothing. */
export const MIN_STROKE_PX = 40;
/** A move must carry the element at least this far to count (2 grid steps):
 *  a fist that only trembles moves nothing. */
export const MIN_MOVE_MM = 2 * GRID_MM;

export interface HandEditHost {
  /** The plan's own tool context (apply → controller.applyOp + render). */
  ctx: ToolContext;
  tools: ToolController;
  /** Forget the newest n redo entries (after a rollback). */
  dropRedo?(n: number): void;
  /** Hold the view's auto-framing still while a stroke runs. */
  setLive?(on: boolean): void;
  /** Pan the plan view inside its board (Select, fist on empty floor). */
  panByPx?(dx: number, dy: number): void;
  /** Magnet aim: the element nearest a client point within radiusPx. */
  aim?(x: number, y: number, radiusPx: number): string | null;
  /** A gesture changed the plan: one history line. */
  onEdit?(summary: string): void;
  /** The banner / readout may have changed. */
  onChange?(): void;
}

export type HandElementKind = 'wall' | 'room' | 'door' | 'window' | 'opening' | 'fixture' | 'text' | 'dim';

export interface HandTarget {
  id: string;
  kind: HandElementKind;
  label: string;
  /** Client px of the element's handle point. */
  x: number;
  y: number;
}

export interface HandSelection {
  id: string;
  kind: HandElementKind;
  label: string;
  /** "Bedroom: 4.10 m × 3.00 m" */
  readout: string;
  /** Size steppers: one (length / width) or two (width × depth). */
  axes: { key: 'a' | 'b'; name: string; value: number }[];
  /** 'Rotate' (furniture), 'Flip swing' (door) or null. */
  rotate: string | null;
  movable: boolean;
}

export interface HandMode {
  tool: string;
  kind: 'draw' | 'place' | 'select';
  /** The banner line. */
  text: string;
  /** Large live size, or null. */
  readout: string | null;
  /** A stroke or resize is running. */
  live: boolean;
  /** A short message for the hand ("Move closer to a wall…"), or null. */
  note: string | null;
}

export interface PlanHandEdit {
  mode(): HandMode;
  hover(x: number, y: number): void;
  tap(x: number, y: number): void;
  /** A held fist closed at (x, y). False = nothing to do here. */
  fistStart(x: number, y: number): boolean;
  fistMove(x: number, y: number): void;
  /** The hand opened: commit. */
  fistEnd(): void;
  /** Hand lost / looked away / second fist: apply nothing. */
  fistCancel(): void;
  busy(): boolean;
  /** Element handles for the palm highlight (Select tool only). */
  targets(): HandTarget[];
  select(id: string | null): void;
  selection(): HandSelection | null;
  remove(): boolean;
  rotate(): boolean;
  /** Client-px box of the selected element (what the last edit made or
   *  changed), or null — the view brings it back on screen if it left. */
  focusBox(): { left: number; top: number; right: number; bottom: number } | null;
  /** One 10 cm step on a size axis (the stepper buttons). */
  step(axis: 'a' | 'b', dir: 1 | -1): boolean;
  /** Peace-and-move resize: begin, feed the hand travel (px), end / cancel. */
  resizeBegin(): boolean;
  resizeTravel(dxPx: number, dyPx: number): void;
  resizeEnd(): void;
  resizeCancel(): void;
}

type Env = Record<string, unknown>;
const DRAW_TOOLS = new Set(['wall', 'room', 'dim', 'opening', 'measure', 'stairs']);
const WALL_HOSTED: Record<string, 'add_door' | 'add_window' | 'add_opening'> = { door: 'add_door', window: 'add_window', opening: 'add_opening' };
const m = mmToMetresLabel;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

const KIND_WORD: Record<HandElementKind, string> = {
  wall: 'Wall', room: 'Room', door: 'Door', window: 'Window', opening: 'Opening', fixture: 'Furniture', text: 'Label', dim: 'Dimension',
};

function kindOf(doc: PlanDoc, id: string): HandElementKind | null {
  const f = findObject(doc, id);
  if (!f) return null;
  if (f.kind === 'opening') return (f.obj as Opening).kind;
  return f.kind;
}

/** A short name for an element: "Wall 3.00 m", "Bedroom", "Door 0.90 m". */
export function handLabel(doc: PlanDoc, id: string): string {
  const f = findObject(doc, id);
  if (!f) return '';
  if (f.kind === 'wall') return `Wall ${m(wallLength(f.obj as Wall))}`;
  if (f.kind === 'room') return (f.obj as Room).name || 'Room';
  if (f.kind === 'opening') { const o = f.obj as Opening; return `${KIND_WORD[o.kind]} ${m(o.width)}`; }
  if (f.kind === 'fixture') return fixtureSpec((f.obj as Fixture).kind).label;
  if (f.kind === 'text') return `Label “${(f.obj as TextLabel).text.slice(0, 18)}”`;
  const len = dimLength(f.obj as Dimension, doc);
  return `Dimension${len === null ? '' : ` ${m(len)}`}`;
}

function roomBox(room: Room, doc: PlanDoc): { x: number; y: number; w: number; h: number } | null {
  const poly = roomPolygon(room, doc);
  if (!poly) return null;
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The longest wall of a room that runs along x (horizontal) or y. */
function roomWall(room: Room, doc: PlanDoc, horizontal: boolean): Wall | null {
  let best: Wall | null = null;
  for (const id of room.wallIds) {
    const w = doc.walls.find((x) => x.id === id);
    if (!w) continue;
    const d = wallDir(w);
    if ((Math.abs(d.x) >= Math.abs(d.y)) !== horizontal) continue;
    if (!best || wallLength(w) > wallLength(best)) best = w;
  }
  return best;
}

/** Sizes the steppers act on (mm). `b` is absent for one-axis elements. */
function sizeOf(doc: PlanDoc, id: string): { a: number; b?: number } | null {
  const f = findObject(doc, id);
  if (!f) return null;
  if (f.kind === 'wall') return { a: wallLength(f.obj as Wall) };
  if (f.kind === 'room') { const b = roomBox(f.obj as Room, doc); return b ? { a: b.w, b: b.h } : null; }
  if (f.kind === 'opening') return { a: (f.obj as Opening).width };
  if (f.kind === 'fixture') { const x = f.obj as Fixture; return { a: x.w, b: x.d }; }
  if (f.kind === 'dim') { const len = dimLength(f.obj as Dimension, doc); return len === null ? null : { a: len }; }
  return null;
}

/** Ops that give element `id` the sizes (a, b), from the document as it was
 *  when the resize began (`base`: its sizes then). */
function resizeEnvs(doc: PlanDoc, id: string, base: { a: number; b?: number }, a: number, b: number | undefined): Env[] {
  const f = findObject(doc, id);
  if (!f) return [];
  const wallLen = (v: number) => clamp(v, MIN_WALL_MM, PLAN_LIMITS.wallLen.max);
  if (f.kind === 'wall') return [{ op: 'set_length', target: id, length: wallLen(a) }];
  if (f.kind === 'room') {
    const room = f.obj as Room;
    const out: Env[] = [];
    const hw = roomWall(room, doc, true), vw = roomWall(room, doc, false);
    if (hw && a !== base.a) out.push({ op: 'set_length', target: hw.id, length: wallLen(wallLength(hw) + (a - base.a)) });
    if (vw && b !== undefined && base.b !== undefined && b !== base.b) out.push({ op: 'set_length', target: vw.id, length: wallLen(wallLength(vw) + (b - base.b)) });
    return out;
  }
  if (f.kind === 'opening') {
    const o = f.obj as Opening;
    const wall = doc.walls.find((w) => w.id === o.wallId);
    const max = Math.min(PLAN_LIMITS.openingWidth.max, wall ? wallLength(wall) : Infinity);
    return [{ op: 'set_width', target: id, width: clamp(a, PLAN_LIMITS.openingWidth.min, max) }];
  }
  if (f.kind === 'fixture') {
    const { min, max } = PLAN_LIMITS.fixtureSize;
    return [{ op: 'set_size', target: id, w: clamp(a, min, max), d: clamp(b ?? (f.obj as Fixture).d, min, max) }];
  }
  if (f.kind === 'dim') {
    const dim = f.obj as Dimension;
    if (dim.wallId) return [{ op: 'set_length', target: dim.wallId, length: wallLen(a) }];
    if (dim.a && dim.b) {
      const len = Math.max(1, dist(dim.a, dim.b));
      const want = clamp(a, RESIZE_STEP_MM, PLAN_LIMITS.wallLen.max);
      const bx = dim.a.x + ((dim.b.x - dim.a.x) / len) * want, by = dim.a.y + ((dim.b.y - dim.a.y) / len) * want;
      return [{ op: 'delete', target: id }, { op: 'add_dim', ax: dim.a.x, ay: dim.a.y, bx, by }];
    }
  }
  return [];
}

export function createPlanHandEdit(host: HandEditHost): PlanHandEdit {
  const { ctx, tools } = host;
  const doc = (): PlanDoc => ctx.snapshot() as PlanDoc;
  const pinch = (x: number, y: number): ToolPointer => ({ x, y, source: 'pinch' });
  const snapMm = () => Math.max(GRID_MM, HAND_SNAP_PX / ctx.scale());
  const reachMm = () => Math.max(600, HAND_WALL_REACH_PX / ctx.scale());
  const toolId = () => tools.activeId();
  const changed = () => host.onChange?.();
  // The last thing the hand was told ("Move closer to a wall…"): the banner
  // shows it for a few seconds (the mouse hint pill is hidden in hand edit).
  let note: { text: string; at: number } | null = null;
  const NOTE_MS = 3500;
  const status = (text: string): void => { note = { text, at: Date.now() }; ctx.setStatus(text); };

  // ---- live steps → one undo step
  let steps = 0;
  const live = (env: Env): boolean => { const ok = ctx.apply(env).ok; if (ok) steps++; return ok; };
  function rollback(): void {
    const n = steps;
    for (; steps > 0; steps--) ctx.apply({ op: 'undo' });
    if (n) host.dropRedo?.(n);
  }
  /** Apply the gesture's final ops as one step; true if the plan changed. */
  function commit(envs: Env[], summary: string): boolean {
    rollback();
    if (!envs.length) { ctx.render(); return false; }
    const ok = ctx.apply(envs.length === 1 ? envs[0] : { op: 'batch', ops: envs }).ok;
    if (ok) host.onEdit?.(summary);
    return ok;
  }

  // ---- snapping
  /** Endpoints / midpoints, then a point on a wall, then the 10 cm grid. */
  function drawSnap(world: Point, anchor?: Point): Point {
    const d = doc();
    const obj = snapToObjects(world, d.walls, snapMm());
    if (obj) return obj.point;
    const cand = anchor ? ortho45(anchor, world) : world;
    const hit = nearestWall(cand, d.walls, snapMm() / 2);
    if (hit) return pointAlong(hit.wall, clamp(snapValueToGrid(hit.t), 0, wallLength(hit.wall)));
    return snapToGrid(cand);
  }

  // ---- strokes
  type Stroke =
    | { kind: 'wall'; a: Point; b: Point }
    | { kind: 'dim'; a: Point; b: Point }
    | { kind: 'measure'; a: Point; b: Point }
    | { kind: 'room'; a: Point; b: Point }
    | { kind: 'opening'; wall: Wall; t0: number; t1: number }
    | { kind: 'tool'; last: { x: number; y: number } }
    | { kind: 'place'; last: { x: number; y: number } }
    | { kind: 'move'; id: string; elem: HandElementKind; grab: Point; ids: string[]; applied: Point; offset0: number; wallId?: string; label: string }
    | { kind: 'pan'; last: { x: number; y: number } };
  let stroke: Stroke | null = null;
  /** Where the fist closed, and how far it has got from there (px). */
  let strokeFrom = { x: 0, y: 0 };
  let strokeTravel = 0;
  let readout: string | null = null;
  let lingering: string | null = null;

  const line = (ov: OverlayDraw, a: Point, b: Point, color: string, text: string): void => {
    const sa = ctx.toScreen(a), sb = ctx.toScreen(b);
    ov.dot(sa, color, 5); ov.dot(sb, color, 5);
    ov.line(sa, sb, color, 4);
    ov.label({ x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 - 14 }, text, color);
  };

  function openingSpan(s: { wall: Wall; t0: number; t1: number }): { offset: number; width: number } {
    const len = wallLength(s.wall);
    const lo = clamp(snapValueToGrid(Math.min(s.t0, s.t1)), 0, len);
    const hi = clamp(snapValueToGrid(Math.max(s.t0, s.t1)), 0, len);
    return { offset: lo, width: hi - lo };
  }

  function paintStroke(): void {
    const s = stroke;
    if (!s) return;
    if (s.kind === 'wall' || s.kind === 'dim' || s.kind === 'measure') {
      const len = dist(s.a, s.b);
      const name = s.kind === 'wall' ? 'Wall' : s.kind === 'dim' ? 'Dimension' : 'Measure';
      readout = `${name}: ${m(len)}`;
      const color = s.kind === 'wall' ? '#1d4ed8' : '#15803d';
      ctx.setOverlay((ov) => line(ov, s.a, s.b, color, m(len)));
    } else if (s.kind === 'room') {
      const r = normRect(s.a, s.b);
      readout = `Room: ${m(r.w)} × ${m(r.h)}`;
      ctx.setOverlay((ov) => {
        ov.rect(ctx.toScreen({ x: r.x, y: r.y }), ctx.toScreen({ x: r.x + r.w, y: r.y + r.h }), '#1d4ed8', 'rgba(37,99,235,0.10)');
        ov.label(ctx.toScreen({ x: r.x + r.w / 2, y: r.y + r.h / 2 }), `${m(r.w)} × ${m(r.h)}`, '#1d4ed8');
      });
    } else if (s.kind === 'opening') {
      const sp = openingSpan(s);
      readout = `Opening: ${m(sp.width)}`;
      ctx.setOverlay((ov) => line(ov, pointAlong(s.wall, sp.offset), pointAlong(s.wall, sp.offset + sp.width), '#b45309', m(sp.width)));
    }
    changed();
  }

  /** What a held fist with the Select tool moves. */
  function beginMove(x: number, y: number): Stroke | null {
    const d = doc();
    const sel = d.selectedIds?.length ? d.selectedIds : d.selectedId ? [d.selectedId] : [];
    // Only the SELECTED element moves, and only when the fist closes on or
    // near it. Anywhere else (or with nothing selected) the fist pans the
    // plan — it never grabs whatever happens to be nearby.
    const id = sel.length === 1 ? sel[0] : null;
    // "Near" is measured to the selected element ITSELF (its box on screen plus
    // the hand reach), so a door in the middle of the selected wall, or a
    // closer neighbour, cannot steal the grab.
    const box = id ? focusBox() : null;
    const onIt = !!box && x >= box.left - HAND_AIM_PX && x <= box.right + HAND_AIM_PX && y >= box.top - HAND_AIM_PX && y <= box.bottom + HAND_AIM_PX;
    if (!id || !onIt) return { kind: 'pan', last: { x, y } };
    const elem = kindOf(d, id);
    if (!elem) return null;
    const grab = ctx.toWorld(x, y);
    const base = { kind: 'move' as const, id, elem, grab, applied: { x: 0, y: 0 }, offset0: 0, label: handLabel(d, id) };
    if (elem === 'room') {
      const room = d.rooms.find((r) => r.id === id)!;
      const poly = roomPolygon(room, d);
      const inside = (p: Point) => !!poly && pointInPolygon(p, poly);
      const ids = [
        ...room.wallIds,
        ...d.fixtures.filter((f) => inside({ x: f.x, y: f.y })).map((f) => f.id),
        ...d.texts.filter((t) => inside({ x: t.x, y: t.y })).map((t) => t.id),
      ];
      return { ...base, ids };
    }
    if (elem === 'door' || elem === 'window' || elem === 'opening') {
      const o = d.openings.find((q) => q.id === id)!;
      return { ...base, ids: [id], offset0: o.offset, wallId: o.wallId };
    }
    if (elem === 'dim') { status('A dimension follows what it measures — move the wall instead.'); return null; }
    return { ...base, ids: [id] };
  }

  /** The ops that carry a move stroke from its start to `total` (world mm). */
  function moveEnvs(s: Extract<Stroke, { kind: 'move' }>, total: Point): Env[] {
    if (s.wallId) {
      const d = doc();
      const o = d.openings.find((q) => q.id === s.id);
      const wall = d.walls.find((w) => w.id === s.wallId);
      if (!o || !wall) return [];
      const dir = wallDir(wall);
      const want = snapValueToGrid(s.offset0 + total.x * dir.x + total.y * dir.y);
      const offset = clampOpeningOffset(want + o.width / 2, o.width, wallLength(wall));
      return Math.abs(offset - o.offset) < 1 ? [] : [{ op: 'move_opening', target: s.id, offset }];
    }
    if (!total.x && !total.y) return [];
    if (s.elem === 'room') return [{ op: 'move_many', ids: s.ids, dx: total.x, dy: total.y }];
    return [{ op: 'move', target: s.id, dx: total.x, dy: total.y }];
  }

  function fistStart(x: number, y: number): boolean {
    if (stroke) fistCancel();
    lingering = null;
    steps = 0;
    strokeFrom = { x, y };
    strokeTravel = 0;
    const tool = toolId();
    const world = ctx.toWorld(x, y);
    const d = doc();
    if (tool === 'wall') { const a = drawSnap(world); stroke = { kind: 'wall', a, b: a }; }
    else if (tool === 'room') { const a = snapToGrid(world); stroke = { kind: 'room', a, b: a }; }
    else if (tool === 'dim' || tool === 'measure') { const a = measureSnap(world, d.walls, snapMm()).point; stroke = tool === 'dim' ? { kind: 'dim', a, b: a } : { kind: 'measure', a, b: a }; }
    else if (tool === 'opening') {
      const hit = nearestWall(world, d.walls, reachMm());
      if (!hit) { status(d.walls.length ? 'Start the opening on a wall.' : 'Draw a wall first — an opening sits in a wall.'); return false; }
      stroke = { kind: 'opening', wall: hit.wall, t0: hit.t, t1: hit.t };
    }
    else if (tool === 'stairs') { tools.down(pinch(x, y)); stroke = { kind: 'tool', last: { x, y } }; }
    else if (tool === 'select') { stroke = beginMove(x, y); }
    else { tools.hover(pinch(x, y)); stroke = { kind: 'place', last: { x, y } }; }
    if (!stroke) return false;
    host.setLive?.(true);
    paintStroke();
    changed();
    return true;
  }

  function fistMove(x: number, y: number): void {
    const s = stroke;
    if (!s) return;
    strokeTravel = Math.max(strokeTravel, Math.hypot(x - strokeFrom.x, y - strokeFrom.y));
    const world = ctx.toWorld(x, y);
    if (s.kind === 'wall') s.b = drawSnap(world, s.a);
    else if (s.kind === 'room') s.b = snapToGrid(world);
    else if (s.kind === 'dim' || s.kind === 'measure') s.b = measureSnap(world, doc().walls, snapMm()).point;
    else if (s.kind === 'opening') s.t1 = projectToWall(world, s.wall).t;
    else if (s.kind === 'tool') { tools.move(pinch(x, y)); s.last = { x, y }; return; }
    else if (s.kind === 'place') { tools.hover(pinch(x, y)); s.last = { x, y }; return; }
    else if (s.kind === 'pan') { host.panByPx?.(x - s.last.x, y - s.last.y); s.last = { x, y }; return; }
    else {
      const total = s.wallId ? { x: world.x - s.grab.x, y: world.y - s.grab.y } : snapToGrid({ x: world.x - s.grab.x, y: world.y - s.grab.y });
      if (s.wallId) {
        const envs = moveEnvs(s, total);
        if (envs.length) live(envs[0]);
        const o = doc().openings.find((q) => q.id === s.id);
        if (o) readout = `${s.label}: ${m(o.offset)} from the wall end`;
      } else {
        const dx = total.x - s.applied.x, dy = total.y - s.applied.y;
        if (dx || dy) {
          const env: Env = s.elem === 'room' ? { op: 'move_many', ids: s.ids, dx, dy } : { op: 'move', target: s.id, dx, dy };
          if (live(env)) s.applied = total;
        }
        readout = `${s.label}: moved ${m(Math.hypot(s.applied.x, s.applied.y))}`;
      }
      changed();
      return;
    }
    paintStroke();
  }

  function endStroke(apply: boolean): void {
    const s = stroke;
    if (!s) return;
    stroke = null;
    readout = null;
    host.setLive?.(false);
    const done = (): void => { ctx.setOverlay(null); changed(); };
    if (s.kind === 'tool') {
      if (apply && strokeTravel < MIN_STROKE_PX) { tools.cancel(); status('Nothing drawn — keep your fist closed and move, then open your hand.'); return done(); }
      if (apply) {
        const before = doc().fixtures.length;
        tools.up(pinch(s.last.x, s.last.y));
        if (doc().fixtures.length > before) host.onEdit?.('Drew stairs');
      } else tools.cancel();
      return done();
    }
    if (s.kind === 'place') {
      if (apply) place(s.last.x, s.last.y); else tools.cancel();
      return done();
    }
    if (s.kind === 'pan') return done();
    if (!apply) { rollback(); ctx.render(); return done(); }
    // A fist that closed and opened without really moving draws nothing.
    if (s.kind !== 'move' && strokeTravel < MIN_STROKE_PX) {
      rollback();
      status('Nothing drawn — keep your fist closed and move, then open your hand.');
      ctx.render();
      return done();
    }
    if (s.kind === 'wall') {
      const len = dist(s.a, s.b);
      if (len < MIN_WALL_MM) status('Too short for a wall — keep your fist closed and move further.');
      else if (commit([{ op: 'add_wall', x1: s.a.x, y1: s.a.y, x2: s.b.x, y2: s.b.y, thickness: DEFAULTS.thickness }], `Drew a wall ${m(len)}`)) lingering = `Wall: ${m(len)}`;
    } else if (s.kind === 'room') {
      const r = normRect(s.a, s.b);
      if (r.w < 300 || r.h < 300) status('Room too small — drag a larger rectangle.');
      else if (commit([{ op: 'add_room', x: r.x, y: r.y, w: r.w, h: r.h }], `Drew a room ${m(r.w)} × ${m(r.h)}`)) lingering = `Room: ${m(r.w)} × ${m(r.h)}`;
    } else if (s.kind === 'dim') {
      const len = dist(s.a, s.b);
      if (len < GRID_MM) status('Too short for a dimension — move further, or fist-tap a wall to pin one.');
      else if (commit([{ op: 'add_dim', ax: s.a.x, ay: s.a.y, bx: s.b.x, by: s.b.y }], `Added a dimension ${m(len)}`)) lingering = `Dimension: ${m(len)}`;
    } else if (s.kind === 'measure') {
      const len = dist(s.a, s.b);
      lingering = `Measured: ${m(len)}`;
      ctx.setStatus(`Measured ${m(len)}.`);
    } else if (s.kind === 'opening') {
      const sp = openingSpan(s);
      if (sp.width < PLAN_LIMITS.openingWidth.min) status('Too narrow for an opening — drag further along the wall, or fist-tap for a standard one.');
      else if (commit([{ op: 'add_opening', target: s.wall.id, offset: sp.offset, width: sp.width }], `Added an opening ${m(sp.width)}`)) lingering = `Opening: ${m(sp.width)}`;
    } else {
      let envs: Env[];
      if (s.wallId) {
        // Openings: where the live frames left it.
        const o = doc().openings.find((q) => q.id === s.id);
        envs = o && Math.abs(o.offset - s.offset0) >= 1 ? [{ op: 'move_opening', target: s.id, offset: o.offset }] : [];
      } else envs = moveEnvs(s, s.applied);
      // Under two grid steps it was a tremble, not a move.
      const far = s.wallId
        ? envs.length > 0 && Math.abs(Number((envs[0] as { offset?: number }).offset) - s.offset0) >= MIN_MOVE_MM
        : Math.hypot(s.applied.x, s.applied.y) >= MIN_MOVE_MM;
      if (far) commit(envs, `Moved ${s.label}`);
      else { rollback(); ctx.render(); if (strokeTravel > 0) status(`${s.label} stays where it was — move at least 20 cm to move it.`); }
    }
    done();
  }
  const fistEnd = () => endStroke(true);
  function fistCancel(): void { endStroke(false); }

  // ---- taps
  function pinDimension(world: Point): void {
    const hit = nearestWall(world, doc().walls, reachMm());
    if (!hit) { status('Fist-tap closer to a wall to dimension it.'); return; }
    if (ctx.apply({ op: 'add_dim', target: hit.wall.id }).ok) host.onEdit?.(`Added a dimension on a ${m(wallLength(hit.wall))} wall`);
  }

  function place(x: number, y: number): void {
    const tool = toolId();
    const world = ctx.toWorld(x, y);
    const d = doc();
    const hosted = WALL_HOSTED[tool];
    if (hosted) {
      const name = tool === 'door' ? 'door' : tool === 'window' ? 'window' : 'opening';
      const hit = nearestWall(world, d.walls, reachMm());
      if (!hit) { status(d.walls.length ? `Move closer to a wall to place the ${name}.` : `Draw a wall first — a ${name} sits in a wall.`); return; }
      const width = tool === 'window' ? DEFAULTS.windowWidth : DEFAULTS.doorWidth;
      const offset = clampOpeningOffset(snapValueToGrid(hit.t), width, wallLength(hit.wall));
      const env: Env = { op: hosted, target: hit.wall.id, offset, width, ...(tool === 'door' ? { swing: 'left' } : {}) };
      if (ctx.apply(env).ok) { ctx.setStatus(`${KIND_WORD[tool as HandElementKind]} placed.`); host.onEdit?.(`Placed a ${name}`); }
      ctx.setOverlay(null);
      return;
    }
    if (tool === 'text') {
      const g = snapToGrid(world);
      if (ctx.apply({ op: 'add_text', nums: { x: g.x, y: g.y }, text: 'Note' }).ok) { ctx.setStatus('Label placed — say or type its text.'); host.onEdit?.('Placed a label'); }
      return;
    }
    if (tool === 'dim') { pinDimension(world); return; }
    const fx = fixtureKindOf(tool);
    if (fx || tool === 'stairs') {
      const before = doc().fixtures.length;
      tools.down(pinch(x, y));
      tools.up(pinch(x, y));
      if (doc().fixtures.length > before) host.onEdit?.(`Placed ${fx ? fixtureSpec(fx).label.toLowerCase() : 'stairs'}`);
      ctx.setOverlay(null);
      return;
    }
    status('Keep your fist closed and move to draw.');
  }

  function tap(x: number, y: number): void {
    lingering = null;
    if (toolId() === 'select') {
      const id = host.aim?.(x, y, HAND_AIM_PX) ?? ctx.pick(x, y);
      select(id);
      return;
    }
    place(x, y);
    changed();
  }

  function hover(x: number, y: number): void {
    if (stroke || resize) return;
    tools.hover(pinch(x, y));
  }

  // ---- selection
  function select(id: string | null): void {
    const d = doc();
    const cur = d.selectedIds?.length ? d.selectedIds : d.selectedId ? [d.selectedId] : [];
    if (id ? cur.length === 1 && cur[0] === id : cur.length === 0) return;
    ctx.apply({ op: 'select_set', ids: id ? [id] : [] });
    lingering = null;
    changed();
  }

  function selectedId(): string | null {
    const d = doc();
    const sel = d.selectedIds?.length ? d.selectedIds : d.selectedId ? [d.selectedId] : [];
    return sel.length === 1 ? sel[0] : null;
  }

  function sizeText(d: PlanDoc, id: string): string {
    const s = sizeOf(d, id);
    if (!s) return '';
    return s.b === undefined ? m(s.a) : `${m(s.a)} × ${m(s.b)}`;
  }

  function selection(): HandSelection | null {
    const d = doc();
    const id = selectedId();
    const kind = id ? kindOf(d, id) : null;
    if (!id || !kind) return null;
    const s = sizeOf(d, id);
    const f = findObject(d, id)!;
    const name = kind === 'room' ? ((f.obj as Room).name || 'Room') : kind === 'fixture' ? fixtureSpec((f.obj as Fixture).kind).label : KIND_WORD[kind];
    const axes: HandSelection['axes'] = !s ? [] : s.b === undefined
      ? [{ key: 'a', name: kind === 'wall' || kind === 'dim' ? 'Length' : 'Width', value: s.a }]
      : [{ key: 'a', name: 'Width', value: s.a }, { key: 'b', name: 'Depth', value: s.b }];
    return {
      id, kind, label: handLabel(d, id),
      readout: s ? `${name}: ${sizeText(d, id)}` : handLabel(d, id),
      axes,
      rotate: kind === 'fixture' ? 'Rotate' : kind === 'door' ? 'Flip swing' : null,
      movable: kind !== 'dim',
    };
  }

  function targets(): HandTarget[] {
    if (toolId() !== 'select') return [];
    const d = doc();
    const out: HandTarget[] = [];
    const add = (id: string, kind: HandElementKind, p: Point): void => {
      const s = ctx.toScreen(p);
      out.push({ id, kind, label: handLabel(d, id), x: s.x, y: s.y });
    };
    for (const r of d.rooms) { const c = roomCentroid(r, d); if (c) add(r.id, 'room', c); }
    for (const w of d.walls) add(w.id, 'wall', wallMidpoint(w));
    for (const o of d.openings) {
      const wall = d.walls.find((w) => w.id === o.wallId);
      if (wall) add(o.id, o.kind, pointAlong(wall, o.offset + o.width / 2));
    }
    for (const f of d.fixtures) add(f.id, 'fixture', { x: f.x, y: f.y });
    for (const t of d.texts) add(t.id, 'text', { x: t.x, y: t.y });
    for (const dim of d.dims) if (!dim.wallId && dim.a && dim.b) add(dim.id, 'dim', { x: (dim.a.x + dim.b.x) / 2, y: (dim.a.y + dim.b.y) / 2 });
    return out;
  }

  function remove(): boolean {
    const d = doc();
    const ids = d.selectedIds?.length ? d.selectedIds : d.selectedId ? [d.selectedId] : [];
    if (!ids.length) { status('Nothing is selected to remove.'); return false; }
    const what = ids.length === 1 ? handLabel(d, ids[0]) : `${ids.length} elements`;
    const envs = ids.map((id) => ({ op: 'delete', target: id }));
    const ok = ctx.apply(envs.length === 1 ? envs[0] : { op: 'batch', ops: envs }).ok;
    if (ok) { ctx.setStatus(`Removed ${what}. Undo brings it back.`); host.onEdit?.(`Removed ${what}`); lingering = null; changed(); }
    return ok;
  }

  function rotate(): boolean {
    const sel = selection();
    if (!sel?.rotate) { status('Select furniture or a door to rotate it.'); return false; }
    const ok = ctx.apply(sel.kind === 'fixture' ? { op: 'rotate', target: sel.id, angle: 90 } : { op: 'rotate', target: sel.id }).ok;
    if (ok) { host.onEdit?.(sel.kind === 'fixture' ? `Rotated ${sel.label}` : 'Flipped the door swing'); changed(); }
    return ok;
  }

  // ---- resize (peace-and-move, or the steppers)
  let resize: { id: string; base: { a: number; b?: number }; sa: number; sb: number; doc0: PlanDoc; axis: Point | null } | null = null;

  /** One-axis elements grow along their own direction on screen: toward the
   *  right, or up when they run vertically. */
  function travelAxis(d: PlanDoc, id: string): Point | null {
    const f = findObject(d, id);
    if (!f) return null;
    let a: Point | undefined, b: Point | undefined;
    if (f.kind === 'wall') { a = (f.obj as Wall).a; b = (f.obj as Wall).b; }
    else if (f.kind === 'opening') { const w = d.walls.find((x) => x.id === (f.obj as Opening).wallId); a = w?.a; b = w?.b; }
    else if (f.kind === 'dim') {
      const dim = f.obj as Dimension;
      const w = dim.wallId ? d.walls.find((x) => x.id === dim.wallId) : undefined;
      a = w?.a ?? dim.a; b = w?.b ?? dim.b;
    }
    if (!a || !b) return null;
    const sa = ctx.toScreen(a), sb = ctx.toScreen(b);
    let x = sb.x - sa.x, y = sb.y - sa.y;
    const len = Math.hypot(x, y) || 1;
    x /= len; y /= len;
    if (Math.abs(x) < 0.3 ? y > 0 : x < 0) { x = -x; y = -y; }
    return { x, y };
  }

  function resizeBegin(): boolean {
    if (stroke) return false;
    if (resize) return true;
    const id = selectedId();
    const d = doc();
    const base = id ? sizeOf(d, id) : null;
    if (!id || !base) return false;
    steps = 0;
    resize = { id, base, sa: 0, sb: 0, doc0: d, axis: base.b === undefined ? travelAxis(d, id) : null };
    host.setLive?.(true);
    changed();
    return true;
  }

  function resizeTo(sa: number, sb: number): void {
    const r = resize;
    if (!r || (sa === r.sa && sb === r.sb)) return;
    const a = r.base.a + sa * RESIZE_STEP_MM;
    const b = r.base.b === undefined ? undefined : r.base.b + sb * RESIZE_STEP_MM;
    // Always from the document as it was when the resize began.
    rollback();
    const envs = resizeEnvs(r.doc0, r.id, r.base, a, b);
    for (const env of envs) live(env);
    r.sa = sa; r.sb = sb;
    // A free dimension is re-created: follow the new one.
    const now = doc();
    if (!findObject(now, r.id) && now.selectedId) readout = `Dimension: ${sizeText(now, now.selectedId)}`;
    else readout = selection()?.readout ?? null;
    if (!envs.length) ctx.render();
    changed();
  }

  function resizeTravel(dxPx: number, dyPx: number): void {
    const r = resize;
    if (!r) return;
    if (r.base.b === undefined) {
      const ax = r.axis ?? { x: 1, y: 0 };
      resizeTo(Math.trunc((dxPx * ax.x + dyPx * ax.y) / RESIZE_STEP_PX), 0);
    } else {
      resizeTo(Math.trunc(dxPx / RESIZE_STEP_PX), Math.trunc(-dyPx / RESIZE_STEP_PX));
    }
  }

  function resizeFinish(apply: boolean): void {
    const r = resize;
    if (!r) return;
    resize = null;
    host.setLive?.(false);
    if (!apply || (!r.sa && !r.sb)) { rollback(); ctx.render(); readout = null; changed(); return; }
    const a = r.base.a + r.sa * RESIZE_STEP_MM;
    const b = r.base.b === undefined ? undefined : r.base.b + r.sb * RESIZE_STEP_MM;
    const label = handLabel(r.doc0, r.id);
    commit(resizeEnvs(r.doc0, r.id, r.base, a, b), `Resized ${label}`);
    const now = doc();
    const id = findObject(now, r.id) ? r.id : now.selectedId;
    if (id) host.onChange?.();
    readout = null;
    changed();
  }

  function step(axis: 'a' | 'b', dir: 1 | -1): boolean {
    if (!resizeBegin()) return false;
    const r = resize!;
    const before = JSON.stringify(sizeOf(doc(), r.id));
    resizeTo(axis === 'a' ? dir : 0, axis === 'b' ? dir : 0);
    const now = doc();
    const id = findObject(now, r.id) ? r.id : now.selectedId;
    const moved = !id || JSON.stringify(sizeOf(now, id)) !== before;
    resizeFinish(moved);
    return moved;
  }

  // ---- banner
  function mode(): HandMode {
    const tool = toolId();
    const sel = selection();
    const busy = !!stroke || !!resize;
    if (note && (busy || Date.now() - note.at > NOTE_MS)) note = null;
    const base = { tool, live: busy, note: note?.text ?? null, readout: readout ?? lingering ?? (tool === 'select' ? sel?.readout ?? null : null) };
    if (tool === 'select') {
      let text = 'Select — point an open palm at a wall, room or door, then hold a thumbs-up';
      if (stroke?.kind === 'move') text = `Moving ${stroke.label} — open your hand to drop it`;
      else if (stroke?.kind === 'pan') text = 'Moving the plan view — open your hand to stop';
      else if (resize) text = `Resizing ${sel?.label ?? ''} — move your peace sign, change shape to finish`;
      else if (sel) {
        const bits = [sel.movable ? 'fist on it: move' : '', sel.axes.length ? 'peace-and-move: resize' : '', sel.rotate ? `left peace: ${sel.rotate.toLowerCase()}` : '', 'right thumbs-down: remove'].filter(Boolean);
        text = `${sel.label} selected — ${bits.join(' · ')}`;
      }
      return { ...base, kind: 'select', text };
    }
    if (DRAW_TOOLS.has(tool)) {
      const noun: Record<string, string> = { wall: 'walls', room: 'a room', dim: 'a dimension', opening: 'an opening', measure: 'a measurement', stairs: 'stairs' };
      const how: Record<string, string> = {
        wall: 'close your fist to start, open your hand to finish',
        room: 'close your fist on one corner, open your hand on the opposite corner',
        dim: 'fist-drag between two points, or fist-tap a wall',
        opening: 'fist-drag along a wall, or fist-tap for a standard opening',
        measure: 'close your fist to start, open your hand to read the length',
        stairs: 'fist-drag the run, or fist-tap for a standard flight',
      };
      const text = stroke ? `Drawing ${noun[tool]} — open your hand to finish` : `Drawing ${noun[tool]} with your hand — ${how[tool]}`;
      return { ...base, kind: 'draw', text };
    }
    const fx = fixtureKindOf(tool);
    const what = fx ? fixtureSpec(fx).label.toLowerCase() : tool === 'text' ? 'label' : tool;
    const snapNote = WALL_HOSTED[tool] ? ' (it snaps to the nearest wall)' : '';
    return { ...base, kind: 'place', text: stroke ? `Placing a ${what} — open your hand to drop it` : `Placing a ${what} — fist-tap where it goes${snapNote}` };
  }

  function focusBox(): { left: number; top: number; right: number; bottom: number } | null {
    const d = doc();
    const id = selectedId();
    const f = id ? findObject(d, id) : null;
    if (!id || !f) return null;
    let pts: Point[] = [];
    if (f.kind === 'wall') pts = [(f.obj as Wall).a, (f.obj as Wall).b];
    else if (f.kind === 'room') pts = roomPolygon(f.obj as Room, d) ?? [];
    else if (f.kind === 'opening') {
      const o = f.obj as Opening;
      const w = d.walls.find((x) => x.id === o.wallId);
      if (w) pts = [pointAlong(w, o.offset), pointAlong(w, o.offset + o.width)];
    } else if (f.kind === 'fixture') pts = fixturePolygon(f.obj as Fixture);
    else if (f.kind === 'text') pts = [{ x: (f.obj as TextLabel).x, y: (f.obj as TextLabel).y }];
    else {
      const dim = f.obj as Dimension;
      const w = dim.wallId ? d.walls.find((x) => x.id === dim.wallId) : undefined;
      pts = w ? [w.a, w.b] : dim.a && dim.b ? [dim.a, dim.b] : [];
    }
    if (!pts.length) return null;
    const s = pts.map((p) => ctx.toScreen(p));
    return { left: Math.min(...s.map((p) => p.x)), top: Math.min(...s.map((p) => p.y)), right: Math.max(...s.map((p) => p.x)), bottom: Math.max(...s.map((p) => p.y)) };
  }

  return {
    focusBox,
    mode, hover, tap, fistStart, fistMove, fistEnd, fistCancel,
    busy: () => !!stroke || !!resize,
    targets, select, selection, remove, rotate, step,
    resizeBegin, resizeTravel, resizeEnd: () => resizeFinish(true), resizeCancel: () => resizeFinish(false),
  };
}
