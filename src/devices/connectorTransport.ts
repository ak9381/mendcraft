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

/** Send one planned request through a fixed transport. A transport failure
 *  (the bridge or the plugin not answering) is thrown, so the caller can mark
 *  the device unreachable; a request this file will not send is `ok: false`. */
export async function runPlanned(req: PlannedRequest, deps: { wiz: WizClient; native?: LanPlugin }): Promise<RunPlannedResult> {
  // planRequest checked these; a stale or hand-made request is checked again.
  if (!isPrivateIPv4(req.host)) return { ok: false, why: NOT_LAN };
  if (req.transport === 'udp') {
    if (!ALLOWED_UDP_PORTS.includes(req.port)) return { ok: false, why: NEEDS_PHONE_APP };
    const payload = isObj(req.payload) ? req.payload : null;
    if (req.port === WIZ_PORT) {
      const method = payload?.method;
      // Only setting or reading the light: never "reboot", "reset", "registration".
      if (method !== 'setPilot' && method !== 'getPilot') return { ok: false, why: deps.native ? LAMP_CANT_TAKE : NEEDS_PHONE_APP };
      if (method === 'getPilot') {
        if (!deps.native) return { ok: true, state: await deps.wiz.getPilot(req.host) };
        const r = await deps.native.sendUdp({ host: req.host, port: WIZ_PORT, payload: encodeMessage(buildGetPilot()), waitMs: 1500 });
        return { ok: true, state: r.reply ? safePilot(r.reply) : null };
      }
      const intent = lampIntentFromPilot(payload?.params);
      if (!intent) return { ok: false, why: LAMP_CANT_TAKE };
      if (!deps.native) return { ok: true, state: await deps.wiz.setPilot(req.host, intent) };
      // The phone app sends the checked command, rebuilt from the intent (never the raw payload).
      await deps.native.sendUdp({ host: req.host, port: WIZ_PORT, payload: encodeMessage(buildSetPilot(intent)), waitMs: 1500 });
      return { ok: true };
    }
    if (!deps.native) return { ok: false, why: NEEDS_PHONE_APP };
    await deps.native.sendUdp({ host: req.host, port: req.port, payload: JSON.stringify(req.payload) });
    return { ok: true };
  }
  if (!deps.native) return { ok: false, why: NEEDS_PHONE_APP };
  if (!ALLOWED_HTTP_PORTS.includes(req.port) || !['GET', 'POST', 'PUT'].includes(req.method)) return { ok: false, why: NEEDS_PHONE_APP };
  const base = `http://${req.host}${req.port === 80 ? '' : `:${req.port}`}/`;
  if (!req.url.startsWith(base)) return { ok: false, why: NOT_LAN };
  const res = await deps.native.http({ method: req.method, url: req.url, ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}) });
  return res.status >= 200 && res.status < 300 ? { ok: true } : { ok: false, why: `The device answered ${res.status}. Nothing changed.` };
}
