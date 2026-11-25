// Which engine really runs each step, with an honest label. Nano runs on the
// device when Chrome's Prompt API is here and we're not on a phone, or when
// Android ML Kit / Apple Intelligence is available in the native shell;
// otherwise the "Nano" step is drafted by Gemini in the cloud and says so.
// Gemini is real when a cloud TextGenModel is reachable, else a scripted SIM.
// planEngines() is pure (unit-tested); createEngines() wires the real I/O.
import { scriptedEngine, type EngineId, type ReplyShape, type StreamOptions, type SurfaceEngine } from './aiTurn';
import { nanoQueue, type NanoQueue } from '../ai/nanoQueue';
import { GEMINI_NOT_SET_UP } from '../ai/cloudErrors';
import { NANO_SYSTEM_PROMPT } from './nanoPlan';
import { ROUTE_PHONE_NO_NANO, ROUTE_VIA_HUB } from '../ai/privacyRouter';

export const PHONE_NANO_NOTE = ROUTE_PHONE_NO_NANO;
export const NO_NANO_NOTE = "Gemini · cloud — Nano isn't available here, so Deep drafted it";
export const APPLE_ON_DEVICE_NOTE = 'Apple · on device — nothing left this device';
export { ROUTE_VIA_HUB };

export interface EngineEnv {
  /** Chrome's Prompt API (globalThis.LanguageModel) is present. */
  hasLanguageModel: boolean;
  /** Capacitor iOS/Android shell. */
  isPhone: boolean;
  /** A usable cloud TextGenModel is reachable. */
  hasCloud: boolean;
  /** ?sim=1 — force scripted engines for the box/demo. */
  sim: boolean;
  /** Android ML Kit GenAI checkStatus reported AVAILABLE. */
  androidNano?: boolean;
  /** iOS Apple Foundation Models plugin reported available. */
  appleOnDevice?: boolean;
  /** Desktop Chrome hub is reachable over the sync room or LAN. */
  hubReachable?: boolean;
}

export interface EngineChoice {
  engine: EngineId;
  /** Scripted stand-in rather than a real model call. */
  sim: boolean;
  /** Honest route-line override when the step didn't run where its name says. */
  routeNote?: string;
}

/** Decide which engine backs each step, and whether it's real or scripted. */
export function planEngines(env: EngineEnv): { nano: EngineChoice; gemini: EngineChoice } {
  if (env.sim) return { nano: { engine: 'nano', sim: true }, gemini: { engine: 'gemini', sim: true } };
  const gemini: EngineChoice = { engine: 'gemini', sim: !env.hasCloud };
  const nanoOnDevice = (env.hasLanguageModel && !env.isPhone) || !!env.androidNano || !!env.appleOnDevice;
  const nano: EngineChoice = nanoOnDevice
    ? (env.appleOnDevice
      ? { engine: 'nano', sim: false, routeNote: APPLE_ON_DEVICE_NOTE }
      : { engine: 'nano', sim: false })
    : { engine: 'gemini', sim: !env.hasCloud, routeNote: env.isPhone
      ? (env.hubReachable ? ROUTE_VIA_HUB : PHONE_NANO_NOTE)
      : NO_NANO_NOTE };
  return { nano, gemini };
}

// --- real engine I/O -------------------------------------------------------

/** Minimal surface of Chrome's LanguageModel (Prompt API) we use for Nano. */
export interface PromptApi {
  create(options?: unknown): Promise<PromptSession>;
}
export interface PromptSession {
  promptStreaming(prompt: string, options?: unknown): AsyncIterable<string> | ReadableStream<string>;
  clone?(options?: unknown): Promise<PromptSession>;
  destroy?(): void;
}

/** Minimal cloud model: a function that streams a prompt and resolves the text.
 *  createEngines() adapts src/ai/hybrid.generateWithBudget to this. */
export type CloudStream = (prompt: string, onText: (full: string) => void, opts?: { shape?: ReplyShape }) => Promise<string>;

export interface EnginesRuntime {
  languageModel?: PromptApi | null;
  /** The page's one Nano runner (shared queue + warm session). Built from
   *  `languageModel` when not given. */
  nanoRunner?: NanoRunner | null;
  cloud?: CloudStream | null;
  isPhone?: boolean;
  sim?: boolean;
  androidNano?: boolean;
  appleOnDevice?: boolean;
  /** On-device generate used when the engine is Apple (or another plugin), not Chrome Nano. */
  onDeviceGenerate?: CloudStream | null;
  hubReachable?: boolean;
}

/** Text in, text out, English — the same question for create() and for
 *  availability(), so Chrome doesn't warn about an unspecified language. */
export const NANO_CREATE_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
} as const;

/** A prompt with no deadline of its own (a short reply, a refusal check)
 *  still may not hold the one model for ever. */
export const NANO_DEFAULT_TIMEOUT_MS = 20_000;
/** The longest a warm-up may hold the model's slot. */
export const NANO_WARM_MAX_MS = 15_000;
/** How long a burst of buffered chunks may run before the page gets a turn. */
const NANO_YIELD_EVERY_MS = 24;

export interface NanoRunner {
  /** One prompt through the shared queue. Never more than the queue's limit
   *  (one) at a time, however many callers ask. */
  stream(prompt: string, onText: (full: string) => void, opts?: StreamOptions): Promise<string>;
  /** Load the model and the fixed instructions ahead of the first turn. */
  warm(): Promise<boolean>;
}

export interface NanoRunnerDeps {
  queue?: NanoQueue;
  now?: () => number;
  /** Give the page a frame (default: a macrotask). */
  yieldToPage?: () => Promise<void>;
}

/** The one place a board prompt reaches Chrome's on-device model: a single
 *  queued call per turn (no per-tile sessions), a base session that already
 *  holds the fixed instructions (cloned per turn, so the first token doesn't
 *  wait on a cold load), a JSON-schema constraint on the reply, and an abort
 *  that really stops the model. */
export function createNanoRunner(lm: PromptApi, deps: NanoRunnerDeps = {}): NanoRunner {
  const queue = deps.queue ?? nanoQueue;
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const yieldToPage = deps.yieldToPage ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
  let base: Promise<PromptSession | null> | null = null;
  /** The warm session once it exists — a turn never waits on a pending one. */
  let ready: PromptSession | null = null;

  function baseSession(): Promise<PromptSession | null> {
    base ??= lm.create({ ...NANO_CREATE_OPTIONS, initialPrompts: [{ role: 'system', content: NANO_SYSTEM_PROMPT }] })
      .then((s) => { ready = typeof s.clone === 'function' ? s : (s.destroy?.(), null); return ready; })
      .catch(() => null);
    return base;
  }

  async function sessionFor(opts: StreamOptions): Promise<{ session: PromptSession; input: string | null }> {
    if (opts.system === NANO_SYSTEM_PROMPT && opts.user && ready?.clone) {
      try { return { session: await ready.clone(opts.signal ? { signal: opts.signal } : undefined), input: opts.user }; }
      catch { base = null; ready = null; /* the base died (tab slept, model unloaded): start clean */ }
    }
    return { session: await lm.create({ ...NANO_CREATE_OPTIONS, ...(opts.signal ? { signal: opts.signal } : {}) }), input: null };
  }

  return {
    // Warming holds the model's one slot, so it gives it back after a bound
    // even if Chrome never answers (the session, if it ever arrives, is kept).
    warm: () => queue.run(() => Promise.race([
      baseSession().then((s) => s != null),
      new Promise<boolean>((resolve) => { setTimeout(() => resolve(false), NANO_WARM_MAX_MS); }),
    ]), { priority: 5 }).catch(() => false),
    stream: (prompt, onText, given = {}) => {
      // No signal from the caller: the runner brings its own deadline.
      let opts = given;
      let ownTimer: ReturnType<typeof setTimeout> | null = null;
      if (!given.signal && typeof AbortController !== 'undefined') {
        const own = new AbortController();
        ownTimer = setTimeout(() => own.abort(), NANO_DEFAULT_TIMEOUT_MS);
        opts = { ...given, signal: own.signal };
      }
      const timedOut = (): boolean => !given.signal && !!opts.signal?.aborted;
      return queue.run(async () => {
      if (opts.signal?.aborted) throw new Error('stopped');
      // An abort must free the queue even if Chrome never settles the session
      // or the stream: the work is raced against the signal, not trusted to end.
      let session: PromptSession | null = null;
      const stop = (): void => { try { session?.destroy?.(); } catch { /* already gone */ } };
      let onAbort: (() => void) | null = null;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => { stop(); reject(new Error('stopped')); };
        opts.signal?.addEventListener('abort', onAbort, { once: true });
      });
      aborted.catch(() => undefined);
      const work = (async (): Promise<string> => {
        const got = await sessionFor(opts);
        session = got.session;
        if (opts.signal?.aborted) { stop(); throw new Error('stopped'); }
        const stream = got.session.promptStreaming(got.input ?? prompt, {
          ...(opts.constraint ? { responseConstraint: opts.constraint, omitResponseConstraintInput: true } : {}),
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
        let full = '';
        let lastYield = now();
        for await (const chunk of stream as AsyncIterable<string>) {
          if (opts.signal?.aborted) throw new Error('stopped');
          // Chrome yields incremental chunks (older builds: the text so far).
          full = full && chunk.startsWith(full) ? chunk : full + chunk;
          onText(full);
          // Buffered chunks resolve back to back as microtasks: hand the page
          // a frame so a long reply can never freeze it.
          if (now() - lastYield >= NANO_YIELD_EVERY_MS) { await yieldToPage(); lastYield = now(); }
        }
        if (opts.signal?.aborted) throw new Error('stopped');
        return full;
      })();
      work.catch(() => undefined);
      try {
        return await Promise.race([work, aborted]);
      } finally {
        if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
        stop();
      }
      }, { priority: 10, signal: opts.signal })
        .catch((e) => { throw timedOut() ? new Error(`took longer than ${Math.round(NANO_DEFAULT_TIMEOUT_MS / 1000)} s`) : e; })
        .finally(() => { if (ownTimer) clearTimeout(ownTimer); });
    },
  };
}

function realNanoEngine(runner: NanoRunner, routeNote?: string): SurfaceEngine {
  return { id: 'nano', sim: false, routeLine: routeNote, stream: (prompt, onText, opts) => runner.stream(prompt, onText, opts) };
}

function cloudEngine(id: EngineId, cloud: CloudStream, routeNote?: string): SurfaceEngine {
  return {
    id, sim: false, routeLine: routeNote,
    stream: (prompt, onText, opts) => cloud(prompt, onText, opts?.shape ? { shape: opts.shape } : undefined),
  };
}

const runners = new WeakMap<PromptApi, NanoRunner>();
function runnerFor(rt: EnginesRuntime): NanoRunner | null {
  if (rt.nanoRunner) return rt.nanoRunner;
  if (!rt.languageModel) return null;
  let r = runners.get(rt.languageModel);
  if (!r) { r = createNanoRunner(rt.languageModel); runners.set(rt.languageModel, r); }
  return r;
}

/** A real engine never carries a scripted stand-in: when it fails, the turn
 *  hands off to the other REAL engine (on-device -> Gemini) or says why it
 *  failed. Scripted drafts exist only when the whole run is ?sim=1 (or the
 *  build has no cloud model at all, which is labelled SIM from the start). */
function engineFromChoice(choice: EngineChoice, json: string, rt: EnginesRuntime): SurfaceEngine {
  if (choice.sim) return { ...scriptedEngine(choice.engine, json), routeLine: choice.routeNote };
  const handoff = rt.cloud ? cloudEngine('gemini', rt.cloud) : undefined;
  const runner = choice.engine === 'nano' ? runnerFor(rt) : null;
  if (runner) return { ...realNanoEngine(runner, choice.routeNote), handoff };
  if (choice.engine === 'nano' && rt.onDeviceGenerate) {
    return { ...cloudEngine('nano', rt.onDeviceGenerate, choice.routeNote), handoff };
  }
  if (rt.cloud) return cloudEngine('gemini', rt.cloud, choice.routeNote);
  // Promised real but the transport vanished: fail the turn with the reason.
  return {
    id: choice.engine, sim: false, routeLine: choice.routeNote,
    stream: () => Promise.reject(new Error(choice.engine === 'nano' ? 'the on-device model is not available here' : GEMINI_NOT_SET_UP)),
  };
}

function envFrom(rt: EnginesRuntime): EngineEnv {
  return {
    hasLanguageModel: !!rt.languageModel,
    isPhone: !!rt.isPhone,
    hasCloud: !!rt.cloud,
    sim: !!rt.sim,
    androidNano: !!rt.androidNano,
    appleOnDevice: !!rt.appleOnDevice,
    hubReachable: !!rt.hubReachable,
  };
}

/** Engine factories keyed by step id, for mountCanvas({ engines }).
 *  Re-read runtime flags on every turn so a late-ready Apple plugin is used. */
export function createEngines(rt: EnginesRuntime): Partial<Record<EngineId, (json: string) => SurfaceEngine>> {
  return {
    nano: (json) => engineFromChoice(planEngines(envFrom(rt)).nano, json, rt),
    gemini: (json) => engineFromChoice(planEngines(envFrom(rt)).gemini, json, rt),
  };
}
