// Tile action -> intent -> connector. The device store is the source of truth;
// the tile only ever shows what the store projects. Optimistic pending state,
// confirmed on ack, rolled back with an error on failure or timeout.
import { levelRefusal } from './deviceGuard';
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

/** A failure whose message is meant for the person ("Spotify needs Premium
 *  to control playback."): the store shows it on the tile as it is. */
export class DeviceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceError';
  }
}

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
  /** A device that was really found joins the list (or its state is replaced). */
  add(id: string, state: DeviceState): void;
  /** A device that is not really there leaves the list. */
  remove(id: string): void;
}

export const LAMP_OFF_REFUSAL = 'The lamp is off — turn it on first. Nothing changed.';
/** A brightness change that does not ask for "on", on a lamp that is off:
 *  sent to a real bulb it would switch it ON (at 10 %). */
export const lampOffRefusal = (cur: DeviceState, i: DeviceIntent): boolean =>
  !cur.on && i.on === undefined && i.brightness !== undefined && i.brightness > 0;

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
      // And a lamp that is off stays off: only an explicit "on" (a chip, the
      // + button, "turn it on") lights it — a dim or a step down never does.
      const refusal = levelRefusal(intent) ?? (lampOffRefusal(prev, intent) ? LAMP_OFF_REFUSAL : null);
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
        const why = e instanceof DeviceError && e.message ? e.message : isTimeout
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
    add(id, s) {
      state[id] = structuredClone(s);
      publish(id);
    },
    remove(id) {
      delete state[id];
    },
  };
}

/** A tile press -> the one intent it means, or null (unknown action, or a
 *  preset key the tile never offered). Pure: both render paths and the tests
 *  go through it. `value` is the pressed chip's own value — a preset key, or
 *  a number for a level set directly (keyboard fine steps). Values are passed
 *  on as asked: the store refuses anything out of range. */
export function tileIntent(name: string, deviceId: string, cur: DeviceState, _value?: string | number): DeviceIntent | null {
  switch (name) {
    // Lamp and speaker presses are generated controls now: device.act → controlSpec.ts.
    case 'switch.toggle': return { deviceId, on: !cur.on };
    default: return null;
  }
}

/** Intents that set a level outright (a chip, or a keyboard fine step). */
export const isLevelSet = (i: DeviceIntent): boolean => i.brightness !== undefined || i.temp !== undefined || i.volume !== undefined;
/** Intents that change a lamp's power or look: anything still waiting to set a level is stale after one. */
const supersedesLevels = (i: DeviceIntent): boolean => i.on !== undefined || i.sceneId !== undefined || i.rgb !== undefined;

export const ACT_GAP_MS = 150;

/** Every tile press for a device goes through ONE lane, in order, one command
 *  in flight at a time.
 *  - Level sets are calmed: at most one every `gapMs`, and while one is out
 *    only the LATEST value asked for is kept. A held key or a burst of presses
 *    is never a burst of lamp commands with overlapping rollbacks — a failure
 *    rolls back to the last value that was really applied.
 *  - Anything else (power, toggle, scene, colour, transport) runs in the order
 *    it was pressed. A power or look change also DROPS a level set still
 *    waiting: "off" pressed after a brightness chip must leave the lamp off,
 *    never relit by the stale chip. */
export function createActQueue(
  store: Pick<DeviceStore, 'act'>,
  gapMs = ACT_GAP_MS,
  clock: { now(): number; later(f: () => void, ms: number): unknown } = { now: () => Date.now(), later: (f, ms) => setTimeout(f, ms) },
): {
  /** Resolves with the device's state once THIS command has been applied. A
   *  level set that was replaced or dropped resolves with the result of the
   *  command that took its place. Never needs a catch for the lane to run. */
  act(intent: DeviceIntent): Promise<DeviceState>;
  pending(deviceId: string): boolean;
} {
  type Waiter = { resolve(s: DeviceState): void; reject(e: unknown): void };
  interface Job { intent: DeviceIntent; waiters: Waiter[] }
  interface Lane { busy: boolean; lastAt: number; next: Job | null; ordered: Job[]; timer: boolean }
  const lanes = new Map<string, Lane>();
  const lane = (id: string): Lane => {
    let l = lanes.get(id);
    if (!l) { l = { busy: false, lastAt: -Infinity, next: null, ordered: [], timer: false }; lanes.set(id, l); }
    return l;
  };
  function send(id: string, l: Lane, job: Job): void {
    l.busy = true;
    let p: Promise<DeviceState>;
    try { p = store.act(job.intent); } catch (e) { p = Promise.reject(e); }
    void p.then(
      (s) => { job.waiters.forEach((w) => w.resolve(s)); },
      (e) => { job.waiters.forEach((w) => w.reject(e)); },
    ).then(() => { l.busy = false; pump(id); });
  }
  function pump(id: string): void {
    const l = lane(id);
    if (l.busy) return;
    // Presses that are not level sets first, in the order they came.
    const ordered = l.ordered.shift();
    if (ordered) { send(id, l, ordered); return; }
    if (!l.next) return;
    const wait = l.lastAt + gapMs - clock.now();
    if (wait > 0) {
      if (!l.timer) { l.timer = true; clock.later(() => { l.timer = false; pump(id); }, wait); }
      return;
    }
    const job = l.next;
    l.next = null; l.lastAt = clock.now();
    send(id, l, job);
  }
  return {
    act(intent) {
      const l = lane(intent.deviceId);
      const done = new Promise<DeviceState>((resolve, reject) => {
        const job: Job = { intent, waiters: [{ resolve, reject }] };
        if (isLevelSet(intent) && intent.on !== false) {
          // Latest wins; whoever waited on the replaced value waits on this one.
          if (l.next) job.waiters.push(...l.next.waiters);
          l.next = job;
        } else {
          if (supersedesLevels(intent) && l.next) { job.waiters.push(...l.next.waiters); l.next = null; }
          l.ordered.push(job);
        }
      });
      done.catch(() => undefined); // a caller that does not listen never leaves a rejection unhandled
      pump(intent.deviceId);
      return done;
    },
    pending: (id) => { const l = lanes.get(id); return !!l && (l.busy || !!l.next || l.ordered.length > 0); },
  };
}

/** What a spoken device command says once its commands have really been
 *  answered: the parser's line when they applied, the store's own refusal
 *  when they did not ("The lamp is off — turn it on first. Nothing changed."
 *  instead of "Dimmed …"). Some applied and some refused: both are said.
 *  `results` are the settled lane promises, one per intent. Pure. */
export function spokenStatus(results: readonly PromiseSettledResult<DeviceState>[], okLine: string): string {
  const errors = results.map((r) => (r.status === 'fulfilled' ? r.value.error ?? '' : 'That device did not answer. Nothing changed.')).filter((e) => !!e);
  if (!errors.length) return okLine;
  const first = errors[0];
  return errors.length === results.length ? first : `${okLine} ${first}`;
}
