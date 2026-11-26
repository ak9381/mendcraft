// Wires the canvas's lamp devices (ids starting 'wiz-') to the real local WiZ
// bridge (scripts/wiz-bridge.mjs, via src/devices/wizClient) when it answers;
// every other device, and every wiz- device while the bridge is unreachable,
// falls through to `fallback` (the canvas's own simulated connector) — tagged
// `sim: true` so the tile shows it's not the real bulb.
import { DeviceError, lampLook, type DeviceConnector, type DeviceIntent } from './deviceActions';
import type { DeviceState } from './surfacePlan';
import { BridgeRefusedError, type WizClient } from '../devices/wizClient';
import type { LampIntent, LampState } from '../devices/wiz';

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
  return {
    async run(intent: DeviceIntent): Promise<Partial<DeviceState>> {
      // Checked before the bridge or the fallback: nothing reaches a bulb, real or simulated.
      const lamp = isWizDevice(intent.deviceId) ? wizIntentFor(intent) : null;
      if (isWizDevice(intent.deviceId) && !lamp) throw new DeviceError(LAMP_CANT_DO_THAT);
      if (lamp && deps.status.up) {
        try {
          const state = await deps.client.setPilot(bulbIp(intent.deviceId), lamp);
          return { on: state?.on ?? intent.on ?? true, brightness: state?.dimming ?? intent.brightness, ...lookFrom(state, intent), sim: false, unreachable: false };
        } catch (err) {
          // The bridge is up and refused the value: the lamp did not change and
          // nothing is simulated in its place — the store shows the refusal.
          if (err instanceof BridgeRefusedError) throw err;
          deps.status.up = false; // bridge dropped mid-session — fall through below.
          deps.onDown?.();
        }
      }
      if (deps.honest && isWizDevice(intent.deviceId)) { deps.onRefusedUnreachable?.(); throw new DeviceError(LAMP_NOT_REACHABLE); }
      const ack = await deps.fallback.run(intent);
      return isWizDevice(intent.deviceId) ? { ...ack, sim: true } : ack;
    },
  };
}
