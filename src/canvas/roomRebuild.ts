// A room turn ("build the dashboard", "connect everything in this room") is
// about the devices that are really here. Two rules hold whatever the model
// wrote — on-device draft, Gemini improvement or a Gemini handoff alike:
//
//  1. The model is told about every device that answers right now: the
//     managed WiZ lamps the bridge really found (not a remembered bulb that
//     is "Not reachable"), the speaker, and any other device in the store.
//  2. A rebuild never drops a device tile that is still real. A device tile
//     the board already had (its device is still in the device list) is put
//     back when the reply left it out; a device that answers but is on no
//     tile gets one; the gimbal tile stays (or joins, while the paired
//     iPhone reports a stand). What was put back is listed, so the review
//     can say so — the diff against the old board stays honest.
import type { DeviceHint } from './aiTurn';
import { isManagedLampId } from './realLamps';
import { GIMBAL_TILE_LABEL } from './gimbalTile';
import { MAX_TILES, type DeviceState, type SurfacePlan, type TileSpec } from './surfacePlan';

type DeviceTile = Extract<TileSpec, { deviceId: string }>;
const isDeviceTile = (t: TileSpec): t is DeviceTile => t.type === 'lamp' || t.type === 'music' || t.type === 'switch';

function childrenOf(t: TileSpec): TileSpec[] | null {
  switch (t.type) {
    case 'row': case 'grid': case 'card': return t.children;
    case 'tabs': return t.tabs.flatMap((tab) => tab.children);
    case 'split': return [...t.first, ...t.second];
    default: return null;
  }
}

/** Every leaf tile, in reading order, through every group. */
export function leafTiles(tiles: readonly TileSpec[]): TileSpec[] {
  const out: TileSpec[] = [];
  const walk = (ts: readonly TileSpec[]): void => {
    for (const t of ts) { const kids = childrenOf(t); if (kids) walk(kids); else out.push(t); }
  };
  walk(tiles);
  return out;
}

/** The devices that answer right now, for a room turn's prompt. A managed
 *  lamp counts only while it is reachable (and, on a live canvas, only once
 *  the bridge has really found it — a remembered SIM placeholder does not);
 *  every other device in the store (the speaker, a switch) counts. */
export function answeringDevices(all: Record<string, DeviceState>, o: { label: (id: string) => string; kind: (id: string) => string; live: boolean }): DeviceHint[] {
  const out: DeviceHint[] = [];
  for (const [id, d] of Object.entries(all)) {
    if (isManagedLampId(id) && (d.unreachable || (o.live && d.sim))) continue;
    out.push({ id, label: o.label(id), kind: o.kind(id) });
  }
  return out;
}

function tileTypeFor(kind: string): 'lamp' | 'music' | 'switch' {
  const k = kind.toLowerCase();
  if (k === 'music' || k === 'speaker') return 'music';
  if (k === 'switch' || k === 'plug' || k === 'fan' || k === 'tv' || k === 'ac') return 'switch';
  return 'lamp';
}

export interface KeepRoomDevicesInput {
  /** The board as it is now (null: a blank board). */
  before: SurfacePlan | null;
  /** The devices that answer now (answeringDevices). */
  answering: readonly DeviceHint[];
  /** Every device id still in the device list (a tile for one is "still real"). */
  known: ReadonlySet<string>;
  /** The paired iPhone reports a stand right now. */
  stand: boolean;
}

export interface KeptRoom {
  plan: SurfacePlan;
  /** Tiles the board had that the reply left out, put back (their labels). */
  restored: string[];
  /** Devices that answer but were on no tile, given one (their labels). */
  added: string[];
}

/** The model's room plan with every real device tile kept (see the header).
 *  The same plan object when nothing had to change; never touches a floor
 *  plan. Extra tiles go after the reply's own tiles, before its Connect
 *  button; when the board has no top-level room left they share one row. */
export function keepRoomDevices(proposed: SurfacePlan, i: KeepRoomDevicesInput): KeptRoom {
  if (proposed.kind !== 'room') return { plan: proposed, restored: [], added: [] };
  const leaves = leafTiles(proposed.tiles);
  const shown = new Set(leaves.filter(isDeviceTile).map((t) => t.deviceId));
  const hasGimbal = leaves.some((t) => t.type === 'gimbal');
  const extra: TileSpec[] = [];
  const restored: string[] = [];
  const added: string[] = [];
  const beforeLeaves = i.before ? leafTiles(i.before.tiles) : [];
  for (const t of beforeLeaves) {
    if (!isDeviceTile(t) || shown.has(t.deviceId) || !i.known.has(t.deviceId)) continue;
    shown.add(t.deviceId);
    extra.push(t);
    restored.push(t.label);
  }
  for (const d of i.answering) {
    if (shown.has(d.id)) continue;
    shown.add(d.id);
    extra.push({ type: tileTypeFor(d.kind), deviceId: d.id, label: d.label });
    added.push(d.label);
  }
  const hadGimbal = beforeLeaves.some((t) => t.type === 'gimbal');
  if (!hasGimbal && (hadGimbal || i.stand)) {
    const old = beforeLeaves.find((t) => t.type === 'gimbal');
    extra.push(old ?? { type: 'gimbal', label: GIMBAL_TILE_LABEL });
    (hadGimbal ? restored : added).push(GIMBAL_TILE_LABEL);
  }
  if (!extra.length) return { plan: proposed, restored, added };

  let tiles = [...proposed.tiles];
  // Real devices are on the board now: a Connect button stays only if there
  // is room for it (it is the one tile that can go).
  const connectAt = tiles.findIndex((t) => t.type === 'connect');
  const room = MAX_TILES - tiles.length;
  if (extra.length <= room) {
    tiles.splice(connectAt < 0 ? tiles.length : connectAt, 0, ...extra);
  } else {
    if (room <= 0 && connectAt >= 0) tiles.splice(connectAt, 1);
    const at = tiles.findIndex((t) => t.type === 'connect');
    const group: TileSpec = { type: 'row', children: extra };
    if (tiles.length < MAX_TILES) tiles.splice(at < 0 ? tiles.length : at, 0, group);
    else {
      // Still full: the extras join the last top-level tile's own row.
      const last = tiles[tiles.length - 1];
      tiles = [...tiles.slice(0, -1), { type: 'row', children: [last, ...extra] }];
    }
  }
  return { plan: { ...proposed, tiles }, restored, added };
}

/** One plain line for the terminal / review: what was put back or added. */
export function keptRoomLine(k: Pick<KeptRoom, 'restored' | 'added'>): string {
  const list = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const parts: string[] = [];
  if (k.restored.length) parts.push(`kept ${list(k.restored)} (the reply left ${k.restored.length === 1 ? 'it' : 'them'} out)`);
  if (k.added.length) parts.push(`added ${list(k.added)} (${k.added.length === 1 ? 'it answers' : 'they answer'} here)`);
  if (!parts.length) return '';
  const s = parts.join('; ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}
