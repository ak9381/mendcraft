// Pure builders for the CONNECT AI turns, reusing aiTurn's SurfaceRequest / SentInfo shape.
// (a) pointConnect(deviceGuess) -> scripted Gemini JSON proposing ONE tile, receipt "1 photo of what you pointed at, your words"
// (b) roomScan(found[]) -> scripted JSON proposing one tile per device, receipt "5 photos of the room"
// (c) byName(utterance) -> uses identify.ts identityFromWords/deviceNameIn to propose the tile, Nano-only (receipt null)
// Plus mergeTiles(plan, newTiles) that adds tiles to an existing room SurfacePlan without duplicates and within MAX_TILES.

import {
  MAX_TILES,
  tileComponentId,
  type SurfacePlan,
  type TileSpec,
} from './surfacePlan';
import {
  scriptedEngine,
  type DeviceHint,
  type SentInfo,
  type SurfaceEngine,
  type SurfaceRequest,
} from './aiTurn';
import { deviceNameIn, identityFromWords, isAddDevicePhrase } from '../devices/identify';
import type { FoundDevice } from '../devices/addDeviceFlow';

export type DeviceGuess =
  | string
  | { kind?: string; label?: string; id?: string; brand?: string };

export type FoundDeviceItem =
  | string
  | DeviceHint
  | FoundDevice
  | { id?: string; label?: string; name?: string; kind?: string; host?: string };

export interface ConnectTurnResult {
  sent: SentInfo;
  json: string;
  plan: SurfacePlan;
  request: SurfaceRequest;
  engine: SurfaceEngine;
}

function toValidId(raw: string, fallback: string): string {
  const clean = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(clean) ? clean : fallback;
}

export type DeviceTileSpec =
  | { type: 'lamp'; deviceId: string; label: string }
  | { type: 'music'; deviceId: string; label: string }
  | { type: 'switch'; deviceId: string; label: string };

function mapKindToTile(kind: string, label: string, explicitId?: string): DeviceTileSpec {
  const k = kind.toLowerCase();
  const baseLabel = label.trim() || 'Device';
  if (k === 'speaker' || k === 'music') {
    return {
      type: 'music',
      deviceId: toValidId(explicitId ?? baseLabel, 'speaker-1'),
      label: baseLabel,
    };
  }
  if (k === 'plug' || k === 'switch' || k === 'fan' || k === 'tv' || k === 'ac') {
    return {
      type: 'switch',
      deviceId: toValidId(explicitId ?? baseLabel, 'switch-1'),
      label: baseLabel,
    };
  }
  return {
    type: 'lamp',
    deviceId: toValidId(explicitId ?? baseLabel, 'lamp-1'),
    label: baseLabel,
  };
}

export function pointConnect(
  deviceGuess?: DeviceGuess,
  opts: { frameTitle?: string; sim?: boolean } = {},
): ConnectTurnResult {
  let kind = 'lamp';
  let label = 'Lamp';
  let id: string | undefined;

  if (typeof deviceGuess === 'string') {
    const raw = deviceGuess.trim().toLowerCase();
    if (raw === 'speaker' || raw === 'music') {
      kind = 'speaker';
      label = 'Speaker';
      id = 'speaker-1';
    } else {
      kind = 'lamp';
      label = deviceGuess.trim() || 'Lamp';
      id = toValidId(label, 'lamp-1');
    }
  } else if (deviceGuess && typeof deviceGuess === 'object') {
    kind = deviceGuess.kind ?? 'lamp';
    label = deviceGuess.label ?? (kind === 'speaker' ? 'Speaker' : 'Lamp');
    id = deviceGuess.id ? toValidId(deviceGuess.id, 'device-1') : undefined;
  }

  const tile = mapKindToTile(kind, label, id);
  const title = opts.frameTitle ?? 'This room';
  const plan: SurfacePlan = {
    kind: 'room',
    title,
    tiles: [tile],
  };
  const json = JSON.stringify(plan, null, 2);

  const sentReceipt = '1 photo of what you pointed at, your words';
  const sim = opts.sim ?? true;
  const routeLine = sim
    ? `SIM · Gemini · cloud — ${sentReceipt}`
    : `Gemini · cloud — ${sentReceipt}`;

  const sent: SentInfo = {
    engine: 'gemini',
    prompt: `You build one board on a smart canvas. Propose 1 tile to add for the device you see pointed at: ${tile.label} (${tile.type}).`,
    sent: sentReceipt,
    routeLine,
    sim,
  };

  const request: SurfaceRequest = {
    utterance: 'connect what I am pointing at',
    frameTitle: title,
    devices: [{ id: tile.deviceId, label: tile.label, kind: tile.type }],
  };

  return {
    sent,
    json,
    plan,
    request,
    engine: scriptedEngine('gemini', json),
  };
}

export function roomScan(
  found: FoundDeviceItem[] = [],
  opts: { frameTitle?: string; sim?: boolean } = {},
): ConnectTurnResult {
  const title = opts.frameTitle ?? 'This room';
  const tiles: DeviceTileSpec[] = [];
  const seenIds = new Set<string>();

  const items = found.length > 0 ? found : [{ id: 'room-light', label: 'Room light', kind: 'smart-bulb' }];

  for (let i = 0; i < items.length && tiles.length < MAX_TILES; i++) {
    const item = items[i];
    let kind = 'lamp';
    let label = `Device ${i + 1}`;
    let rawId: string | undefined;

    if (typeof item === 'string') {
      label = item;
      kind = item.toLowerCase().includes('speaker') ? 'speaker' : 'lamp';
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      kind = typeof obj.kind === 'string' ? obj.kind : 'lamp';
      label =
        typeof obj.label === 'string'
          ? obj.label
          : typeof obj.name === 'string'
          ? obj.name
          : `Device ${i + 1}`;
      rawId = typeof obj.id === 'string' ? obj.id : typeof obj.host === 'string' ? obj.host : undefined;
    }

    const tile = mapKindToTile(kind, label, rawId ? toValidId(rawId, `device-${i + 1}`) : undefined);
    const did = tile.deviceId;
    if (seenIds.has(did)) {
      tile.deviceId = `${did}-${i + 1}`;
    }
    seenIds.add(tile.deviceId);
    tiles.push(tile);
  }

  const plan: SurfacePlan = {
    kind: 'room',
    title,
    tiles,
  };
  const json = JSON.stringify(plan, null, 2);

  const sentReceipt = '5 photos of the room';
  const sim = opts.sim ?? true;
  const routeLine = sim
    ? `SIM · Gemini · cloud — ${sentReceipt}`
    : `Gemini · cloud — ${sentReceipt}`;

  const sent: SentInfo = {
    engine: 'gemini',
    prompt: `You build one board on a smart canvas. Propose tiles for devices scanned across 5 camera frames: ${tiles.map((t) => t.label).join(', ')}.`,
    sent: sentReceipt,
    routeLine,
    sim,
  };

  const request: SurfaceRequest = {
    utterance: 'scan the room',
    frameTitle: title,
    devices: tiles.map((t) => ({ id: t.deviceId, label: t.label, kind: t.type })),
  };

  return {
    sent,
    json,
    plan,
    request,
    engine: scriptedEngine('gemini', json),
  };
}

export function byName(
  utterance: string,
  opts: { frameTitle?: string; sim?: boolean; devices?: DeviceHint[] } = {},
): ConnectTurnResult | null {
  const idFromWords = identityFromWords(utterance);
  const nameInWords = deviceNameIn(utterance);

  if (!idFromWords && !nameInWords) {
    return null;
  }

  const kind = idFromWords?.kind ?? nameInWords!.kind;
  const label = idFromWords?.label ?? (nameInWords!.name.charAt(0).toUpperCase() + nameInWords!.name.slice(1));

  // A known device whose label she named wins over minting a new id, so
  // "connect the speaker" lands on the real speaker-1 instead of a dead tile.
  const said = utterance.toLowerCase();
  const known = opts.devices?.find((d) => d.label && said.includes(d.label.toLowerCase()));
  const tile = known ? mapKindToTile(known.kind, known.label, known.id) : mapKindToTile(kind, label);
  const title = opts.frameTitle ?? 'This room';
  const plan: SurfacePlan = {
    kind: 'room',
    title,
    tiles: [tile],
  };
  const json = JSON.stringify(plan, null, 2);

  const sim = opts.sim ?? false;
  const routeLine = sim
    ? 'SIM · Nano · on device — nothing left this device'
    : 'Nano · on device — nothing left this device';

  const sent: SentInfo = {
    engine: 'nano',
    prompt: `You build one board on a smart canvas. Propose 1 tile for: "${utterance}".`,
    sent: null,
    routeLine,
    sim,
  };

  const request: SurfaceRequest = {
    utterance,
    frameTitle: title,
    devices: [{ id: tile.deviceId, label: tile.label, kind: tile.type }],
  };

  return {
    sent,
    json,
    plan,
    request,
    engine: scriptedEngine('nano', json),
  };
}

/** Route a spoken connect ask: a generic "connect a device" opens the sheet,
 *  a named "connect the speaker" becomes a by-name Nano turn, anything else
 *  (room-connect, device commands) is not ours. */
export function connectAsk(text: string): 'sheet' | 'byName' | null {
  if (!isAddDevicePhrase(text)) return null;
  return deviceNameIn(text) ? 'byName' : 'sheet';
}

export function mergeTiles(plan: SurfacePlan, newTiles: TileSpec[]): SurfacePlan {
  const existing = [...plan.tiles];
  const seen = new Set<string>();

  for (const t of existing) {
    seen.add(tileComponentId(t));
    if ('deviceId' in t && t.deviceId) {
      seen.add(`dev:${t.deviceId}`);
    }
  }

  const merged = [...existing];
  for (const t of newTiles) {
    if (merged.length >= MAX_TILES) break;
    const cid = tileComponentId(t);
    const did = 'deviceId' in t && t.deviceId ? `dev:${t.deviceId}` : null;
    if (seen.has(cid) || (did && seen.has(did))) continue;

    seen.add(cid);
    if (did) seen.add(did);
    merged.push(t);
  }

  return {
    kind: plan.kind ?? 'room',
    title: plan.title,
    tiles: merged,
  };
}
