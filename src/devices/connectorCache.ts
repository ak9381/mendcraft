// CONNECTOR + DEVICE CACHE (pure, storage-injectable).
//
// A connector is written once (cloud Gemini) and then reused from this cache,
// offline, for every later device of the same brand + kind. Every read is
// re-validated through coerceConnector, so a tampered cache entry can't smuggle
// in a port or method the interpreter would refuse. Paired devices (name +
// LAN address + which connector) are stored alongside. localStorage only.

import { coerceConnector, isPrivateIPv4, type Connector } from './connector';

export const CONNECTORS_KEY = 'mendcraft.connectors';
export const DEVICES_KEY = 'mendcraft.devices';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

const defaultStore = (): Store | null => (typeof localStorage !== 'undefined' ? localStorage : null);

function readJson(store: Store | null, key: string): unknown {
  try { const raw = store?.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export function loadConnectors(store: Store | null = defaultStore()): Record<string, Connector> {
  const raw = readJson(store, CONNECTORS_KEY);
  const out: Record<string, Connector> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const v of Object.values(raw as Record<string, unknown>)) {
      const src = v && typeof v === 'object' ? (v as { source?: unknown }).source : null;
      const c = coerceConnector(v, src === 'builtin' || src === 'cloud' || src === 'on-device' || src === 'sim' ? src : 'cloud');
      if (c) out[c.key] = c;
    }
  }
  return out;
}

export function getCachedConnector(key: string, store: Store | null = defaultStore()): Connector | null {
  return loadConnectors(store)[key] ?? null;
}

export function saveConnector(c: Connector, store: Store | null = defaultStore()): void {
  const all = loadConnectors(store);
  all[c.key] = c;
  try { store?.setItem(CONNECTORS_KEY, JSON.stringify(all)); } catch { /* quota — keep working */ }
}

export interface PairedDevice {
  id: string;
  name: string;
  connectorKey: string;
  host: string;
  addedAt: number;
  /** Did the on-device camera check see the test action work? */
  verified: 'done' | 'not_done' | 'unsure';
}

export function loadDevices(store: Store | null = defaultStore()): PairedDevice[] {
  const raw = readJson(store, DEVICES_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((d): d is PairedDevice =>
    !!d && typeof d === 'object' && typeof d.id === 'string' && typeof d.name === 'string' &&
    typeof d.connectorKey === 'string' && typeof d.host === 'string' && isPrivateIPv4(d.host) &&
    typeof d.addedAt === 'number' && ['done', 'not_done', 'unsure'].includes(d.verified)).slice(0, 50);
}

export function saveDevice(d: PairedDevice, store: Store | null = defaultStore()): PairedDevice[] {
  const list = loadDevices(store).filter((x) => x.id !== d.id && !(x.host === d.host && x.connectorKey === d.connectorKey));
  list.unshift(d);
  try { store?.setItem(DEVICES_KEY, JSON.stringify(list.slice(0, 50))); } catch { /* ignore */ }
  return list;
}
