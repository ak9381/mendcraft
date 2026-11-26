// The lamps on the canvas are the lamps in the room. The canvas starts with
// two seeded lamps ('wiz-desk', 'wiz-ceiling') so it works with nothing
// connected; they are simulated and labelled SIM. When the local WiZ bridge
// answers, they are replaced by what the bridge really finds: one device per
// bulb, called "Lamp", "Lamp 2", …, with the bulb's real on/brightness.
// One bulb in the room means one lamp on the canvas — and one lamp id in the
// list the models are given.
//
// Lamp ids are managed here: the seeded ids and 'wiz-lamp-N'. A board may
// only show a managed lamp id that is in the device list right now; any
// other (a seeded lamp after the swap, a bulb that has gone, a plan written
// from a prompt built before discovery, a saved board from another session)
// is given the first current lamp that board does not already show, or
// removed — never left as a dead "unknown device" tile.
import type { DeviceState, SurfacePlan, TileSpec } from './surfacePlan';
import type { WizClient } from '../devices/wizClient';

/** The simulated lamps the canvas is seeded with. */
export const SEEDED_LAMP_IDS = ['wiz-desk', 'wiz-ceiling'] as const;
export const LAMP_IDS_KEY = 'mendcraft.wizLamps';
const CONNECT_LABEL = 'Connect a device';
const REAL_LAMP_ID = /^wiz-lamp-\d{1,3}$/;
/** The most bulbs remembered (older, absent ones are forgotten first). */
export const LAMP_MEMORY_MAX = 8;

/** A lamp id this module manages (seeded, or one it gave a real bulb). */
export const isManagedLampId = (id: string): boolean => REAL_LAMP_ID.test(id) || (SEEDED_LAMP_IDS as readonly string[]).includes(id);

export interface RealLamp {
  /** 'wiz-lamp-1', 'wiz-lamp-2', … — stable for a bulb across reloads.
   *  Never the IP itself: an id travels (plans, the phone, a redacted prompt). */
  id: string;
  /** The bulb's LAN address ('' = the bridge's configured default bulb). */
  ip: string;
  label: string;
  state: DeviceState;
}

type IdStore = Pick<Storage, 'getItem' | 'setItem'> | null;

const ipKey = (ip: string): number[] => ip.split('.').map((p) => Number(p) || 0);
const byIp = (a: string, b: string): number => {
  const x = ipKey(a), y = ipKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return a.localeCompare(b);
};

/** What is kept about a bulb between sessions is a hash of its address, never
 *  the address: enough to give the same bulb the same id again. */
export function lampKey(ip: string): string {
  if (!ip) return 'default';
  // Two rounds of FNV-1a (different offsets) → 16 hex characters.
  const round = (seed: number): string => {
    let h = seed >>> 0;
    for (let i = 0; i < ip.length; i++) { h ^= ip.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  };
  return `h${round(0x811c9dc5)}${round(0x9e3779b1)}`;
}

interface LampMemory {
  /** lampKey(ip) → id, oldest first. */
  ids: Record<string, string>;
  /** The lamp ids of the last successful discovery, in board order. */
  last: string[];
}

function loadMemory(storage: IdStore): LampMemory {
  const empty: LampMemory = { ids: {}, last: [] };
  try {
    const raw = JSON.parse(storage?.getItem(LAMP_IDS_KEY) ?? 'null') as { ids?: unknown; last?: unknown } | null;
    if (!raw || typeof raw !== 'object' || !raw.ids || typeof raw.ids !== 'object') return empty; // also drops an old IP-keyed map
    const ids: Record<string, string> = {};
    for (const [key, id] of Object.entries(raw.ids as Record<string, unknown>)) {
      if (typeof id === 'string' && REAL_LAMP_ID.test(id) && /^(default|h[0-9a-f]{16})$/.test(key)) ids[key] = id;
    }
    const known = new Set(Object.values(ids));
    const last = Array.isArray(raw.last) ? raw.last.filter((id): id is string => typeof id === 'string' && known.has(id)) : [];
    return { ids, last: [...new Set(last)] };
  } catch { return empty; }
}

function saveMemory(storage: IdStore, m: LampMemory): void {
  try { storage?.setItem(LAMP_IDS_KEY, JSON.stringify({ v: 2, ids: m.ids, last: m.last })); } catch { /* ids still work for this session */ }
}

/** The lamp ids the bridge last really found on this machine (empty: never). */
export function rememberedLampIds(storage: IdStore = null): string[] {
  return loadMemory(storage).last;
}

/** One id per bulb: a bulb seen before keeps its id; a new one takes the
 *  lowest free number. The bridge's "default bulb" (no address known) and
 *  that same single bulb found later under its address are one bulb: the id
 *  carries over, in either direction. Bulbs not seen for a long time are
 *  forgotten once more than LAMP_MEMORY_MAX are remembered. */
export function assignLampIds(ips: readonly string[], storage: IdStore = null): Record<string, string> {
  const m = loadMemory(storage);
  const keys = ips.map(lampKey);
  // The default-bulb entry and a lone addressed bulb are the same bulb.
  if (ips.length === 1) {
    const [key] = keys;
    if (!m.ids[key]) {
      if (key !== 'default' && m.ids.default) { m.ids[key] = m.ids.default; delete m.ids.default; }
      else if (key === 'default' && m.last.length === 1) {
        const only = Object.entries(m.ids).find(([, id]) => id === m.last[0]);
        if (only) { delete m.ids[only[0]]; m.ids.default = only[1]; }
      }
    }
  }
  const used = new Set(Object.values(m.ids));
  const out: Record<string, string> = {};
  ips.forEach((ip, i) => {
    const key = keys[i];
    let id = m.ids[key];
    if (!id) {
      let n = 1;
      while (used.has(`wiz-lamp-${n}`)) n++;
      id = `wiz-lamp-${n}`;
      used.add(id);
    }
    // Re-insert so the map stays ordered oldest-seen first.
    delete m.ids[key];
    m.ids[key] = id;
    out[ip] = id;
  });
  // Prune: forget the longest-unseen bulbs beyond the cap (never a present one).
  const present = new Set(keys);
  for (const key of Object.keys(m.ids)) {
    if (Object.keys(m.ids).length <= LAMP_MEMORY_MAX) break;
    if (!present.has(key)) delete m.ids[key];
  }
  m.last = ips.map((ip) => out[ip]);
  saveMemory(storage, m);
  return out;
}

export const lampLabel = (index: number): string => (index === 0 ? 'Lamp' : `Lamp ${index + 1}`);

/** Ask the bridge what is really there. Null = the bridge is down. An empty
 *  list = the bridge is up and no bulb answered. */
export async function discoverRealLamps(client: WizClient, storage: IdStore = null): Promise<RealLamp[] | null> {
  if (!(await client.health())) return null;
  let found: Array<{ ip: string; state?: { on: boolean; dimming?: number } | null }> = [];
  try {
    const seen = new Set<string>();
    for (const b of await client.discover()) { if (b.ip && !seen.has(b.ip)) { seen.add(b.ip); found.push({ ip: b.ip, state: b.state }); } }
  } catch {
    found = []; // the bridge answered /health; a failed broadcast is "none found"
  }
  if (!found.length) {
    // No broadcast reply — the bridge may still have one bulb configured.
    try { found = [{ ip: '', state: await client.getPilot('') }]; } catch { return []; }
  }
  found.sort((a, b) => byIp(a.ip, b.ip));
  const ids = assignLampIds(found.map((f) => f.ip), storage);
  const lamps: RealLamp[] = [];
  for (const [i, f] of found.entries()) {
    let pilot = f.state ?? null;
    if (!pilot) { try { pilot = await client.getPilot(f.ip); } catch { pilot = null; } }
    lamps.push({
      id: ids[f.ip], ip: f.ip, label: lampLabel(i),
      // The bulb's own state; one that would not answer is shown off, not guessed.
      state: { on: pilot?.on ?? false, brightness: pilot?.dimming ?? (pilot?.on ? 100 : 0), sim: false, unreachable: false },
    });
  }
  return lamps;
}

/** A current lamp a board may show. */
export interface LampSlot { id: string; label: string }

const isDeviceTile = (t: TileSpec): t is Extract<TileSpec, { deviceId: string }> => t.type === 'lamp' || t.type === 'switch' || t.type === 'music';

/** Make a board show only lamps that exist. A managed lamp id that is not in
 *  `lamps` (a seeded lamp after the swap, a vanished bulb, a remembered lamp
 *  on a machine that never saw it) becomes the first current lamp THIS board
 *  does not already show — so a board with one lamp tile keeps a lamp
 *  whenever there is one — and is removed only when none is left. Every other
 *  tile is untouched. Returns the same plan object when nothing changed. */
export function fitLampTiles(plan: SurfacePlan, lamps: readonly LampSlot[]): SurfacePlan {
  const current = new Set(lamps.map((l) => l.id));
  // Lamps this board already shows keep their place; the rest are free.
  const shown = new Set<string>();
  const scan = (tiles: TileSpec[]): void => {
    for (const t of tiles) {
      if (isDeviceTile(t)) { if (current.has(t.deviceId)) shown.add(t.deviceId); }
      else if (t.type === 'row' || t.type === 'grid' || t.type === 'card') scan(t.children);
      else if (t.type === 'tabs') t.tabs.forEach((tab) => scan(tab.children));
      else if (t.type === 'split') { scan(t.first); scan(t.second); }
    }
  };
  scan(plan.tiles);
  const free = lamps.filter((l) => !shown.has(l.id));
  let changed = false;
  const walk = (tiles: TileSpec[]): TileSpec[] => {
    const out: TileSpec[] = [];
    for (const t of tiles) {
      if (isDeviceTile(t) && isManagedLampId(t.deviceId) && !current.has(t.deviceId)) {
        changed = true;
        const next = free.shift();
        if (next) out.push({ ...t, deviceId: next.id, label: next.label });
      } else if (t.type === 'row' || t.type === 'grid' || t.type === 'card') {
        const children = walk(t.children);
        if (children.length) out.push(children === t.children ? t : { ...t, children });
      } else if (t.type === 'tabs') {
        const tabs = t.tabs.map((tab) => ({ ...tab, children: walk(tab.children) })).filter((tab) => tab.children.length);
        if (tabs.length) out.push({ ...t, tabs });
      } else if (t.type === 'split') {
        const first = walk(t.first), second = walk(t.second);
        if (first.length && second.length) out.push({ ...t, first, second });
        else if (first.length + second.length) out.push({ type: 'row', children: [...first, ...second] });
      } else out.push(t);
    }
    return out;
  };
  const tiles = walk(plan.tiles);
  if (!changed) return plan;
  return { ...plan, tiles: tiles.length ? tiles : [{ type: 'connect', label: CONNECT_LABEL }] };
}

/** Rewrite a board for the real lamps (see fitLampTiles). */
export function remapSeededLamps(plan: SurfacePlan, lamps: readonly RealLamp[]): SurfacePlan {
  return fitLampTiles(plan, lamps);
}

/** The parts of the canvas a lamp swap touches (kept structural for tests). */
export interface LampSwapTarget {
  store: { all(): Record<string, DeviceState>; add(id: string, s: DeviceState): void; remove(id: string): void };
  /** Board plans by frame id — rewritten in place. */
  surfaces: Record<string, SurfacePlan>;
  /** Device id → the name shown and given to the models. */
  labels: Record<string, string>;
  /** Device id → bulb IP, for the connector. */
  ips: Map<string, string>;
}

/** Set the canvas's lamps to exactly `lamps`: every other managed lamp id
 *  leaves the device list (the seeded SIM lamps, a bulb that has gone), each
 *  given lamp joins it, and every board is fitted to the new list. Returns
 *  the ids of the boards that changed (to re-render). The speaker and every
 *  other device stay. */
export function applyRealLamps(target: LampSwapTarget, lamps: readonly RealLamp[]): string[] {
  const now = new Set(lamps.map((l) => l.id));
  for (const id of Object.keys(target.store.all())) {
    if (isManagedLampId(id) && !now.has(id)) { target.store.remove(id); delete target.labels[id]; target.ips.delete(id); }
  }
  for (const id of SEEDED_LAMP_IDS) delete target.labels[id];
  for (const lamp of lamps) {
    target.store.add(lamp.id, lamp.state);
    target.labels[lamp.id] = lamp.label;
    target.ips.set(lamp.id, lamp.ip);
  }
  const changed: string[] = [];
  for (const [frameId, plan] of Object.entries(target.surfaces)) {
    const next = fitLampTiles(plan, lamps);
    if (next !== plan) { target.surfaces[frameId] = next; changed.push(frameId); }
  }
  return changed;
}

/** The lamps to start with when the bridge has not answered (yet, or at all):
 *  the bulbs it last really found on this machine, shown "Not reachable"
 *  (and refused, never simulated) until it does
 *  — so boards saved with those lamps open with live tiles, not dead ones.
 *  Null when no bulb was ever found here (the seeded lamps stay). */
export function rememberedLamps(storage: IdStore = null): RealLamp[] | null {
  const ids = rememberedLampIds(storage);
  if (!ids.length) return null;
  return ids.map((id, i) => ({ id, ip: '', label: lampLabel(i), state: { on: false, brightness: 50, sim: true, unreachable: true } }));
}
