// WiZ lamp protocol — PURE command builder + response parser. WiZ bulbs speak a
// tiny JSON-RPC over UDP (port 38899); browsers can't send UDP, so the web
// client POSTs high-level intents to the local bridge (scripts/wiz-bridge.mjs)
// and the bridge does the datagrams. This module is the SHARED, fully
// unit-tested source of truth for how an intent becomes WiZ params and how a
// bulb's reply becomes a LampState — no DOM, no sockets, no network.

/** WiZ bulbs listen for JSON datagrams on this UDP port. */
export const WIZ_PORT = 38899;

// WiZ accepts these ranges; outside them the bulb ignores the field, so we clamp
// on the way out to keep the UI honest (a slider can't ask for something illegal).
export const DIM_MIN = 10;
export const DIM_MAX = 100;
export const TEMP_MIN = 2200; // warm (Kelvin)
export const TEMP_MAX = 6500; // cool (Kelvin)

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The slice of a bulb's pilot we surface; omitted fields were not reported. */
export interface LampState {
  on: boolean;
  /** Brightness 10–100 (%), when the bulb reported it. */
  dimming?: number;
  /** White colour temperature in Kelvin, when in white mode. */
  temp?: number;
  /** RGB, when in colour mode (all three present together). */
  rgb?: Rgb;
  sceneId?: number;
}

/** What a UI control (phone remote, editor widget, voice) asks the lamp to do. */
export type LampIntent =
  | { kind: 'power'; on: boolean }
  | { kind: 'dim'; dimming: number }
  | { kind: 'temp'; temp: number }
  | { kind: 'color'; rgb: Rgb };

/** A WiZ JSON-RPC message: `{ method, params }`. */
export interface WizMessage {
  method: 'getPilot' | 'setPilot' | 'registration';
  params: Record<string, number | boolean | string>;
}

const round = (n: number) => Math.round(n);

/** Clamp to an integer in [lo, hi]; non-finite → lo. */
function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, round(n)));
}

export const clampDim = (n: number): number => clampInt(n, DIM_MIN, DIM_MAX);
export const clampTemp = (n: number): number => clampInt(n, TEMP_MIN, TEMP_MAX);
export const clampByte = (n: number): number => clampInt(n, 0, 255);

/**
 * Translate a high-level intent into the exact setPilot params a WiZ bulb
 * expects. Pure and total: every numeric field is clamped to a legal range, so
 * the bridge can forward the result verbatim. Setting brightness/temp/colour
 * also implies the light is on (the bulb turns on when it receives them, and the
 * UI should reflect that), so we include `state: true` for those.
 */
export function pilotParamsForIntent(intent: LampIntent): Record<string, number | boolean> {
  switch (intent.kind) {
    case 'power':
      return { state: intent.on };
    case 'dim':
      return { state: true, dimming: clampDim(intent.dimming) };
    case 'temp':
      return { state: true, temp: clampTemp(intent.temp) };
    case 'color':
      return {
        state: true,
        r: clampByte(intent.rgb.r),
        g: clampByte(intent.rgb.g),
        b: clampByte(intent.rgb.b),
      };
  }
}

/** Build a setPilot message for an intent (what the bridge sends over UDP). */
export function buildSetPilot(intent: LampIntent): WizMessage {
  return { method: 'setPilot', params: pilotParamsForIntent(intent) };
}

/** Build the getPilot query (ask a bulb for its current state). */
export function buildGetPilot(): WizMessage {
  return { method: 'getPilot', params: {} };
}

/**
 * Build the discovery datagram. Broadcasting this to 255.255.255.255:38899 makes
 * every WiZ bulb on the LAN reply with its system info; we read the responders'
 * source IPs. `register:false` means "don't bind me as a controller" — a
 * read-only probe. phoneMac/phoneIp are advisory and echoed back.
 */
export function buildRegistration(phoneIp: string, phoneMac: string): WizMessage {
  return {
    method: 'registration',
    params: { phoneIp, phoneMac, register: false },
  };
}

/** Serialize a message to the bytes that go on the wire. */
export function encodeMessage(msg: WizMessage): string {
  return JSON.stringify(msg);
}

interface PilotResult {
  state?: unknown;
  dimming?: unknown;
  temp?: unknown;
  colorTemp?: unknown;
  r?: unknown;
  g?: unknown;
  b?: unknown;
  sceneId?: unknown;
  mac?: unknown;
  success?: unknown;
}

/** Pull the `result` object out of a WiZ reply, whether it's wrapped in the
 *  full `{method,env,result}` envelope or already the bare result object. */
function resultOf(raw: unknown): PilotResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.result === 'object' && o.result !== null) return o.result as PilotResult;
  // Bridge may hand us the result directly, or an error envelope.
  if ('error' in o && !('state' in o)) return null;
  return o as PilotResult;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Parse a getPilot (or state-bearing setPilot) reply into a LampState. Returns
 * null for a malformed reply or an error envelope. getPilot reports white
 * temperature as `colorTemp`; we normalise to `temp`. RGB is only surfaced when
 * all three channels are present and non-zero (a pure-white pilot reports 0,0,0).
 */
export function parsePilotResult(raw: unknown): LampState | null {
  const r = resultOf(raw);
  if (!r || typeof r.state !== 'boolean') return null;
  const out: LampState = { on: r.state };
  if (isNum(r.dimming)) out.dimming = clampDim(r.dimming);
  const temp = isNum(r.colorTemp) ? r.colorTemp : isNum(r.temp) ? r.temp : null;
  if (temp !== null && temp > 0) out.temp = round(temp);
  if (isNum(r.r) && isNum(r.g) && isNum(r.b) && (r.r || r.g || r.b)) {
    out.rgb = { r: clampByte(r.r), g: clampByte(r.g), b: clampByte(r.b) };
  }
  if (isNum(r.sceneId)) out.sceneId = round(r.sceneId);
  return out;
}

/** Did a setPilot succeed? WiZ replies `{result:{success:true}}`. Falls back to
 *  a parseable state (some firmware echoes the pilot) counting as success. */
export function parseSetPilotResult(raw: unknown): boolean {
  const r = resultOf(raw);
  if (!r) return false;
  if (r.success === true) return true;
  return typeof r.state === 'boolean';
}

/** Human one-line summary of a lamp state for a status row. */
export function lampStateLabel(state: LampState | null): string {
  if (!state) return 'Unknown';
  if (!state.on) return 'Off';
  const parts: string[] = ['On'];
  if (isNum(state.dimming)) parts.push(`${state.dimming}%`);
  if (state.rgb) parts.push(`rgb(${state.rgb.r},${state.rgb.g},${state.rgb.b})`);
  else if (isNum(state.temp)) parts.push(`${state.temp}K`);
  return parts.join(' · ');
}
