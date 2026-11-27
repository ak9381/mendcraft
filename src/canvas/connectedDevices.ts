// The live devices table: one row per device, built locally (no AI) from
// what each device really reports. A ✓ only when the device truly answers
// right now; otherwise plain status words. SIM devices never get a ✓.
// The board around it is generated (a table tile with `source: 'devices'`,
// reviewed like any board); only the rows come from here, at every render.
import type { GimbalState } from './phonePoint';

export const DASHBOARD_TITLE = 'Dashboard';
/** Under a live devices table: where its rows come from. */
export const LIVE_TABLE_NOTE = 'Live · what each device reports now';
export const LIVE_TABLE_EMPTY = 'No devices here yet.';
export const TICK = '✓';
/** A paired phone is ticked only if it answered (announce / ping) this recently. */
export const PHONE_FRESH_MS = 45_000;
export const NOT_ANSWERING = 'Paired · not answering';

/** `kind` is a plain word for what the device is (Laptop, Phone, Lamp, Speaker). */
export interface DeviceRow { device: string; status: string; ok: boolean; kind?: string }

/** The columns a live table may show. */
export const DEVICE_FIELDS = ['device', 'status', 'kind'] as const;
export type DeviceField = (typeof DEVICE_FIELDS)[number];
export const DEVICE_FIELD_NAMES: Record<DeviceField, string> = { device: 'Device', status: 'Status', kind: 'Kind' };
/** No fields written: the device and its status. */
export const DEFAULT_DEVICE_FIELDS: readonly DeviceField[] = ['device', 'status'];

export interface ConnectedInput {
  /** This laptop (always answers: it is drawing the board). */
  laptop?: boolean;
  /** The paired iPhone: absent = not paired. */
  iphone?: { sim: boolean; gimbal: GimbalState | null; sensor?: boolean; answering?: boolean } | null;
  /** The paired Nothing phone (Android): absent = not paired. */
  android?: { sim: boolean; answering?: boolean } | null;
  /** Lamps known on this canvas. */
  /** answering = the bridge reached it; unreachable = a real lamp the bridge
   *  can't reach now; sim = a simulated lamp (?sim=1). */
  lamps: readonly { label: string; state: 'answering' | 'unreachable' | 'sim' }[];
  /** Why no lamp can be reached ('' = no extra reason). */
  lampWhy?: string;
  /** The speaker tile's player. */
  speaker?: { spotifyTokens: boolean; playingOn: string; sim: boolean } | null;
}

const gimbalWords = (g: GimbalState | null, sensor?: boolean): string => {
  if (g === 'tracking') return 'Gimbal: tracking you';
  if (g === 'hands') return sensor ? 'Gimbal: following your hands' : 'Gimbal: docked';
  if (g === 'ready') return 'Gimbal: docked';
  return 'Gimbal: no stand';
};

export function connectedDeviceRows(i: ConnectedInput): DeviceRow[] {
  const rows: DeviceRow[] = [];
  const push = (kind: string, device: string, status: string, ok: boolean) => rows.push({ device, status, ok, kind });
  push('Laptop', 'Laptop', 'This canvas', i.laptop !== false);
  if (i.iphone) {
    const g = gimbalWords(i.iphone.gimbal, i.iphone.sensor);
    if (i.iphone.sim) push('Phone', 'iPhone', `SIM · paired · ${g}`, false);
    else if (i.iphone.answering === false) push('Phone', 'iPhone', NOT_ANSWERING, false);
    else push('Phone', 'iPhone', `Paired · ${g}`, true);
  } else push('Phone', 'iPhone', 'Not paired', false);
  if (i.android) {
    if (i.android.sim) push('Phone', 'Nothing phone', 'SIM · paired', false);
    else if (i.android.answering === false) push('Phone', 'Nothing phone', NOT_ANSWERING, false);
    else push('Phone', 'Nothing phone', 'Paired', true);
  }
  else push('Phone', 'Nothing phone', 'Not paired', false);
  if (!i.lamps.length) push('Lamp', 'WiZ lamp', i.lampWhy || 'None found yet', false);
  for (const l of i.lamps) {
    if (l.state === 'answering') push('Lamp', l.label, 'WiZ · answering', true);
    else if (l.state === 'unreachable') push('Lamp', l.label, i.lampWhy || 'Not reachable', false);
    else push('Lamp', l.label, 'SIM lamp', false);
  }
  if (i.speaker) {
    if (i.speaker.sim) push('Speaker', 'Speaker', 'SIM · simulated speaker', false);
    else if (i.speaker.spotifyTokens && i.speaker.playingOn) push('Speaker', 'Speaker', `Spotify · ${i.speaker.playingOn}`, true);
    else if (i.speaker.spotifyTokens) push('Speaker', 'Speaker', 'Spotify connected · nothing playing yet', false);
    else push('Speaker', 'Speaker', 'Spotify not connected', false);
  }
  return rows;
}

/** The rows a live devices table shows: only devices that are here (a paired
 *  phone, a lamp this canvas knows, the speaker), never this laptop (it is the
 *  canvas itself) and never a "Not paired" / "None found yet" stand-in. The
 *  ticks and words are connectedDeviceRows' own. */
export function presentDeviceRows(i: ConnectedInput): DeviceRow[] {
  const rows = connectedDeviceRows(i).filter((r) => r.kind !== 'Laptop');
  return rows.filter((r) => !(r.kind === 'Phone' && r.status === 'Not paired') && !(r.kind === 'Lamp' && !i.lamps.length));
}

/** A table's fields from untrusted data: only device/status/kind, each once;
 *  none (or none left) means device and status. */
export function coerceDeviceFields(raw: unknown): { fields: DeviceField[]; dropped: number } {
  if (!Array.isArray(raw)) return { fields: [...DEFAULT_DEVICE_FIELDS], dropped: raw === undefined ? 0 : 1 };
  const fields: DeviceField[] = [];
  let dropped = 0;
  for (const f of raw) {
    if ((DEVICE_FIELDS as readonly unknown[]).includes(f) && !fields.includes(f as DeviceField)) fields.push(f as DeviceField);
    else dropped++;
  }
  return { fields: fields.length ? fields : [...DEFAULT_DEVICE_FIELDS], dropped };
}

/** The cells of a live table: one row per device, the tick in the device cell. */
export function liveRows(source: 'devices', fields: readonly DeviceField[], rows: readonly DeviceRow[]): string[][] {
  if (source !== 'devices') return [];
  return rows.map((r) => fields.map((f) => (f === 'device' ? (r.ok ? `${TICK} ${r.device}` : r.device) : f === 'status' ? r.status : r.kind ?? '')));
}
