// The replay engine: a tiny SurfaceEngine that answers a turn with a reply
// recorded from a real model run (or, as a labelled stop-gap, hand-written).
// It holds NO replies itself — they come from tests/fixtures/replies/, which
// the e2e script hands the page as window.__mcFixtures before it loads, or a
// unit test passes inline. canvasMain wires it only in DEV / VITE_E2E builds
// with ?sim=1, and every turn it answers says "Replay · recorded reply" when
// the reply was captured from a live run, or "Replay · written example" when
// it was hand-written (or nothing says it was recorded).
// A turn kind with no recorded reply fails loudly — nothing is made up.
import type { EngineId, SurfaceEngine } from './aiTurn';
import type { DeviceState } from './surfacePlan';

/** What one model turn is for; a recorded reply is keyed by engine + kind. */
export type TurnKind =
  | 'board' | 'boardBetter' | 'devices' | 'plan' | 'planEdit' | 'pack'
  | 'connector' | 'steps' | 'morph' | 'selfCheck' | 'break' | 'identify'
  /** An open-ended question ("what can you do?"): a short spoken reply. */
  | 'ask';

export const TURN_KINDS: readonly TurnKind[] = [
  'board', 'boardBetter', 'devices', 'plan', 'planEdit', 'pack',
  'connector', 'steps', 'morph', 'selfCheck', 'break', 'identify', 'ask',
];

export const REPLAY_ROUTE = 'Replay · recorded reply';
/** A hand-written stand-in reply: never passed off as a recording. */
export const WRITTEN_ROUTE = 'Replay · written example';
/** The replay label inside a route line, or null when it is not a replay. */
export function replayRouteIn(line: string | undefined): string | null {
  if (!line) return null;
  return line.includes(WRITTEN_ROUTE) ? WRITTEN_ROUTE : line.includes(REPLAY_ROUTE) ? REPLAY_ROUTE : null;
}
export const NO_MODEL_LINE = 'No model is available here. Nothing was generated.';

/** `<engine>.<turnKind>[.<n>]` — the fixture file name without `.json`. */
export function replayKey(engine: EngineId, kind: TurnKind, n?: number): string {
  return n === undefined ? `${engine}.${kind}` : `${engine}.${kind}.${n}`;
}

export const missingReplyLine = (key: string): string => `No recorded reply for ${key}. Nothing was generated.`;

/** Engine factories that answer from `replies` (key → reply text). The nth
 *  turn of one kind on one engine (counted as it streams) takes `<key>.<n>`
 *  when that is recorded, else `<key>`. `recorded` lists the keys captured
 *  from a live run; every other reply is labelled a written example. */
export function createReplayEngines(replies: Record<string, string>, o: { recorded?: readonly string[] } = {}): Partial<Record<EngineId, (kind: TurnKind) => SurfaceEngine>> {
  const book: Record<string, string> = {};
  for (const [k, v] of Object.entries(replies ?? {})) if (typeof v === 'string') book[k] = v;
  const recorded = new Set((Array.isArray(o.recorded) ? o.recorded : []).filter((k) => typeof k === 'string'));
  const turns = new Map<string, number>();
  /** The key the next (or this) turn of a kind answers from. */
  const keyFor = (id: EngineId, kind: TurnKind, n: number): string =>
    book[replayKey(id, kind, n)] !== undefined ? replayKey(id, kind, n) : replayKey(id, kind);
  const routeOf = (key: string): string => (recorded.has(key) ? REPLAY_ROUTE : WRITTEN_ROUTE);
  const make = (id: EngineId) => (kind: TurnKind): SurfaceEngine => {
    const base = replayKey(id, kind);
    // Before it streams: the reply this turn will take; after: the one it took.
    let key = keyFor(id, kind, (turns.get(base) ?? 0) + 1);
    return {
      id, sim: true,
      get routeLine() { return routeOf(key); },
      // Counted when a turn really streams, not when an engine is looked up.
      async stream(_prompt, onText) {
        const n = (turns.get(base) ?? 0) + 1;
        turns.set(base, n);
        key = keyFor(id, kind, n);
        const reply = book[key];
        if (reply === undefined) throw new Error(missingReplyLine(key));
        onText(reply);
        return reply;
      },
    };
  };
  return { nano: make('nano'), gemini: make('gemini') };
}

/** At most this many fixture devices in one run. */
export const FIXTURE_DEVICES_MAX = 8;
const FIXTURE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The devices a test run registers (`window.__mcFixtures.devices =
 *  [{ id, cls, label }]`): simulated, answered by simulatedAck, every one
 *  labelled SIM. canvasMain reads them only in a test build with ?sim=1.
 *  Lamps and speakers only; anything malformed is skipped. */
export function fixtureDevices(raw: unknown): { devices: Record<string, DeviceState>; labels: Record<string, string> } | null {
  if (!Array.isArray(raw)) return null;
  const devices: Record<string, DeviceState> = {};
  const labels: Record<string, string> = {};
  for (const d of raw.slice(0, FIXTURE_DEVICES_MAX)) {
    if (!d || typeof d !== 'object') continue;
    const { id, cls, label } = d as Record<string, unknown>;
    if (typeof id !== 'string' || !FIXTURE_ID.test(id) || devices[id]) continue;
    if (cls !== 'lamp' && cls !== 'music') continue;
    devices[id] = cls === 'lamp'
      ? { cls: 'lamp', on: false, brightness: 50, sim: true, unreachable: false }
      : { cls: 'music', on: false, brightness: 0, playing: false, volume: 50, sim: true };
    labels[id] = typeof label === 'string' && label.trim() && !/[<>]/.test(label) ? label.trim().slice(0, 40) : id;
  }
  return Object.keys(devices).length ? { devices, labels } : null;
}
