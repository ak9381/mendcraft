// Wires the canvas's lamp devices (ids starting 'wiz-') to the real local WiZ
// bridge (scripts/wiz-bridge.mjs, via src/devices/wizClient) when it answers;
// every other device, and every wiz- device while the bridge is unreachable,
// falls through to `fallback` (the canvas's own simulated connector) — tagged
// `sim: true` so the tile shows it's not the real bulb.
import { lampLook, type DeviceConnector, type DeviceIntent } from './deviceActions';
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
}

/** The one WiZ command a device intent becomes. A scene, a colour and a white
 *  are separate bulb modes, so the most specific one asked for wins; then
 *  brightness; then plain power. */
export function wizIntentFor(intent: DeviceIntent): LampIntent {
  if (intent.sceneId !== undefined) return { kind: 'scene', sceneId: intent.sceneId };
  if (intent.rgb !== undefined) return { kind: 'color', rgb: intent.rgb };
  if (intent.temp !== undefined) return { kind: 'temp', temp: intent.temp };
  if (intent.brightness !== undefined) return { kind: 'dim', dimming: intent.brightness };
  return { kind: 'power', on: intent.on ?? true };
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
      if (isWizDevice(intent.deviceId) && deps.status.up) {
        try {
          const state = await deps.client.setPilot(bulbIp(intent.deviceId), wizIntentFor(intent));
          return { on: state?.on ?? intent.on ?? true, brightness: state?.dimming ?? intent.brightness, ...lookFrom(state, intent), sim: false };
        } catch (err) {
          // The bridge is up and refused the value: the lamp did not change and
          // nothing is simulated in its place — the store shows the refusal.
          if (err instanceof BridgeRefusedError) throw err;
          deps.status.up = false; // bridge dropped mid-session — fall through below.
        }
      }
      const ack = await deps.fallback.run(intent);
      return isWizDevice(intent.deviceId) ? { ...ack, sim: true } : ack;
    },
  };
}
