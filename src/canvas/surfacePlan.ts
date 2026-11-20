// Smart canvas — the compact "surface plan" that Nano drafts and Gemini
// upgrades. Models never write raw A2UI: they emit this small JSON, which is
// coerced here and expanded deterministically into A2UI v0.9 messages.
import { sanitizeVisualMarkup } from './visualSanitize';

export const PROTOCOL = 'v0.9' as const;
export const ROOM_CATALOG_ID = 'https://mendcraft.web.app/catalogs/smart-canvas/v0.json';
export const MAX_TILES = 6;
export const PLAN_TEMPLATES = ['studio', 'oneRoom', 'twoBedroom'] as const;
export type PlanTemplate = (typeof PLAN_TEMPLATES)[number];

/** Caps on the *nested* part of a plan: top-level tiles are still capped at
 *  MAX_TILES (unchanged), but a container tile can hold a whole sub-tree —
 *  these keep that sub-tree from exploding into something no one can see. */
export const MAX_DEPTH = 4;
export const MAX_NODES = 48;
export const CHART_TYPES = ['bar', 'line', 'ring'] as const;
export type ChartType = (typeof CHART_TYPES)[number];
export const TREND_KINDS = ['up', 'down', 'neutral'] as const;
export type TrendKind = (typeof TREND_KINDS)[number];

export type FormField =
  | { kind: 'toggle'; id: string; label: string; value?: boolean }
  | { kind: 'slider'; id: string; label: string; value?: number; min?: number; max?: number }
  | { kind: 'choice'; id: string; label: string; options: string[]; value?: string };

export type LeafTileSpec =
  | { type: 'lamp'; deviceId: string; label: string }
  | { type: 'plan'; boardId: string; template: PlanTemplate }
  | { type: 'music'; deviceId: string; label: string }
  | { type: 'switch'; deviceId: string; label: string }
  | { type: 'scene'; sceneId: string; label: string }
  | { type: 'connect'; label?: string }
  | { type: 'stat'; label: string; value: string; delta?: string; trend?: TrendKind; spark?: number[] }
  | { type: 'chart'; title: string; chartType: ChartType; series: { label: string; value: number }[] }
  | { type: 'table'; title: string; columns: string[]; rows: string[][]; sortable?: boolean; rowActionLabel?: string }
  | { type: 'form'; title: string; fields: FormField[]; submitLabel: string }
  | { type: 'visual'; title: string; markup: string };

export type TileSpec =
  | LeafTileSpec
  | { type: 'row'; children: TileSpec[] }
  | { type: 'grid'; columns: 2 | 3 | 4; children: TileSpec[] }
  | { type: 'card'; title: string; children: TileSpec[] }
  | { type: 'tabs'; tabs: { label: string; children: TileSpec[] }[] }
  | { type: 'split'; direction: 'row' | 'column'; first: TileSpec[]; second: TileSpec[] };

export const CONTAINER_TYPES = ['row', 'grid', 'card', 'tabs', 'split'] as const;

export interface SurfacePlan {
  kind: 'room' | 'plan';
  title: string;
  tiles: TileSpec[];
}

export interface DeviceState {
  on: boolean;
  brightness: number;
  playing?: boolean;
  trackTitle?: string;
  volume?: number;
  pending?: boolean;
  error?: string;
  /** True once we know this lamp isn't the real WiZ bulb (bridge unreachable). */
  sim?: boolean;
}

export interface SceneState {
  active: boolean;
}

export type A2uiMessage = Record<string, unknown> & { version: typeof PROTOCOL };

export type Coerced<T> = { ok: true; value: T } | { ok: false; error: string };

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[<>]/g, '').trim();
  return t ? t.slice(0, max) : null;
}

function cleanTextList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (out.length >= maxItems) break;
    const t = cleanText(item, maxLen);
    if (t) out.push(t);
  }
  return out;
}

function finiteNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

type TileResult = { ok: true; value: TileSpec | null } | { ok: false; error: string };

function coerceFormField(raw: unknown): FormField | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' && ID_RE.test(o.id) ? o.id : null;
  const label = cleanText(o.label, 40);
  if (!id || !label) return null;
  if (o.kind === 'toggle') return { kind: 'toggle', id, label, value: !!o.value };
  if (o.kind === 'slider') {
    const min = finiteNumber(o.min, 0);
    const max = finiteNumber(o.max, 100);
    const value = finiteNumber(o.value, min);
    return { kind: 'slider', id, label, min, max, value: Math.min(Math.max(value, min), max) };
  }
  if (o.kind === 'choice') {
    const options = cleanTextList(o.options, 8, 24);
    if (!options.length) return null;
    const value = typeof o.value === 'string' && options.includes(o.value) ? o.value : options[0];
    return { kind: 'choice', id, label, options, value };
  }
  return null;
}

/** Recursively validates one tile node (leaf or container). `seen` is the
 *  whole tree's device/scene-id dedupe set (shared across nesting, same as
 *  the flat loop this replaced). `counter.n` enforces MAX_NODES over the
 *  whole tree; `depth` enforces MAX_DEPTH. A `null` value (not an error)
 *  means "valid but a duplicate id — silently skip", same as the old loop's
 *  `continue`. */
function coerceTile(raw: unknown, depth: number, seen: Set<string>, counter: { n: number }): TileResult {
  counter.n++;
  if (counter.n > MAX_NODES) return { ok: false, error: `too many nodes (> ${MAX_NODES})` };
  if (depth > MAX_DEPTH) return { ok: false, error: `nesting too deep (> ${MAX_DEPTH})` };
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'tile is not an object' };
  const o = raw as Record<string, unknown>;

  function coerceChildren(list: unknown, label: string): { ok: true; value: TileSpec[] } | { ok: false; error: string } {
    if (!Array.isArray(list)) return { ok: false, error: `${label} needs a list of children` };
    const out: TileSpec[] = [];
    for (const c of list) {
      const r = coerceTile(c, depth + 1, seen, counter);
      if (!r.ok) return r;
      if (r.value) out.push(r.value);
    }
    return { ok: true, value: out };
  }

  if (o.type === 'lamp' || o.type === 'music' || o.type === 'switch') {
    const deviceId = typeof o.deviceId === 'string' && ID_RE.test(o.deviceId) ? o.deviceId : null;
    if (!deviceId) return { ok: false, error: `${o.type} tile needs a valid deviceId` };
    if (seen.has(deviceId)) return { ok: true, value: null };
    seen.add(deviceId);
    const fallbackLabel = o.type === 'lamp' ? 'Lamp' : o.type === 'music' ? 'Music' : 'Switch';
    return { ok: true, value: { type: o.type, deviceId, label: cleanText(o.label, 40) ?? fallbackLabel } };
  }
  if (o.type === 'plan') {
    const boardId = typeof o.boardId === 'string' && ID_RE.test(o.boardId) ? o.boardId : 'plan-1';
    const template = (PLAN_TEMPLATES as readonly string[]).includes(String(o.template)) ? (o.template as PlanTemplate) : 'studio';
    return { ok: true, value: { type: 'plan', boardId, template } };
  }
  if (o.type === 'scene') {
    const sceneId = typeof o.sceneId === 'string' && ID_RE.test(o.sceneId) ? o.sceneId : null;
    if (!sceneId) return { ok: false, error: 'scene tile needs a valid sceneId' };
    if (seen.has(sceneId)) return { ok: true, value: null };
    seen.add(sceneId);
    return { ok: true, value: { type: 'scene', sceneId, label: cleanText(o.label, 40) ?? 'Scene' } };
  }
  if (o.type === 'connect') {
    return { ok: true, value: { type: 'connect', label: cleanText(o.label, 40) ?? 'Connect a device' } };
  }
  if (o.type === 'stat') {
    const label = cleanText(o.label, 40);
    const value = cleanText(o.value, 24);
    if (!label || !value) return { ok: false, error: 'stat tile needs a label and a value' };
    const trend = (TREND_KINDS as readonly string[]).includes(String(o.trend)) ? (o.trend as TrendKind) : undefined;
    const delta = cleanText(o.delta, 16) ?? undefined;
    const spark = Array.isArray(o.spark) ? o.spark.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)).slice(0, 24) : undefined;
    return { ok: true, value: { type: 'stat', label, value, ...(trend ? { trend } : {}), ...(delta ? { delta } : {}), ...(spark && spark.length ? { spark } : {}) } };
  }
  if (o.type === 'chart') {
    const title = cleanText(o.title, 40);
    if (!title) return { ok: false, error: 'chart tile needs a title' };
    const chartType = (CHART_TYPES as readonly string[]).includes(String(o.chartType)) ? (o.chartType as ChartType) : 'bar';
    const seriesRaw = Array.isArray(o.series) ? o.series.slice(0, 12) : [];
    const series = seriesRaw
      .map((s) => {
        if (!s || typeof s !== 'object') return null;
        const so = s as Record<string, unknown>;
        const label = cleanText(so.label, 24);
        const value = typeof so.value === 'number' && Number.isFinite(so.value) ? so.value : null;
        return label && value !== null ? { label, value } : null;
      })
      .filter((s): s is { label: string; value: number } => s !== null);
    if (!series.length) return { ok: false, error: 'chart tile needs at least one data point' };
    return { ok: true, value: { type: 'chart', title, chartType, series } };
  }
  if (o.type === 'table') {
    const title = cleanText(o.title, 40);
    const columns = cleanTextList(o.columns, 8, 24);
    if (!title || !columns.length) return { ok: false, error: 'table tile needs a title and columns' };
    const rowsRaw = Array.isArray(o.rows) ? o.rows.slice(0, 20) : [];
    const rows = rowsRaw
      .map((row) => (Array.isArray(row) ? cleanTextList(row, columns.length, 60) : []))
      .filter((row) => row.length === columns.length);
    const sortable = !!o.sortable;
    const rowActionLabel = cleanText(o.rowActionLabel, 24) ?? undefined;
    return { ok: true, value: { type: 'table', title, columns, rows, sortable, ...(rowActionLabel ? { rowActionLabel } : {}) } };
  }
  if (o.type === 'form') {
    const title = cleanText(o.title, 40);
    if (!title) return { ok: false, error: 'form tile needs a title' };
    const fields = (Array.isArray(o.fields) ? o.fields.slice(0, 8) : []).map(coerceFormField).filter((f): f is FormField => f !== null);
    if (!fields.length) return { ok: false, error: 'form tile needs at least one field' };
    const submitLabel = cleanText(o.submitLabel, 24) ?? 'Submit';
    return { ok: true, value: { type: 'form', title, fields, submitLabel } };
  }
  if (o.type === 'visual') {
    const title = cleanText(o.title, 40);
    const rawMarkup = typeof o.markup === 'string' ? o.markup.slice(0, 20000) : null;
    if (!title || !rawMarkup) return { ok: false, error: 'visual tile needs a title and markup' };
    // Sanitized here — the earliest point untrusted markup enters the
    // system — so every consumer of a coerced SurfacePlan (both render
    // paths, any echo back into a prompt) only ever sees safe markup.
    // Both render paths re-sanitize again right before innerHTML too
    // (belt and suspenders — see widgets.ts/fallbackRenderer.ts).
    const markup = sanitizeVisualMarkup(rawMarkup).html;
    if (!markup) return { ok: false, error: 'visual tile markup had nothing safe left after sanitizing' };
    return { ok: true, value: { type: 'visual', title, markup } };
  }
  if (o.type === 'row') {
    const children = coerceChildren(o.children, 'row');
    if (!children.ok) return children;
    return { ok: true, value: { type: 'row', children: children.value } };
  }
  if (o.type === 'grid') {
    const columns = o.columns === 2 || o.columns === 3 || o.columns === 4 ? o.columns : 2;
    const children = coerceChildren(o.children, 'grid');
    if (!children.ok) return children;
    return { ok: true, value: { type: 'grid', columns, children: children.value } };
  }
  if (o.type === 'card') {
    const title = cleanText(o.title, 40) ?? '';
    const children = coerceChildren(o.children, 'card');
    if (!children.ok) return children;
    return { ok: true, value: { type: 'card', title, children: children.value } };
  }
  if (o.type === 'tabs') {
    if (!Array.isArray(o.tabs) || !o.tabs.length) return { ok: false, error: 'tabs tile needs at least one tab' };
    const tabs: { label: string; children: TileSpec[] }[] = [];
    for (const t of o.tabs.slice(0, 6)) {
      if (!t || typeof t !== 'object') return { ok: false, error: 'tab is not an object' };
      const to = t as Record<string, unknown>;
      const label = cleanText(to.label, 24) ?? 'Tab';
      const children = coerceChildren(to.children, 'tab');
      if (!children.ok) return children;
      tabs.push({ label, children: children.value });
    }
    return { ok: true, value: { type: 'tabs', tabs } };
  }
  if (o.type === 'split') {
    const direction = o.direction === 'column' ? 'column' : 'row';
    const first = coerceChildren(o.first, 'split.first');
    if (!first.ok) return first;
    const second = coerceChildren(o.second, 'split.second');
    if (!second.ok) return second;
    return { ok: true, value: { type: 'split', direction, first: first.value, second: second.value } };
  }
  return { ok: false, error: `unknown tile type ${String(o.type)}` };
}

/** Untrusted model output -> a valid SurfacePlan, or a reason it was refused. */
export function coerceSurfacePlan(raw: unknown): Coerced<SurfacePlan> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (r.kind !== 'room' && r.kind !== 'plan') return { ok: false, error: `unknown kind ${String(r.kind)}` };
  const title = cleanText(r.title, 60) ?? (r.kind === 'room' ? 'This room' : 'Floor plan');
  if (!Array.isArray(r.tiles)) return { ok: false, error: 'tiles must be a list' };
  if (r.tiles.length > MAX_TILES) return { ok: false, error: `too many tiles (${r.tiles.length} > ${MAX_TILES})` };
  const tiles: TileSpec[] = [];
  const seen = new Set<string>();
  const counter = { n: 0 };
  for (const t of r.tiles) {
    const res = coerceTile(t, 1, seen, counter);
    if (!res.ok) return res;
    if (res.value) tiles.push(res.value);
  }
  if (!tiles.length) return { ok: false, error: 'no tiles' };
  return { ok: true, value: { kind: r.kind, title, tiles } };
}

/** Stable, positional id for a tile's A2UI component — `path` is this tile's
 *  index chain from the plan root (e.g. `[2, 0]` = 3rd top-level tile, its
 *  1st child). Device/scene tiles keep their old id shape (so flat plans —
 *  today's 6-beat demo — expand to byte-identical component ids); container
 *  and new leaf tiles use `${type}-${path.join('-')}`, which is deterministic
 *  across re-expansion of the same plan (expandPlan's determinism contract). */
export function tileComponentId(t: TileSpec, path: number[] = [0]): string {
  if (t.type === 'lamp') return `lamp-${t.deviceId}`;
  if (t.type === 'plan') return `plan-${t.boardId}`;
  if (t.type === 'music') return `music-${t.deviceId}`;
  if (t.type === 'switch') return `switch-${t.deviceId}`;
  if (t.type === 'scene') return `scene-${t.sceneId}`;
  if (t.type === 'connect') return 'connect-tile';
  return `${t.type}-${path.join('-')}`;
}

/** Deterministic: the same plan + state always gives the same messages.
 *  Recurses into container tiles (row/grid/card/tabs/split), emitting one
 *  component per node; every container's `children` (or `tabs[].children` /
 *  `first` / `second`) is an id array, so fallbackRenderer.ts's generic
 *  child-linking (any component with a `children` array gets linked, not
 *  just Column) already renders the whole tree with no changes there. */
export function expandPlan(
  plan: SurfacePlan,
  surfaceId: string,
  devices: Record<string, DeviceState>,
): A2uiMessage[] {
  const components: Record<string, unknown>[] = [];
  const deviceData: Record<string, DeviceState> = {};
  const sceneData: Record<string, SceneState> = {};

  function expandNode(t: TileSpec, path: number[]): string {
    const id = tileComponentId(t, path);
    if (t.type === 'lamp') {
      components.push({
        id,
        component: 'LampTile',
        label: t.label,
        on: { path: `/devices/${t.deviceId}/on` },
        brightness: { path: `/devices/${t.deviceId}/brightness` },
        pending: { path: `/devices/${t.deviceId}/pending` },
        error: { path: `/devices/${t.deviceId}/error` },
        onToggle: { event: { name: 'lamp.toggle', context: { deviceId: t.deviceId } } },
        onBrighter: { event: { name: 'lamp.brighter', context: { deviceId: t.deviceId } } },
        onDimmer: { event: { name: 'lamp.dimmer', context: { deviceId: t.deviceId } } },
        sim: { path: `/devices/${t.deviceId}/sim` },
      });
      const s = devices[t.deviceId] ?? { on: false, brightness: 50 };
      deviceData[t.deviceId] = { on: s.on ?? false, brightness: s.brightness ?? 50, pending: false, error: s.error ?? '', sim: s.sim ?? false };
    } else if (t.type === 'plan') {
      components.push({ id, component: 'PlanBoard', boardId: t.boardId, template: t.template });
    } else if (t.type === 'music') {
      components.push({
        id,
        component: 'MusicTile',
        label: t.label,
        playing: { path: `/devices/${t.deviceId}/playing` },
        trackTitle: { path: `/devices/${t.deviceId}/trackTitle` },
        volume: { path: `/devices/${t.deviceId}/volume` },
        pending: { path: `/devices/${t.deviceId}/pending` },
        error: { path: `/devices/${t.deviceId}/error` },
        onPlayPause: { event: { name: 'music.playPause', context: { deviceId: t.deviceId } } },
        onNext: { event: { name: 'music.next', context: { deviceId: t.deviceId } } },
        onLouder: { event: { name: 'music.louder', context: { deviceId: t.deviceId } } },
        onSofter: { event: { name: 'music.softer', context: { deviceId: t.deviceId } } },
      });
      const s = devices[t.deviceId] ?? {};
      deviceData[t.deviceId] = {
        ...s,
        on: s.on ?? false,
        brightness: s.brightness ?? 0,
        playing: s.playing ?? false,
        trackTitle: s.trackTitle ?? '',
        volume: typeof s.volume === 'number' ? s.volume : 50,
        pending: false,
        error: s.error ?? '',
      };
    } else if (t.type === 'switch') {
      components.push({
        id,
        component: 'SwitchTile',
        label: t.label,
        on: { path: `/devices/${t.deviceId}/on` },
        pending: { path: `/devices/${t.deviceId}/pending` },
        error: { path: `/devices/${t.deviceId}/error` },
        onToggle: { event: { name: 'switch.toggle', context: { deviceId: t.deviceId } } },
      });
      const s = devices[t.deviceId] ?? {};
      deviceData[t.deviceId] = {
        ...s,
        on: s.on ?? false,
        brightness: s.brightness ?? 0,
        pending: false,
        error: s.error ?? '',
      };
    } else if (t.type === 'scene') {
      components.push({
        id,
        component: 'SceneTile',
        label: t.label,
        active: { path: `/scenes/${t.sceneId}/active` },
        onActivate: { event: { name: 'scene.activate', context: { sceneId: t.sceneId } } },
      });
      sceneData[t.sceneId] = { active: false };
    } else if (t.type === 'connect') {
      components.push({
        id,
        component: 'ConnectTile',
        label: t.label ?? 'Connect a device',
        onConnect: { event: { name: 'connect.start' } },
      });
    } else if (t.type === 'stat') {
      components.push({ id, component: 'StatTile', label: t.label, value: t.value, delta: t.delta ?? '', trend: t.trend ?? 'neutral', spark: t.spark ?? [] });
    } else if (t.type === 'chart') {
      components.push({ id, component: 'ChartTile', title: t.title, chartType: t.chartType, series: t.series });
    } else if (t.type === 'table') {
      components.push({
        id,
        component: 'TableTile',
        title: t.title,
        columns: t.columns,
        rows: t.rows,
        sortable: !!t.sortable,
        rowActionLabel: t.rowActionLabel ?? '',
        onRowAction: { event: { name: 'table.rowAction', context: { tableId: id } } },
      });
    } else if (t.type === 'form') {
      components.push({
        id,
        component: 'FormTile',
        title: t.title,
        fields: t.fields,
        submitLabel: t.submitLabel,
        onSubmit: { event: { name: 'form.submit', context: { formId: id } } },
      });
    } else if (t.type === 'visual') {
      components.push({
        id,
        component: 'VisualTile',
        title: t.title,
        markup: t.markup,
        onAction: { event: { name: 'visual.action', context: { visualId: id } } },
      });
    } else if (t.type === 'row') {
      const childIds = t.children.map((c, i) => expandNode(c, [...path, i]));
      components.push({ id, component: 'Row', children: childIds });
    } else if (t.type === 'grid') {
      const childIds = t.children.map((c, i) => expandNode(c, [...path, i]));
      components.push({ id, component: 'Grid', columns: t.columns, children: childIds });
    } else if (t.type === 'card') {
      const childIds = t.children.map((c, i) => expandNode(c, [...path, i]));
      components.push({ id, component: 'Card', title: t.title, children: childIds });
    } else if (t.type === 'tabs') {
      const tabs = t.tabs.map((tab, i) => ({ label: tab.label, children: tab.children.map((c, j) => expandNode(c, [...path, i, j])) }));
      components.push({ id, component: 'Tabs', tabs });
    } else if (t.type === 'split') {
      const firstIds = t.first.map((c, i) => expandNode(c, [...path, 0, i]));
      const secondIds = t.second.map((c, i) => expandNode(c, [...path, 1, i]));
      components.push({ id, component: 'Split', direction: t.direction, first: firstIds, second: secondIds });
    }
    return id;
  }

  const tileIds = plan.tiles.map((t, i) => expandNode(t, [i]));
  components.unshift(
    { id: 'root', component: 'Column', children: ['title', ...tileIds] },
    { id: 'title', component: 'Text', text: plan.title, variant: 'h2' },
  );

  const msgs: A2uiMessage[] = [
    { version: PROTOCOL, createSurface: { surfaceId, catalogId: ROOM_CATALOG_ID } },
    { version: PROTOCOL, updateComponents: { surfaceId, components } },
    { version: PROTOCOL, updateDataModel: { surfaceId, path: '/devices', value: deviceData } },
  ];
  if (Object.keys(sceneData).length > 0) {
    msgs.push({ version: PROTOCOL, updateDataModel: { surfaceId, path: '/scenes', value: sceneData } });
  }
  return msgs;
}

/** One device's live state as a data-model update (store -> tile). */
export function deviceUpdate(surfaceId: string, deviceId: string, s: DeviceState): A2uiMessage {
  const value: Record<string, unknown> = {
    pending: !!s.pending,
    error: s.error ?? '',
  };
  if (s.on !== undefined) value.on = s.on;
  if (s.brightness !== undefined) value.brightness = s.brightness;
  if (s.playing !== undefined) value.playing = s.playing;
  if (s.trackTitle !== undefined) value.trackTitle = s.trackTitle;
  if (s.volume !== undefined) value.volume = s.volume;
  if (s.sim !== undefined) value.sim = s.sim;

  return {
    version: PROTOCOL,
    updateDataModel: {
      surfaceId,
      path: `/devices/${deviceId}`,
      value,
    },
  };
}
