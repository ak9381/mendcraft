// The one place a GENERATED connector's request is sent (fixed code, never
// generated). planRequest (connector.ts) has already turned the connector's
// data into one allow-listed request; this file decides how it may travel:
//
//   - In the browser the page may reach only the local WiZ bridge
//     (127.0.0.1:38888, CSP connect-src). So a request is accepted only when
//     it is UDP port 38899 with payload method setPilot or getPilot; its
//     params are checked here and handed to the existing wizClient methods,
//     and the bridge checks them again. Anything else is refused with
//     NEEDS_PHONE_APP. No bridge endpoint is added.
//   - In the phone app the MendcraftLan plugin sends it (it re-checks the
//     host and port itself). The WiZ port still takes only setPilot/getPilot.
//
// A value is refused, never clamped. The bridge token stays inside wizClient.
import { ALLOWED_HTTP_PORTS, ALLOWED_UDP_PORTS, isPrivateIPv4, type JsonTemplate, type PlannedRequest } from './connector';
import { buildGetPilot, buildSetPilot, encodeMessage, isWizScene, parsePilotResult, WIZ_PORT, type LampIntent, type LampState } from './wiz';
import type { WizClient } from './wizClient';
import type { LanPlugin } from './native';

export const NEEDS_PHONE_APP = 'This device needs the phone app to reach it. Nothing changed.';
export const LAMP_CANT_TAKE = "The lamp can't take that command. Nothing changed.";
const NOT_LAN = 'That address is not on your Wi-Fi. Nothing changed.';

export type RunPlannedResult = { ok: true; state?: LampState | null } | { ok: false; why: string };

const isObj = (v: unknown): v is Record<string, JsonTemplate> => !!v && typeof v === 'object' && !Array.isArray(v);
const safePilot = (text: string): LampState | null => { try { return parsePilotResult(JSON.parse(text)); } catch { return null; } };
const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** The setPilot params as ONE WiZ command, or null when they are not one the
 *  bridge takes (unknown key, a value out of range, two modes at once). */
export function lampIntentFromPilot(params: unknown): LampIntent | null {
  if (!isObj(params)) return null;
  const allowed = ['state', 'dimming', 'temp', 'r', 'g', 'b', 'sceneId'];
  if (Object.keys(params).some((k) => !allowed.includes(k))) return null;
  const { state, dimming, temp, r, g, b, sceneId } = params;
  if (state !== undefined && typeof state !== 'boolean') return null;
  const rgb = r !== undefined || g !== undefined || b !== undefined;
  const modes = [dimming !== undefined, temp !== undefined, rgb, sceneId !== undefined].filter(Boolean).length;
  if (modes > 1) return null;
  if (modes === 0) return typeof state === 'boolean' ? { kind: 'power', on: state } : null;
  // A level, white, colour or scene also turns the bulb on: "off" with one is a contradiction.
  if (state === false) return null;
  if (dimming !== undefined) return int(dimming, 10, 100) ? { kind: 'dim', dimming } : null;
  if (temp !== undefined) return int(temp, 2200, 6500) ? { kind: 'temp', temp } : null;
  if (rgb) return int(r, 0, 255) && int(g, 0, 255) && int(b, 0, 255) ? { kind: 'color', rgb: { r, g, b } } : null;
  return int(sceneId, 1, 32) && isWizScene(sceneId) ? { kind: 'scene', sceneId } : null;
}

/** One request, checked and ready to send (nothing has been sent yet). */
export type CheckedRequest =
  | { send: 'wiz-get'; host: string }
  | { send: 'wiz-set'; host: string; intent: LampIntent }
  | { send: 'udp'; host: string; port: number; payload: string }
  | { send: 'http'; method: string; url: string; body?: string };

/** A host on the Wi-Fi that one device can have: private IPv4, and not the
 *  network (.0) or broadcast (.255) address of a /24. */
const deviceHost = (host: string): boolean => {
  if (!isPrivateIPv4(host)) return false;
  const last = Number(host.split('.')[3]);
  return last !== 0 && last !== 255;
};

/** Every check runPlanned makes, without sending anything: what would be
 *  sent, or why it will not be. A press with several requests checks them
 *  all first, so a refusal never comes after part of it was sent. */
export function checkPlanned(req: PlannedRequest, o: { native: boolean }): { ok: true; checked: CheckedRequest } | { ok: false; why: string } {
  // planRequest checked these; a stale or hand-made request is checked again.
  if (!deviceHost(req.host)) return { ok: false, why: NOT_LAN };
  if (req.transport === 'udp') {
    if (!ALLOWED_UDP_PORTS.includes(req.port)) return { ok: false, why: NEEDS_PHONE_APP };
    const payload = isObj(req.payload) ? req.payload : null;
    if (req.port === WIZ_PORT) {
      const method = payload?.method;
      // Only setting or reading the light: never "reboot", "reset", "registration".
      if (method !== 'setPilot' && method !== 'getPilot') return { ok: false, why: o.native ? LAMP_CANT_TAKE : NEEDS_PHONE_APP };
      if (method === 'getPilot') return { ok: true, checked: o.native ? { send: 'udp', host: req.host, port: WIZ_PORT, payload: encodeMessage(buildGetPilot()) } : { send: 'wiz-get', host: req.host } };
      const intent = lampIntentFromPilot(payload?.params);
      if (!intent) return { ok: false, why: LAMP_CANT_TAKE };
      // The phone app sends the checked command, rebuilt from the intent (never the raw payload).
      return { ok: true, checked: o.native ? { send: 'udp', host: req.host, port: WIZ_PORT, payload: encodeMessage(buildSetPilot(intent)) } : { send: 'wiz-set', host: req.host, intent } };
    }
    if (!o.native) return { ok: false, why: NEEDS_PHONE_APP };
    return { ok: true, checked: { send: 'udp', host: req.host, port: req.port, payload: JSON.stringify(req.payload) } };
  }
  if (!o.native) return { ok: false, why: NEEDS_PHONE_APP };
  if (!ALLOWED_HTTP_PORTS.includes(req.port) || !['GET', 'POST', 'PUT'].includes(req.method)) return { ok: false, why: NEEDS_PHONE_APP };
  const base = `http://${req.host}${req.port === 80 ? '' : `:${req.port}`}/`;
  if (!req.url.startsWith(base)) return { ok: false, why: NOT_LAN };
  return { ok: true, checked: { send: 'http', method: req.method, url: req.url, ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}) } };
}

/** Send one request that passed checkPlanned. A transport failure (the
 *  bridge or the plugin not answering) is thrown. */
export async function sendChecked(c: CheckedRequest, deps: { wiz: WizClient; native?: LanPlugin }): Promise<RunPlannedResult> {
  if (c.send === 'wiz-get') return { ok: true, state: await deps.wiz.getPilot(c.host) };
  if (c.send === 'wiz-set') return { ok: true, state: await deps.wiz.setPilot(c.host, c.intent) };
  if (!deps.native) return { ok: false, why: NEEDS_PHONE_APP };
  if (c.send === 'udp') {
    const r = await deps.native.sendUdp({ host: c.host, port: c.port, payload: c.payload, waitMs: 1500 });
    return { ok: true, ...(c.port === WIZ_PORT && c.payload.includes('"getPilot"') ? { state: r.reply ? safePilot(r.reply) : null } : {}) };
  }
  const res = await deps.native.http({ method: c.method, url: c.url, ...(c.body !== undefined ? { body: c.body } : {}) });
  return res.status >= 200 && res.status < 300 ? { ok: true } : { ok: false, why: `The device answered ${res.status}. Nothing changed.` };
}

/** Check one planned request, then send it through a fixed transport. A
 *  transport failure is thrown, so the caller can mark the device
 *  unreachable; a request this file will not send is `ok: false`. */
export async function runPlanned(req: PlannedRequest, deps: { wiz: WizClient; native?: LanPlugin }): Promise<RunPlannedResult> {
  const c = checkPlanned(req, { native: !!deps.native });
  if (!c.ok) return c;
  return sendChecked(c.checked, deps);
}
