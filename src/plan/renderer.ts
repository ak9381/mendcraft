// SVG 2D plan renderer: grid, walls (with thickness), door swing arcs, window
// symbols, live dimension labels in metres, room names + areas, selection
// highlight, hit-testing (click / pinch-tap), drag-to-move with snap, and
// wheel/keyboard pan+zoom. An optional three.js overlay extrudes the walls to
// 3D as a *view* (not a second editor). Implements the generic ViewportHandle.

import type { ModeController, ViewportHandle } from '../core/controller';
import { createToolController, type OverlayDraw, type ToolContext } from '../core/tools';
import { createFullscreenControl, createPalette, createTrash } from '../core/palette';
import {
  copySelected,
  createPlanTools,
  deleteSelected,
  duplicateSelected,
  flipSelected,
  nudgeSelected,
  paletteItems,
  pasteClipboard,
} from './tools';
import { createPropsPanel } from './propsPanel';
import {
  pointAlong,
  roomCentroid,
  roomArea,
  wallLength,
  wallMidpoint,
  wallNormal,
  planBounds,
  mmToMetresLabel,
  mm2ToM2Label,
  type PlanDoc,
  type Point,
  type Wall,
} from './doc';
import { GRID_MM } from './snap';

const SVG = 'http://www.w3.org/2000/svg';
const WALL_HEIGHT_MM = 2500;

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Shortest distance from point p to segment a-b (mm). */
function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function createPlanRenderer(
  container: HTMLElement,
  controller: ModeController,
  onSelect: (id: string | null) => void,
): ViewportHandle {
  const svg = el('svg', { width: '100%', height: '100%', class: 'plan-svg', 'aria-hidden': 'true' });
  svg.style.display = 'block';
  svg.style.touchAction = 'none';
  container.appendChild(svg);

  // View transform: screen = (origin + world * [scale, -scale]). px per mm.
  let scale = 0.08;
  let originX = 0;
  let originY = 0;
  let fitted = false;
  // Bounds signature captured at the last fit, so a geometry edit that changes
  // the overall size re-fits automatically (see render()).
  let fitSig: string | null = null;

  const doc = (): PlanDoc => controller.snapshot() as PlanDoc;
  const toScreen = (p: Point) => ({ x: originX + p.x * scale, y: originY - p.y * scale });
  function toWorld(clientX: number, clientY: number): Point {
    const rect = svg.getBoundingClientRect();
    return { x: (clientX - rect.left - originX) / scale, y: -(clientY - rect.top - originY) / scale };
  }

  /** Signature of the current plan bounds (rounded), for change detection. */
  function boundsSig(): string {
    const b = planBounds(doc());
    if (!b) return 'none';
    const r = (n: number) => Math.round(n / 10);
    return `${r(b.min.x)},${r(b.min.y)},${r(b.max.x)},${r(b.max.y)}`;
  }

  function fitView(): void {
    fitSig = boundsSig();
    const b = planBounds(doc());
    const rect = svg.getBoundingClientRect();
    const W = rect.width || 800;
    const H = rect.height || 600;
    if (!b) {
      scale = 0.08;
      originX = W / 2;
      originY = H / 2;
      return;
    }
    // Fit the plan PLUS the drawn annotations: the overall outer dimensions sit
    // OUT (900 mm) beyond the min.x / min.y edges with a label beyond that, so
    // reserve that band (+label headroom) on those two sides and a little
    // breathing room on the others — otherwise the bottom "8.00 m" dimension and
    // its label clip at the viewport edge after zoom-to-fit.
    const pad = 700; // breathing room (mm)
    const band = 900; // outer-dimension offset (matches OUT in render())
    const label = 650; // headroom for the dimension text at fit scale (mm)
    const minX = b.min.x - band - label;
    const minY = b.min.y - band - label;
    const maxX = b.max.x + pad;
    const maxY = b.max.y + pad;
    const w = maxX - minX;
    const h = maxY - minY;
    scale = Math.min(W / w, H / h, 0.3);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    originX = W / 2 - cx * scale;
    originY = H / 2 + cy * scale;
  }

  // ---- hit-testing ----
  function pick(clientX: number, clientY: number): string | null {
    const p = toWorld(clientX, clientY);
    const d = doc();
    let best: { id: string; dist: number } | null = null;
    for (const w of d.walls) {
      const dist = distToSegment(p, w.a, w.b);
      const slack = Math.max(w.thickness / 2, 120) + 6 / scale;
      if (dist <= slack && (!best || dist < best.dist)) best = { id: w.id, dist };
    }
    if (best) return best.id;
    for (const room of d.rooms) {
      const poly = room.wallIds
        .map((id) => d.walls.find((x) => x.id === id))
        .filter((x): x is Wall => !!x);
      const pts: Point[] = [];
      for (const w of poly) {
        pts.push(w.a, w.b);
      }
      if (pts.length >= 6 && pointInPolygon(p, dedupeLoop(room.wallIds, d))) return room.id;
    }
    return null;
  }

  function dedupeLoop(wallIds: string[], d: PlanDoc): Point[] {
    // Rough polygon for hit-testing: unique endpoints in loop order.
    const pts: Point[] = [];
    const push = (p: Point) => {
      if (!pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1)) pts.push(p);
    };
    for (const id of wallIds) {
      const w = d.walls.find((x) => x.id === id);
      if (w) {
        push(w.a);
        push(w.b);
      }
    }
    return pts;
  }

  // ---- shared tool framework (palette, trash, fullscreen, props) ----
  // All mutations route through ctx.apply → controller.applyOp (validated,
  // undoable). Mouse events and pinch-derived ViewportHandle calls converge on
  // the same ToolController, so every tool works hands-free.
  let overlayDraw: ((ov: OverlayDraw) => void) | null = null;

  const status = document.createElement('div');
  status.className = 'mc-status';
  status.setAttribute('role', 'status');
  container.appendChild(status);

  const trash = createTrash(container);

  const ctx: ToolContext = {
    apply(op) {
      const r = controller.applyOp(op);
      if (r.ok) {
        onSelect(controller.selectedId());
        render();
      } else if (r.error) {
        status.textContent = r.error;
      }
      return r;
    },
    toWorld: (x, y) => toWorld(x, y),
    toScreen(p) {
      const rect = svg.getBoundingClientRect();
      const s = toScreen(p);
      return { x: s.x + rect.left, y: s.y + rect.top };
    },
    scale: () => scale,
    pick,
    select(id) {
      if (id) {
        controller.selectId(id);
        onSelect(id);
      }
    },
    selectedId: () => controller.selectedId(),
    snapshot: () => doc(),
    render: () => render(),
    setOverlay(draw) {
      overlayDraw = draw;
      render();
    },
    setStatus(text) {
      status.textContent = text;
    },
    overTrash: (x, y) => trash.isOver(x, y),
    setTrashHover: (on) => trash.setHover(on),
  };

  const tools = createPlanTools(ctx);
  const toolCtl = createToolController(tools, {
    defaultId: 'select',
    onToolChange(id) {
      palette.setActive(id);
      status.textContent = tools.find((t) => t.id === id)?.hint ?? '';
    },
  });
  const palette = createPalette(container, paletteItems(tools), {
    onArm: (id) => toolCtl.activate(id),
    onPlaceStart: (id, x, y) => toolCtl.beginPlace(id, { x, y, source: 'mouse' }),
  });
  const fsCtl = createFullscreenControl(container, container, (hint) => {
    status.textContent = hint;
  });
  const propsPanel = createPropsPanel(container, {
    apply: (op) => ctx.apply(op),
    snapshot: () => doc(),
    selectedId: () => controller.selectedId(),
  });
  palette.setActive('select');
  status.textContent = tools[0].hint ?? '';

  /** Overlay helpers for the active tool (client px → svg-local px). */
  function makeOverlay(g: SVGGElement): OverlayDraw {
    const rect = svg.getBoundingClientRect();
    const lx = (v: number) => v - rect.left;
    const ly = (v: number) => v - rect.top;
    return {
      line(a, b, color = '#2563eb', width = 2, dash) {
        const ln = el('line', { x1: lx(a.x), y1: ly(a.y), x2: lx(b.x), y2: ly(b.y), stroke: color, 'stroke-width': width, 'stroke-linecap': 'round' });
        if (dash) ln.setAttribute('stroke-dasharray', dash);
        g.appendChild(ln);
      },
      dot(p, color = '#2563eb', r = 4) {
        g.appendChild(el('circle', { cx: lx(p.x), cy: ly(p.y), r, fill: color, stroke: '#ffffff', 'stroke-width': 1.5 }));
      },
      label(p, text, color = '#1f2937') {
        const t = textNode(lx(p.x), ly(p.y), text, 12, color, 'middle');
        t.setAttribute('paint-order', 'stroke');
        t.setAttribute('stroke', '#ffffff');
        t.setAttribute('stroke-width', '3');
        g.appendChild(t);
      },
      rect(a, b, stroke = '#2563eb', fill = 'none') {
        g.appendChild(el('rect', {
          x: Math.min(lx(a.x), lx(b.x)),
          y: Math.min(ly(a.y), ly(b.y)),
          width: Math.abs(a.x - b.x),
          height: Math.abs(a.y - b.y),
          stroke, fill, 'stroke-width': 1.5, 'stroke-dasharray': '6 4',
        }));
      },
    };
  }

  // ---- rendering ----
  function render(): void {
    if (!fitted) {
      fitView();
      fitted = true;
    } else if (!toolBusy && !panning && boundsSig() !== fitSig) {
      // A discrete edit (voice/text/keyboard) changed the overall size — reframe
      // so the result stays fully visible (e.g. stretching the shared wall to
      // 4 m makes the plan taller). Guarded against in-progress drag/pan so a
      // live gesture is never yanked out from under the user.
      fitView();
    }
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const d = doc();
    const rect = svg.getBoundingClientRect();
    const W = rect.width || 800;
    const H = rect.height || 600;

    drawGrid(W, H);

    // Room fills + labels.
    for (const room of d.rooms) {
      const pts = dedupeLoop(room.wallIds, d);
      if (pts.length >= 3) {
        const poly = el('polygon', {
          points: pts.map((p) => { const s = toScreen(p); return `${s.x},${s.y}`; }).join(' '),
          fill: room.id === d.selectedId ? '#dbeafe' : '#f1f5f9',
          stroke: 'none',
        });
        svg.appendChild(poly);
      }
      const c = roomCentroid(room, d);
      if (c) {
        const sc = toScreen(c);
        svg.appendChild(textNode(sc.x, sc.y - 4, room.name, 14, '#334155', 'middle'));
        svg.appendChild(textNode(sc.x, sc.y + 14, mm2ToM2Label(roomArea(room, d)), 12, '#64748b', 'middle'));
      }
    }

    // Walls (no per-wall length labels — they clutter the drawing and sit on
    // door arcs; dimensions are shown separately for the selection + explicit
    // dims + overall outer size below).
    for (const w of d.walls) {
      const a = toScreen(w.a);
      const b = toScreen(w.b);
      const selected = w.id === d.selectedId;
      svg.appendChild(el('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: selected ? '#2563eb' : '#1f2937',
        'stroke-width': Math.max(2, w.thickness * scale),
        'stroke-linecap': 'round',
      }));
    }

    // Openings.
    for (const o of d.openings) {
      const wall = d.walls.find((x) => x.id === o.wallId);
      if (!wall) continue;
      const start = pointAlong(wall, o.offset);
      const end = pointAlong(wall, o.offset + o.width);
      const sa = toScreen(start);
      const sb = toScreen(end);
      // White gap over the wall.
      svg.appendChild(el('line', {
        x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y,
        stroke: '#ffffff', 'stroke-width': Math.max(2, wall.thickness * scale + 1),
      }));
      if (o.kind === 'door') {
        const hinge = o.swing === 'right' ? end : start;
        const leafFar = o.swing === 'right' ? start : end;
        const n = wallNormal(wall);
        const open = { x: hinge.x + n.x * o.width, y: hinge.y + n.y * o.width };
        const sh = toScreen(hinge);
        const sOpen = toScreen(open);
        svg.appendChild(el('line', { x1: sh.x, y1: sh.y, x2: sOpen.x, y2: sOpen.y, stroke: '#2563eb', 'stroke-width': 1.5 }));
        const r = o.width * scale;
        const far = toScreen(leafFar);
        svg.appendChild(el('path', {
          d: `M ${sOpen.x} ${sOpen.y} A ${r} ${r} 0 0 1 ${far.x} ${far.y}`,
          fill: 'none', stroke: '#93c5fd', 'stroke-width': 1,
        }));
      } else if (o.kind === 'window') {
        svg.appendChild(el('line', { x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y, stroke: '#0ea5e9', 'stroke-width': 2 }));
      } else {
        // Plain opening: thin jamb ticks at either end of the gap.
        svg.appendChild(el('line', { x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y, stroke: '#f59e0b', 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
      }
      if (o.id === d.selectedId) {
        svg.appendChild(el('line', {
          x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y,
          stroke: '#2563eb', 'stroke-width': Math.max(4, wall.thickness * scale + 4),
          'stroke-opacity': 0.25, 'stroke-linecap': 'round',
        }));
      }
    }

    // Endpoint handles on the selected wall (drag with the Select tool).
    const selWall = d.walls.find((w) => w.id === d.selectedId);
    if (selWall) {
      for (const endPt of [selWall.a, selWall.b]) {
        const s = toScreen(endPt);
        svg.appendChild(el('rect', {
          x: s.x - 5, y: s.y - 5, width: 10, height: 10,
          fill: '#ffffff', stroke: '#2563eb', 'stroke-width': 2,
        }));
      }
    }

    // Dimensions. We deliberately do NOT label every wall: only the explicit
    // dims (d.dims), the current selection, and the overall outer size. Each dim
    // offsets OUTSIDE the wall (away from the plan centre) with witness lines, so
    // the label never sits on the wall or a door arc.
    const bounds = planBounds(d);
    const centre = bounds
      ? { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 }
      : { x: 0, y: 0 };

    /** Dimension a wall, offset to the outward side (away from the plan centre). */
    function drawWallDim(wall: Wall, color: string, labelColor: string): void {
      let n = wallNormal(wall);
      const mid = wallMidpoint(wall);
      // Flip the normal so the dimension sits on the OUTSIDE of the plan.
      if ((mid.x - centre.x) * n.x + (mid.y - centre.y) * n.y < 0) n = { x: -n.x, y: -n.y };
      const gap = wall.thickness / 2 + 350;
      const a = { x: wall.a.x + n.x * gap, y: wall.a.y + n.y * gap };
      const b = { x: wall.b.x + n.x * gap, y: wall.b.y + n.y * gap };
      const sa = toScreen(a);
      const sb = toScreen(b);
      const wa = toScreen(wall.a);
      const wb = toScreen(wall.b);
      svg.appendChild(el('line', { x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y, stroke: color, 'stroke-width': 1 }));
      svg.appendChild(el('line', { x1: wa.x, y1: wa.y, x2: sa.x, y2: sa.y, stroke: color, 'stroke-width': 0.75 }));
      svg.appendChild(el('line', { x1: wb.x, y1: wb.y, x2: sb.x, y2: sb.y, stroke: color, 'stroke-width': 0.75 }));
      const m = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
      // Nudge the label a little further out along the normal.
      const ns = { x: n.x * scale, y: -n.y * scale };
      svg.appendChild(textNode(m.x + ns.x * 10, m.y - ns.y * 10 - 2, mmToMetresLabel(wallLength(wall)), 12, labelColor, 'middle'));
    }

    const dimmed = new Set(d.dims.map((dm) => dm.wallId));
    for (const dim of d.dims) {
      const wall = d.walls.find((x) => x.id === dim.wallId);
      if (wall) drawWallDim(wall, '#16a34a', '#15803d');
    }
    // Selected wall: dimension it too (unless it already has an explicit dim).
    if (d.selectedId && !dimmed.has(d.selectedId)) {
      const sel = d.walls.find((x) => x.id === d.selectedId);
      if (sel) drawWallDim(sel, '#2563eb', '#2563eb');
    }

    // Overall outer dimensions (bounding box width + height), drawn outside.
    if (bounds) {
      const OUT = 900; // mm beyond the plan
      const { min, max } = bounds;
      const widthMm = max.x - min.x;
      const heightMm = max.y - min.y;
      if (widthMm > 1) {
        const y = min.y - OUT;
        const sa = toScreen({ x: min.x, y });
        const sb = toScreen({ x: max.x, y });
        svg.appendChild(el('line', { x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y, stroke: '#94a3b8', 'stroke-width': 1 }));
        svg.appendChild(el('line', { x1: toScreen({ x: min.x, y: min.y }).x, y1: toScreen({ x: min.x, y: min.y }).y, x2: sa.x, y2: sa.y, stroke: '#cbd5e1', 'stroke-width': 0.75 }));
        svg.appendChild(el('line', { x1: toScreen({ x: max.x, y: min.y }).x, y1: toScreen({ x: max.x, y: min.y }).y, x2: sb.x, y2: sb.y, stroke: '#cbd5e1', 'stroke-width': 0.75 }));
        svg.appendChild(textNode((sa.x + sb.x) / 2, sa.y + 16, mmToMetresLabel(widthMm), 12, '#64748b', 'middle'));
      }
      if (heightMm > 1) {
        const x = min.x - OUT;
        const sa = toScreen({ x, y: min.y });
        const sb = toScreen({ x, y: max.y });
        svg.appendChild(el('line', { x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y, stroke: '#94a3b8', 'stroke-width': 1 }));
        svg.appendChild(el('line', { x1: toScreen({ x: min.x, y: min.y }).x, y1: toScreen({ x: min.x, y: min.y }).y, x2: sa.x, y2: sa.y, stroke: '#cbd5e1', 'stroke-width': 0.75 }));
        svg.appendChild(el('line', { x1: toScreen({ x: min.x, y: max.y }).x, y1: toScreen({ x: min.x, y: max.y }).y, x2: sb.x, y2: sb.y, stroke: '#cbd5e1', 'stroke-width': 0.75 }));
        const m = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
        const t = textNode(m.x - 8, m.y, mmToMetresLabel(heightMm), 12, '#64748b', 'middle');
        t.setAttribute('transform', `rotate(-90 ${m.x - 8} ${m.y})`);
        svg.appendChild(t);
      }
    }

    // Active-tool transient overlay (ghost previews, live readouts) on top.
    if (overlayDraw) {
      const g = el('g', { class: 'mc-overlay' });
      svg.appendChild(g);
      overlayDraw(makeOverlay(g));
    }
    propsPanel?.update();

    if (view3d) view3d.update();
  }

  /** Zoom-to-fit the current plan into the viewport, then redraw. Called after
   *  generate / template load and on window resize so the drawing stays centred
   *  in the (panel-free) viewport rather than running under the side panel. */
  function fit(): void {
    fitView();
    fitted = true;
    render();
  }

  function drawGrid(W: number, H: number): void {
    // Draw grid lines at GRID_MM spacing across the visible world rect.
    const topLeft = toWorld(svg.getBoundingClientRect().left, svg.getBoundingClientRect().top);
    const botRight = toWorld(svg.getBoundingClientRect().left + W, svg.getBoundingClientRect().top + H);
    const minX = Math.floor(Math.min(topLeft.x, botRight.x) / GRID_MM) * GRID_MM;
    const maxX = Math.ceil(Math.max(topLeft.x, botRight.x) / GRID_MM) * GRID_MM;
    const minY = Math.floor(Math.min(topLeft.y, botRight.y) / GRID_MM) * GRID_MM;
    const maxY = Math.ceil(Math.max(topLeft.y, botRight.y) / GRID_MM) * GRID_MM;
    if ((maxX - minX) / GRID_MM > 400 || (maxY - minY) / GRID_MM > 400) return; // too zoomed out
    for (let x = minX; x <= maxX; x += GRID_MM) {
      const s1 = toScreen({ x, y: minY });
      const s2 = toScreen({ x, y: maxY });
      svg.appendChild(el('line', { x1: s1.x, y1: s1.y, x2: s2.x, y2: s2.y, stroke: '#eef2f7', 'stroke-width': 1 }));
    }
    for (let y = minY; y <= maxY; y += GRID_MM) {
      const s1 = toScreen({ x: minX, y });
      const s2 = toScreen({ x: maxX, y });
      svg.appendChild(el('line', { x1: s1.x, y1: s1.y, x2: s2.x, y2: s2.y, stroke: '#eef2f7', 'stroke-width': 1 }));
    }
  }

  function textNode(x: number, y: number, s: string, size: number, fill: string, anchor: string): SVGTextElement {
    const t = el('text', { x, y, 'font-size': size, fill, 'text-anchor': anchor, 'font-family': 'system-ui, sans-serif' });
    t.textContent = s;
    return t;
  }

  // ---- native mouse / wheel / keyboard ----
  let panning: { x: number; y: number } | null = null;
  // A tool gesture (drag/draw) is in flight — suppress auto re-fit meanwhile.
  let toolBusy = false;

  svg.addEventListener('mousedown', (e) => {
    if (toolCtl.down({ x: e.clientX, y: e.clientY, source: 'mouse' })) {
      toolBusy = true;
      return;
    }
    panning = { x: e.clientX, y: e.clientY };
  });
  svg.addEventListener('dblclick', () => {
    toolCtl.handleKey(new KeyboardEvent('keydown', { key: 'Enter' }));
  });
  window.addEventListener('mousemove', onMouseMove);
  function onMouseMove(e: MouseEvent): void {
    if (panning) {
      originX += e.clientX - panning.x;
      originY += e.clientY - panning.y;
      panning = { x: e.clientX, y: e.clientY };
      render();
      return;
    }
    const p = { x: e.clientX, y: e.clientY, source: 'mouse' as const };
    if (e.buttons === 0 && !toolCtl.placing()) toolCtl.hover(p);
    else toolCtl.move(p);
  }
  window.addEventListener('mouseup', onMouseUp);
  function onMouseUp(e: MouseEvent): void {
    if (!panning) toolCtl.up({ x: e.clientX, y: e.clientY, source: 'mouse' });
    panning = null;
    toolBusy = false;
  }

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const before = toWorld(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    scale = Math.max(0.005, Math.min(2, scale * factor));
    const after = toWorld(e.clientX, e.clientY);
    originX += (after.x - before.x) * scale;
    originY -= (after.y - before.y) * scale;
    render();
  }, { passive: false });

  function onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    // Global editing chords (work in any tool).
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      const did = k === 'd' ? duplicateSelected(ctx) : k === 'c' ? copySelected(ctx) : k === 'v' ? pasteClipboard(ctx) : false;
      if (did) {
        e.preventDefault();
        return;
      }
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && deleteSelected(ctx)) {
        e.preventDefault();
        return;
      }
      if (e.key.toLowerCase() === 'x' && flipSelected(ctx)) {
        e.preventDefault();
        return;
      }
      if (e.key.toLowerCase() === 'f' && !e.shiftKey) {
        void fsCtl.toggle();
        e.preventDefault();
        return;
      }
    }
    // Tool shortcuts (V/W/R/D/N/O/T/M, Shift+M) + active-tool keys (Enter, Esc).
    if (toolCtl.handleKey(e)) {
      e.preventDefault();
      render();
      return;
    }
    // Arrows nudge the selection by one grid cell; with nothing selected they pan.
    if (controller.selectedId() && e.key.startsWith('Arrow')) {
      const g = GRID_MM;
      const d: Record<string, [number, number]> = {
        ArrowLeft: [-g, 0], ArrowRight: [g, 0], ArrowUp: [0, g], ArrowDown: [0, -g],
      };
      const n = d[e.key];
      if (n && nudgeSelected(ctx, n[0], n[1])) {
        e.preventDefault();
        return;
      }
    }
    const step = 40;
    if (e.key === 'ArrowLeft') originX += step;
    else if (e.key === 'ArrowRight') originX -= step;
    else if (e.key === 'ArrowUp') originY += step;
    else if (e.key === 'ArrowDown') originY -= step;
    else if (e.key === '+' || e.key === '=') scale *= 1.1;
    else if (e.key === '-' || e.key === '_') scale /= 1.1;
    else return;
    e.preventDefault();
    render();
  }
  container.addEventListener('keydown', onKey);

  // Re-fit on container/window resize so the plan never ends up partly under the
  // panel; while the 3D view is active the SVG is hidden, so just redraw.
  const resize = new ResizeObserver(() => (view3d ? render() : fit()));
  resize.observe(container);

  // ---- optional 3D extrude view ----
  let view3d: { update(): void; dispose(): void } | null = null;
  function toggle3D(on: boolean): boolean {
    if (on && !view3d) {
      void import('./extrude3d').then(({ createExtrudeView }) => {
        view3d = createExtrudeView(container, () => doc(), WALL_HEIGHT_MM);
        svg.style.display = 'none';
        view3d.update();
      });
      return true;
    }
    if (!on && view3d) {
      view3d.dispose();
      view3d = null;
      svg.style.display = 'block';
      render();
      return false;
    }
    return !!view3d;
  }

  render();

  // Pinch events arrive via these ViewportHandle hooks (main.ts converts hand
  // coords to client px) and feed the SAME ToolController as the mouse.
  let pinchActive = false;
  let lastPinch = { x: 0, y: 0 };

  return {
    render,
    fit,
    pick,
    beginDrag(clientX, clientY) {
      lastPinch = { x: clientX, y: clientY };
      const item = palette.itemAt(clientX, clientY);
      if (item) {
        toolCtl.beginPlace(item.toolId, { x: clientX, y: clientY, source: 'pinch' });
        pinchActive = true;
        return true;
      }
      pinchActive = toolCtl.down({ x: clientX, y: clientY, source: 'pinch' });
      toolBusy = pinchActive;
      return pinchActive;
    },
    drag(clientX, clientY) {
      lastPinch = { x: clientX, y: clientY };
      if (toolCtl.placing() || pinchActive) {
        toolCtl.move({ x: clientX, y: clientY, source: 'pinch' });
        return true;
      }
      return false;
    },
    endDrag() {
      if (toolCtl.placing() || pinchActive) toolCtl.up({ x: lastPinch.x, y: lastPinch.y, source: 'pinch' });
      pinchActive = false;
      toolBusy = false;
    },
    tap(clientX, clientY) {
      const item = palette.itemAt(clientX, clientY);
      if (item) {
        toolCtl.activate(item.toolId);
        return true;
      }
      const p = { x: clientX, y: clientY, source: 'pinch' as const };
      const handled = toolCtl.down(p);
      toolCtl.up(p);
      return handled;
    },
    hover(clientX, clientY) {
      toolCtl.hover({ x: clientX, y: clientY, source: 'pinch' });
    },
    toggle3D,
    dispose() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('keydown', onKey);
      resize.disconnect();
      view3d?.dispose();
      palette.dispose();
      trash.dispose();
      fsCtl.dispose();
      propsPanel.dispose();
      status.remove();
      svg.remove();
    },
  };
}
