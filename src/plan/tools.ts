// Plan-mode tools built on the shared core/tools framework: Select (drag,
// endpoint handles, slide hosted openings), Wall (click-click polyline with
// ortho/45° + snapping + live readout), Room (drag rectangle), hosted
// Door/Window/Opening placement with ghost preview, Dimension, Measure
// (two-point + chain with live length/angle), and a Text placeholder.
// Every mutation goes through ctx.apply → controller.applyOp (validated,
// undoable, op-logged). All units mm, Y-up; pointer coords are client px.

import type { Tool, ToolContext, ToolPointer } from '../core/tools';
import type { PaletteItemSpec } from '../core/palette';
import { GRID_MM, measureSnap, snapToGrid, snapToObjects, snapValueToGrid, type MeasureSnapKind } from './snap';
import { chainClick, emptyChain, normRect, ortho45, type WallChainState } from './drawTools';
import { clampOpeningOffset, nearestWall, projectToWall } from './hosting';
import { fixtureHandlePoint, fixturePolygon, handleAngle, rectHits, snapAngle, toggleSelection } from './editing';
import { fixtureSpec, snapFixtureToWall, type FixtureSpec } from './fixtures';
import {
  mmToMetresLabel,
  pointAlong,
  roomPolygon,
  wallLength,
  wallMidpoint,
  type Fixture,
  type Opening,
  type PlanDoc,
  type Point,
  type Room,
  type Wall,
} from './doc';
import { DEFAULTS } from './ops';

const docOf = (ctx: ToolContext): PlanDoc => ctx.snapshot() as PlanDoc;

/** Object-snap radius in mm that tracks the zoom (≥ one grid cell, ~14 px). */
const snapRadius = (ctx: ToolContext): number => Math.max(GRID_MM, 14 / ctx.scale());

// ─── Selection helpers (also used by the renderer's global keys) ────────────

type Clip =
  | { type: 'wall'; a: Point; b: Point; thickness: number }
  | { type: 'opening'; kind: Opening['kind']; wallId: string; offset: number; width: number; swing?: 'left' | 'right' }
  | { type: 'room'; x: number; y: number; w: number; h: number }
  | { type: 'fixture'; kind: string; x: number; y: number; w: number; d: number; rotation: number };

let clipboard: Clip[] = [];

/** Current multi-selection (falls back to the single selectedId). */
export function selectionIds(ctx: ToolContext): string[] {
  const d = docOf(ctx);
  if (d.selectedIds?.length) return d.selectedIds;
  return d.selectedId ? [d.selectedId] : [];
}

function setSelection(ctx: ToolContext, ids: string[]): void {
  ctx.apply({ op: 'select_set', ids });
}

/** Apply a list of op envelopes as ONE undoable step (single op stays plain). */
function applyAsOne(ctx: ToolContext, envs: Array<Record<string, unknown>>): boolean {
  if (envs.length === 0) return false;
  if (envs.length === 1) return ctx.apply(envs[0]).ok;
  return ctx.apply({ op: 'batch', ops: envs }).ok;
}

function selectedObject(ctx: ToolContext): { kind: 'wall' | 'opening' | 'room' | 'fixture'; obj: Wall | Opening | Room | Fixture } | null {
  const d = docOf(ctx);
  const id = ctx.selectedId();
  if (!id) return null;
  const w = d.walls.find((x) => x.id === id);
  if (w) return { kind: 'wall', obj: w };
  const o = d.openings.find((x) => x.id === id);
  if (o) return { kind: 'opening', obj: o };
  const r = d.rooms.find((x) => x.id === id);
  if (r) return { kind: 'room', obj: r };
  const f = d.fixtures.find((x) => x.id === id);
  if (f) return { kind: 'fixture', obj: f };
  return null;
}

/** Delete the whole selection as one undoable step. */
export function deleteSelected(ctx: ToolContext): boolean {
  const ids = selectionIds(ctx);
  return applyAsOne(ctx, ids.map((id) => ({ op: 'delete', target: id })));
}

/** X: flip the selected door's swing. */
export function flipSelected(ctx: ToolContext): boolean {
  const sel = selectedObject(ctx);
  if (!sel || sel.kind !== 'opening' || (sel.obj as Opening).kind !== 'door') return false;
  return ctx.apply({ op: 'set_swing', target: sel.obj.id }).ok;
}

/** Ctrl+R: rotate selected fixtures 90° CCW; a selected door flips its swing. */
export function rotateSelected(ctx: ToolContext): boolean {
  const d = docOf(ctx);
  const envs: Array<Record<string, unknown>> = [];
  for (const id of selectionIds(ctx)) {
    if (d.fixtures.some((f) => f.id === id)) envs.push({ op: 'rotate', target: id, angle: 90 });
    else if (d.openings.some((o) => o.id === id && o.kind === 'door')) envs.push({ op: 'rotate', target: id });
  }
  return applyAsOne(ctx, envs);
}

function clipOne(d: PlanDoc, id: string): Clip | null {
  const w = d.walls.find((x) => x.id === id);
  if (w) return { type: 'wall', a: { ...w.a }, b: { ...w.b }, thickness: w.thickness };
  const o = d.openings.find((x) => x.id === id);
  if (o) return { type: 'opening', kind: o.kind, wallId: o.wallId, offset: o.offset, width: o.width, swing: o.swing };
  const f = d.fixtures.find((x) => x.id === id);
  if (f) return { type: 'fixture', kind: f.kind, x: f.x, y: f.y, w: f.w, d: f.d, rotation: f.rotation };
  const room = d.rooms.find((x) => x.id === id);
  if (room) {
    const poly = roomPolygon(room, d);
    if (!poly) return null;
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { type: 'room', x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return null;
}

function clipsFrom(ctx: ToolContext): Clip[] {
  const d = docOf(ctx);
  return selectionIds(ctx).map((id) => clipOne(d, id)).filter((c): c is Clip => !!c);
}

function clipEnvelope(clip: Clip, shift: number): Record<string, unknown> {
  if (clip.type === 'wall')
    return {
      op: 'add_wall',
      x1: clip.a.x + shift, y1: clip.a.y - shift,
      x2: clip.b.x + shift, y2: clip.b.y - shift,
      thickness: clip.thickness,
    };
  if (clip.type === 'opening') {
    const op = clip.kind === 'door' ? 'add_door' : clip.kind === 'window' ? 'add_window' : 'add_opening';
    return {
      op, target: clip.wallId, offset: clip.offset + clip.width + 100, width: clip.width,
      ...(clip.kind === 'door' ? { swing: clip.swing ?? 'left' } : {}),
    };
  }
  if (clip.type === 'fixture')
    return { op: 'add_fixture', kind: clip.kind, x: clip.x + shift, y: clip.y - shift, w: clip.w, d: clip.d, rotation: clip.rotation };
  return { op: 'add_room', x: clip.x + shift, y: clip.y - shift, w: clip.w, h: clip.h };
}

/** Ctrl+D: duplicate the whole selection (one undoable step). */
export function duplicateSelected(ctx: ToolContext): boolean {
  return applyAsOne(ctx, clipsFrom(ctx).map((c) => clipEnvelope(c, 300)));
}

/** Ctrl+C / Ctrl+V — the clipboard holds the whole selection. */
export function copySelected(ctx: ToolContext): boolean {
  const clips = clipsFrom(ctx);
  if (clips.length === 0) return false;
  clipboard = clips;
  return true;
}
export function pasteClipboard(ctx: ToolContext): boolean {
  return applyAsOne(ctx, clipboard.map((c) => clipEnvelope(c, 500)));
}

/** Arrow keys: nudge the selection by (dx, dy) mm as one step; a lone opening
 *  slides along its wall instead. */
export function nudgeSelected(ctx: ToolContext, dx: number, dy: number): boolean {
  const d = docOf(ctx);
  const ids = selectionIds(ctx);
  if (ids.length === 0) return false;
  const movable = ids.filter((id) =>
    d.walls.some((w) => w.id === id) || d.fixtures.some((f) => f.id === id) || d.texts.some((t) => t.id === id));
  if (movable.length > 0)
    return ctx.apply({ op: 'move_many', ids: movable, dx, dy }).ok;
  const o = d.openings.find((x) => x.id === ids[0]);
  if (o) {
    const delta = dx !== 0 ? dx : dy;
    return ctx.apply({ op: 'move_opening', target: o.id, offset: o.offset + delta }).ok;
  }
  return false;
}

// ─── Tools ──────────────────────────────────────────────────────────────────

function createSelectTool(ctx: ToolContext): Tool {
  type Drag =
    | { kind: 'wall'; id: string; grabWorld: Point; grabMid: Point }
    | { kind: 'opening'; id: string }
    | { kind: 'fixture'; id: string; grabWorld: Point; grabPos: Point }
    | { kind: 'end'; wallId: string; end: 'a' | 'b' }
    | { kind: 'multi'; ids: string[]; grabWorld: Point; applied: Point }
    | { kind: 'rotate'; id: string }
    | { kind: 'marquee'; startWorld: Point; additive: boolean }
    | null;
  let drag: Drag = null;
  let overTrash = false;

  function endpointAt(p: ToolPointer): { wallId: string; end: 'a' | 'b' } | null {
    if (selectionIds(ctx).length !== 1) return null;
    const wall = docOf(ctx).walls.find((w) => w.id === ctx.selectedId());
    if (!wall) return null;
    for (const end of ['a', 'b'] as const) {
      const s = ctx.toScreen(wall[end]);
      if (Math.hypot(s.x - p.x, s.y - p.y) <= 10) return { wallId: wall.id, end };
    }
    return null;
  }

  /** Rotate handle of the single selected fixture, hit within 12 px. */
  function rotateHandleAt(p: ToolPointer): string | null {
    if (selectionIds(ctx).length !== 1) return null;
    const f = docOf(ctx).fixtures.find((x) => x.id === ctx.selectedId());
    if (!f) return null;
    const s = ctx.toScreen(fixtureHandlePoint(f, 30 / ctx.scale()));
    return Math.hypot(s.x - p.x, s.y - p.y) <= 12 ? f.id : null;
  }

  function marqueeOverlay(start: Point, cur: Point): void {
    ctx.setOverlay((ov) => {
      ov.rect(ctx.toScreen(start), ctx.toScreen(cur), '#2563eb', 'rgba(37,99,235,0.06)');
      const r = normRect(start, cur);
      ov.label(ctx.toScreen({ x: r.x + r.w / 2, y: r.y + r.h }), `${mmToMetresLabel(r.w)} × ${mmToMetresLabel(r.h)}`, '#2563eb');
    });
  }

  return {
    id: 'select',
    label: 'Select',
    icon: '⬚',
    shortcut: 'v',
    hint: 'Click to select (Shift toggles, drag empty canvas for a marquee); drag to move; Ctrl+R rotates; drop on the bin to delete.',
    onDown(p) {
      const handle = endpointAt(p);
      if (handle) {
        drag = { kind: 'end', ...handle };
        return true;
      }
      const rotId = rotateHandleAt(p);
      if (rotId) {
        drag = { kind: 'rotate', id: rotId };
        return true;
      }
      const world = ctx.toWorld(p.x, p.y);
      const id = ctx.pick(p.x, p.y);
      if (!id) {
        drag = { kind: 'marquee', startWorld: world, additive: !!p.shift };
        return true;
      }
      const sel = selectionIds(ctx);
      if (p.shift) {
        setSelection(ctx, toggleSelection(sel, id));
        return true;
      }
      const keepGroup = sel.includes(id) && sel.length > 1;
      if (!keepGroup) setSelection(ctx, [id]);
      const d = docOf(ctx);
      if (keepGroup) {
        const ids = sel.filter((x) => d.walls.some((w) => w.id === x) || d.fixtures.some((f) => f.id === x));
        drag = { kind: 'multi', ids, grabWorld: world, applied: { x: 0, y: 0 } };
      } else {
        const wall = d.walls.find((w) => w.id === id);
        const fixture = d.fixtures.find((f) => f.id === id);
        if (wall) drag = { kind: 'wall', id, grabWorld: world, grabMid: wallMidpoint(wall) };
        else if (fixture) drag = { kind: 'fixture', id, grabWorld: world, grabPos: { x: fixture.x, y: fixture.y } };
        else if (d.openings.some((o) => o.id === id)) drag = { kind: 'opening', id };
      }
      ctx.render();
      return true;
    },
    onMove(p) {
      if (!drag) return;
      const world = ctx.toWorld(p.x, p.y);
      const d = docOf(ctx);
      if (drag.kind === 'marquee') {
        marqueeOverlay(drag.startWorld, world);
        return;
      }
      if (drag.kind === 'rotate') {
        const f = d.fixtures.find((x) => x.id === (drag as { id: string }).id);
        if (!f) return;
        const desired = snapAngle(handleAngle({ x: f.x, y: f.y }, world), 15);
        let delta = desired - f.rotation;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        if (Math.abs(delta) >= 1) ctx.apply({ op: 'rotate', target: f.id, angle: delta });
        ctx.setStatus(`Rotation ${Math.round(desired)}° (snaps to 15°)`);
        return;
      }
      overTrash = ctx.overTrash(p.x, p.y);
      ctx.setTrashHover(overTrash);
      if (drag.kind === 'multi') {
        const desired = {
          x: snapValueToGrid(world.x - drag.grabWorld.x),
          y: snapValueToGrid(world.y - drag.grabWorld.y),
        };
        const dx = desired.x - drag.applied.x;
        const dy = desired.y - drag.applied.y;
        if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
          if (ctx.apply({ op: 'move_many', ids: drag.ids, dx, dy }).ok) drag.applied = desired;
        }
        return;
      }
      if (drag.kind === 'end') {
        const wall = d.walls.find((w) => w.id === (drag as { wallId: string }).wallId);
        if (!wall) return;
        const hit = snapToObjects(world, d.walls, snapRadius(ctx), wall.id);
        const pt = hit ? hit.point : snapToGrid(world);
        ctx.apply({ op: 'move_end', target: wall.id, end: drag.end, x: pt.x, y: pt.y });
        return;
      }
      if (drag.kind === 'wall') {
        const cur = d.walls.find((w) => w.id === (drag as { id: string }).id);
        if (!cur) return;
        const target = {
          x: drag.grabMid.x + (world.x - drag.grabWorld.x),
          y: drag.grabMid.y + (world.y - drag.grabWorld.y),
        };
        const hit = snapToObjects(target, d.walls.filter((w) => w.id !== cur.id), snapRadius(ctx));
        const snapped = hit ? hit.point : snapToGrid(target);
        const mid = wallMidpoint(cur);
        const dx = snapped.x - mid.x;
        const dy = snapped.y - mid.y;
        if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) ctx.apply({ op: 'move', target: cur.id, dx, dy });
        return;
      }
      if (drag.kind === 'fixture') {
        const f = d.fixtures.find((x) => x.id === (drag as { id: string }).id);
        if (!f) return;
        const target = snapToGrid({
          x: drag.grabPos.x + (world.x - drag.grabWorld.x),
          y: drag.grabPos.y + (world.y - drag.grabWorld.y),
        });
        const dx = target.x - f.x;
        const dy = target.y - f.y;
        if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) ctx.apply({ op: 'move', target: f.id, dx, dy });
        return;
      }
      const o = d.openings.find((x) => x.id === (drag as { id: string }).id);
      const wall = o && d.walls.find((w) => w.id === o.wallId);
      if (!o || !wall) return;
      const proj = projectToWall(world, wall);
      const offset = clampOpeningOffset(proj.t, o.width, wallLength(wall));
      if (Math.abs(offset - o.offset) >= 1) ctx.apply({ op: 'move_opening', target: o.id, offset });
    },
    onUp(p) {
      if (drag?.kind === 'marquee') {
        const world = p ? ctx.toWorld(p.x, p.y) : drag.startWorld;
        const r = normRect(drag.startWorld, world);
        const hits = rectHits(docOf(ctx), r);
        const ids = drag.additive ? [...new Set([...selectionIds(ctx), ...hits])] : hits;
        ctx.setOverlay(null);
        setSelection(ctx, ids);
      } else if (drag && drag.kind !== 'end' && drag.kind !== 'rotate' && overTrash) {
        deleteSelected(ctx);
      }
      drag = null;
      overTrash = false;
      ctx.setTrashHover(false);
    },
    onCancel() {
      drag = null;
      ctx.setOverlay(null);
      ctx.setTrashHover(false);
    },
  };
}

function createWallTool(ctx: ToolContext): Tool {
  let chain: WallChainState = emptyChain();
  let hover: Point | null = null;

  function nextPoint(world: Point): Point {
    const d = docOf(ctx);
    const obj = snapToObjects(world, d.walls, snapRadius(ctx));
    if (obj) return obj.point;
    const last = chain.pts[chain.pts.length - 1];
    return snapToGrid(last ? ortho45(last, world) : world);
  }

  function updateOverlay(): void {
    if (chain.pts.length === 0 && !hover) {
      ctx.setOverlay(null);
      return;
    }
    ctx.setOverlay((ov) => {
      for (const pt of chain.pts) ov.dot(ctx.toScreen(pt), '#2563eb');
      const last = chain.pts[chain.pts.length - 1];
      if (last && hover) {
        const a = ctx.toScreen(last);
        const b = ctx.toScreen(hover);
        ov.line(a, b, '#2563eb', 3);
        const len = Math.hypot(hover.x - last.x, hover.y - last.y);
        const ang = Math.round((Math.atan2(hover.y - last.y, hover.x - last.x) * 180) / Math.PI);
        ov.label({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 10 }, `${mmToMetresLabel(len)} · ${ang}°`, '#1d4ed8');
      } else if (hover) {
        ov.dot(ctx.toScreen(hover), '#93c5fd');
      }
    });
  }

  function finish(): void {
    chain = emptyChain();
    hover = null;
    ctx.setOverlay(null);
    ctx.setStatus('Wall chain finished.');
  }

  return {
    id: 'wall',
    label: 'Wall',
    icon: '─',
    shortcut: 'w',
    hint: 'Click to place wall points (ortho/45° + snap). Click the last point again, double-click, Enter or Esc to finish.',
    onDown(p) {
      const pt = nextPoint(ctx.toWorld(p.x, p.y));
      const res = chainClick(chain, pt, 150);
      chain = res.state;
      if (res.wall)
        ctx.apply({
          op: 'add_wall',
          x1: res.wall.a.x, y1: res.wall.a.y, x2: res.wall.b.x, y2: res.wall.b.y,
          thickness: DEFAULTS.thickness,
        });
      if (res.finished) finish();
      else updateOverlay();
      return true;
    },
    onHover(p) {
      hover = nextPoint(ctx.toWorld(p.x, p.y));
      updateOverlay();
    },
    onMove(p) {
      this.onHover?.(p);
    },
    onKey(e) {
      if (e.key === 'Enter') {
        finish();
        return true;
      }
      return false;
    },
    onCancel: finish,
    onDeactivate: finish,
  };
}

function createRoomTool(ctx: ToolContext): Tool {
  let start: Point | null = null;
  return {
    id: 'room',
    label: 'Room',
    icon: '▭',
    shortcut: 'r',
    hint: 'Drag a rectangle to create a room (4 walls, auto-named, shared edges reused).',
    onDown(p) {
      start = snapToGrid(ctx.toWorld(p.x, p.y));
      return true;
    },
    onMove(p) {
      if (!start) return;
      const cur = snapToGrid(ctx.toWorld(p.x, p.y));
      const r = normRect(start, cur);
      ctx.setOverlay((ov) => {
        ov.rect(ctx.toScreen({ x: r.x, y: r.y }), ctx.toScreen({ x: r.x + r.w, y: r.y + r.h }), '#2563eb', 'rgba(37,99,235,0.08)');
        const c = ctx.toScreen({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
        ov.label(c, `${mmToMetresLabel(r.w)} × ${mmToMetresLabel(r.h)}`, '#1d4ed8');
      });
    },
    onUp(p) {
      if (!start) return;
      const cur = snapToGrid(ctx.toWorld(p.x, p.y));
      const r = normRect(start, cur);
      start = null;
      ctx.setOverlay(null);
      if (r.w >= 300 && r.h >= 300) ctx.apply({ op: 'add_room', x: r.x, y: r.y, w: r.w, h: r.h });
      else ctx.setStatus('Room too small — drag a larger rectangle.');
    },
    onCancel() {
      start = null;
      ctx.setOverlay(null);
    },
  };
}

function createHostedTool(ctx: ToolContext, kind: 'door' | 'window' | 'opening'): Tool {
  const width = kind === 'window' ? DEFAULTS.windowWidth : DEFAULTS.doorWidth;
  const label = kind === 'door' ? 'Door' : kind === 'window' ? 'Window' : 'Opening';
  const color = kind === 'door' ? '#2563eb' : kind === 'window' ? '#0ea5e9' : '#f59e0b';
  let ghost: { wall: Wall; offset: number } | null = null;

  function track(p: ToolPointer): void {
    const world = ctx.toWorld(p.x, p.y);
    const d = docOf(ctx);
    const hit = nearestWall(world, d.walls, Math.max(600, 30 / ctx.scale()));
    if (!hit) {
      ghost = null;
      ctx.setOverlay((ov) => ov.label({ x: p.x + 14, y: p.y - 10 }, `${label}: hover a wall`, '#94a3b8'));
      return;
    }
    const offset = clampOpeningOffset(hit.t, width, wallLength(hit.wall));
    ghost = { wall: hit.wall, offset };
    ctx.setOverlay((ov) => {
      const a = ctx.toScreen(pointAlong(ghost!.wall, ghost!.offset));
      const b = ctx.toScreen(pointAlong(ghost!.wall, ghost!.offset + width));
      ov.line(a, b, color, Math.max(6, ghost!.wall.thickness * ctx.scale() + 2));
      ov.label({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 12 }, `${label} ${mmToMetresLabel(width)} @ ${mmToMetresLabel(ghost!.offset)}`, color);
    });
  }

  function place(p: ToolPointer): void {
    track(p);
    if (ctx.overTrash(p.x, p.y)) {
      ctx.setOverlay(null);
      return; // released over the bin: cancel placement
    }
    if (!ghost) {
      ctx.setStatus(`Move the cursor over a wall to place a ${label.toLowerCase()}.`);
      return;
    }
    const op = kind === 'door' ? 'add_door' : kind === 'window' ? 'add_window' : 'add_opening';
    ctx.apply({
      op, target: ghost.wall.id, offset: ghost.offset, width,
      ...(kind === 'door' ? { swing: 'left' } : {}),
    });
    ctx.setStatus(kind === 'door' ? 'Door placed — press X to flip its swing.' : `${label} placed.`);
  }

  return {
    id: kind,
    label,
    icon: kind === 'door' ? '◧' : kind === 'window' ? '◫' : '▯',
    shortcut: kind === 'door' ? 'd' : kind === 'window' ? 'n' : 'o',
    placeable: true,
    hint: `Hover a wall to preview, click (or drag from the palette) to place a ${label.toLowerCase()}. It slides and clamps along the wall.`,
    onHover: track,
    onMove: track,
    onDown(p) {
      place(p);
      return true;
    },
    onPlace: place,
    onCancel() {
      ghost = null;
      ctx.setOverlay(null);
    },
    onDeactivate() {
      ghost = null;
      ctx.setOverlay(null);
    },
  };
}

function createDimTool(ctx: ToolContext): Tool {
  return {
    id: 'dim',
    label: 'Dimension',
    icon: '⟷',
    shortcut: 'm',
    hint: 'Click a wall to add a permanent aligned dimension.',
    onDown(p) {
      const hit = nearestWall(ctx.toWorld(p.x, p.y), docOf(ctx).walls, Math.max(600, 30 / ctx.scale()));
      if (hit) ctx.apply({ op: 'add_dim', target: hit.wall.id });
      else ctx.setStatus('Click closer to a wall to dimension it.');
      return true;
    },
  };
}

function createMeasureTool(ctx: ToolContext): Tool {
  let pts: Point[] = [];
  let hover: { point: Point; kind: MeasureSnapKind } | null = null;

  const snap = (world: Point): { point: Point; kind: MeasureSnapKind } =>
    measureSnap(world, docOf(ctx).walls, snapRadius(ctx));

  const SNAP_COLORS: Record<MeasureSnapKind, string> = {
    endpoint: '#16a34a', midpoint: '#0ea5e9', face: '#f59e0b', grid: '#86efac',
  };

  function updateOverlay(): void {
    if (pts.length === 0 && !hover) {
      ctx.setOverlay(null);
      return;
    }
    ctx.setOverlay((ov) => {
      let total = 0;
      for (let i = 0; i < pts.length; i++) {
        ov.dot(ctx.toScreen(pts[i]), '#16a34a');
        if (i > 0) {
          const a = ctx.toScreen(pts[i - 1]);
          const b = ctx.toScreen(pts[i]);
          const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
          total += len;
          ov.line(a, b, '#16a34a', 2);
          ov.label({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 8 }, mmToMetresLabel(len), '#15803d');
        }
      }
      const last = pts[pts.length - 1];
      if (hover) {
        // Visible snap marker: colour by what it snapped to; non-grid snaps get
        // a ring + name so wall-face snaps are unmistakable.
        const hs = ctx.toScreen(hover.point);
        ov.dot(hs, SNAP_COLORS[hover.kind], hover.kind === 'grid' ? 3 : 5);
        if (hover.kind !== 'grid') ov.label({ x: hs.x + 12, y: hs.y + 12 }, hover.kind, SNAP_COLORS[hover.kind]);
        if (last) {
          const a = ctx.toScreen(last);
          const len = Math.hypot(hover.point.x - last.x, hover.point.y - last.y);
          const ang = Math.round((Math.atan2(hover.point.y - last.y, hover.point.x - last.x) * 180) / Math.PI);
          ov.line(a, hs, '#16a34a', 2, '6 4');
          ov.label({ x: hs.x + 12, y: hs.y - 10 }, `${mmToMetresLabel(len)} · ${ang}°${total > 0 ? ` · Σ ${mmToMetresLabel(total + len)}` : ''}`, '#15803d');
        }
      }
      if (pts.length >= 2) {
        const end = ctx.toScreen(pts[pts.length - 1]);
        ov.label({ x: end.x, y: end.y + 20 }, '⏎ Make dimension', '#2563eb');
      }
    });
  }

  function clear(): void {
    pts = [];
    hover = null;
    ctx.setOverlay(null);
  }

  /** Enter: turn the measured chain into permanent aligned dimensions. */
  function makeDimension(): void {
    const envs: Array<Record<string, unknown>> = [];
    for (let i = 1; i < pts.length; i++) {
      envs.push({ op: 'add_dim', ax: pts[i - 1].x, ay: pts[i - 1].y, bx: pts[i].x, by: pts[i].y });
    }
    if (applyAsOne(ctx, envs)) ctx.setStatus(`${envs.length} permanent dimension${envs.length > 1 ? 's' : ''} added.`);
    clear();
  }

  return {
    id: 'measure',
    label: 'Measure',
    icon: '⟼',
    shortcut: 'shift+m',
    hint: 'Click points to measure (snaps to endpoints, midpoints and BOTH wall faces, with a marker). Enter turns the chain into a permanent dimension; Esc clears.',
    onDown(p) {
      const s = snap(ctx.toWorld(p.x, p.y));
      pts = [...pts, s.point];
      updateOverlay();
      return true;
    },
    onHover(p) {
      hover = snap(ctx.toWorld(p.x, p.y));
      updateOverlay();
    },
    onMove(p) {
      this.onHover?.(p);
    },
    onKey(e) {
      if (e.key === 'Enter') {
        if (pts.length >= 2) makeDimension();
        else clear();
        return true;
      }
      return false;
    },
    onCancel: clear,
    onDeactivate: clear,
  };
}

function createTextTool(ctx: ToolContext): Tool {
  function place(p: ToolPointer): void {
    const world = snapToGrid(ctx.toWorld(p.x, p.y));
    ctx.editText?.(p.x, p.y, '', (text) => {
      if (text.trim()) ctx.apply({ op: 'add_text', nums: { x: world.x, y: world.y }, text: text.trim() });
    });
  }
  return {
    id: 'text',
    label: 'Text',
    icon: 'T',
    shortcut: 't',
    placeable: true,
    hint: 'Click to place a text label, then type. Double-click a label to edit it; set the font size in the properties panel.',
    onDown(p) {
      place(p);
      return true;
    },
    onPlace: place,
  };
}

/** Tool id for placing a component of a given kind. */
export const fixtureToolId = (kind: string): string => `fx:${kind}`;

/** The component kind a fixture tool id refers to (null for non-fixture tools). */
export function fixtureKindOf(toolId: string): string | null {
  return toolId.startsWith('fx:') ? toolId.slice(3) : null;
}

/** Generic click/drag-to-place tool for a catalogue component (columns,
 *  furniture, sanitary). Shows a ghost footprint; wall-hugging items back
 *  against a nearby wall, everything else grid-snaps. */
function createFixtureTool(ctx: ToolContext, spec: FixtureSpec): Tool {
  /** Resolve the placement (centre + rotation) under the cursor. */
  function resolve(p: ToolPointer): { x: number; y: number; w: number; d: number; rotation: number } {
    const world = ctx.toWorld(p.x, p.y);
    const base = { x: world.x, y: world.y, w: spec.w, d: spec.d };
    if (spec.snapsToWall) {
      const snapped = snapFixtureToWall(base, docOf(ctx).walls, Math.max(1500, 60 / ctx.scale()));
      if (snapped) return { ...base, ...snapped };
    }
    const g = snapToGrid(world);
    return { ...base, x: g.x, y: g.y, rotation: 0 };
  }

  function ghost(p: ToolPointer): void {
    const f = resolve(p);
    ctx.setOverlay((ov) => {
      const pts = fixturePolygon({ id: '', kind: spec.kind, ...f }).map((q) => ctx.toScreen(q));
      for (let i = 0; i < pts.length; i++) ov.line(pts[i], pts[(i + 1) % pts.length], '#b45309', 1.5);
      ov.label(ctx.toScreen({ x: f.x, y: f.y }), spec.label, '#92400e');
    });
  }

  function place(p: ToolPointer): void {
    if (ctx.overTrash(p.x, p.y)) {
      ctx.setOverlay(null);
      return;
    }
    const f = resolve(p);
    ctx.apply({ op: 'add_fixture', kind: spec.kind, nums: { x: f.x, y: f.y, w: f.w, d: f.d, rotation: f.rotation } });
    ctx.setStatus(`${spec.label} placed — Ctrl+R rotates, drag to move.`);
  }

  return {
    id: fixtureToolId(spec.kind),
    label: spec.label,
    icon: spec.icon,
    shortcut: '',
    placeable: true,
    hint: `Hover to preview, click (or drag from the palette) to place a ${spec.label.toLowerCase()}.${spec.snapsToWall ? ' Backs against a nearby wall.' : ''}`,
    onHover: ghost,
    onMove: ghost,
    onDown(p) {
      place(p);
      return true;
    },
    onPlace: place,
    onCancel: () => ctx.setOverlay(null),
    onDeactivate: () => ctx.setOverlay(null),
  };
}

/** Stairs: drag a straight run to set its length + direction (click places a
 *  default run). Stored as a `stairs` fixture (w = run length, d = width). */
function createStairsTool(ctx: ToolContext): Tool {
  const spec = fixtureSpec('stairs');
  let start: Point | null = null;

  function commit(run: { a: Point; b: Point }): void {
    const len = Math.hypot(run.b.x - run.a.x, run.b.y - run.a.y);
    if (len < 500) {
      ctx.setStatus('Run too short — drag further to set the stair length.');
      return;
    }
    const angle = (Math.atan2(run.b.y - run.a.y, run.b.x - run.a.x) * 180) / Math.PI;
    const centre = { x: (run.a.x + run.b.x) / 2, y: (run.a.y + run.b.y) / 2 };
    ctx.apply({ op: 'add_fixture', kind: 'stairs', nums: { x: centre.x, y: centre.y, w: len, d: spec.d, rotation: angle } });
    ctx.setStatus(`Stairs ${mmToMetresLabel(len)} placed.`);
  }

  function overlay(a: Point, b: Point): void {
    ctx.setOverlay((ov) => {
      const sa = ctx.toScreen(a);
      const sb = ctx.toScreen(b);
      ov.line(sa, sb, '#64748b', 2);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      ov.label({ x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 - 10 }, `Stairs ${mmToMetresLabel(len)}`, '#475569');
    });
  }

  return {
    id: 'stairs',
    label: 'Stairs',
    icon: spec.icon,
    shortcut: 's',
    placeable: true,
    hint: 'Drag a straight run to set the stair length and direction (step lines + arrow). Click once to drop a default run.',
    onDown(p) {
      start = snapToGrid(ctx.toWorld(p.x, p.y));
      return true;
    },
    onMove(p) {
      if (!start) return;
      overlay(start, snapToGrid(ortho45(start, ctx.toWorld(p.x, p.y))));
    },
    onUp(p) {
      if (!start) return;
      const end = snapToGrid(ortho45(start, ctx.toWorld(p.x, p.y)));
      ctx.setOverlay(null);
      if (Math.hypot(end.x - start.x, end.y - start.y) < 500) {
        // A plain click: drop a default-length run pointing east.
        commit({ a: start, b: { x: start.x + spec.w, y: start.y } });
      } else {
        commit({ a: start, b: end });
      }
      start = null;
    },
    onPlace(p) {
      const g = snapToGrid(ctx.toWorld(p.x, p.y));
      commit({ a: { x: g.x - spec.w / 2, y: g.y }, b: { x: g.x + spec.w / 2, y: g.y } });
      ctx.setOverlay(null);
    },
    onCancel() {
      start = null;
      ctx.setOverlay(null);
    },
  };
}

/** Component kinds shown in the compact "Furniture" palette flyout. */
export const FURNITURE_FLYOUT: string[] = [
  'column-round', 'bed-single', 'bed-double', 'sofa', 'dining-table', 'chair',
  'desk', 'kitchen-counter', 'wardrobe', 'toilet', 'sink', 'bathtub', 'shower',
];

export function createPlanTools(ctx: ToolContext): Tool[] {
  const fixtureTools = ['column-square', ...FURNITURE_FLYOUT].map((k) => createFixtureTool(ctx, fixtureSpec(k)));
  return [
    createSelectTool(ctx),
    createWallTool(ctx),
    createRoomTool(ctx),
    createHostedTool(ctx, 'door'),
    createHostedTool(ctx, 'window'),
    createHostedTool(ctx, 'opening'),
    createDimTool(ctx),
    createMeasureTool(ctx),
    createStairsTool(ctx),
    createTextTool(ctx),
    ...fixtureTools,
  ];
}

const toSpec = (t: Tool): PaletteItemSpec => ({
  toolId: t.id, label: t.label, icon: t.icon, shortcut: t.shortcut, placeable: t.placeable, stub: t.stub,
});

/** Palette layout: the main dock, with every furniture/sanitary component tucked
 *  into one compact "Furniture" flyout so the dock stays short. */
export function paletteItems(tools: Tool[]): PaletteItemSpec[] {
  const byId = (id: string) => tools.find((t) => t.id === id);
  const flyoutIds = new Set(FURNITURE_FLYOUT.map(fixtureToolId));
  const dock: PaletteItemSpec[] = [];
  for (const t of tools) {
    if (flyoutIds.has(t.id)) continue;
    // Give the square-column tool the plain "Column" label on the dock.
    dock.push(t.id === fixtureToolId('column-square') ? { ...toSpec(t), label: 'Column' } : toSpec(t));
  }
  const group = FURNITURE_FLYOUT.map((k) => byId(fixtureToolId(k))).filter((t): t is Tool => !!t).map(toSpec);
  dock.push({ toolId: 'furniture-group', label: 'Furniture', icon: '🛋', shortcut: '', group });
  return dock;
}
