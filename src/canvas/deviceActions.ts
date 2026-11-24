// Tile action -> intent -> connector. The device store is the source of truth;
// the tile only ever shows what the store projects. Optimistic pending state,
// confirmed on ack, rolled back with an error on failure or timeout.
import { deviceUpdate, type A2uiMessage, type DeviceState } from './surfacePlan';

export type LampIntent = { deviceId: string; on?: boolean; brightness?: number };
export type MusicIntent = { deviceId: string; playing?: boolean; volume?: number; next?: boolean };
export type SwitchIntent = { deviceId: string; on?: boolean };
export type DeviceIntent = {
  deviceId: string;
  on?: boolean;
  brightness?: number;
  playing?: boolean;
  volume?: number;
  next?: boolean;
  /** "play <something>": a search for the speaker's music service (never shown on the tile). */
  query?: string;
};

export interface DeviceConnector {
  run(intent: DeviceIntent): Promise<Partial<DeviceState>>;
}

export interface DeviceStore {
  get(id: string): DeviceState;
  all(): Record<string, DeviceState>;
  act(intent: DeviceIntent): Promise<DeviceState>;
  /** Flag a device as simulated (or not) without a network round trip —
   *  used once the WiZ bridge's reachability is known. */
  setSim(id: string, sim: boolean): void;
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

      const brightness = intent.brightness === undefined
        ? prev.brightness
        : Math.max(0, Math.min(100, Math.round(intent.brightness)));
      const volume = intent.volume === undefined
        ? prev.volume
        : Math.max(0, Math.min(100, Math.round(intent.volume)));

      const isMusic = intent.playing !== undefined || intent.volume !== undefined || intent.next !== undefined;

      const optimistic: DeviceState = {
        ...prev,
        pending: true,
        error: '',
      };
      if (intent.on !== undefined) optimistic.on = intent.on;
      if (brightness !== undefined) optimistic.brightness = brightness;
      if (intent.playing !== undefined) optimistic.playing = intent.playing;
      if (volume !== undefined) optimistic.volume = volume;

      state[intent.deviceId] = optimistic;
      publish(intent.deviceId);

      try {
        const fullIntent: DeviceIntent = { ...intent };
        if (brightness !== undefined) fullIntent.brightness = brightness;
        if (volume !== undefined) fullIntent.volume = volume;

        const ack = await Promise.race([
          connector.run(fullIntent),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
        ]);
        state[intent.deviceId] = {
          ...state[intent.deviceId],
          ...ack,
          pending: false,
          error: '',
        };
      } catch (e) {
        const isTimeout = e instanceof Error && e.message === 'timeout';
        const why = isTimeout
          ? (isMusic ? "Couldn't reach the music player" : "Couldn't reach the lamp")
          : (isMusic ? 'Music player refused the change' : 'Lamp refused the change');
        state[intent.deviceId] = { ...prev, pending: false, error: why };
      }
      publish(intent.deviceId);
      return state[intent.deviceId];
    },
    setSim(id, sim) {
      if (!state[id]) return;
      state[id] = { ...state[id], sim };
      publish(id);
    },
  };
}
