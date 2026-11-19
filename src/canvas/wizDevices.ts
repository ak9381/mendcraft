// Wires the canvas's stub lamp devices ('wiz-desk', 'wiz-ceiling') to the real
// local WiZ bridge (scripts/wiz-bridge.mjs, via src/devices/wizClient) when it
// answers; every other device, and every wiz- device while the bridge is
// unreachable, falls through to `fallback` (the canvas's own simulated
// connector) — tagged `sim: true` so the tile shows it's not the real bulb.
import type { DeviceConnector, DeviceIntent } from './deviceActions';
import type { DeviceState } from './surfacePlan';
import type { WizClient } from '../devices/wizClient';

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

export function createWizAwareConnector(deps: WizConnectorDeps): DeviceConnector {
  const bulbIp = deps.bulbIp ?? (() => '');
  return {
    async run(intent: DeviceIntent): Promise<Partial<DeviceState>> {
      if (isWizDevice(intent.deviceId) && deps.status.up) {
        try {
          const lampIntent = intent.brightness !== undefined
            ? { kind: 'dim' as const, dimming: intent.brightness }
            : { kind: 'power' as const, on: intent.on ?? true };
          const state = await deps.client.setPilot(bulbIp(intent.deviceId), lampIntent);
          return { on: state?.on ?? intent.on ?? true, brightness: state?.dimming ?? intent.brightness, sim: false };
        } catch {
          deps.status.up = false; // bridge dropped mid-session — fall through below.
        }
      }
      const ack = await deps.fallback.run(intent);
      return isWizDevice(intent.deviceId) ? { ...ack, sim: true } : ack;
    },
  };
}
