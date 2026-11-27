// The lamp CONNECTOR turn: Gemini writes, once, how to talk to a lamp, as
// DATA (named actions, each one allow-listed request) plus an intent map
// (which action each canvas request runs). She reviews it; Approve stores it
// as a `connector-<slug(key)>` artifact. Nothing in it is ever executed: the
// fixed interpreter (connector.ts planRequest) and transport
// (connectorTransport.ts) are the only code that act on it.
//
// What leaves this device: the brand and kind of the lamp. Never an
// address, never the bridge token.
import type { SentInfo } from './aiTurn';
import type { Coerced } from './surfacePlan';
import { extractJson, hasCompleteJson } from '../ai/cloudJson';
import {
  ALLOWED_HTTP_PORTS, ALLOWED_UDP_PORTS, coerceConnector, connectorKey, DISCOVERY_METHODS, slug, type Connector,
} from '../devices/connector';
import { coerceIntentMapNotes, type IntentMap } from '../devices/intentMap';
import type { DeviceIdentity } from '../devices/identify';

export const CONNECTOR_ROUTE_LINE = 'Gemini · cloud — writing how to talk to the lamp, as data';
export const CONNECTOR_SENT = 'the lamp’s brand and kind. No address, no token.';
/** At most this many actions in one reply (connector.ts keeps 12; more is refused, not cut). */
const MAX_REPLY_ACTIONS = 12;

/** The identity a lamp on the canvas is asked about (WiZ: the bridge found it). */
export const WIZ_LAMP_IDENTITY: DeviceIdentity = { kind: 'smart-bulb', brand: 'WiZ', model: '', label: 'WiZ bulb', confidence: 1 };

/** The artifact id a connector is stored under: `connector-<slug(key)>`. */
export const connectorArtifactId = (key: string): string => `connector-${slug(key)}`;

export function buildConnectorPrompt(identity: DeviceIdentity): SentInfo {
  const brand = identity.brand.replace(/["\n]/g, ' ').slice(0, 40) || 'unknown brand';
  const kind = identity.kind.replace(/["\n]/g, ' ').slice(0, 40) || 'device';
  const prompt = [
    `Write a LAN connector for a ${brand} ${kind} as DATA, not code. Reply with JSON only:`,
    '{"connector": Connector, "intents": IntentMap}',
    'Connector = {"deviceKind": string, "brand": string, "protocol": string, "discovery": {"method": string, "port"?: number}, "actions": [Action], "test": {"action": string, "prepare"?: string}}',
    'Action = {"id": "lower-case-id", "label": string, "params": [{"name": string, "type": "number"|"boolean", "min"?: number, "max"?: number, "default"?: number}], "request": Request, "successCue": what a camera would SEE when it worked}',
    `Request = {"transport": "udp", "port": ${ALLOWED_UDP_PORTS.join('|')}, "payload": JSON} | {"transport": "http", "port": ${ALLOWED_HTTP_PORTS.join('|')}, "method": "GET"|"POST"|"PUT", "path": "/local/path", "body"?: JSON}`,
    'In a payload, body or path, a param value is written "{{paramName}}". Every placeholder must be a declared param.',
    `discovery.method is one of ${DISCOVERY_METHODS.join(', ')}. Never write a host, an IP address or a full URL: the address comes from the local network.`,
    'IntentMap = {"on"?: Entry, "off"?: Entry, "brightness"?: Entry, "temp"?: Entry, "rgb"?: Entry, "sceneId"?: Entry}',
    'Entry = {"action": an action id above, "params"?: {paramName: "brightness"|"temp"|"r"|"g"|"b"|"sceneId"}}. Fill every param the action declares.',
    'brightness is 10 to 100 %, temp is 2200 to 6500 K, r g b are 0 to 255.',
    `At most ${MAX_REPLY_ACTIONS} actions. Use only the device's documented local protocol. If it has none, reply {"supported": false}.`,
  ].join('\n');
  return { engine: 'gemini', prompt, sent: CONNECTOR_SENT, routeLine: CONNECTOR_ROUTE_LINE, sim: false };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Why one written action is not allowed, or null. Said in the refusal. */
function actionProblem(raw: unknown, i: number): string | null {
  if (!isObj(raw)) return `action ${i + 1} is not an action`;
  const name = typeof raw.id === 'string' ? `"${raw.id.slice(0, 32)}"` : `action ${i + 1}`;
  const r = raw.request;
  if (!isObj(r)) return `${name} has no request`;
  const port = Number(r.port ?? (r.transport === 'http' ? 80 : NaN));
  if (r.transport === 'udp' && !ALLOWED_UDP_PORTS.includes(port)) return `${name} uses UDP port ${String(r.port).slice(0, 8)}, which is not allowed`;
  if (r.transport === 'http') {
    if (!ALLOWED_HTTP_PORTS.includes(port)) return `${name} uses HTTP port ${String(r.port).slice(0, 8)}, which is not allowed`;
    if (typeof r.path !== 'string' || !r.path.startsWith('/') || r.path.startsWith('//')) return `${name} goes to an address, not a local path`;
  }
  if (r.transport !== 'udp' && r.transport !== 'http') return `${name} uses a transport that is not allowed`;
  return null;
}

/** Check a connector reply. Strict: one action that fails its check refuses
 *  the whole connector (a reviewed connector is exactly what runs). With
 *  `expectKey`, a connector for another brand or kind is refused too. */
export function parseConnectorReply(text: string, expectKey?: string): Coerced<{ connector: Connector; intents: IntentMap }> {
  const bad = (error: string) => ({ ok: false as const, error });
  if (!hasCompleteJson(text)) return bad('the reply holds no complete JSON');
  const raw = extractJson(text);
  if (!isObj(raw)) return bad('the reply is not a JSON object');
  if (raw.supported === false) return bad('Gemini says this device has no local protocol');
  const rc = raw.connector;
  if (!isObj(rc)) return bad('the reply has no connector');
  if (!Array.isArray(rc.actions) || !rc.actions.length) return bad('the connector has no actions');
  if (rc.actions.length > MAX_REPLY_ACTIONS) return bad(`the connector has more than ${MAX_REPLY_ACTIONS} actions`);
  for (const [i, a] of rc.actions.entries()) { const why = actionProblem(a, i); if (why) return bad(why); }
  const connector = coerceConnector(rc, 'cloud');
  if (!connector) return bad('the connector failed its check');
  if (connector.actions.length !== rc.actions.length) return bad(`${rc.actions.length - connector.actions.length} of its actions failed their check`);
  if (expectKey && connector.key !== expectKey) return bad(`it is written for a ${connector.brand} ${connector.deviceKind}, not this lamp`);
  const { map, dropped } = coerceIntentMapNotes(raw.intents, connector);
  if (!Object.keys(map).length) return bad('its intent map names no action the connector has');
  return { ok: true, value: { connector, intents: map }, ...(dropped.length ? { notes: dropped.map((d) => `Left out of the intent map: ${d}.`) } : {}) };
}

/** The key a lamp's connector is stored under (WiZ lamps: "wiz|smart-bulb"). */
export const lampConnectorKey = (identity: DeviceIdentity = WIZ_LAMP_IDENTITY): string => connectorKey(identity.brand, identity.kind);
