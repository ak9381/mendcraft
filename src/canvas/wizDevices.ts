// Wires the canvas's lamp devices (ids starting 'wiz-') to the real local WiZ
// bridge (scripts/wiz-bridge.mjs, via src/devices/wizClient) when it answers;
// every other device, and every wiz- device while the bridge is unreachable,
// falls through to `fallback` (the canvas's own simulated connector) — tagged
// `sim: true` so the tile shows it's not the real bulb.
import { DeviceError, lampLook, type DeviceConnector, type DeviceIntent } from './deviceActions';
import type { DeviceState } from './surfacePlan';
import { BridgeRefusedError, type WizClient } from '../devices/wizClient';
import type { LampIntent, LampState } from '../devices/wiz';
import { planRequest, type Connector } from '../devices/connector';
import { actionsForIntent, argsRefusal, type ActionCall, type IntentMap } from '../devices/intentMap';
import { checkPlanned, sendChecked } from '../devices/connectorTransport';
import type { LanPlugin } from '../devices/native';

export function isWizDevice(deviceId: string): boolean {
  return deviceId.startsWith('wiz-');
}

/** Mutable, shared with the caller so a proactive health check (or a bridge
 *  call that fails mid-session) can flip reachability for every future call. */
export interface BridgeStatus {
  up: boolean;
}

export interface WizConnectorDeps {
  client: WizClient;
  fallback: DeviceConnector;
  status: BridgeStatus;
  /** WiZ bulb IP for a device id; '' asks the bridge for its configured default. */
  bulbIp?: (deviceId: string) => string;
  /** Live mode (no ?sim=1): a lamp the bridge can't reach is NOT simulated —
   *  the press is refused with LAMP_NOT_REACHABLE and nothing changes. */
  honest?: boolean;
  /** The bridge just stopped answering mid-session (status.up flipped false). */
  onDown?: () => void;
  /** Live mode: a lamp press was refused because the bridge isn't answering. */
  onRefusedUnreachable?: () => void;
  /** Which connector a lamp runs on: an approved generated one (its data and
   *  intent map), the labelled built-in WiZ mapping, or none (a press is
   *  refused with how to connect it). Not given: the built-in mapping. */
  connectorFor?: (deviceId: string) => LampConnector;
  /** The phone app's LAN plugin, when there is one (it sends what the browser can't). */
  native?: LanPlugin;
}

/** An approved generated connector, as the canvas holds it after its check. */
export interface ApprovedConnector { connector: Connector; intents: IntentMap }
/** What a lamp runs on right now. */
export type LampConnector = ApprovedConnector | 'built-in' | null;
/** The tile's footnote words for it. */
export type ConnectorState = 'generated' | 'built-in' | 'none';
export const connectorState = (c: LampConnector): ConnectorState => (c === null ? 'none' : c === 'built-in' ? 'built-in' : 'generated');

/** A lamp with no connector yet: a press says how to get one. */
export const NO_CONNECTOR_LINE = 'This lamp has no connector yet. Say “connect the lamp” to make one. Nothing changed.';
/** The lamp's generated connector has no action for what was asked. */
export const CONNECTOR_CANT_DO_THAT = "The lamp's connector has no action for that. Nothing changed.";

/** What an intent becomes on a lamp, checked before anything is sent: the
 *  built-in WiZ command, or the generated connector's action calls. Throws
 *  the refusal (never a clamp, never a default). */
export function checkLampIntent(intent: DeviceIntent, c: LampConnector): { builtin: LampIntent } | { calls: ActionCall[]; approved: ApprovedConnector } {
  if (c === null) throw new DeviceError(NO_CONNECTOR_LINE);
  if (c === 'built-in') {
    const lamp = wizIntentFor(intent);
    if (!lamp) throw new DeviceError(LAMP_CANT_DO_THAT);
    return { builtin: lamp };
  }
  if (intent.playing !== undefined || intent.volume !== undefined || intent.next !== undefined || intent.previous !== undefined || intent.query !== undefined) throw new DeviceError(LAMP_CANT_DO_THAT);
  const calls = actionsForIntent(intent, c.intents);
  if (!calls) throw new DeviceError(CONNECTOR_CANT_DO_THAT);
  for (const call of calls) {
    const action = c.connector.actions.find((a) => a.id === call.action);
    if (!action) throw new DeviceError(CONNECTOR_CANT_DO_THAT);
    const why = argsRefusal(action, call.args);
    if (why) throw new DeviceError(`${why} Nothing changed.`);
  }
  return { calls, approved: c };
}

/** A test build's simulated lamps follow the same connector rules as real
 *  ones: the same refusals, then the simulated answer. */
export function createConnectorGate(inner: DeviceConnector, connectorFor: (deviceId: string) => LampConnector): DeviceConnector {
  return {
    async run(intent) {
      if (!isWizDevice(intent.deviceId)) return inner.run(intent);
      checkLampIntent(intent, connectorFor(intent.deviceId));
      return inner.run(intent);
    },
  };
}

/** A real lamp the bridge can't reach right now (live mode only). */
export const LAMP_NOT_REACHABLE = 'Not reachable — the lamp bridge isn’t answering. Nothing changed.';

/** Live mode without a bridge at all: lamps are refused, never simulated;
 *  every other device goes to `fallback`. */
export function createUnreachableLampConnector(fallback: DeviceConnector): DeviceConnector {
  return {
    async run(intent) {
      if (isWizDevice(intent.deviceId)) throw new DeviceError(LAMP_NOT_REACHABLE);
      return fallback.run(intent);
    },
  };
}

/** A lamp was asked for something a lamp can't do (a volume, a track). */
export const LAMP_CANT_DO_THAT = "A lamp can't do that. Nothing changed.";

/** The one WiZ command a device intent becomes, or null when it holds
 *  nothing a lamp does. A scene, a colour and a white are separate bulb
 *  modes, so the most specific one asked for wins; then brightness; then
 *  plain power. Never a default: an unknown intent does not turn the bulb on. */
export function wizIntentFor(intent: DeviceIntent): LampIntent | null {
  // Speaker fields on a lamp: refused, whatever else rides along.
  if (intent.playing !== undefined || intent.volume !== undefined || intent.next !== undefined || intent.previous !== undefined || intent.query !== undefined) return null;
  // Off is off: "lamp to 0 %" must never reach the bulb as a dim (WiZ's floor
  // is 10 %, and a dim also turns the bulb ON).
  if (intent.on === false || intent.brightness === 0) return { kind: 'power', on: false };
  if (intent.sceneId !== undefined) return { kind: 'scene', sceneId: intent.sceneId };
  if (intent.rgb !== undefined) return { kind: 'color', rgb: intent.rgb };
  if (intent.temp !== undefined) return { kind: 'temp', temp: intent.temp };
  if (intent.brightness !== undefined) return { kind: 'dim', dimming: intent.brightness };
  if (intent.on === true) return { kind: 'power', on: true };
  return null;
}

const hex = (c: { r: number; g: number; b: number }): string =>
  `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;

/** What the bulb reported, as the tile's look; what was asked fills the gaps. */
function lookFrom(state: LampState | null, intent: DeviceIntent): Partial<DeviceState> {
  if (!state) return lampLook(intent);
  if (state.sceneId) return { sceneId: state.sceneId, color: '', temp: 0 };
  if (state.rgb) return { color: hex(state.rgb), sceneId: 0, temp: 0 };
  if (state.temp) return { temp: state.temp, color: '', sceneId: 0 };
  return lampLook(intent);
}

export function createWizAwareConnector(deps: WizConnectorDeps): DeviceConnector {
  const bulbIp = deps.bulbIp ?? (() => '');
  const ack = (state: LampState | null, intent: DeviceIntent): Partial<DeviceState> =>
    ({ on: state?.on ?? intent.on ?? true, brightness: state?.dimming ?? intent.brightness, ...lookFrom(state, intent), sim: false, unreachable: false });
  /** The generated connector's calls, each planned (allow-list, private
   *  address) before the first is sent, then sent through the fixed transport. */
  async function runGenerated(calls: ActionCall[], c: ApprovedConnector, intent: DeviceIntent): Promise<Partial<DeviceState>> {
    const ip = bulbIp(intent.deviceId);
    const plans = calls.map((call) => planRequest(c.connector, call.action, call.args, ip));
    for (const p of plans) if (!p.ok) throw new DeviceError(`${p.error} Nothing changed.`);
    // Every request is checked before the first one is sent: a press is sent
    // whole or refused whole, so "Nothing changed." is always true.
    const checked = plans.map((p) => (p.ok ? checkPlanned(p.request, { native: !!deps.native }) : { ok: false as const, why: 'Nothing changed.' }));
    for (const c of checked) if (!c.ok) throw new DeviceError(c.why);
    let state: LampState | null = null;
    /** True once a request of this press has really gone out. */
    let sent = false;
    for (const c of checked) {
      if (!c.ok) continue;
      let r: Awaited<ReturnType<typeof sendChecked>>;
      try { r = await sendChecked(c.checked, { wiz: deps.client, native: deps.native }); }
      catch (e) {
        // The bridge said no to a later request of this press: the earlier
        // ones already went out, so "the lamp did not change" is not true.
        if (sent && e instanceof BridgeRefusedError) throw new DeviceError(`The bridge refused a step (${e.message.replace(/[.\s]+$/, '')}). Part of this was already sent.`);
        throw e;
      }
      // Only an HTTP device can answer "no" after a send: when earlier
      // requests of this press already went out, the line says so.
      if (!r.ok) throw new DeviceError(!sent ? r.why : `${r.why.replace(/\s*Nothing changed\.$/, '')} Part of this was already sent.`);
      sent = true;
      if (r.state !== undefined) state = r.state;
    }
    return ack(state, intent);
  }
  return {
    async run(intent: DeviceIntent): Promise<Partial<DeviceState>> {
      // Checked before the bridge or the fallback: nothing reaches a bulb, real or simulated.
      const plan = isWizDevice(intent.deviceId) ? checkLampIntent(intent, deps.connectorFor ? deps.connectorFor(intent.deviceId) : 'built-in') : null;
      if (plan && deps.status.up) {
        try {
          if ('calls' in plan) return await runGenerated(plan.calls, plan.approved, intent);
          const state = await deps.client.setPilot(bulbIp(intent.deviceId), plan.builtin);
          return ack(state, intent);
        } catch (err) {
          // The bridge is up and refused the value (or the connector's request
          // was refused here): the lamp did not change and nothing is
          // simulated in its place — the store shows the refusal.
          if (err instanceof BridgeRefusedError || err instanceof DeviceError) throw err;
          deps.status.up = false; // bridge dropped mid-session — fall through below.
          deps.onDown?.();
        }
      }
      if (deps.honest && isWizDevice(intent.deviceId)) { deps.onRefusedUnreachable?.(); throw new DeviceError(LAMP_NOT_REACHABLE); }
      const res = await deps.fallback.run(intent);
      return isWizDevice(intent.deviceId) ? { ...res, sim: true } : res;
    },
  };
}
