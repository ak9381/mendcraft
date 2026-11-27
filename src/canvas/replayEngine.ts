// The replay engine: a tiny SurfaceEngine that answers a turn with a reply
// recorded from a real model run (or, as a labelled stop-gap, hand-written).
// It holds NO replies itself — they come from tests/fixtures/, which
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
 *  when that is recorded, else `<key>`. A turn asked with a `sub` (the
 *  language of a pack turn: `gemini.pack.kn`) takes `<key>.<sub>.<n>`, then
 *  `<key>.<sub>`, before those. `recorded` lists the keys captured from a
 *  live run; every other reply is labelled a written example. */
export function createReplayEngines(replies: Record<string, string>, o: { recorded?: readonly string[]; liveShape?: readonly string[] } = {}): Partial<Record<EngineId, (kind: TurnKind, sub?: string) => SurfaceEngine>> {
  const book: Record<string, string> = {};
  for (const [k, v] of Object.entries(replies ?? {})) if (typeof v === 'string') book[k] = v;
  const recorded = new Set((Array.isArray(o.recorded) ? o.recorded : []).filter((k) => typeof k === 'string'));
  // A recorded reply is what the live model wrote on the production path;
  // a hand-written one may say so too (`shape: "live"` in its file).
  const liveShaped = new Set([...recorded, ...(Array.isArray(o.liveShape) ? o.liveShape : []).filter((k) => typeof k === 'string')]);
  const turns = new Map<string, number>();
  /** The key the next (or this) turn of a kind answers from. */
  const keyFor = (id: EngineId, kind: TurnKind, n: number, sub?: string): string => {
    const base = replayKey(id, kind);
    const tries = [...(sub ? [`${base}.${sub}.${n}`, `${base}.${sub}`] : []), replayKey(id, kind, n)];
    return tries.find((k) => book[k] !== undefined) ?? base;
  };
  const routeOf = (key: string): string => (recorded.has(key) ? REPLAY_ROUTE : WRITTEN_ROUTE);
  const make = (id: EngineId) => (kind: TurnKind, sub?: string): SurfaceEngine => {
    const base = replayKey(id, kind);
    // Before it streams: the reply this turn will take; after: the one it took.
    let key = keyFor(id, kind, (turns.get(base) ?? 0) + 1, sub);
    return {
      id, sim: true,
      get routeLine() { return routeOf(key); },
      // The reply this turn takes was written on the live path: the turn
      // runs that path too (a Nano board turn asks for and parses {t,d}).
      get liveShape() { return liveShaped.has(key); },
      // Counted when a turn really streams, not when an engine is looked up.
      async stream(_prompt, onText) {
        const n = (turns.get(base) ?? 0) + 1;
        turns.set(base, n);
        key = keyFor(id, kind, n, sub);
        const reply = book[key];
        if (reply === undefined) throw new Error(missingReplyLine(key));
        onText(reply);
        return reply;
      },
    };
  };
  return { nano: make('nano'), gemini: make('gemini') };
}

/** What a recording reports with each reply (the fixture file's fields). */
export interface RecordedMeta { engine: EngineId; model: string; turnKind: TurnKind; promptSha: string }
export type RecordSink = (key: string, reply: string, meta: RecordedMeta) => void;
type EngineFactory = (kind: TurnKind, sub?: string) => SurfaceEngine | undefined;

/** sha-256 of the prompt, hex; '' where the browser has no SubtleCrypto. */
async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return '';
  try {
    const d = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return ''; }
}

/** The live engines, wrapped so every reply a turn really got is reported to
 *  `sink` once, under the key a replay of the same run looks it up by: the
 *  first turn of a kind is `<key>` (or `<key>.<sub>`), a later one
 *  `<key>.<n>` (n counted per engine and kind, as the replay counts — a
 *  turn that failed still counts, so a replay meets the same gap). The
 *  reply is passed through unchanged; a turn that fails reports nothing.
 *  The engine stays live (`sim: false`): a recorded turn runs the production
 *  path — its prompt, responseConstraint, retries, ledger and checks — and a
 *  replay of it runs that path again (`liveShape`). A reply is kept under
 *  the engine that really answered: when a step's slot is served by the
 *  other engine (no Nano here, so the "nano" step is Gemini in the cloud)
 *  nothing is recorded for it — a cloud reply is never filed as Nano's —
 *  and `onSkip` says so. `onFlight` hears how many turns are streaming.
 *  canvasMain wires this only in a test build with ?record=1&sim=1 — never
 *  in production. */
export function recordingEngines(
  live: Partial<Record<EngineId, EngineFactory>>,
  sink: RecordSink,
  o: { modelOf?: (id: EngineId) => string; onSkip?: (line: string) => void; onFlight?: (n: number) => void } = {},
): Partial<Record<EngineId, EngineFactory>> {
  const modelOf = o.modelOf ?? ((id: EngineId) => (id === 'nano' ? 'gemini-nano' : 'gemini'));
  const turns = new Map<string, number>();
  let flying = 0;
  const flight = (d: number): void => { flying += d; o.onFlight?.(flying); };
  const keyFor = (base: string, n: number, sub?: string): string => {
    const first = sub ? `${base}.${sub}` : base;
    return n === 1 ? first : `${first}.${n}`;
  };
  const wrap = (id: EngineId, make: EngineFactory): EngineFactory => (kind, sub) => {
    const engine = make(kind, sub);
    if (!engine) return undefined;
    const base = replayKey(id, kind);
    return {
      ...engine,
      async stream(prompt, onText, opts) {
        // Counted for the slot either way: a replay asks this slot this turn.
        const n = (turns.get(base) ?? 0) + 1;
        turns.set(base, n);
        const key = keyFor(base, n, sub);
        flight(1);
        try {
          const reply = await engine.stream(prompt, onText, opts);
          if (engine.id !== id) o.onSkip?.(`Not recorded: ${key} was answered by ${engine.id}, not ${id}.`);
          else sink(key, reply, { engine: engine.id, model: modelOf(engine.id), turnKind: kind, promptSha: await sha256Hex(prompt) });
          return reply;
        } finally { flight(-1); }
      },
      // Nano handing a turn off to Gemini streams the handoff engine directly:
      // that turn is in flight too (a recording waits for it), and it is a
      // cloud reply, so it is never filed in Nano's slot.
      ...(engine.handoff ? { handoff: {
        ...engine.handoff,
        async stream(prompt: string, onText: (t: string) => void, opts?: Parameters<NonNullable<typeof engine.handoff>['stream']>[2]) {
          flight(1);
          try {
            const reply = await engine.handoff!.stream(prompt, onText, opts);
            o.onSkip?.(`Not recorded: a ${kind} turn ${id} handed off to ${engine.handoff!.id}.`);
            return reply;
          } finally { flight(-1); }
        },
      } } : {}),
    };
  };
  const out: Partial<Record<EngineId, EngineFactory>> = {};
  for (const id of ['nano', 'gemini'] as const) { const f = live[id]; if (f) out[id] = wrap(id, f); }
  return out;
}

/** At most this many fixture devices in one run. */
export const FIXTURE_DEVICES_MAX = 8;
const FIXTURE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The devices a test run registers (`window.__mcFixtures.devices =
 *  [{ id, cls, label, volume? }]`): simulated, answered by simulatedAck, every
 *  one labelled SIM. canvasMain reads them only in a test build with ?sim=1.
 *  Lamps and speakers go into the device store; a speaker's volume is what
 *  the fixture says (0–100), else unknown until something reads it — never
 *  a made-up number. A `gimbal` entry is the stand docked on the SIM iPhone
 *  (`stand: true`): it is not a store device, the iPhone reports it, and it
 *  counts only while that SIM iPhone is paired. Anything malformed is skipped. */
export function fixtureDevices(raw: unknown): { devices: Record<string, DeviceState>; labels: Record<string, string>; stand: boolean } | null {
  if (!Array.isArray(raw)) return null;
  const devices: Record<string, DeviceState> = {};
  const labels: Record<string, string> = {};
  let stand = false;
  for (const d of raw.slice(0, FIXTURE_DEVICES_MAX)) {
    if (!d || typeof d !== 'object') continue;
    const { id, cls, label, volume } = d as Record<string, unknown>;
    if (cls === 'gimbal') { stand = true; continue; }
    if (typeof id !== 'string' || !FIXTURE_ID.test(id) || devices[id]) continue;
    if (cls !== 'lamp' && cls !== 'music') continue;
    const vol = typeof volume === 'number' && Number.isInteger(volume) && volume >= 0 && volume <= 100 ? volume : undefined;
    devices[id] = cls === 'lamp'
      ? { cls: 'lamp', on: false, brightness: 50, sim: true, unreachable: false }
      : { cls: 'music', on: false, brightness: 0, playing: false, ...(vol !== undefined ? { volume: vol } : {}), sim: true };
    labels[id] = typeof label === 'string' && label.trim() && !/[<>]/.test(label) ? label.trim().slice(0, 40) : id;
  }
  return Object.keys(devices).length || stand ? { devices, labels, stand } : null;
}
