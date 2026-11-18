// Smart canvas — the compact "surface plan" that Nano drafts and Gemini
// upgrades. Models never write raw A2UI: they emit this small JSON, which is
// coerced here and expanded deterministically into A2UI v0.9 messages.

export const PROTOCOL = 'v0.9' as const;
export const ROOM_CATALOG_ID = 'https://mendcraft.web.app/catalogs/smart-canvas/v0.json';
export const MAX_TILES = 6;
export const PLAN_TEMPLATES = ['studio', 'oneRoom', 'twoBedroom'] as const;
export type PlanTemplate = (typeof PLAN_TEMPLATES)[number];

export type TileSpec =
  | { type: 'lamp'; deviceId: string; label: string }
  | { type: 'plan'; boardId: string; template: PlanTemplate }
  | { type: 'music'; deviceId: string; label: string }
  | { type: 'switch'; deviceId: string; label: string }
  | { type: 'scene'; sceneId: string; label: string }
  | { type: 'connect'; label?: string };

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
  for (const t of r.tiles) {
    if (!t || typeof t !== 'object') return { ok: false, error: 'tile is not an object' };
    const o = t as Record<string, unknown>;
    if (o.type === 'lamp') {
      const deviceId = typeof o.deviceId === 'string' && ID_RE.test(o.deviceId) ? o.deviceId : null;
      if (!deviceId) return { ok: false, error: 'lamp tile needs a valid deviceId' };
      if (seen.has(deviceId)) continue;
      seen.add(deviceId);
      tiles.push({ type: 'lamp', deviceId, label: cleanText(o.label, 40) ?? 'Lamp' });
    } else if (o.type === 'plan') {
      const boardId = typeof o.boardId === 'string' && ID_RE.test(o.boardId) ? o.boardId : 'plan-1';
      const template = (PLAN_TEMPLATES as readonly string[]).includes(String(o.template)) ? (o.template as PlanTemplate) : 'studio';
      tiles.push({ type: 'plan', boardId, template });
    } else if (o.type === 'music') {
      const deviceId = typeof o.deviceId === 'string' && ID_RE.test(o.deviceId) ? o.deviceId : null;
      if (!deviceId) return { ok: false, error: 'music tile needs a valid deviceId' };
      if (seen.has(deviceId)) continue;
      seen.add(deviceId);
      tiles.push({ type: 'music', deviceId, label: cleanText(o.label, 40) ?? 'Music' });
    } else if (o.type === 'switch') {
      const deviceId = typeof o.deviceId === 'string' && ID_RE.test(o.deviceId) ? o.deviceId : null;
      if (!deviceId) return { ok: false, error: 'switch tile needs a valid deviceId' };
      if (seen.has(deviceId)) continue;
      seen.add(deviceId);
      tiles.push({ type: 'switch', deviceId, label: cleanText(o.label, 40) ?? 'Switch' });
    } else if (o.type === 'scene') {
      const sceneId = typeof o.sceneId === 'string' && ID_RE.test(o.sceneId) ? o.sceneId : null;
      if (!sceneId) return { ok: false, error: 'scene tile needs a valid sceneId' };
      if (seen.has(sceneId)) continue;
      seen.add(sceneId);
      tiles.push({ type: 'scene', sceneId, label: cleanText(o.label, 40) ?? 'Scene' });
    } else if (o.type === 'connect') {
      tiles.push({ type: 'connect', label: cleanText(o.label, 40) ?? 'Connect a device' });
    } else {
      return { ok: false, error: `unknown tile type ${String(o.type)}` };
    }
  }
  if (!tiles.length) return { ok: false, error: 'no tiles' };
  return { ok: true, value: { kind: r.kind, title, tiles } };
}

export function tileComponentId(t: TileSpec): string {
  if (t.type === 'lamp') return `lamp-${t.deviceId}`;
  if (t.type === 'plan') return `plan-${t.boardId}`;
  if (t.type === 'music') return `music-${t.deviceId}`;
  if (t.type === 'switch') return `switch-${t.deviceId}`;
  if (t.type === 'scene') return `scene-${t.sceneId}`;
  return 'connect-tile';
}

/** Deterministic: the same plan + state always gives the same messages. */
export function expandPlan(
  plan: SurfacePlan,
  surfaceId: string,
  devices: Record<string, DeviceState>,
): A2uiMessage[] {
  const tileIds = plan.tiles.map(tileComponentId);
  const components: Record<string, unknown>[] = [
    { id: 'root', component: 'Column', children: ['title', ...tileIds] },
    { id: 'title', component: 'Text', text: plan.title, variant: 'h2' },
  ];
  const deviceData: Record<string, DeviceState> = {};
  const sceneData: Record<string, SceneState> = {};

  for (const t of plan.tiles) {
    if (t.type === 'lamp') {
      components.push({
        id: tileComponentId(t),
        component: 'LampTile',
        label: t.label,
        on: { path: `/devices/${t.deviceId}/on` },
        brightness: { path: `/devices/${t.deviceId}/brightness` },
        pending: { path: `/devices/${t.deviceId}/pending` },
        error: { path: `/devices/${t.deviceId}/error` },
        onToggle: { event: { name: 'lamp.toggle', context: { deviceId: t.deviceId } } },
        onBrighter: { event: { name: 'lamp.brighter', context: { deviceId: t.deviceId } } },
        onDimmer: { event: { name: 'lamp.dimmer', context: { deviceId: t.deviceId } } },
      });
      const s = devices[t.deviceId] ?? { on: false, brightness: 50 };
      deviceData[t.deviceId] = { on: s.on ?? false, brightness: s.brightness ?? 50, pending: false, error: s.error ?? '' };
    } else if (t.type === 'plan') {
      components.push({ id: tileComponentId(t), component: 'PlanBoard', boardId: t.boardId, template: t.template });
    } else if (t.type === 'music') {
      components.push({
        id: tileComponentId(t),
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
        id: tileComponentId(t),
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
        id: tileComponentId(t),
        component: 'SceneTile',
        label: t.label,
        active: { path: `/scenes/${t.sceneId}/active` },
        onActivate: { event: { name: 'scene.activate', context: { sceneId: t.sceneId } } },
      });
      sceneData[t.sceneId] = { active: false };
    } else if (t.type === 'connect') {
      components.push({
        id: tileComponentId(t),
        component: 'ConnectTile',
        label: t.label ?? 'Connect a device',
        onConnect: { event: { name: 'connect.start' } },
      });
    }
  }

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

  return {
    version: PROTOCOL,
    updateDataModel: {
      surfaceId,
      path: `/devices/${deviceId}`,
      value,
    },
  };
}
