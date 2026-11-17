// SEND-LAYER SAFETY (pure). Every LAN command from a connector passes through
// here right before it leaves: values that look like brightness, volume or
// colour are clamped to sane ranges (whatever the connector said), and each
// device gets a rate limit so a loop or a bad connector can't hammer it.

import type { JsonTemplate, Transports } from './connector';

/** Hard ranges by field name (case-insensitive), applied to the final payload. */
export const SAFE_RANGES: Record<string, [number, number]> = {
  dimming: [10, 100], brightness: [0, 100], bri: [1, 254], level: [0, 100],
  volume: [0, 100], vol: [0, 100],
  temp: [2200, 6500], kelvin: [2200, 6500], ct: [153, 500],
  r: [0, 255], g: [0, 255], b: [0, 255], red: [0, 255], green: [0, 255], blue: [0, 255], w: [0, 255], c: [0, 255],
  hue: [0, 360], sat: [0, 100], saturation: [0, 100],
};

export interface ClampNote { field: string; from: number; to: number }

function clampValue(key: string, v: unknown, notes: ClampNote[]): unknown {
  const range = SAFE_RANGES[key.toLowerCase()];
  if (!range) return v;
  const n = typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return v;
  const to = Math.min(range[1], Math.max(range[0], n));
  if (to === n) return v;
  notes.push({ field: key, from: n, to });
  return typeof v === 'string' ? String(to) : to;
}

/** Clamp every known field in a JSON payload (recursively). */
export function clampPayload(t: JsonTemplate, notes: ClampNote[] = []): JsonTemplate {
  if (Array.isArray(t)) return t.map((x) => clampPayload(x, notes));
  if (t && typeof t === 'object') {
    const out: Record<string, JsonTemplate> = {};
    for (const [k, v] of Object.entries(t)) {
      out[k] = v && typeof v === 'object' ? clampPayload(v, notes) : (clampValue(k, v, notes) as JsonTemplate);
    }
    return out;
  }
  return t;
}

/** Clamp known fields in a URL's query string (?brightness=500 -> 100). */
export function clampUrl(url: string, notes: ClampNote[] = []): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  let changed = false;
  for (const [k, v] of [...params.entries()]) {
    const c = clampValue(k, v, notes);
    if (c !== v) { params.set(k, String(c)); changed = true; }
  }
  return changed ? `${url.slice(0, q)}?${params.toString()}` : url;
}

export interface RateLimit {
  /** Most commands per device inside `windowMs`. */
  max: number;
  windowMs: number;
  /** Smallest gap between two commands to the same device. */
  minGapMs: number;
}
export const DEFAULT_RATE: RateLimit = { max: 6, windowMs: 3000, minGapMs: 150 };

export function createRateLimiter(limit: RateLimit = DEFAULT_RATE, now: () => number = Date.now) {
  const sent = new Map<string, number[]>();
  return {
    /** Records the send when allowed. */
    take(device: string): { ok: true } | { ok: false; waitMs: number } {
      const t = now();
      const list = (sent.get(device) ?? []).filter((x) => t - x < limit.windowMs);
      const last = list[list.length - 1];
      if (last !== undefined && t - last < limit.minGapMs) return { ok: false, waitMs: limit.minGapMs - (t - last) };
      if (list.length >= limit.max) return { ok: false, waitMs: limit.windowMs - (t - list[0]) };
      list.push(t);
      sent.set(device, list);
      return { ok: true };
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

export class TooFastError extends Error {
  constructor(device: string, waitMs: number) {
    super(`Slow down: too many commands to ${device}. Try again in ${Math.max(1, Math.ceil(waitMs / 1000))} s.`);
    this.name = 'TooFastError';
  }
}

function hostOf(url: string): string {
  const m = /^https?:\/\/([^/:?#]+)/i.exec(url);
  return m ? m[1] : url;
}

/** Wrap transports with clamping + a per-device rate limit. */
export function safeTransports(t: Transports, limiter: RateLimiter = createRateLimiter(), onClamp?: (notes: ClampNote[]) => void): Transports {
  const report = (notes: ClampNote[]) => { if (notes.length) onClamp?.(notes); };
  return {
    ...(t.udp ? {
      udp: async (host: string, port: number, payload: JsonTemplate) => {
        const r = limiter.take(host);
        if (!r.ok) throw new TooFastError(host, r.waitMs);
        const notes: ClampNote[] = [];
        const safe = clampPayload(payload, notes);
        report(notes);
        return t.udp!(host, port, safe);
      },
    } : {}),
    ...(t.http ? {
      http: async (method: string, url: string, body?: JsonTemplate) => {
        const host = hostOf(url);
        const r = limiter.take(host);
        if (!r.ok) throw new TooFastError(host, r.waitMs);
        const notes: ClampNote[] = [];
        const safeUrl = clampUrl(url, notes);
        const safeBody = body === undefined ? undefined : clampPayload(body, notes);
        report(notes);
        return t.http!(method, safeUrl, safeBody);
      },
    } : {}),
  };
}
