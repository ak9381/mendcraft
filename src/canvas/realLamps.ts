// The lamps on the canvas are the lamps in the room. The canvas starts with
// two seeded lamps ('wiz-desk', 'wiz-ceiling') so it works with nothing
// connected; they are simulated and labelled SIM. When the local WiZ bridge
// answers, they are replaced by what the bridge really finds: one device per
// bulb IP, called "Lamp", "Lamp 2", …, with the bulb's real on/brightness.
// One bulb in the room means one lamp on the canvas — and one lamp id in the
// list the models are given.
import type { DeviceState, SurfacePlan, TileSpec } from './surfacePlan';
import type { WizClient } from '../devices/wizClient';

/** The simulated lamps the canvas is seeded with. */
export const SEEDED_LAMP_IDS = ['wiz-desk', 'wiz-ceiling'] as const;
export const LAMP_IDS_KEY = 'mendcraft.wizLamps';
const CONNECT_LABEL = 'Connect a device';

export interface RealLamp {
  /** 'wiz-lamp-1', 'wiz-lamp-2', … — stable for a bulb's IP across reloads.
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

function loadIds(storage: IdStore): Record<string, string> {
  try {
    const raw = JSON.parse(storage?.getItem(LAMP_IDS_KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [ip, id] of Object.entries(raw as Record<string, unknown>)) if (typeof id === 'string' && /^wiz-lamp-\d{1,3}$/.test(id)) out[ip] = id;
    return out;
  } catch { return {}; }
}

/** One id per bulb IP: a bulb seen before keeps its id; a new one takes the
 *  lowest free number. */
export function assignLampIds(ips: readonly string[], storage: IdStore = null): Record<string, string> {
  const known = loadIds(storage);
  const used = new Set(Object.values(known));
  const out: Record<string, string> = {};
  for (const ip of ips) {
    if (known[ip]) { out[ip] = known[ip]; continue; }
    let n = 1;
    while (used.has(`wiz-lamp-${n}`)) n++;
    out[ip] = known[ip] = `wiz-lamp-${n}`;
    used.add(out[ip]);
  }
  try { storage?.setItem(LAMP_IDS_KEY, JSON.stringify(known)); } catch { /* ids still work for this session */ }
  return out;
}

export const lampLabel = (index: number): string => (index === 0 ? 'Lamp' : `Lamp ${index + 1}`);

/** Ask the bridge what is really there. Null = the bridge is down (keep the
 *  seeded SIM lamps). An empty list = the bridge is up and no bulb answered. */
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
      state: { on: pilot?.on ?? false, brightness: pilot?.dimming ?? (pilot?.on ? 100 : 0), sim: false },
    });
  }
  return lamps;
}

/** Which real lamp takes each seeded lamp's place on boards that already
 *  show one (in order); a seeded lamp with no real bulb left is removed. */
export function seededLampMap(lamps: readonly RealLamp[]): Record<string, RealLamp | null> {
  const map: Record<string, RealLamp | null> = {};
  SEEDED_LAMP_IDS.forEach((id, i) => { map[id] = lamps[i] ?? null; });
  return map;
}

/** Rewrite a board for the real lamps: a seeded lamp's tile becomes its real
 *  lamp's (id and name), or goes when there is no such bulb. Returns the same
 *  plan object when nothing on it was seeded. */
export function remapSeededLamps(plan: SurfacePlan, lamps: readonly RealLamp[]): SurfacePlan {
  const map = seededLampMap(lamps);
  const used = new Set<string>();
  let changed = false;
  const walk = (tiles: TileSpec[]): TileSpec[] => {
    const out: TileSpec[] = [];
    for (const t of tiles) {
      if ((t.type === 'lamp' || t.type === 'switch' || t.type === 'music') && t.deviceId in map) {
        changed = true;
        const real = map[t.deviceId];
        if (!real || used.has(real.id)) continue;
        used.add(real.id);
        out.push({ ...t, deviceId: real.id, label: real.label });
      } else if (t.type === 'row' || t.type === 'grid' || t.type === 'card') {
        const children = walk(t.children);
        if (children.length) out.push({ ...t, children });
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

/** Make the canvas's lamps the bridge's bulbs: the seeded SIM lamps leave the
 *  device list, each found bulb joins it with its real state, and boards that
 *  showed a seeded lamp now show the real one. Returns the ids of the boards
 *  that changed (to re-render). The speaker and every other device stay. */
export function applyRealLamps(target: LampSwapTarget, lamps: readonly RealLamp[]): string[] {
  for (const id of SEEDED_LAMP_IDS) { target.store.remove(id); delete target.labels[id]; }
  // A bulb that has gone since the last look leaves too.
  const now = new Set(lamps.map((l) => l.id));
  for (const id of Object.keys(target.store.all())) if (/^wiz-lamp-\d+$/.test(id) && !now.has(id)) { target.store.remove(id); delete target.labels[id]; target.ips.delete(id); }
  for (const lamp of lamps) {
    target.store.add(lamp.id, lamp.state);
    target.labels[lamp.id] = lamp.label;
    target.ips.set(lamp.id, lamp.ip);
  }
  const changed: string[] = [];
  for (const [frameId, plan] of Object.entries(target.surfaces)) {
    const next = remapSeededLamps(plan, lamps);
    if (next !== plan) { target.surfaces[frameId] = next; changed.push(frameId); }
  }
  return changed;
}
