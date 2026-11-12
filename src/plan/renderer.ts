// SVG 2D plan renderer: grid, walls (with thickness), door swing arcs, window
// symbols, live dimension labels in metres, room names + areas, selection
// highlight, hit-testing (click / pinch-tap), drag-to-move with snap, and
// wheel/keyboard pan+zoom. An optional three.js overlay extrudes the walls to
// 3D as a *view* (not a second editor). Implements the generic ViewportHandle.

import type { ModeController, ViewportHandle } from '../core/controller';
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
import { GRID_MM, snapPoint } from './snap';

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

  const doc = (): PlanDoc => controller.snapshot() as PlanDoc;
  const toScreen = (p: Point) => ({ x: originX + p.x * scale, y: originY - p.y * scale });
  function toWorld(clientX: number, clientY: number): Point {
    const rect = svg.getBoundingClientRect();
    return { x: (clientX - rect.left - originX) / scale, y: -(clientY - rect.top - originY) / scale };
  }

  function fitView(): void {
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
    const pad = 1000; // mm margin
    const w = b.max.x - b.min.x + pad * 2;
    const h = b.max.y - b.min.y + pad * 2;
    scale = Math.min(W / w, H / h, 0.3);
    const cx = (b.min.x + b.max.x) / 2;
    const cy = (b.min.y + b.max.y) / 2;
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

  // ---- drag ----
  let drag: { wallId: string; grabWorld: Point; grabMid: Point } | null = null;

  function beginDrag(clientX: number, clientY: number): boolean {
    const sel = controller.selectedId();
    if (!sel) return false;
    const w = doc().walls.find((x) => x.id === sel);
    if (!w) return false;
    drag = { wallId: w.id, grabWorld: toWorld(clientX, clientY), grabMid: wallMidpoint(w) };
    return true;
  }

  function doDrag(clientX: number, clientY: number): boolean {
    if (!drag) return false;
    const now = toWorld(clientX, clientY);
    const target = {
      x: drag.grabMid.x + (now.x - drag.grabWorld.x),
      y: drag.grabMid.y + (now.y - drag.grabWorld.y),
    };
    const others = doc().walls.filter((w) => w.id !== drag!.wallId);
    const snapped = snapPoint(target, others, GRID_MM, GRID_MM).point;
    const cur = doc().walls.find((w) => w.id === drag!.wallId);
    if (!cur) return false;
    const mid = wallMidpoint(cur);
    const dx = snapped.x - mid.x;
    const dy = snapped.y - mid.y;
    if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
      controller.applyOp({ op: 'move', target: drag.wallId, nums: { dx, dy } });
      render();
    }
    return true;
  }

  function endDrag(): void {
    drag = null;
  }

  // ---- rendering ----
  function render(): void {
    if (!fitted) {
      fitView();
      fitted = true;
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

    // Walls.
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
      // Live length label at the midpoint.
      const mid = toScreen(wallMidpoint(w));
      svg.appendChild(textNode(mid.x, mid.y - Math.max(6, w.thickness * scale * 0.5 + 4), mmToMetresLabel(wallLength(w)), 11, selected ? '#2563eb' : '#94a3b8', 'middle'));
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
      } else {
        svg.appendChild(el('line', { x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y, stroke: '#0ea5e9', 'stroke-width': 2 }));
      }
    }

    // Dimensions (explicit) — offset line + witnesses + label in metres.
    for (const dim of d.dims) {
      const wall = d.walls.find((x) => x.id === dim.wallId);
      if (!wall) continue;
      const n = wallNormal(wall);
      const gap = wall.thickness / 2 + 350;
      const a = { x: wall.a.x + n.x * gap, y: wall.a.y + n.y * gap };
      const b = { x: wall.b.x + n.x * gap, y: wall.b.y + n.y * gap };
      const sa = toScreen(a);
      const sb = toScreen(b);
      const wa = toScreen(wall.a);
      const wb = toScreen(wall.b);
      svg.appendChild(el('line', { x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y, stroke: '#16a34a', 'stroke-width': 1 }));
      svg.appendChild(el('line', { x1: wa.x, y1: wa.y, x2: sa.x, y2: sa.y, stroke: '#16a34a', 'stroke-width': 0.75 }));
      svg.appendChild(el('line', { x1: wb.x, y1: wb.y, x2: sb.x, y2: sb.y, stroke: '#16a34a', 'stroke-width': 0.75 }));
      const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
      svg.appendChild(textNode(mid.x, mid.y - 4, mmToMetresLabel(wallLength(wall)), 12, '#15803d', 'middle'));
    }

    if (view3d) view3d.update();
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

  svg.addEventListener('mousedown', (e) => {
    const id = pick(e.clientX, e.clientY);
    if (id) {
      onSelect(id);
      controller.selectId(id);
      render();
      beginDrag(e.clientX, e.clientY);
    } else {
      panning = { x: e.clientX, y: e.clientY };
    }
  });
  window.addEventListener('mousemove', onMouseMove);
  function onMouseMove(e: MouseEvent): void {
    if (drag) { doDrag(e.clientX, e.clientY); return; }
    if (panning) {
      originX += e.clientX - panning.x;
      originY += e.clientY - panning.y;
      panning = { x: e.clientX, y: e.clientY };
      render();
    }
  }
  window.addEventListener('mouseup', onMouseUp);
  function onMouseUp(): void {
    endDrag();
    panning = null;
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

  const resize = new ResizeObserver(() => render());
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

  return {
    render,
    pick,
    beginDrag,
    drag: doDrag,
    endDrag,
    toggle3D,
    dispose() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('keydown', onKey);
      resize.disconnect();
      view3d?.dispose();
      svg.remove();
    },
  };
}
