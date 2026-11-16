// LAN discovery + transports for the connector interpreter.
//
// Order of preference:
//   1. iOS app (MendcraftLan native plugin): real UDP/HTTP + broadcast/Bonjour.
//   2. Browser + the laptop WiZ bridge (npm run wiz-bridge): WiZ only.
//   3. Browser alone: a STUB. Chrome can't open UDP sockets or scan the LAN,
//      and an https page can't fetch http://192.168.x.x (mixed content). We say
//      so and let her type the address instead of pretending.

import type { Connector, JsonTemplate, Transports } from './connector';
import type { FoundDevice, StepSource } from './addDeviceFlow';
import { getLanPlugin, jsonOrUndefined, type LanPlugin } from './native';
import { resolveBridgeUrl } from './wizClient';

type FetchLike = (input: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const defaultFetch: FetchLike = (i, init) => fetch(i, init) as unknown as ReturnType<FetchLike>;

export const WEB_STUB_NOTE =
  'Chrome can’t scan Wi-Fi. The iPhone app finds devices by itself; here, type the device’s address (from your router or the WiZ app) or run the WiZ bridge.';

export interface DiscoveryEnv {
  lan?: LanPlugin | null;
  bridgeUrl?: string;
  fetch?: FetchLike;
}

/** Is the laptop WiZ bridge up? (short timeout; never throws) */
export async function bridgeHealthy(base = resolveBridgeUrl(), timeoutMs = 700): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(`${base.replace(/\/$/, '')}/health`, { signal: ctl.signal });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}

async function bridgeUp(base: string, f: FetchLike): Promise<boolean> {
  try { const r = await f(`${base}/health`); return r.ok; } catch { return false; }
}

export async function discoverDevices(
  c: Connector, env: DiscoveryEnv = {},
): Promise<{ found: FoundDevice[]; source: StepSource; note: string }> {
  const lan = env.lan === undefined ? getLanPlugin() : env.lan;
  if (lan) {
    try {
      const r = await lan.discover({ method: c.discovery.method, port: c.discovery.port, service: c.discovery.service, waitMs: 1500 });
      const found = (r.devices ?? []).filter((d) => typeof d.host === 'string');
      return { found, source: 'native', note: found.length ? '' : 'The iPhone looked but found nothing. Is it on the same Wi-Fi?' };
    } catch (err) {
      return { found: [], source: 'native', note: `iPhone discovery failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  const f = env.fetch ?? defaultFetch;
  const base = (env.bridgeUrl ?? resolveBridgeUrl()).replace(/\/$/, '');
  if (c.discovery.method === 'wiz-udp-broadcast' && (await bridgeUp(base, f))) {
    try {
      const r = await f(`${base}/discover`);
      const body = (await r.json()) as { bulbs?: Array<{ ip?: unknown; mac?: unknown }> };
      const found = (body.bulbs ?? []).filter((b) => typeof b.ip === 'string')
        .map((b) => ({ host: b.ip as string, ...(typeof b.mac === 'string' ? { mac: b.mac } : {}), name: 'WiZ bulb' }));
      return { found, source: 'bridge', note: found.length ? '' : 'The WiZ bridge found no bulbs on this Wi-Fi.' };
    } catch {
      /* fall through to the stub */
    }
  }
  return { found: [], source: 'stub', note: WEB_STUB_NOTE };
}

/** The fixed transports handed to the interpreter. */
export function makeTransports(env: DiscoveryEnv = {}): Transports {
  const lan = env.lan === undefined ? getLanPlugin() : env.lan;
  const f = env.fetch ?? defaultFetch;
  const base = (env.bridgeUrl ?? resolveBridgeUrl()).replace(/\/$/, '');
  if (lan) {
    return {
      udp: async (host, port, payload) => {
        const r = await lan.sendUdp({ host, port, payload: JSON.stringify(payload), waitMs: 800 });
        return r.reply ? safeJson(r.reply) : null;
      },
      http: async (method, url, body) => {
        const r = await lan.http({ method, url, body: jsonOrUndefined(body) });
        if (r.status >= 400) throw new Error(`device said HTTP ${r.status}`);
        return r.body ? safeJson(r.body) : null;
      },
    };
  }
  return {
    // Browser: only WiZ datagrams, relayed by the laptop bridge (which
    // re-checks the params itself). Anything else needs the iPhone app.
    udp: async (host: string, port: number, payload: JsonTemplate) => {
      const p = payload as { method?: unknown; params?: unknown } | null;
      if (port !== 38899 || !p || (p.method !== 'setPilot' && p.method !== 'getPilot')) {
        throw new Error('This device needs the iPhone app (the browser can only reach WiZ bulbs, via the bridge).');
      }
      let r;
      try {
        r = await f(`${base}/${p.method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ip: host, params: p.params ?? {} }) });
      } catch {
        throw new Error('WiZ bridge is offline. Run `npm run wiz-bridge` on the laptop, or use the iPhone app.');
      }
      if (!r.ok) throw new Error(`bridge error ${r.status}`);
      return r.json();
    },
    http: async (method: string, url: string, body?: JsonTemplate) => {
      const r = await f(url, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : undefined, body: jsonOrUndefined(body) });
      if (!r.ok) throw new Error(`device said HTTP ${r.status}`);
      try { return await r.json(); } catch { return null; }
    },
  };
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
