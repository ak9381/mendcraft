// DECLARATIVE CONNECTORS + FIXED INTERPRETER (pure, DOM-free, no eval).
//
// Control Anything (Meta 2026 Indie winner, arXiv 2611.08321) has a cloud agent
// write a fresh Node program per device and run it unsandboxed, every time. Its
// own Limitations list (a) no reuse, (b) no sandbox, (c) no proof of the
// physical effect. Mendcraft's answer for (a) and (b):
//
//   - Cloud Gemini writes a connector ONCE, as DATA: named actions, each mapped
//     to one UDP datagram or one HTTP call with typed, ranged params.
//   - This file is the only thing that turns a connector into a request. It
//     validates the whole connector against an allowlist (transports, ports,
//     methods, path shape, template depth), clamps every param, and fills
//     templates by exact "{{name}}" substitution. Nothing is ever evaluated.
//   - The host is never part of the connector: it comes from LAN discovery and
//     must be a private IPv4 address, so a connector cannot aim at the internet.
//   - Connectors are cached (connectorCache.ts) and reused offline.
//
// (c) — proof of the effect — is the on-device before/after check in
// addDeviceFlow.ts.

export type ParamType = 'number' | 'boolean' | 'enum';

export interface ParamSpec {
  name: string;
  type: ParamType;
  min?: number;
  max?: number;
  values?: string[];
  default?: number | boolean | string;
}

/** A JSON template: any JSON value; a string that is exactly "{{p}}" becomes
 *  the typed param value, "{{p}}" inside a longer string is interpolated. */
export type JsonTemplate = null | boolean | number | string | JsonTemplate[] | { [k: string]: JsonTemplate };

export type RequestSpec =
  | { transport: 'udp'; port: number; payload: JsonTemplate }
  | { transport: 'http'; port: number; method: 'GET' | 'POST' | 'PUT'; path: string; body?: JsonTemplate };

export interface ConnectorAction {
  id: string;
  label: string;
  /** Kannada label (optional). */
  kn?: string;
  params: ParamSpec[];
  request: RequestSpec;
  /** What the camera should see when this worked, e.g. "the bulb is lit". */
  successCue: string;
}

export type DiscoveryMethod = 'wiz-udp-broadcast' | 'mdns' | 'ssdp' | 'manual';

export type ConnectorSource = 'builtin' | 'cloud' | 'on-device' | 'sim';

export interface Connector {
  version: 1;
  /** Normalised cache key, e.g. "wiz|smart-bulb". */
  key: string;
  deviceKind: string;
  brand: string;
  protocol: string;
  discovery: { method: DiscoveryMethod; service?: string; port?: number };
  actions: ConnectorAction[];
  /** Visible proof test: run `prepare` (if any), take the BEFORE frame, run
   *  `action`, take the AFTER frame, ask Nano whether `successCue` holds. */
  test: { action: string; prepare?: string };
  source: ConnectorSource;
  createdAt: number;
}

// ---- allowlist ------------------------------------------------------------

/** UDP ports a connector may use: WiZ (38899), Govee LAN API (4003). */
export const ALLOWED_UDP_PORTS: readonly number[] = [38899, 4003];
/** HTTP ports a connector may use (plain LAN device web APIs). */
export const ALLOWED_HTTP_PORTS: readonly number[] = [80, 8080, 8081, 9123];
export const ALLOWED_HTTP_METHODS: readonly string[] = ['GET', 'POST', 'PUT'];
export const DISCOVERY_METHODS: readonly DiscoveryMethod[] = ['wiz-udp-broadcast', 'mdns', 'ssdp', 'manual'];

const MAX_ACTIONS = 12;
const MAX_PARAMS = 6;
const MAX_TEMPLATE_DEPTH = 4;
const MAX_TEMPLATE_KEYS = 24;
const MAX_STRING = 200;
const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const PARAM_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,23}$/;
const KEY_RE = /^[a-zA-Z0-9_.-]{1,32}$/;
const PATH_RE = /^\/[A-Za-z0-9_\-./{}=&?%:]{0,180}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = MAX_STRING): string | null =>
  typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null;

/** Lower-case, dash-joined slug ("WiZ Connected" → "wiz-connected"). */
export function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'unknown';
}

/** Cache key for a device identity: brand + kind. Model is ignored on purpose
 *  (one connector covers a brand's family, e.g. every WiZ bulb). */
export function connectorKey(brand: string, kind: string): string {
  return `${slug(brand || 'unknown')}|${slug(kind || 'device')}`;
}

/** Private IPv4 only (10/8, 172.16/12, 192.168/16). Hostnames are refused. */
export function isPrivateIPv4(host: string): boolean {
  const p = host.split('.');
  if (p.length !== 4 || !p.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255)) return false;
  const [a, b] = p.map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function coerceTemplate(v: unknown, depth = 0): JsonTemplate | undefined {
  if (depth > MAX_TEMPLATE_DEPTH) return undefined;
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') return v.length <= MAX_STRING ? v : undefined;
  if (Array.isArray(v)) {
    if (v.length > MAX_TEMPLATE_KEYS) return undefined;
    const out: JsonTemplate[] = [];
    for (const x of v) { const c = coerceTemplate(x, depth + 1); if (c === undefined) return undefined; out.push(c); }
    return out;
  }
  if (isObj(v)) {
    const keys = Object.keys(v);
    if (keys.length > MAX_TEMPLATE_KEYS) return undefined;
    const out: Record<string, JsonTemplate> = {};
    for (const k of keys) {
      if (!KEY_RE.test(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') return undefined;
      const c = coerceTemplate(v[k], depth + 1);
      if (c === undefined) return undefined;
      out[k] = c;
    }
    return out;
  }
  return undefined;
}

/** Placeholders used anywhere in a template. */
export function templateParams(t: JsonTemplate | undefined): Set<string> {
  const out = new Set<string>();
  const walk = (x: JsonTemplate | undefined): void => {
    if (typeof x === 'string') { for (const m of x.matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g)) out.add(m[1]); }
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  };
  walk(t);
  return out;
}

function coerceParam(raw: unknown): ParamSpec | null {
  if (!isObj(raw)) return null;
  const name = str(raw.name, 24);
  if (!name || !PARAM_RE.test(name)) return null;
  const type = raw.type;
  if (type === 'number') {
    const min = typeof raw.min === 'number' && Number.isFinite(raw.min) ? raw.min : 0;
    const max = typeof raw.max === 'number' && Number.isFinite(raw.max) ? raw.max : 100;
    if (max < min) return null;
    const d = typeof raw.default === 'number' && Number.isFinite(raw.default) ? Math.min(max, Math.max(min, raw.default)) : min;
    return { name, type, min, max, default: d };
  }
  if (type === 'boolean') return { name, type, default: typeof raw.default === 'boolean' ? raw.default : true };
  if (type === 'enum') {
    const values = Array.isArray(raw.values) ? raw.values.map((x) => str(x, 40)).filter((x): x is string => !!x).slice(0, 16) : [];
    if (!values.length) return null;
    const d = typeof raw.default === 'string' && values.includes(raw.default) ? raw.default : values[0];
    return { name, type, values, default: d };
  }
  return null;
}

function coerceRequest(raw: unknown): RequestSpec | null {
  if (!isObj(raw)) return null;
  // Cloud schemas can't express free-form JSON, so the writer may send the
  // template as a JSON string (payloadJson / bodyJson); parse it as data only.
  const parseMaybe = (v: unknown, s: unknown): unknown => {
    if (v !== undefined) return v;
    if (typeof s !== 'string' || s.length > 2000) return undefined;
    try { return JSON.parse(s); } catch { return undefined; }
  };
  if (raw.transport === 'udp') {
    const port = Number(raw.port);
    if (!ALLOWED_UDP_PORTS.includes(port)) return null;
    const payload = coerceTemplate(parseMaybe(raw.payload, raw.payloadJson));
    if (payload === undefined || !isObj(payload)) return null;
    return { transport: 'udp', port, payload };
  }
  if (raw.transport === 'http') {
    const port = raw.port === undefined ? 80 : Number(raw.port);
    if (!ALLOWED_HTTP_PORTS.includes(port)) return null;
    const method = typeof raw.method === 'string' ? raw.method.toUpperCase() : 'GET';
    if (!ALLOWED_HTTP_METHODS.includes(method)) return null;
    const path = str(raw.path, 181);
    if (!path || !PATH_RE.test(path) || path.includes('..') || path.startsWith('//')) return null;
    const bodyRaw = parseMaybe(raw.body, raw.bodyJson);
    const body = bodyRaw === undefined ? undefined : coerceTemplate(bodyRaw);
    if (bodyRaw !== undefined && body === undefined) return null;
    return { transport: 'http', port, method: method as 'GET' | 'POST' | 'PUT', path, ...(body !== undefined ? { body } : {}) };
  }
  return null;
}

function coerceAction(raw: unknown): ConnectorAction | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 32);
  const label = str(raw.label, 60);
  const successCue = str(raw.successCue, 160) ?? 'the device visibly changed';
  if (!id || !ID_RE.test(id) || !label) return null;
  const params: ParamSpec[] = [];
  if (Array.isArray(raw.params)) {
    for (const p of raw.params.slice(0, MAX_PARAMS)) { const c = coerceParam(p); if (c) params.push(c); }
  }
  const request = coerceRequest(raw.request);
  if (!request) return null;
  // Every placeholder must be a declared param — no free variables.
  const used = templateParams(request.transport === 'udp' ? request.payload : request.body);
  if (request.transport === 'http') for (const m of request.path.matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g)) used.add(m[1]);
  for (const u of used) if (!params.some((p) => p.name === u)) return null;
  const kn = str(raw.kn, 60);
  return { id, label, ...(kn ? { kn } : {}), params, request, successCue };
}

/**
 * Validate untrusted connector JSON (from cloud Gemini, the cache, or a test)
 * into a Connector, or null. Invalid ACTIONS are dropped; a connector with no
 * valid action, an unknown discovery method, or a test that names a missing
 * action is rejected outright.
 */
export function coerceConnector(raw: unknown, source: ConnectorSource, now = Date.now()): Connector | null {
  if (!isObj(raw)) return null;
  const deviceKind = str(raw.deviceKind, 40) ?? 'device';
  const brand = str(raw.brand, 40) ?? 'unknown';
  const protocol = str(raw.protocol, 60) ?? 'unknown';
  const disc = isObj(raw.discovery) ? raw.discovery : {};
  const method = DISCOVERY_METHODS.includes(disc.method as DiscoveryMethod) ? (disc.method as DiscoveryMethod) : null;
  if (!method) return null;
  const service = str(disc.service, 60);
  const dport = Number(disc.port);
  const actions: ConnectorAction[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.actions)) {
    for (const a of raw.actions.slice(0, MAX_ACTIONS)) {
      const c = coerceAction(a);
      if (c && !seen.has(c.id)) { seen.add(c.id); actions.push(c); }
    }
  }
  if (!actions.length) return null;
  const t = isObj(raw.test) ? raw.test : {};
  const testAction = typeof t.action === 'string' && seen.has(t.action) ? t.action : actions[0].id;
  const prepare = typeof t.prepare === 'string' && seen.has(t.prepare) && t.prepare !== testAction ? t.prepare : undefined;
  return {
    version: 1,
    key: connectorKey(brand, deviceKind),
    deviceKind, brand, protocol,
    discovery: { method, ...(service ? { service } : {}), ...(Number.isInteger(dport) && dport > 0 && dport < 65536 ? { port: dport } : {}) },
    actions,
    test: { action: testAction, ...(prepare ? { prepare } : {}) },
    source,
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now,
  };
}

// ---- interpreter ----------------------------------------------------------

export type ParamValue = number | boolean | string;

/** Clamp/validate one argument against its spec (falls back to the default). */
export function coerceArg(spec: ParamSpec, v: unknown): ParamValue {
  if (spec.type === 'number') {
    const n = typeof v === 'string' ? Number(v) : v;
    const val = typeof n === 'number' && Number.isFinite(n) ? n : (spec.default as number);
    return Math.round(Math.min(spec.max ?? val, Math.max(spec.min ?? val, val)));
  }
  if (spec.type === 'boolean') return typeof v === 'boolean' ? v : (spec.default as boolean);
  return typeof v === 'string' && spec.values?.includes(v) ? v : (spec.default as string);
}

/** Fill a template by exact placeholder substitution. Pure; no evaluation. */
export function fillTemplate(t: JsonTemplate, args: Record<string, ParamValue>): JsonTemplate {
  if (typeof t === 'string') {
    const whole = /^\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}$/.exec(t);
    if (whole && whole[1] in args) return args[whole[1]];
    return t.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (_, n: string) => (n in args ? encodeURIComponent(String(args[n])) : ''));
  }
  if (Array.isArray(t)) return t.map((x) => fillTemplate(x, args));
  if (t && typeof t === 'object') {
    const out: Record<string, JsonTemplate> = {};
    for (const [k, v] of Object.entries(t)) out[k] = fillTemplate(v, args);
    return out;
  }
  return t;
}

export type PlannedRequest =
  | { transport: 'udp'; host: string; port: number; payload: JsonTemplate }
  | { transport: 'http'; host: string; port: number; method: string; url: string; body?: JsonTemplate };

export type PlanResult = { ok: true; request: PlannedRequest; action: ConnectorAction } | { ok: false; error: string };

/** Turn (connector, action, args, host) into one concrete, allowlisted request. */
export function planRequest(c: Connector, actionId: string, args: Record<string, unknown>, host: string): PlanResult {
  const action = c.actions.find((a) => a.id === actionId);
  if (!action) return { ok: false, error: `No action "${actionId}" in this connector.` };
  if (!isPrivateIPv4(host)) return { ok: false, error: 'Device address must be a private Wi-Fi address (192.168.x.x, 10.x.x.x or 172.16–31.x.x).' };
  const filled: Record<string, ParamValue> = {};
  for (const p of action.params) filled[p.name] = coerceArg(p, args[p.name]);
  const r = action.request;
  // Re-check the allowlist at run time too (a cached connector may be old).
  if (r.transport === 'udp') {
    if (!ALLOWED_UDP_PORTS.includes(r.port)) return { ok: false, error: 'UDP port not allowed.' };
    return { ok: true, action, request: { transport: 'udp', host, port: r.port, payload: fillTemplate(r.payload, filled) } };
  }
  if (!ALLOWED_HTTP_PORTS.includes(r.port) || !ALLOWED_HTTP_METHODS.includes(r.method)) return { ok: false, error: 'HTTP port or method not allowed.' };
  const path = fillTemplate(r.path, filled) as string;
  if (!PATH_RE.test(path) || path.includes('..')) return { ok: false, error: 'HTTP path not allowed.' };
  return {
    ok: true, action,
    request: {
      transport: 'http', host, port: r.port, method: r.method,
      url: `http://${host}${r.port === 80 ? '' : `:${r.port}`}${path}`,
      ...(r.body !== undefined ? { body: fillTemplate(r.body, filled) } : {}),
    },
  };
}

/** Transports the interpreter may call. Each is a fixed function; a connector
 *  only supplies data to it. */
export interface Transports {
  udp?: (host: string, port: number, payload: JsonTemplate) => Promise<unknown>;
  http?: (method: string, url: string, body?: JsonTemplate) => Promise<unknown>;
}

export interface RunResult { ok: boolean; reply?: unknown; error?: string; request?: PlannedRequest }

export async function runAction(
  c: Connector, actionId: string, args: Record<string, unknown>, host: string, transports: Transports,
): Promise<RunResult> {
  const plan = planRequest(c, actionId, args, host);
  if (!plan.ok) return { ok: false, error: plan.error };
  const req = plan.request;
  try {
    if (req.transport === 'udp') {
      if (!transports.udp) return { ok: false, error: 'This device speaks UDP; that runs in the iPhone app or through the WiZ bridge.', request: req };
      return { ok: true, reply: await transports.udp(req.host, req.port, req.payload), request: req };
    }
    if (!transports.http) return { ok: false, error: 'No HTTP transport here.', request: req };
    return { ok: true, reply: await transports.http(req.method, req.url, req.body), request: req };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), request: req };
  }
}

// ---- built-in seed --------------------------------------------------------

/** Known-good WiZ connector. Used as the offline seed, in sim mode, and as the
 *  fallback when the cloud writer is unreachable for a WiZ bulb. */
export function builtinWizConnector(now = Date.now()): Connector {
  const c = coerceConnector({
    deviceKind: 'smart-bulb', brand: 'WiZ', protocol: 'WiZ JSON-RPC over UDP 38899',
    discovery: { method: 'wiz-udp-broadcast', port: 38899 },
    actions: [
      { id: 'power-on', label: 'Turn on', kn: 'ಆನ್ ಮಾಡು', params: [], successCue: 'the bulb is lit and the room is brighter',
        request: { transport: 'udp', port: 38899, payload: { method: 'setPilot', params: { state: true } } } },
      { id: 'power-off', label: 'Turn off', kn: 'ಆಫ್ ಮಾಡು', params: [], successCue: 'the bulb is dark',
        request: { transport: 'udp', port: 38899, payload: { method: 'setPilot', params: { state: false } } } },
      { id: 'brightness', label: 'Brightness', kn: 'ಬೆಳಕು', params: [{ name: 'level', type: 'number', min: 10, max: 100, default: 80 }],
        successCue: 'the bulb brightness changed',
        request: { transport: 'udp', port: 38899, payload: { method: 'setPilot', params: { state: true, dimming: '{{level}}' } } } },
      { id: 'warmth', label: 'Warm or cool white', kn: 'ಬಿಳಿ ಬಣ್ಣ', params: [{ name: 'kelvin', type: 'number', min: 2200, max: 6500, default: 2700 }],
        successCue: 'the light colour changed',
        request: { transport: 'udp', port: 38899, payload: { method: 'setPilot', params: { state: true, temp: '{{kelvin}}' } } } },
    ],
    test: { action: 'power-on', prepare: 'power-off' },
  }, 'builtin', now);
  if (!c) throw new Error('builtin WiZ connector failed validation');
  return c;
}

/** Is this identity a WiZ bulb (so the built-in connector applies)? */
export function isWizIdentity(brand: string, kind: string): boolean {
  return /\bwiz\b/i.test(brand) || (/wiz/i.test(brand) && /bulb|lamp|light/i.test(kind));
}
