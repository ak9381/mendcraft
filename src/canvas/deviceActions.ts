// Tile action -> intent -> connector. The device store is the source of truth;
// the tile only ever shows what the store projects. Optimistic pending state,
// confirmed on ack, rolled back with an error on failure or timeout.
import { deviceUpdate, type A2uiMessage, type DeviceState } from './surfacePlan';

export type LampIntent = { deviceId: string; on?: boolean; brightness?: number };

export interface DeviceConnector {
  run(intent: LampIntent): Promise<{ on: boolean; brightness: number }>;
}

export interface DeviceStore {
  get(id: string): DeviceState;
  all(): Record<string, DeviceState>;
  act(intent: LampIntent): Promise<DeviceState>;
}

export function createDeviceStore(
  initial: Record<string, DeviceState>,
  connector: DeviceConnector,
  emit: (m: A2uiMessage) => void,
  surfaceId: () => string | null,
  timeoutMs = 3000,
): DeviceStore {
  const state: Record<string, DeviceState> = structuredClone(initial);
  const publish = (id: string) => { const s = surfaceId(); if (s) emit(deviceUpdate(s, id, state[id])); };
  return {
    get: (id) => state[id],
    all: () => structuredClone(state),
    async act(intent) {
      const prev = state[intent.deviceId];
      if (!prev) throw new Error(`unknown device ${intent.deviceId}`);
      const brightness = intent.brightness === undefined ? prev.brightness : Math.max(0, Math.min(100, Math.round(intent.brightness)));
      state[intent.deviceId] = { ...prev, on: intent.on ?? prev.on, brightness, pending: true, error: '' };
      publish(intent.deviceId);
      try {
        const ack = await Promise.race([
          connector.run({ ...intent, brightness }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
        ]);
        state[intent.deviceId] = { on: ack.on, brightness: ack.brightness, pending: false, error: '' };
      } catch (e) {
        const why = e instanceof Error && e.message === 'timeout' ? "Couldn't reach the lamp" : 'Lamp refused the change';
        state[intent.deviceId] = { ...prev, pending: false, error: why };
      }
      publish(intent.deviceId);
      return state[intent.deviceId];
    },
  };
}
