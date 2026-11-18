// Connect flow (pure): "connect a WiZ bulb" / a pointed-at speaker / a quick
// scan each become a DeviceSpec, and specs become tiles appended to the room's
// surface plan — always before the Connect tile, never past MAX_TILES, never
// duplicating a device that is already on the board.
import { MAX_TILES, type SurfacePlan, type TileSpec } from './surfacePlan';

export type ConnectKind = 'lamp' | 'music' | 'switch';
export interface DeviceSpec { kind: ConnectKind; label: string; deviceId: string }

/** The demo's pointed-at speaker (matches the device store's speaker-1 stub). */
export const POINTED_SPEAKER_SPEC: DeviceSpec = { kind: 'music', label: 'Speaker', deviceId: 'speaker-1' };

const KIND_WORDS: ReadonlyArray<readonly [RegExp, ConnectKind]> = [
  [/\b(bulb|lamp|light)s?\b/, 'lamp'],
  [/\b(speaker|stereo|soundbar|radio)s?\b/, 'music'],
  [/\b(fan|switch|plug|outlet|heater)s?\b/, 'switch'],
];

/** A safe tile/device id from a spoken name: lowercase, hyphens, ≤40 chars. */
function slugId(label: string): string | null {
  const s = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return /^[a-z0-9][a-z0-9-]*$/.test(s) ? s : null;
}

/** A spoken device name → a DeviceSpec, or null when nothing device-like is named. */
export function parseConnectName(text: string): DeviceSpec | null {
  const label = text.trim();
  if (!label) return null;
  const t = label.toLowerCase();
  const kind = KIND_WORDS.find(([re]) => re.test(t))?.[1];
  if (!kind) return null;
  const deviceId = slugId(label);
  return deviceId ? { kind, label, deviceId } : null;
}

export function deviceSpecToTile(spec: DeviceSpec): TileSpec {
  return { type: spec.kind, deviceId: spec.deviceId, label: spec.label };
}

/** What a quick scan of the room proposes (SIM): one lamp, one speaker. */
export function scannedDeviceSpecs(): DeviceSpec[] {
  return [
    { kind: 'lamp', label: 'Desk lamp', deviceId: 'wiz-desk' },
    POINTED_SPEAKER_SPEC,
  ];
}

const tileKey = (t: TileSpec): string | null =>
  t.type === 'lamp' || t.type === 'music' || t.type === 'switch' ? t.deviceId
  : t.type === 'scene' ? `scene:${t.sceneId}`
  : t.type === 'plan' ? `plan:${t.boardId}`
  : null;

/** Pure: a new plan with the tiles appended before the Connect tile. Existing
 *  devices are not duplicated and the plan never grows past MAX_TILES. */
export function addTilesToPlan(plan: SurfacePlan, tiles: readonly TileSpec[]): SurfacePlan {
  const seen = new Set(plan.tiles.map(tileKey).filter((k): k is string => k !== null));
  const front: TileSpec[] = plan.tiles.filter((t) => t.type !== 'connect');
  const connects = plan.tiles.filter((t) => t.type === 'connect');
  for (const t of tiles) {
    const key = tileKey(t);
    if (key && seen.has(key)) continue;
    if (front.length + connects.length >= MAX_TILES) break;
    front.push(t);
    if (key) seen.add(key);
  }
  return { ...plan, tiles: [...front, ...connects] };
}
