// Fallback A2UI renderer: takes the SAME gated A2UI messages
// (createSurface / updateComponents / updateDataModel / deleteSurface)
// and renders Column, Text, LampTile, PlanBoard, MusicTile, SwitchTile,
// SceneTile, ConnectTile into a host element without @a2ui/lit (plain DOM).
//
// Pure part: message reducer to a render tree with resolved bindings.
import type { A2uiMessage } from './surfacePlan';

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

  // Link children if specified in root/column
  for (const comp of Object.values(surface.components)) {
    const rawChildren = comp.children;
    if (Array.isArray(rawChildren)) {
      const parentNode = nodesById[comp.id];
      if (parentNode) {
        parentNode.children = rawChildren
          .map((cid) => (typeof cid === 'string' ? nodesById[cid] : null))
          .filter((n): n is RenderNode => n !== null && n !== undefined);
      }
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
function renderNodeToDom(
  node: RenderNode,
  doc: Document,
  onAction?: (action: FallbackAction) => void,
): HTMLElement {
  const p = node.props;

  function triggerAction(act: unknown): void {
    if (act && typeof act === 'object' && 'event' in act) {
      const ev = (act as { event: FallbackAction }).event;
      onAction?.(ev);
    }
  }

  if (node.component === 'Column') {
    const el = doc.createElement('div');
    el.className = 'mc-fb-column';
    el.style.display = 'grid';
    el.style.gap = '16px';
    if (node.children) {
      for (const child of node.children) {
        el.appendChild(renderNodeToDom(child, doc, onAction));
      }
    }
    return el;
  }

  if (node.component === 'Text') {
    const tag = p.variant === 'h1' ? 'h1' : p.variant === 'h2' ? 'h2' : 'p';
    const el = doc.createElement(tag);
    el.className = `mc-fb-text ${String(p.variant || 'body')}`;
    el.textContent = p.text ? String(p.text) : '';
    return el;
  }

  if (node.component === 'LampTile') {
    const on = !!p.on;
    const brightness = typeof p.brightness === 'number' ? p.brightness : 0;
    const el = doc.createElement('div');
    el.className = `mc-fb-tile lamp ${on ? 'on' : ''}`;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', String(p.label || 'Lamp'));

    const rowTop = doc.createElement('div');
    rowTop.className = 'row';
    const labelSpan = doc.createElement('span');
    labelSpan.className = 'label';
    labelSpan.textContent = String(p.label || 'Lamp');
    const stateSpan = doc.createElement('span');
    stateSpan.className = 'state';
    stateSpan.setAttribute('aria-live', 'polite');
    stateSpan.textContent = on ? `On · ${brightness}%` : 'Off';
    rowTop.appendChild(labelSpan);
    rowTop.appendChild(stateSpan);
    el.appendChild(rowTop);

    const meter = doc.createElement('div');
    meter.className = 'meter';
    meter.setAttribute('aria-hidden', 'true');
    const bar = doc.createElement('i');
    bar.style.width = `${on ? brightness : 0}%`;
    meter.appendChild(bar);
    el.appendChild(meter);

    const rowBtns = doc.createElement('div');
    rowBtns.className = 'row';

    const btnToggle = doc.createElement('button');
    btnToggle.className = 'primary';
    btnToggle.textContent = on ? 'Turn off' : 'Turn on';
    btnToggle.addEventListener('click', () => triggerAction(p.onToggle));
    rowBtns.appendChild(btnToggle);

    if (p.onDimmer) {
      const btnDimmer = doc.createElement('button');
      btnDimmer.textContent = 'Dimmer';
      btnDimmer.addEventListener('click', () => triggerAction(p.onDimmer));
      rowBtns.appendChild(btnDimmer);
    }
    if (p.onBrighter) {
      const btnBrighter = doc.createElement('button');
      btnBrighter.textContent = 'Brighter';
      btnBrighter.addEventListener('click', () => triggerAction(p.onBrighter));
      rowBtns.appendChild(btnBrighter);
    }
    el.appendChild(rowBtns);
    return el;
  }

  if (node.component === 'MusicTile') {
    const playing = !!p.playing;
    const vol = typeof p.volume === 'number' ? Math.max(0, Math.min(100, Math.round(p.volume))) : 50;
    const track = p.trackTitle ? String(p.trackTitle) : '';
    const el = doc.createElement('div');
    el.className = `mc-fb-tile music ${playing ? 'playing' : ''}`;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', String(p.label || 'Music'));

    const rowTop = doc.createElement('div');
    rowTop.className = 'row';
    const labelSpan = doc.createElement('span');
    labelSpan.className = 'label';
    labelSpan.textContent = String(p.label || 'Music');
    const stateSpan = doc.createElement('span');
    stateSpan.className = 'state';
    stateSpan.setAttribute('aria-live', 'polite');
    stateSpan.textContent = `${playing ? 'Playing' : 'Paused'}${track ? ` · ${track}` : ''} · ${vol}%`;
    rowTop.appendChild(labelSpan);
    rowTop.appendChild(stateSpan);
    el.appendChild(rowTop);

    const meter = doc.createElement('div');
    meter.className = 'meter';
    meter.setAttribute('aria-hidden', 'true');
    const bar = doc.createElement('i');
    bar.style.width = `${vol}%`;
    meter.appendChild(bar);
    el.appendChild(meter);

    const rowBtns = doc.createElement('div');
    rowBtns.className = 'row';

    const btnPlay = doc.createElement('button');
    btnPlay.className = 'primary';
    btnPlay.textContent = playing ? 'Pause' : 'Play';
    btnPlay.addEventListener('click', () => triggerAction(p.onPlayPause));
    rowBtns.appendChild(btnPlay);

    if (p.onSofter) {
      const btnSofter = doc.createElement('button');
      btnSofter.textContent = 'Softer';
      btnSofter.addEventListener('click', () => triggerAction(p.onSofter));
      rowBtns.appendChild(btnSofter);
    }
    if (p.onLouder) {
      const btnLouder = doc.createElement('button');
      btnLouder.textContent = 'Louder';
      btnLouder.addEventListener('click', () => triggerAction(p.onLouder));
      rowBtns.appendChild(btnLouder);
    }
    if (p.onNext) {
      const btnNext = doc.createElement('button');
      btnNext.textContent = 'Next';
      btnNext.addEventListener('click', () => triggerAction(p.onNext));
      rowBtns.appendChild(btnNext);
    }
    el.appendChild(rowBtns);
    return el;
  }

  if (node.component === 'SwitchTile') {
    const on = !!p.on;
    const el = doc.createElement('div');
    el.className = `mc-fb-tile switch ${on ? 'on' : ''}`;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', String(p.label || 'Switch'));

    const rowTop = doc.createElement('div');
    rowTop.className = 'row';
    const labelSpan = doc.createElement('span');
    labelSpan.className = 'label';
    labelSpan.textContent = String(p.label || 'Switch');
    const stateSpan = doc.createElement('span');
    stateSpan.className = 'state';
    stateSpan.setAttribute('aria-live', 'polite');
    stateSpan.textContent = on ? 'On' : 'Off';
    rowTop.appendChild(labelSpan);
    rowTop.appendChild(stateSpan);
    el.appendChild(rowTop);

    const rowBtns = doc.createElement('div');
    rowBtns.className = 'row';
    const btnToggle = doc.createElement('button');
    btnToggle.className = 'primary';
    btnToggle.textContent = on ? 'Turn off' : 'Turn on';
    btnToggle.addEventListener('click', () => triggerAction(p.onToggle));
    rowBtns.appendChild(btnToggle);
    el.appendChild(rowBtns);
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
