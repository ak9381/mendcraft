// Which engine really runs each step, with an honest label. Nano runs on the
// device only when Chrome's Prompt API is here and we're not on a phone;
// otherwise the "Nano" step is drafted by Gemini in the cloud and says so.
// Gemini is real when a cloud TextGenModel is reachable, else a scripted SIM.
// planEngines() is pure (unit-tested); createEngines() wires the real I/O.
import { scriptedEngine, type EngineId, type SurfaceEngine } from './aiTurn';

export const PHONE_NANO_NOTE = "Gemini · cloud — Nano isn't on this phone, so Deep drafted it";
export const NO_NANO_NOTE = "Gemini · cloud — Nano isn't available here, so Deep drafted it";

export interface EngineEnv {
  /** Chrome's Prompt API (globalThis.LanguageModel) is present. */
  hasLanguageModel: boolean;
  /** Capacitor iOS/Android — Nano isn't available here. */
  isPhone: boolean;
  /** A usable cloud TextGenModel is reachable. */
  hasCloud: boolean;
  /** ?sim=1 — force scripted engines for the box/demo. */
  sim: boolean;
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
  const nanoOnDevice = env.hasLanguageModel && !env.isPhone;
  const nano: EngineChoice = nanoOnDevice
    ? { engine: 'nano', sim: false }
    : { engine: 'gemini', sim: !env.hasCloud, routeNote: env.isPhone ? PHONE_NANO_NOTE : NO_NANO_NOTE };
  return { nano, gemini };
}

// --- real engine I/O -------------------------------------------------------

/** Minimal surface of Chrome's LanguageModel (Prompt API) we use for Nano. */
export interface PromptApi {
  create(options?: unknown): Promise<PromptSession>;
}
export interface PromptSession {
  promptStreaming(prompt: string, options?: unknown): AsyncIterable<string> | ReadableStream<string>;
}

/** Minimal cloud model: a function that streams a prompt and resolves the text.
 *  createEngines() adapts src/ai/hybrid.generateWithBudget to this. */
export type CloudStream = (prompt: string, onText: (full: string) => void) => Promise<string>;

export interface EnginesRuntime {
  languageModel?: PromptApi | null;
  cloud?: CloudStream | null;
  isPhone?: boolean;
  sim?: boolean;
}

function realNanoEngine(lm: PromptApi, routeNote?: string): SurfaceEngine {
  return {
    id: 'nano', sim: false, routeLine: routeNote,
    async stream(prompt, onText) {
      const session = await lm.create();
      const stream = session.promptStreaming(prompt);
      let full = '';
      for await (const chunk of stream as AsyncIterable<string>) {
        // Chrome yields incremental chunks; concatenate for the full text so far.
        full = chunk.startsWith(full) ? chunk : full + chunk;
        onText(full);
      }
      return full;
    },
  };
}

function cloudEngine(id: EngineId, cloud: CloudStream, routeNote?: string): SurfaceEngine {
  return {
    id, sim: false, routeLine: routeNote,
    stream: (prompt, onText) => cloud(prompt, onText),
  };
}

function engineFromChoice(choice: EngineChoice, json: string, rt: EnginesRuntime): SurfaceEngine {
  const scripted = { ...scriptedEngine(choice.engine, json), routeLine: choice.routeNote };
  if (choice.sim) return scripted;
  if (choice.engine === 'nano' && rt.languageModel) {
    return { ...realNanoEngine(rt.languageModel, choice.routeNote), fallback: scripted };
  }
  if (rt.cloud) return { ...cloudEngine('gemini', rt.cloud, choice.routeNote), fallback: scripted };
  // Promised real but the transport vanished (e.g. cloud dropped): scripted, honest SIM.
  return scripted;
}

/** Engine factories keyed by step id, for mountCanvas({ engines }). */
export function createEngines(rt: EnginesRuntime): Partial<Record<EngineId, (json: string) => SurfaceEngine>> {
  const env: EngineEnv = { hasLanguageModel: !!rt.languageModel, isPhone: !!rt.isPhone, hasCloud: !!rt.cloud, sim: !!rt.sim };
  const plan = planEngines(env);
  return {
    nano: (json) => engineFromChoice(plan.nano, json, rt),
    gemini: (json) => engineFromChoice(plan.gemini, json, rt),
  };
}
