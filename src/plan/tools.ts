// Plan-mode tools built on the shared core/tools framework: Select (drag,
// endpoint handles, slide hosted openings), Wall (click-click polyline with
// ortho/45° + snapping + live readout), Room (drag rectangle), hosted
// Door/Window/Opening placement with ghost preview, Dimension, Measure
// (two-point + chain with live length/angle), and a Text placeholder.
// Every mutation goes through ctx.apply → controller.applyOp (validated,
// undoable, op-logged). All units mm, Y-up; pointer coords are client px.

import type { Tool, ToolContext, ToolPointer } from '../core/tools';
import type { PaletteItemSpec } from '../core/palette';
import { GRID_MM, snapToGrid, snapToObjects } from './snap';
import { chainClick, emptyChain, normRect, ortho45, type WallChainState } from './drawTools';
import { clampOpeningOffset, nearestWall, projectToWall } from './hosting';
import {
  mmToMetresLabel,
  pointAlong,
  roomPolygon,
  wallLength,
  wallMidpoint,
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

/** Endpoint/midpoint snap first, grid snap otherwise. */
function snapWorld(ctx: ToolContext, world: Point): Point {
  const hit = snapToObjects(world, docOf(ctx).walls, snapRadius(ctx));
  return hit ? hit.point : snapToGrid(world);
}

// ─── Selection helpers (also used by the renderer's global keys) ────────────

type Clip =
  | { type: 'wall'; a: Point; b: Point; thickness: number }
  | { type: 'opening'; kind: Opening['kind']; wallId: string; offset: number; width: number; swing?: 'left' | 'right' }
  | { type: 'room'; x: number; y: number; w: number; h: number }
  | null;

let clipboard: Clip = null;

function selectedObject(ctx: ToolContext): { kind: 'wall' | 'opening' | 'room'; obj: Wall | Opening | Room } | null {
  const d = docOf(ctx);
  const id = ctx.selectedId();
  if (!id) return null;
  const w = d.walls.find((x) => x.id === id);
  if (w) return { kind: 'wall', obj: w };
  const o = d.openings.find((x) => x.id === id);
  if (o) return { kind: 'opening', obj: o };
  const r = d.rooms.find((x) => x.id === id);
  if (r) return { kind: 'room', obj: r };
  return null;
}

export function deleteSelected(ctx: ToolContext): boolean {
  const id = ctx.selectedId();
  if (!id) return false;
  return ctx.apply({ op: 'delete', target: id }).ok;
}

/** X: flip the selected door's swing. */
export function flipSelected(ctx: ToolContext): boolean {
  const sel = selectedObject(ctx);
  if (!sel || sel.kind !== 'opening' || (sel.obj as Opening).kind !== 'door') return false;
  return ctx.apply({ op: 'set_swing', target: sel.obj.id }).ok;
}

function clipFrom(ctx: ToolContext): Clip {
  const sel = selectedObject(ctx);
  if (!sel) return null;
  if (sel.kind === 'wall') {
    const w = sel.obj as Wall;
    return { type: 'wall', a: { ...w.a }, b: { ...w.b }, thickness: w.thickness };
  }
  if (sel.kind === 'opening') {
    const o = sel.obj as Opening;
    return { type: 'opening', kind: o.kind, wallId: o.wallId, offset: o.offset, width: o.width, swing: o.swing };
  }
  const room = sel.obj as Room;
  const poly = roomPolygon(room, docOf(ctx));
  if (!poly) return null;
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { type: 'room', x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function applyClip(ctx: ToolContext, clip: Clip, shift: number): boolean {
  if (!clip) return false;
  if (clip.type === 'wall')
    return ctx.apply({
      op: 'add_wall',
      x1: clip.a.x + shift, y1: clip.a.y - shift,
      x2: clip.b.x + shift, y2: clip.b.y - shift,
      thickness: clip.thickness,
    }).ok;
  if (clip.type === 'opening') {
    const op = clip.kind === 'door' ? 'add_door' : clip.kind === 'window' ? 'add_window' : 'add_opening';
    return ctx.apply({
      op, target: clip.wallId, offset: clip.offset + clip.width + 100, width: clip.width,
      ...(clip.kind === 'door' ? { swing: clip.swing ?? 'left' } : {}),
    }).ok;
  }
  return ctx.apply({ op: 'add_room', x: clip.x + shift, y: clip.y - shift, w: clip.w, h: clip.h }).ok;
}

/** Ctrl+D: duplicate the selection with a small offset. */
export function duplicateSelected(ctx: ToolContext): boolean {
  return applyClip(ctx, clipFrom(ctx), 300);
}

/** Ctrl+C / Ctrl+V. */
export function copySelected(ctx: ToolContext): boolean {
  const c = clipFrom(ctx);
  if (!c) return false;
  clipboard = c;
  return true;
}
export function pasteClipboard(ctx: ToolContext): boolean {
  return applyClip(ctx, clipboard, 500);
}

/** Arrow keys: nudge a wall by (dx, dy) mm, or slide an opening along its wall. */
export function nudgeSelected(ctx: ToolContext, dx: number, dy: number): boolean {
  const sel = selectedObject(ctx);
  if (!sel) return false;
  if (sel.kind === 'wall')
    return ctx.apply({ op: 'move', target: sel.obj.id, dx, dy }).ok;
  if (sel.kind === 'opening') {
    const o = sel.obj as Opening;
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
    | { kind: 'end'; wallId: string; end: 'a' | 'b' }
    | null;
  let drag: Drag = null;
  let overTrash = false;

  function endpointAt(p: ToolPointer): { wallId: string; end: 'a' | 'b' } | null {
    const wall = docOf(ctx).walls.find((w) => w.id === ctx.selectedId());
    if (!wall) return null;
    for (const end of ['a', 'b'] as const) {
      const s = ctx.toScreen(wall[end]);
      if (Math.hypot(s.x - p.x, s.y - p.y) <= 10) return { wallId: wall.id, end };
    }
    return null;
  }

  return {
    id: 'select',
    label: 'Select',
    icon: '⬚',
    shortcut: 'v',
    hint: 'Click/pinch to select; drag to move; drag endpoint handles to stretch; drop on the bin to delete.',
    onDown(p) {
      const handle = endpointAt(p);
      if (handle) {
        drag = { kind: 'end', ...handle };
        return true;
      }
      const id = ctx.pick(p.x, p.y);
      if (!id) return false; // let the host pan
      ctx.select(id);
      const d = docOf(ctx);
      const wall = d.walls.find((w) => w.id === id);
      if (wall) drag = { kind: 'wall', id, grabWorld: ctx.toWorld(p.x, p.y), grabMid: wallMidpoint(wall) };
      else if (d.openings.some((o) => o.id === id)) drag = { kind: 'opening', id };
      ctx.render();
      return true;
    },
    onMove(p) {
      if (!drag) return;
      overTrash = ctx.overTrash(p.x, p.y);
      ctx.setTrashHover(overTrash);
      const world = ctx.toWorld(p.x, p.y);
      const d = docOf(ctx);
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
      const o = d.openings.find((x) => x.id === (drag as { id: string }).id);
      const wall = o && d.walls.find((w) => w.id === o.wallId);
      if (!o || !wall) return;
      const proj = projectToWall(world, wall);
      const offset = clampOpeningOffset(proj.t, o.width, wallLength(wall));
      if (Math.abs(offset - o.offset) >= 1) ctx.apply({ op: 'move_opening', target: o.id, offset });
    },
    onUp() {
      if (drag && drag.kind !== 'end' && overTrash) {
        const id = drag.kind === 'wall' || drag.kind === 'opening' ? drag.id : null;
        if (id) ctx.apply({ op: 'delete', target: id });
      }
      drag = null;
      overTrash = false;
      ctx.setTrashHover(false);
    },
    onCancel() {
      drag = null;
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
  let hover: Point | null = null;

  const snap = (world: Point): Point => snapWorld(ctx, world);

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
      if (last && hover) {
        const a = ctx.toScreen(last);
        const b = ctx.toScreen(hover);
        const len = Math.hypot(hover.x - last.x, hover.y - last.y);
        const ang = Math.round((Math.atan2(hover.y - last.y, hover.x - last.x) * 180) / Math.PI);
        ov.line(a, b, '#16a34a', 2, '6 4');
        ov.label({ x: b.x + 12, y: b.y - 10 }, `${mmToMetresLabel(len)} · ${ang}°${total > 0 ? ` · Σ ${mmToMetresLabel(total + len)}` : ''}`, '#15803d');
      } else if (hover) {
        ov.dot(ctx.toScreen(hover), '#86efac');
      }
    });
  }

  function clear(): void {
    pts = [];
    hover = null;
    ctx.setOverlay(null);
  }

  return {
    id: 'measure',
    label: 'Measure',
    icon: '⟼',
    shortcut: 'shift+m',
    hint: 'Click points to measure (chains; snaps to endpoints/midpoints/grid; shows length + angle). Esc clears. Use Dimension (M) for a permanent dim.',
    onDown(p) {
      pts = [...pts, snap(ctx.toWorld(p.x, p.y))];
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
        clear();
        return true;
      }
      return false;
    },
    onCancel: clear,
    onDeactivate: clear,
  };
}

function createTextTool(ctx: ToolContext): Tool {
  return {
    id: 'text',
    label: 'Text',
    icon: 'T',
    shortcut: 't',
    stub: true,
    hint: 'Text labels are a placeholder — coming in the next update.',
    onActivate() {
      ctx.setStatus('Text tool is a placeholder — coming in the next update.');
    },
    onDown() {
      ctx.setStatus('Text tool is a placeholder — coming in the next update.');
      return true;
    },
  };
}

export function createPlanTools(ctx: ToolContext): Tool[] {
  return [
    createSelectTool(ctx),
    createWallTool(ctx),
    createRoomTool(ctx),
    createHostedTool(ctx, 'door'),
    createHostedTool(ctx, 'window'),
    createHostedTool(ctx, 'opening'),
    createDimTool(ctx),
    createMeasureTool(ctx),
    createTextTool(ctx),
  ];
}

export function paletteItems(tools: Tool[]): PaletteItemSpec[] {
  return tools.map((t) => ({
    toolId: t.id,
    label: t.label,
    icon: t.icon,
    shortcut: t.shortcut,
    placeable: t.placeable,
    stub: t.stub,
  }));
}
