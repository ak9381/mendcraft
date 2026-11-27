// Browser-side WiZ client. The web app CANNOT send UDP, so it talks ONLY to the
// local bridge (scripts/wiz-bridge.mjs) over HTTP/JSON. This wrapper builds the
// WiZ params with the pure, tested src/devices/wiz.ts and surfaces an honest
// "bridge offline" error when the laptop isn't running the bridge — it never
// pretends the lamp is connected. No cloud, no WiZ account: everything is LAN.

import {
  buildGetPilot,
  parsePilotResult,
  parseSetPilotResult,
  pilotParamsForIntent,
  type LampIntent,
  type LampState,
} from './wiz';

/** Default bridge URL: localhost, so it only works on the same laptop unless
 *  the user runs the bridge with --host 0.0.0.0 and points here at its LAN IP. */
export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:38888';
/** The longest a bridge call may take (a discovery window is ~1 s). */
export const WIZ_CALL_TIMEOUT_MS = 8000;

/** A bulb the bridge discovered on the LAN. */
export interface DiscoveredBulb {
  ip: string;
  mac?: string;
  state?: LampState | null;
}

/** Thrown when the bridge can't be reached — the UI shows the run-the-bridge hint. */
export class BridgeOfflineError extends Error {
  constructor(message = 'bridge offline') {
    super(message);
    this.name = 'BridgeOfflineError';
  }
}

/** Thrown when the bridge answers 400: it validated the params and refused
 *  them (out of range, unknown scene). The lamp did not change. */
export class BridgeRefusedError extends Error {
  constructor(message = 'bridge refused the request') {
    super(message);
    this.name = 'BridgeRefusedError';
  }
}

type FetchLike =(input: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface WizClient {
  readonly baseUrl: string;
  /** Is the bridge up? Never throws — returns false when unreachable. */
  health(): Promise<boolean>;
  /** Ask the bridge to broadcast-discover bulbs on the LAN. */
  discover(): Promise<DiscoveredBulb[]>;
  /** Read a bulb's current pilot. */
  getPilot(ip: string): Promise<LampState>;
  /** Apply an intent, then return the refreshed state (bridge re-reads). */
  setPilot(ip: string, intent: LampIntent): Promise<LampState | null>;
}

/** Resolve the configured bridge URL: ?bridge= wins, then localStorage, then
 *  the localhost default. Lets a phone on the LAN point at the laptop's IP. */
export function resolveBridgeUrl(
  search = typeof window !== 'undefined' ? window.location.search : '',
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
): string {
  try {
    const q = new URLSearchParams(search).get('bridge');
    if (q) return q.replace(/\/$/, '');
    const stored = storage?.getItem('mendcraft.wizBridge');
    if (stored) return stored.replace(/\/$/, '');
  } catch {
    // URL/storage unavailable — fall through to the default.
  }
  return DEFAULT_BRIDGE_URL;
}

/** Resolve the bridge's auth token: ?wizToken= wins (and is persisted to
 *  localStorage so a bookmarked/shared link keeps working), then a prior
 *  localStorage value. Empty when neither is set — the bridge then answers
 *  401 and the connector falls back to the simulated device. */
export function resolveWizToken(
  search = typeof window !== 'undefined' ? window.location.search : '',
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
): string {
  try {
    const q = new URLSearchParams(search).get('wizToken');
    if (q) {
      storage?.setItem('mendcraft.wizToken', q);
      return q;
    }
    return storage?.getItem('mendcraft.wizToken') ?? '';
  } catch {
    return '';
  }
}

/** The page address without ?wizToken=, once the token is safely stored (so
 *  it does not show in the address bar, or in a screen recording). Null when
 *  there is no token in the address, or it could not be stored (then the
 *  address keeps it, so the bridge still works). */
export function wizTokenFreeUrl(
  href: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
): string | null {
  try {
    const url = new URL(href);
    const q = url.searchParams.get('wizToken');
    if (!q || !storage) return null;
    storage.setItem('mendcraft.wizToken', q);
    if (storage.getItem('mendcraft.wizToken') !== q) return null;
    url.searchParams.delete('wizToken');
    return url.toString();
  } catch {
    return null;
  }
}

export function createWizClient(
  baseUrl: string = resolveBridgeUrl(),
  fetchImpl: FetchLike = (input, init) => fetch(input, init) as unknown as ReturnType<FetchLike>,
  token: string = resolveWizToken(),
  timeoutMs: number = WIZ_CALL_TIMEOUT_MS,
): WizClient {
  const base = baseUrl.replace(/\/$/, '');

  async function call(path: string, body?: unknown): Promise<unknown> {
    let res;
    // A bridge that never answers (a hung process, a sleeping laptop) is
    // offline after timeoutMs, and the request is cancelled: a hung /health
    // must never leave discovery waiting forever (final review M7).
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      res = await Promise.race([
        fetchImpl(`${base}${path}`, {
          method: body ? 'POST' : 'GET',
          headers: { ...(body ? { 'content-type': 'application/json' } : {}), 'x-wiz-token': token },
          body: body ? JSON.stringify(body) : undefined,
          ...(ctl ? { signal: ctl.signal } : {}),
        }),
        new Promise<never>((_r, reject) => { timer = setTimeout(() => { ctl?.abort(); reject(new BridgeOfflineError('bridge did not answer in time')); }, timeoutMs); }),
      ]);
    } catch {
      // Connection refused / DNS / CORS network error / no answer — the bridge is down.
      throw new BridgeOfflineError();
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 400) {
      // The bridge is up and said no (its own range check): not "offline".
      let why = '';
      try { why = String(((await res.json()) as { error?: unknown })?.error ?? ''); } catch { /* no body */ }
      throw new BridgeRefusedError(why || 'bridge refused the request');
    }
    if (!res.ok) throw new Error(`bridge error ${res.status}`);
    return res.json();
  }

  return {
    baseUrl: base,
    async health() {
      try {
        const r = (await call('/health')) as { ok?: boolean };
        return r?.ok === true;
      } catch {
        return false;
      }
    },
    async discover() {
      const r = (await call('/discover')) as { bulbs?: unknown };
      const bulbs = Array.isArray(r?.bulbs) ? r.bulbs : [];
      return bulbs
        .map((b): DiscoveredBulb | null => {
          const o = (b ?? {}) as Record<string, unknown>;
          if (typeof o.ip !== 'string') return null;
          return {
            ip: o.ip,
            mac: typeof o.mac === 'string' ? o.mac : undefined,
            state: parsePilotResult(o.state ?? o),
          };
        })
        .filter((b): b is DiscoveredBulb => b !== null);
    },
    async getPilot(ip) {
      const r = await call('/getPilot', { ip, message: buildGetPilot() });
      const state = parsePilotResult((r as { result?: unknown })?.result ?? r);
      if (!state) throw new Error('bulb did not respond');
      return state;
    },
    async setPilot(ip, intent) {
      const r = (await call('/setPilot', {
        ip,
        params: pilotParamsForIntent(intent),
      })) as { result?: unknown; state?: unknown };
      if (!parseSetPilotResult(r.result ?? r)) throw new Error('bulb rejected the command');
      // Prefer a fresh read so the UI reflects the real state (setPilot replies
      // only `{success}`); fall back to anything the reply carried.
      try {
        return await this.getPilot(ip);
      } catch {
        return parsePilotResult((r as { state?: unknown }).state ?? r.result ?? r);
      }
    },
  };
}
