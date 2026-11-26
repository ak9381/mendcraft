// Fallback A2UI renderer: takes the SAME gated A2UI messages
// (createSurface / updateComponents / updateDataModel / deleteSurface)
// and renders Column, Text, DeviceTile (lamp, speaker, switch, gimbal),
// PlanBoard, SceneTile, ConnectTile into a host element without @a2ui/lit (plain DOM).
//
// Pure part: message reducer to a render tree with resolved bindings.
import type { A2uiMessage, FormField } from './surfacePlan';
import { sanitizeVisualMarkup } from './visualSanitize';
import { buildVisualDom } from './visualMount';
import { rangeNudge, rangePresets, rangeStep } from './lampPresets';
import { NOT_CONNECTED_BADGE, STANDARD_CONTROLS_NOTE, intentMatches, readoutText, sliderView, stateLine, tileActive, tileState } from './deviceTile';
import type { ControlSpec } from './controlSpec';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** `createElementNS` when the doc supports it (a real Document, or a test
 *  fake that implements it) — SVG shapes minted via plain `createElement`
 *  render as inert HTMLUnknownElements, not vector graphics. */
function svgEl(doc: Document, tag: string): HTMLElement {
  const d = doc as unknown as { createElementNS?(ns: string, t: string): HTMLElement };
  return d.createElementNS ? d.createElementNS(SVG_NS, tag) : doc.createElement(tag);
}

export interface RenderNode {
  id: string;
  component: string;
  props: Record<string, unknown>;
  children?: RenderNode[];
}

export interface RenderTree {
  surfaceId: string;
  root: RenderNode | null;
  nodesById: Record<string, RenderNode>;
}

export interface SurfaceState {
  surfaceId: string;
  catalogId?: string;
  components: Record<string, { id: string; component: string; [k: string]: unknown }>;
  dataModel: Record<string, unknown>;
}

export interface FallbackRendererState {
  surfaces: Record<string, SurfaceState>;
}

export interface FallbackAction {
  name: string;
  context?: Record<string, unknown>;
}

export interface FallbackRendererOptions {
  host?: HTMLElement;
  onAction?: (action: FallbackAction) => void;
  doc?: Document;
}

export interface FallbackRenderer {
  processMessages(messages: A2uiMessage[]): Record<string, RenderTree>;
  getTree(surfaceId: string): RenderTree | null;
  getState(): FallbackRendererState;
  dispatchAction(action: FallbackAction): void;
  render(surfaceId: string, hostEl?: HTMLElement): HTMLElement | null;
}

function deepClone<T>(v: T): T {
  if (v === undefined || v === null) return v;
  if (typeof structuredClone !== 'undefined') return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}

function resolvePathValue(dataModel: Record<string, unknown>, path: string): unknown {
  const clean = path.replace(/^\/+/, '');
  if (!clean) return dataModel;
  const segments = clean.split('/');
  let cur: unknown = dataModel;
  for (const seg of segments) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function applyPathUpdate(target: Record<string, unknown>, path: string, value: unknown): void {
  const clean = path.replace(/^\/+/, '');
  if (!clean) {
    if (value && typeof value === 'object') {
      Object.assign(target, value);
    }
    return;
  }
  const segments = clean.split('/');
  let cur = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const s = segments[i];
    if (!cur[s] || typeof cur[s] !== 'object') {
      cur[s] = {};
    }
    cur = cur[s] as Record<string, unknown>;
  }
  const last = segments[segments.length - 1];
  if (value && typeof value === 'object' && !Array.isArray(value) && cur[last] && typeof cur[last] === 'object') {
    Object.assign(cur[last] as Record<string, unknown>, value);
  } else {
    cur[last] = value;
  }
}

function resolveComponentProps(
  comp: { id: string; component: string; [k: string]: unknown },
  dataModel: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(comp)) {
    if (key === 'id' || key === 'component') continue;
    if (val && typeof val === 'object' && 'path' in val && typeof (val as { path: unknown }).path === 'string') {
      resolved[key] = resolvePathValue(dataModel, (val as { path: string }).path);
    } else {
      resolved[key] = val;
    }
  }
  return resolved;
}

export function buildRenderTree(surface: SurfaceState): RenderTree {
  const nodesById: Record<string, RenderNode> = {};
  for (const comp of Object.values(surface.components)) {
    nodesById[comp.id] = {
      id: comp.id,
      component: comp.component,
      props: resolveComponentProps(comp, surface.dataModel),
    };
  }

  // Link children if specified in root/column (and any other component with
  // a flat `children` id array — Row/Grid/Card/Split all reuse this same
  // shape so they need no special case here).
  for (const comp of Object.values(surface.components)) {
    const parentNode = nodesById[comp.id];
    if (!parentNode) continue;
    const rawChildren = comp.children;
    if (Array.isArray(rawChildren)) {
      parentNode.children = rawChildren
        .map((cid) => (typeof cid === 'string' ? nodesById[cid] : null))
        .filter((n): n is RenderNode => n !== null && n !== undefined);
    }
    // Tabs nests its child-id arrays one level deeper (`tabs[].children`),
    // so the generic `children` link above never reaches them — resolve
    // those ids into real RenderNodes here, in place on the props.
    const rawTabs = comp.tabs;
    if (Array.isArray(rawTabs)) {
      parentNode.props.tabs = rawTabs.map((t) => {
        if (!t || typeof t !== 'object') return t;
        const to = t as { label?: unknown; children?: unknown };
        const children = Array.isArray(to.children)
          ? to.children.map((cid) => (typeof cid === 'string' ? nodesById[cid] : null)).filter((n): n is RenderNode => n !== null)
          : [];
        return { label: to.label, children };
      });
    }
  }

  const root = nodesById['root'] ?? (Object.values(nodesById)[0] || null);

  return {
    surfaceId: surface.surfaceId,
    root,
    nodesById,
  };
}

/** Pure reducer from A2UI messages to render trees. */
export function reduceA2uiMessages(
  prevState: FallbackRendererState | undefined,
  messages: A2uiMessage[],
): { state: FallbackRendererState; trees: Record<string, RenderTree> } {
  // Surfaces not targeted by this batch are copied by reference — only
  // surfaces a message actually mutates get a fresh (cloned) SurfaceState.
  const state: FallbackRendererState = prevState ? { surfaces: { ...prevState.surfaces } } : { surfaces: {} };
  const cloned = new Set<string>();
  const ownSurface = (sid: string): SurfaceState | undefined => {
    const s = state.surfaces[sid];
    if (!s || cloned.has(sid)) return s;
    cloned.add(sid);
    return (state.surfaces[sid] = {
      surfaceId: s.surfaceId,
      catalogId: s.catalogId,
      components: { ...s.components },
      dataModel: deepClone(s.dataModel),
    });
  };

  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const msg = m as Record<string, unknown>;

    if (msg.createSurface && typeof msg.createSurface === 'object') {
      const cs = msg.createSurface as { surfaceId: string; catalogId?: string };
      state.surfaces[cs.surfaceId] = {
        surfaceId: cs.surfaceId,
        catalogId: cs.catalogId,
        components: {},
        dataModel: {},
      };
      cloned.add(cs.surfaceId);
    } else if (msg.updateComponents && typeof msg.updateComponents === 'object') {
      const uc = msg.updateComponents as {
        surfaceId: string;
        components: Array<{ id: string; component: string; [k: string]: unknown }>;
      };
      const s = ownSurface(uc.surfaceId);
      if (s && Array.isArray(uc.components)) {
        for (const c of uc.components) {
          if (c && c.id) {
            s.components[c.id] = c;
          }
        }
      }
    } else if (msg.updateDataModel && typeof msg.updateDataModel === 'object') {
      const ud = msg.updateDataModel as { surfaceId: string; path: string; value: unknown };
      const s = ownSurface(ud.surfaceId);
      if (s) {
        applyPathUpdate(s.dataModel, ud.path, ud.value);
      }
    } else if (msg.deleteSurface && typeof msg.deleteSurface === 'object') {
      const ds = msg.deleteSurface as { surfaceId: string };
      delete state.surfaces[ds.surfaceId];
    }
  }

  const trees: Record<string, RenderTree> = {};
  for (const [sid, surface] of Object.entries(state.surfaces)) {
    trees[sid] = buildRenderTree(surface);
  }

  return { state, trees };
}

/** Plain DOM node renderer for a RenderNode without @a2ui/lit. */
export function renderNodeToDom(
  node: RenderNode,
  doc: Document,
  onAction?: (action: FallbackAction) => void,
): HTMLElement {
  const p = node.props;

  function triggerAction(act: unknown, extraContext?: Record<string, unknown>): void {
    if (act && typeof act === 'object' && 'event' in act) {
      const ev = (act as { event: FallbackAction }).event;
      const merged = extraContext ? { ...ev, context: { ...(ev.context ?? {}), ...extraContext } } : ev;
      onAction?.(merged);
    }
  }

  function renderChildren(el: HTMLElement): void {
    if (node.children) {
      for (const child of node.children) el.appendChild(renderNodeToDom(child, doc, onAction));
    }
  }

  if (node.component === 'Column') {
    const el = doc.createElement('div');
    el.className = 'mc-fb-column';
    el.style.display = 'grid';
    el.style.gap = '16px';
    renderChildren(el);
    return el;
  }

  if (node.component === 'Row') {
    const el = doc.createElement('div');
    el.className = 'mc-fb-row';
    el.style.display = 'flex';
    el.style.flexWrap = 'wrap';
    el.style.gap = '16px';
    renderChildren(el);
    return el;
  }

  if (node.component === 'Grid') {
    const cols = typeof p.columns === 'number' ? p.columns : 2;
    const el = doc.createElement('div');
    el.className = `mc-fb-grid mc-fb-grid-${cols}`;
    el.style.display = 'grid';
    el.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    el.style.gap = '16px';
    renderChildren(el);
    return el;
  }

  if (node.component === 'Card') {
    const el = doc.createElement('div');
    el.className = 'mc-fb-card';
    el.style.border = '2px solid #E4E0D8';
    el.style.borderRadius = '16px';
    el.style.background = '#FFFFFF';
    el.style.padding = '16px';
    el.style.display = 'grid';
    el.style.gap = '12px';
    if (p.title) {
      const h = doc.createElement('h3');
      h.className = 'mc-fb-card-title';
      h.textContent = String(p.title);
      el.appendChild(h);
    }
    renderChildren(el);
    return el;
  }

  if (node.component === 'Tabs') {
    const tabs = Array.isArray(p.tabs) ? (p.tabs as Array<{ label: string; children: RenderNode[] }>) : [];
    const el = doc.createElement('div');
    el.className = 'mc-fb-tabs';
    const bar = doc.createElement('div');
    bar.className = 'mc-fb-tab-bar';
    bar.setAttribute('role', 'tablist');
    const panels = doc.createElement('div');
    panels.className = 'mc-fb-tab-panels';
    el.appendChild(bar);
    el.appendChild(panels);

    const panelEls: HTMLElement[] = [];
    const buttonEls: HTMLElement[] = [];
    tabs.forEach((tab, i) => {
      const btn = doc.createElement('button');
      btn.setAttribute('type', 'button');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(i === 0));
      btn.className = `mc-fb-tab-btn${i === 0 ? ' active' : ''}`;
      btn.textContent = tab.label;
      bar.appendChild(btn);
      buttonEls.push(btn);

      const panel = doc.createElement('div');
      panel.className = 'mc-fb-tab-panel';
      panel.style.display = 'grid';
      panel.style.gap = '16px';
      panel.hidden = i !== 0;
      for (const child of tab.children ?? []) panel.appendChild(renderNodeToDom(child as RenderNode, doc, onAction));
      panels.appendChild(panel);
      panelEls.push(panel);

      btn.addEventListener('click', () => {
        panelEls.forEach((pe, j) => { pe.hidden = j !== i; });
        buttonEls.forEach((be, j) => {
          be.classList.toggle('active', j === i);
          be.setAttribute('aria-selected', String(j === i));
        });
      });
    });
    return el;
  }

  if (node.component === 'Split') {
    const direction = p.direction === 'column' ? 'column' : 'row';
    const firstCount = typeof p.firstCount === 'number' ? p.firstCount : 0;
    const el = doc.createElement('div');
    el.className = `mc-fb-split mc-fb-split-${direction}`;
    el.style.display = 'flex';
    el.style.flexDirection = direction;
    el.style.gap = '16px';
    const firstEl = doc.createElement('div');
    firstEl.className = 'mc-fb-split-pane';
    firstEl.style.flex = '1';
    const secondEl = doc.createElement('div');
    secondEl.className = 'mc-fb-split-pane';
    secondEl.style.flex = '1';
    const children = node.children ?? [];
    for (const child of children.slice(0, firstCount)) firstEl.appendChild(renderNodeToDom(child, doc, onAction));
    for (const child of children.slice(firstCount)) secondEl.appendChild(renderNodeToDom(child, doc, onAction));
    el.appendChild(firstEl);
    el.appendChild(secondEl);
    return el;
  }

  if (node.component === 'StatTile') {
    const trend = p.trend === 'up' ? '▲' : p.trend === 'down' ? '▼' : '';
    const trendColor = p.trend === 'up' ? '#6B8F71' : p.trend === 'down' ? '#B5453A' : '#6E6A63';
    const el = doc.createElement('div');
    el.className = 'mc-fb-tile stat';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', String(p.label || 'Stat'));
    const labelEl = doc.createElement('div');
    labelEl.className = 'label';
    labelEl.textContent = String(p.label || '');
    const valueEl = doc.createElement('div');
    valueEl.className = 'value';
    valueEl.textContent = String(p.value ?? '');
    el.appendChild(labelEl);
    el.appendChild(valueEl);
    if (p.delta) {
      const deltaEl = doc.createElement('div');
      deltaEl.className = 'delta';
      deltaEl.style.color = trendColor;
      deltaEl.textContent = `${trend} ${String(p.delta)}`.trim();
      el.appendChild(deltaEl);
    }
    if (Array.isArray(p.spark) && p.spark.length > 1) {
      const spark = p.spark as number[];
      const max = Math.max(...spark, 1);
      const min = Math.min(...spark, 0);
      const range = Math.max(max - min, 1);
      const w = 100;
      const h = 24;
      const pts = spark.map((v, i) => `${(i / (spark.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
      const svg = svgEl(doc, 'svg');
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.setAttribute('class', 'sparkline');
      svg.setAttribute('aria-hidden', 'true');
      const poly = svgEl(doc, 'polyline');
      poly.setAttribute('points', pts);
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', trendColor);
      poly.setAttribute('stroke-width', '2');
      svg.appendChild(poly);
      el.appendChild(svg);
    }
    return el;
  }

  if (node.component === 'ChartTile') {
    const el = doc.createElement('div');
    el.className = 'mc-fb-tile chart';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', String(p.title || 'Chart'));
    const h = doc.createElement('div');
    h.className = 'label';
    h.textContent = String(p.title || '');
    el.appendChild(h);
    const series = Array.isArray(p.series) ? (p.series as Array<{ label: string; value: number }>) : [];
    const svg = svgEl(doc, 'svg');
    svg.setAttribute('viewBox', '0 0 120 60');
    svg.setAttribute('class', 'chart-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', series.map((s) => `${s.label}: ${s.value}`).join(', '));
    const max = Math.max(...series.map((s) => s.value), 1);
    if (p.chartType === 'ring') {
      const total = series.reduce((a, s) => a + Math.max(s.value, 0), 0) || 1;
      let angle = 0;
      const colors = ['#6B8F71', '#C98B3C', '#5A7BA6', '#6E6A63'];
      series.forEach((s, i) => {
        const frac = Math.max(s.value, 0) / total;
        const circle = svgEl(doc, 'circle');
        circle.setAttribute('cx', '30');
        circle.setAttribute('cy', '30');
        circle.setAttribute('r', '24');
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke', colors[i % colors.length]);
        circle.setAttribute('stroke-width', '10');
        const circumference = 2 * Math.PI * 24;
        circle.setAttribute('stroke-dasharray', `${frac * circumference} ${circumference}`);
        circle.setAttribute('stroke-dashoffset', String(-angle * circumference));
        svg.appendChild(circle);
        angle += frac;
      });
    } else if (p.chartType === 'line') {
      const pts = series.map((s, i) => `${(i / Math.max(series.length - 1, 1)) * 110 + 5},${55 - (s.value / max) * 50}`).join(' ');
      const poly = svgEl(doc, 'polyline');
      poly.setAttribute('points', pts);
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', '#5A7BA6');
      poly.setAttribute('stroke-width', '2');
      svg.appendChild(poly);
    } else {
      const barWidth = 100 / Math.max(series.length, 1);
      series.forEach((s, i) => {
        const barH = (s.value / max) * 50;
        const rect = svgEl(doc, 'rect');
        rect.setAttribute('x', String(5 + i * barWidth));
        rect.setAttribute('y', String(55 - barH));
        rect.setAttribute('width', String(barWidth * 0.7));
        rect.setAttribute('height', String(barH));
        rect.setAttribute('fill', '#C98B3C');
        svg.appendChild(rect);
      });
    }
    el.appendChild(svg);
    return el;
  }

  if (node.component === 'TableTile') {
    const el = doc.createElement('div');
    el.className = 'mc-fb-tile table';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', String(p.title || 'Table'));
    const h = doc.createElement('div');
    h.className = 'label';
    h.textContent = String(p.title || '');
    el.appendChild(h);

    const columns = Array.isArray(p.columns) ? (p.columns as string[]) : [];
    let rows = Array.isArray(p.rows) ? (p.rows as string[][]).slice() : [];
    let sortCol: number | null = null;
    let sortAsc = true;

    const table = doc.createElement('table');
    table.className = 'mc-fb-table';
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    const tbody = doc.createElement('tbody');
    table.appendChild(thead);
    table.appendChild(tbody);
    thead.appendChild(headRow);
    el.appendChild(table);

    function renderRows(): void {
      tbody.textContent = '';
      for (let ri = 0; ri < rows.length; ri++) {
        const tr = doc.createElement('tr');
        for (const cell of rows[ri]) {
          const td = doc.createElement('td');
          td.textContent = cell;
          tr.appendChild(td);
        }
        if (p.sortable || p.rowActionLabel) {
          const td = doc.createElement('td');
          if (p.rowActionLabel) {
            const btn = doc.createElement('button');
            btn.setAttribute('type', 'button');
            btn.textContent = String(p.rowActionLabel);
            const rowIndex = ri;
            btn.addEventListener('click', () => triggerAction(p.onRowAction, { rowIndex, row: rows[rowIndex] }));
            td.appendChild(btn);
          }
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    }

    columns.forEach((colLabel, ci) => {
      const th = doc.createElement('th');
      if (p.sortable) {
        const btn = doc.createElement('button');
        btn.setAttribute('type', 'button');
        btn.className = 'mc-fb-sort-btn';
        btn.textContent = colLabel;
        btn.addEventListener('click', () => {
          sortAsc = sortCol === ci ? !sortAsc : true;
          sortCol = ci;
          rows = rows.slice().sort((a, b) => (sortAsc ? 1 : -1) * a[ci].localeCompare(b[ci]));
          renderRows();
        });
        th.appendChild(btn);
      } else {
        th.textContent = colLabel;
      }
      headRow.appendChild(th);
    });
    if (p.sortable || p.rowActionLabel) headRow.appendChild(doc.createElement('th'));
    renderRows();
    return el;
  }

  if (node.component === 'FormTile') {
    const el = doc.createElement('div');
    el.className = 'mc-fb-tile form';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', String(p.title || 'Form'));
    const h = doc.createElement('div');
    h.className = 'label';
    h.textContent = String(p.title || '');
    el.appendChild(h);

    const fields = Array.isArray(p.fields) ? (p.fields as FormField[]) : [];
    const values: Record<string, boolean | number | string> = {};
    for (const f of fields) {
      values[f.id] = f.kind === 'toggle' ? !!f.value : f.kind === 'slider' ? (f.value ?? f.min ?? 0) : (f.value ?? f.options?.[0] ?? '');
      const row = doc.createElement('div');
      row.className = 'row';
      const label = doc.createElement('label');
      label.textContent = f.label;
      row.appendChild(label);
      if (f.kind === 'toggle') {
        const input = doc.createElement('input');
        input.setAttribute('type', 'checkbox');
        input.setAttribute('aria-label', f.label);
        if (f.value) input.setAttribute('checked', 'checked');
        input.addEventListener('change', (e) => { values[f.id] = !!(e as { target?: { checked?: boolean } }).target?.checked; });
        row.appendChild(input);
      } else if (f.kind === 'slider') {
        // No slider: step buttons and preset chips, each one press.
        const min = f.min ?? 0, max = f.max ?? 100;
        const level = doc.createElement('div');
        level.className = 'level';
        level.setAttribute('data-level', 'value');
        level.setAttribute('data-level-step', String(rangeStep(min, max)));
        level.setAttribute('role', 'group');
        level.setAttribute('aria-label', f.label);
        level.setAttribute('aria-valuemin', String(min));
        level.setAttribute('aria-valuemax', String(max));
        const readout = doc.createElement('span');
        readout.className = 'readout';
        readout.setAttribute('data-level-readout', '');
        const chips: Array<{ el: HTMLElement; n: number }> = [];
        const set = (n: number): void => {
          const v = Math.max(Math.min(min, max), Math.min(Math.max(min, max), n));
          values[f.id] = v;
          readout.textContent = String(v);
          level.setAttribute('aria-valuenow', String(v));
          level.setAttribute('aria-label', `${f.label} ${v}`);
          for (const c of chips) c.el.setAttribute('aria-pressed', String(c.n === v));
        };
        const step = (text: string, dir: 1 | -1, attr: string): HTMLElement => {
          const b = doc.createElement('button');
          b.setAttribute('type', 'button');
          b.className = 'step';
          b.setAttribute(attr, '');
          b.setAttribute('aria-label', `${f.label}: ${dir > 0 ? 'higher' : 'lower'}`);
          b.textContent = text;
          b.addEventListener('click', () => set(rangeNudge(Number(values[f.id]), dir, min, max)));
          return b;
        };
        level.appendChild(step('−', -1, 'data-level-dec'));
        level.appendChild(readout);
        level.appendChild(step('+', 1, 'data-level-inc'));
        for (const n of rangePresets(min, max)) {
          const b = doc.createElement('button');
          b.setAttribute('type', 'button');
          b.className = 'mc-fb-preset';
          b.setAttribute('aria-label', `${f.label} ${n}`);
          b.textContent = String(n);
          b.addEventListener('click', () => set(n));
          chips.push({ el: b, n });
          level.appendChild(b);
        }
        set(Number(values[f.id]));
        row.appendChild(level);
      } else if (f.kind === 'choice') {
        for (const opt of f.options) {
          const btn = doc.createElement('button');
          btn.setAttribute('type', 'button');
          btn.setAttribute('aria-pressed', String(opt === f.value));
          btn.className = `mc-fb-choice${opt === f.value ? ' active' : ''}`;
          btn.textContent = opt;
          btn.addEventListener('click', () => { values[f.id] = opt; });
          row.appendChild(btn);
        }
      }
      el.appendChild(row);
    }

    const submitRow = doc.createElement('div');
    submitRow.className = 'row';
    const submitBtn = doc.createElement('button');
    submitBtn.className = 'primary';
    submitBtn.setAttribute('type', 'button');
    submitBtn.textContent = String(p.submitLabel || 'Submit');
    submitBtn.addEventListener('click', () => triggerAction(p.onSubmit, { values: { ...values } }));
    submitRow.appendChild(submitBtn);
    el.appendChild(submitRow);
    return el;
  }

  if (node.component === 'VisualTile') {
    const el = doc.createElement('div');
    el.className = 'mc-fb-tile visual';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', String(p.title || 'Visual'));
    const h = doc.createElement('div');
    h.className = 'label';
    h.textContent = String(p.title || '');
    el.appendChild(h);
    const frame = doc.createElement('div');
    frame.className = 'mc-fb-visual-frame';
    const { nodes } = sanitizeVisualMarkup(String(p.markup || ''));
    const built = buildVisualDom(nodes, doc as never, ({ action, label }) => triggerAction(p.onAction, { action, label }));
    for (const n of built) frame.appendChild(n as HTMLElement);
    el.appendChild(frame);
    return el;
  }

  if (node.component === 'Text') {
    const tag = p.variant === 'h1' ? 'h1' : p.variant === 'h2' ? 'h2' : 'p';
    const el = doc.createElement(tag);
    el.className = `mc-fb-text ${String(p.variant || 'body')}`;
    el.textContent = p.text ? String(p.text) : '';
    return el;
  }

  // ---- device tiles: discrete, one-press controls (no slider) ----
  // Same structure and level-control contract as the Lit tiles (deviceTiles.ts):
  // one [data-level] element per level, holding [data-level-dec] /
  // [data-level-inc] step buttons and a [data-level-readout].
  function mk(tag: string, className: string, text?: string): HTMLElement {
    const e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function btn(text: string, act: string, onClick: () => void, o: { cls?: string; label?: string; pressed?: boolean; value?: string | number; attrs?: string[] } = {}): HTMLElement {
    const b = mk('button', o.cls ?? '', text);
    b.setAttribute('type', 'button');
    b.setAttribute('data-act', act);
    if (o.label) b.setAttribute('aria-label', o.label);
    if (o.pressed !== undefined) b.setAttribute('aria-pressed', String(o.pressed));
    if (o.value !== undefined) b.setAttribute('data-value', String(o.value));
    for (const a of o.attrs ?? []) b.setAttribute(a, '');
    b.addEventListener('click', onClick);
    return b;
  }
  function levelEl(kind: string, step: number, label: string, now: number | null, min: number, max: number): HTMLElement {
    const el = mk('div', 'level');
    el.setAttribute('data-level', kind);
    el.setAttribute('data-level-step', String(step));
    if (now !== null) el.setAttribute('aria-valuenow', String(now));
    el.setAttribute('aria-valuemin', String(min));
    el.setAttribute('aria-valuemax', String(max));
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', label);
    return el;
  }
  function readoutEl(text: string): HTMLElement {
    const r = mk('span', 'readout-value', text);
    r.setAttribute('data-level-readout', '');
    return r;
  }
  function noteEl(): HTMLElement {
    const n = mk('p', 'note error', String(p.error ?? ''));
    n.setAttribute('role', 'status');
    return n;
  }

  // The one device tile: drawn from its approved controls. A press adds only
  // its control (and option) index to the tile's device.act context.
  if (node.component === 'DeviceTile') {
    const s = tileState(p);
    const controls = (Array.isArray(p.controls) ? p.controls : []) as ControlSpec[];
    const label = String(p.label || 'Device');
    const el = mk('div', `mc-fb-tile device ${s.cls} ${tileActive(s) ? 'on' : ''}`);
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', label);
    el.setAttribute('data-device-cls', s.cls);
    const head = mk('div', 'row head');
    head.appendChild(mk('span', 'label', label));
    const stateSpan = mk('span', 'state', `${stateLine(s)}${p.pending ? ' · checking…' : ''}`);
    stateSpan.setAttribute('aria-live', 'polite');
    stateSpan.setAttribute('data-device-state', '');
    head.appendChild(stateSpan);
    if (p.unreachable) head.appendChild(mk('span', 'reach-badge', NOT_CONNECTED_BADGE));
    else if (p.sim) head.appendChild(mk('span', 'sim-badge', 'SIM'));
    el.appendChild(head);
    if (p.error) el.appendChild(noteEl());
    controls.forEach((c, i) => {
      if (c.kind === 'toggle' || c.kind === 'button') {
        el.appendChild(btn(c.label, c.kind, () => triggerAction(p.onAct, { control: i }), { cls: c.kind === 'toggle' ? 'primary' : '', pressed: c.kind === 'toggle' ? intentMatches(c.intent, s) : undefined }));
      } else if (c.kind === 'chips') {
        const group = mk('div', 'chips');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', c.label);
        c.options.forEach((o, j) => group.appendChild(btn(o.label, 'chip', () => triggerAction(p.onAct, { control: i, option: j }), { pressed: intentMatches(o.intent, s), value: j })));
        el.appendChild(group);
      } else if (c.kind === 'slider') {
        const v = sliderView(c.key, s, { unreachable: !!p.unreachable });
        const level = levelEl(c.key, v.step, `${c.label} ${v.readout}`, v.known ? v.now : null, v.min, v.max);
        const steps = mk('div', 'steps');
        steps.appendChild(btn('−', 'dec', () => triggerAction(p.onAct, { control: i, option: 0 }), { cls: 'step', label: `${c.label} down`, attrs: ['data-level-dec'] }));
        const ro = mk('div', 'readout', `${c.label} `);
        ro.appendChild(readoutEl(v.readout));
        steps.appendChild(ro);
        steps.appendChild(btn('+', 'inc', () => triggerAction(p.onAct, { control: i, option: 1 }), { cls: 'step', label: `${c.label} up`, attrs: ['data-level-inc'] }));
        level.appendChild(steps);
        el.appendChild(level);
      } else {
        el.appendChild(mk('div', 'readout', `${c.label ? `${c.label} ` : ''}${readoutText(c.show, s)}`));
      }
    });
    if (p.standard) el.appendChild(mk('p', 'note', STANDARD_CONTROLS_NOTE));
    return el;
  }

  if (node.component === 'SceneTile') {
    const active = !!p.active;
    const el = doc.createElement('div');
    el.className = `mc-fb-tile scene ${active ? 'active' : ''}`;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', String(p.label || 'Scene'));

    const rowTop = doc.createElement('div');
    rowTop.className = 'row';
    const labelSpan = doc.createElement('span');
    labelSpan.className = 'label';
    labelSpan.textContent = String(p.label || 'Scene');
    const stateSpan = doc.createElement('span');
    stateSpan.className = 'state';
    stateSpan.setAttribute('aria-live', 'polite');
    stateSpan.textContent = active ? 'Active' : 'Inactive';
    rowTop.appendChild(labelSpan);
    rowTop.appendChild(stateSpan);
    el.appendChild(rowTop);

    const rowBtns = doc.createElement('div');
    rowBtns.className = 'row';
    const btnAct = doc.createElement('button');
    btnAct.className = 'primary';
    btnAct.textContent = 'Activate';
    btnAct.addEventListener('click', () => triggerAction(p.onActivate));
    rowBtns.appendChild(btnAct);
    el.appendChild(rowBtns);
    return el;
  }

  if (node.component === 'ConnectTile') {
    const el = doc.createElement('div');
    el.className = 'mc-fb-tile connect';
    el.setAttribute('role', 'group');
    const label = p.label ? String(p.label) : 'Connect a device';
    el.setAttribute('aria-label', label);

    const btn = doc.createElement('button');
    btn.className = 'primary';
    btn.textContent = label;
    btn.addEventListener('click', () => triggerAction(p.onConnect));
    el.appendChild(btn);
    return el;
  }

  if (node.component === 'PlanBoard') {
    const el = doc.createElement('div');
    el.className = 'mc-fb-tile plan-board';
    el.textContent = `Floor plan: ${String(p.template || 'studio')}`;
    return el;
  }

  const generic = doc.createElement('div');
  generic.className = `mc-fb-tile generic ${node.component.toLowerCase()}`;
  generic.dataset.id = node.id;
  return generic;
}

/** Renders a full RenderTree into a host element. */
export function renderTreeToDom(
  tree: RenderTree,
  host: HTMLElement,
  opts: { doc?: Document; onAction?: (action: FallbackAction) => void } = {},
): HTMLElement {
  const doc = opts.doc ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) throw new Error('Document unavailable for DOM rendering');

  const wrapper = doc.createElement('div');
  wrapper.className = 'mc-fallback-surface';
  wrapper.dataset.surfaceId = tree.surfaceId;

  if (tree.root) {
    wrapper.appendChild(renderNodeToDom(tree.root, doc, opts.onAction));
  }

  host.appendChild(wrapper);
  return wrapper;
}

export function createFallbackRenderer(opts: FallbackRendererOptions = {}): FallbackRenderer {
  let currentState: FallbackRendererState = { surfaces: {} };
  let currentTrees: Record<string, RenderTree> = {};

  return {
    processMessages(messages: A2uiMessage[]): Record<string, RenderTree> {
      const res = reduceA2uiMessages(currentState, messages);
      currentState = res.state;
      currentTrees = res.trees;
      return currentTrees;
    },

    getTree(surfaceId: string): RenderTree | null {
      return currentTrees[surfaceId] ?? null;
    },

    getState(): FallbackRendererState {
      return deepClone(currentState);
    },

    dispatchAction(action: FallbackAction): void {
      opts.onAction?.(action);
    },

    render(surfaceId: string, hostEl?: HTMLElement): HTMLElement | null {
      const tree = currentTrees[surfaceId];
      const targetHost = hostEl ?? opts.host;
      if (!tree || !targetHost) return null;
      targetHost.innerHTML = '';
      return renderTreeToDom(tree, targetHost, { doc: opts.doc, onAction: opts.onAction });
    },
  };
}
