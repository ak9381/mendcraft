// The "Connected devices" board: one row per device, built locally (no AI)
// from what each device really reports. A ✓ only when the device truly
// answers right now; otherwise plain status words. SIM devices never get a ✓.
import type { GimbalState } from './phonePoint';
import type { SurfacePlan } from './surfacePlan';

export const DEVICES_BOARD_TITLE = 'Connected devices';
export const DASHBOARD_TITLE = 'Dashboard';
export const TICK = '✓';
/** A paired phone is ticked only if it answered (announce / ping) this recently. */
export const PHONE_FRESH_MS = 45_000;
export const NOT_ANSWERING = 'Paired · not answering';

export interface DeviceRow { device: string; status: string; ok: boolean }

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
  rows.push({ device: 'Laptop', status: 'This canvas', ok: i.laptop !== false });
  if (i.iphone) {
    const g = gimbalWords(i.iphone.gimbal, i.iphone.sensor);
    if (i.iphone.sim) rows.push({ device: 'iPhone', status: `SIM · paired · ${g}`, ok: false });
    else if (i.iphone.answering === false) rows.push({ device: 'iPhone', status: NOT_ANSWERING, ok: false });
    else rows.push({ device: 'iPhone', status: `Paired · ${g}`, ok: true });
  } else rows.push({ device: 'iPhone', status: 'Not paired', ok: false });
  if (i.android) {
    if (i.android.sim) rows.push({ device: 'Nothing phone', status: 'SIM · paired', ok: false });
    else if (i.android.answering === false) rows.push({ device: 'Nothing phone', status: NOT_ANSWERING, ok: false });
    else rows.push({ device: 'Nothing phone', status: 'Paired', ok: true });
  }
  else rows.push({ device: 'Nothing phone', status: 'Not paired', ok: false });
  if (!i.lamps.length) rows.push({ device: 'WiZ lamp', status: i.lampWhy || 'None found yet', ok: false });
  for (const l of i.lamps) {
    if (l.state === 'answering') rows.push({ device: l.label, status: 'WiZ · answering', ok: true });
    else if (l.state === 'unreachable') rows.push({ device: l.label, status: i.lampWhy || 'Not reachable', ok: false });
    else rows.push({ device: l.label, status: 'SIM lamp', ok: false });
  }
  if (i.speaker) {
    if (i.speaker.sim) rows.push({ device: 'Speaker', status: 'SIM · simulated speaker', ok: false });
    else if (i.speaker.spotifyTokens && i.speaker.playingOn) rows.push({ device: 'Speaker', status: `Spotify · ${i.speaker.playingOn}`, ok: true });
    else if (i.speaker.spotifyTokens) rows.push({ device: 'Speaker', status: 'Spotify connected · nothing playing yet', ok: false });
    else rows.push({ device: 'Speaker', status: 'Spotify not connected', ok: false });
  }
  return rows;
}

/** The board itself: one table, a ✓ in front of a device only when it answers. */
export function connectedDevicesPlan(rows: readonly DeviceRow[]): SurfacePlan {
  return {
    kind: 'room',
    title: DEVICES_BOARD_TITLE,
    tiles: [{
      type: 'table',
      title: 'Devices',
      columns: ['Device', 'Status'],
      rows: rows.map((r) => [r.ok ? `${TICK} ${r.device}` : r.device, r.status]),
      sortable: false,
    }],
  };
}
