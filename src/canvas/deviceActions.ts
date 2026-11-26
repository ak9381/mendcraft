// Tile action -> intent -> connector. The device store is the source of truth;
// the tile only ever shows what the store projects. Optimistic pending state,
// confirmed on ack, rolled back with an error on failure or timeout.
import { lampStep, levelRefusal } from './deviceGuard';
import { LAMP_TILE_STEP, VOLUME_TILE_STEP, colourIntent, sceneIntent, tempStep, whiteIntent } from './lampPresets';
import { deviceUpdate, type A2uiMessage, type DeviceState } from './surfacePlan';

export type LampIntent = { deviceId: string; on?: boolean; brightness?: number };
export type MusicIntent = { deviceId: string; playing?: boolean; volume?: number; next?: boolean };
export type SwitchIntent = { deviceId: string; on?: boolean };
export type DeviceIntent = {
  deviceId: string;
  on?: boolean;
  brightness?: number;
  /** Lamp white, in Kelvin (2200–6500). */
  temp?: number;
  /** Lamp colour, each channel 0–255. */
  rgb?: { r: number; g: number; b: number };
  /** Lamp scene (a WiZ sceneId). */
  sceneId?: number;
  playing?: boolean;
  volume?: number;
  next?: boolean;
  previous?: boolean;
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
  /** Set display-only facts (which music service a speaker uses) without an action. */
  patch(id: string, part: Partial<DeviceState>): void;
}

/** A "play <query>" turn is a multi-step search-and-play, not a quick ack. */
export const QUERY_TIMEOUT_MS = 15000;

const hex = (c: { r: number; g: number; b: number }): string =>
  `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;

/** What a lamp's look becomes after an intent: a colour, a white and a scene
 *  replace each other (the bulb is only ever in one of those modes). */
export function lampLook(intent: DeviceIntent): Partial<DeviceState> {
  if (intent.sceneId !== undefined) return { sceneId: intent.sceneId, color: '', temp: 0 };
  if (intent.rgb !== undefined) return { color: hex(intent.rgb), sceneId: 0, temp: 0 };
  if (intent.temp !== undefined) return { temp: intent.temp, color: '', sceneId: 0 };
  return {};
}

/** The built-in (simulated) device: it does what it was asked, nothing more.
 *  Pure, so the SIM path is testable; the canvas adds only the delay. */
export function simulatedAck(cur: DeviceState, i: DeviceIntent, tracks: readonly string[] = []): Partial<DeviceState> {
  const look = lampLook(i);
  const ack: Partial<DeviceState> = { on: i.on ?? (Object.keys(look).length ? true : cur.on), brightness: i.brightness ?? cur.brightness, ...look };
  if (i.playing !== undefined) ack.playing = i.playing;
  if (i.volume !== undefined) ack.volume = i.volume;
  if ((i.next || i.previous) && tracks.length) {
    const at = tracks.indexOf(cur.trackTitle ?? '');
    ack.trackTitle = tracks[(at + (i.next ? 1 : -1) + tracks.length) % tracks.length];
    ack.playing = true;
  }
  return ack;
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
      // Refuse, never clamp: an out-of-range level changes nothing and says why.
      const refusal = levelRefusal(intent);
      if (refusal) {
        state[intent.deviceId] = { ...prev, pending: false, error: refusal };
        publish(intent.deviceId);
        return state[intent.deviceId];
      }

      const brightness = intent.brightness === undefined
        ? prev.brightness
        : Math.max(0, Math.min(100, Math.round(intent.brightness)));
      const volume = intent.volume === undefined
        ? prev.volume
        : Math.max(0, Math.min(100, Math.round(intent.volume)));

      const isMusic = intent.playing !== undefined || intent.volume !== undefined || intent.next !== undefined || intent.previous !== undefined;

      const optimistic: DeviceState = {
        ...prev,
        ...lampLook(intent),
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
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), intent.query ? Math.max(timeoutMs, QUERY_TIMEOUT_MS) : timeoutMs)),
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
    patch(id, part) {
      if (!state[id]) return;
      state[id] = { ...state[id], ...part };
      publish(id);
    },
  };
}

/** A tile press -> the one intent it means, or null (unknown action, or a
 *  preset key the tile never offered). Pure: both render paths and the tests
 *  go through it. `value` is the pressed chip's own value — a preset key, or
 *  a number for a level set directly (keyboard fine steps). Values are passed
 *  on as asked: the store refuses anything out of range. */
export function tileIntent(name: string, deviceId: string, cur: DeviceState, value?: string | number): DeviceIntent | null {
  const num = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const key = typeof value === 'string' ? value : '';
  switch (name) {
    case 'lamp.toggle':
    case 'switch.toggle': return { deviceId, on: !cur.on };
    case 'lamp.brighter': return { deviceId, on: true, brightness: lampStep(cur.brightness + LAMP_TILE_STEP) };
    case 'lamp.dimmer': return { deviceId, brightness: lampStep(cur.brightness - LAMP_TILE_STEP) };
    case 'lamp.level': return num === null ? null : { deviceId, on: true, brightness: num };
    case 'lamp.color': return colourIntent(deviceId, key);
    case 'lamp.scene': return sceneIntent(deviceId, key);
    case 'lamp.white': return num !== null ? { deviceId, on: true, temp: num } : whiteIntent(deviceId, key);
    case 'lamp.warmer': return { deviceId, on: true, temp: tempStep(cur.temp, -1) };
    case 'lamp.cooler': return { deviceId, on: true, temp: tempStep(cur.temp, 1) };
    case 'music.playPause': return { deviceId, playing: !cur.playing };
    case 'music.next': return { deviceId, next: true };
    case 'music.previous': return { deviceId, previous: true };
    case 'music.louder': return { deviceId, volume: Math.min(100, (cur.volume ?? 50) + VOLUME_TILE_STEP) };
    case 'music.softer': return { deviceId, volume: Math.max(0, (cur.volume ?? 50) - VOLUME_TILE_STEP) };
    case 'music.volume': return num === null ? null : { deviceId, volume: num };
    default: return null;
  }
}
