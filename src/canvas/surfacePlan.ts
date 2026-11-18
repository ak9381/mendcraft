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
  | { type: 'plan'; boardId: string; template: PlanTemplate };

export interface SurfacePlan {
  kind: 'room' | 'plan';
  title: string;
  tiles: TileSpec[];
}

export interface DeviceState {
  on: boolean;
  brightness: number;
  pending?: boolean;
  error?: string;
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
    } else {
      return { ok: false, error: `unknown tile type ${String(o.type)}` };
    }
  }
  if (!tiles.length) return { ok: false, error: 'no tiles' };
  return { ok: true, value: { kind: r.kind, title, tiles } };
}

export function tileComponentId(t: TileSpec): string {
  return t.type === 'lamp' ? `lamp-${t.deviceId}` : `plan-${t.boardId}`;
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
      deviceData[t.deviceId] = { on: s.on, brightness: s.brightness, pending: false, error: s.error ?? '' } as DeviceState;
    } else {
      components.push({ id: tileComponentId(t), component: 'PlanBoard', boardId: t.boardId, template: t.template });
    }
  }
  return [
    { version: PROTOCOL, createSurface: { surfaceId, catalogId: ROOM_CATALOG_ID } },
    { version: PROTOCOL, updateComponents: { surfaceId, components } },
    { version: PROTOCOL, updateDataModel: { surfaceId, path: '/devices', value: deviceData } },
  ];
}

/** One device's live state as a data-model update (store -> tile). */
export function deviceUpdate(surfaceId: string, deviceId: string, s: DeviceState): A2uiMessage {
  return {
    version: PROTOCOL,
    updateDataModel: {
      surfaceId,
      path: `/devices/${deviceId}`,
      value: { on: s.on, brightness: s.brightness, pending: !!s.pending, error: s.error ?? '' },
    },
  };
}
