// Which engine really runs each step, with an honest label. Nano runs on the
// device when Chrome's Prompt API is here and we're not on a phone, or when
// Android ML Kit / Apple Intelligence is available in the native shell;
// otherwise the "Nano" step is drafted by Gemini in the cloud and says so.
// Gemini is real when a cloud TextGenModel is reachable, else a scripted SIM.
// planEngines() is pure (unit-tested); createEngines() wires the real I/O.
import { scriptedEngine, type EngineId, type ReplyShape, type StreamOptions, type SurfaceEngine } from './aiTurn';
import { GEMINI_NOT_SET_UP } from '../ai/cloudErrors';
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

/** Chrome's LanguageModel (Prompt API) global. The canvas only checks that it
 *  is there (and its availability()); every prompt goes through Firebase AI
 *  Logic — see `nanoStream`. */
export type PromptApi = object;

/** Minimal cloud model: a function that streams a prompt and resolves the text.
 *  createEngines() adapts src/ai/hybrid.streamCanvasPlanOrThrow to this. */
export type CloudStream = (prompt: string, onText: (full: string) => void, opts?: { shape?: ReplyShape; onSend?: () => void; onRetract?: () => void }) => Promise<string>;

/** One on-device prompt: Firebase AI Logic in ONLY_ON_DEVICE mode, through
 *  the page's one Nano queue (src/ai/hybrid.streamOnDevice). */
export type OnDeviceStream = (prompt: string, onText: (full: string) => void, opts?: StreamOptions) => Promise<string>;

export interface EnginesRuntime {
  /** Chrome's Prompt API is present (availability only — never prompted directly). */
  languageModel?: PromptApi | null;
  /** The on-device call. Null or missing means Nano is OFF on this page, even
   *  when the Prompt API is present: the Nano step is then drafted by Gemini
   *  and says so. */
  nanoStream?: OnDeviceStream | null;
  cloud?: CloudStream | null;
  isPhone?: boolean;
  sim?: boolean;
  androidNano?: boolean;
  appleOnDevice?: boolean;
  /** On-device generate used when the engine is Apple (or another plugin), not Chrome Nano. */
  onDeviceGenerate?: CloudStream | null;
  hubReachable?: boolean;
}

function cloudEngine(id: EngineId, cloud: CloudStream, routeNote?: string): SurfaceEngine {
  return {
    id, sim: false, routeLine: routeNote,
    stream: (prompt, onText, opts) => {
      // A plugin's on-device generate has no queue: it starts at once.
      if (id === 'nano') { opts?.onStart?.(); opts?.onReady?.(); }
      return cloud(prompt, onText, opts?.shape || opts?.onCloudSend ? { shape: opts.shape, onSend: opts.onCloudSend, onRetract: opts.onCloudRetract } : undefined);
    },
  };
}

/** Chrome Nano is usable on this page: the Prompt API is here, it is not a
 *  phone, and the page was given the Firebase AI Logic on-device call. */
const chromeNano = (rt: EnginesRuntime): boolean => !!rt.languageModel && !!rt.nanoStream;

/** A real engine never carries a scripted stand-in: when it fails, the turn
 *  hands off to the other REAL engine (on-device -> Gemini) or says why it
 *  failed. Scripted drafts exist only when the whole run is ?sim=1 (or the
 *  build has no cloud model at all, which is labelled SIM from the start). */
function engineFromChoice(choice: EngineChoice, json: string, rt: EnginesRuntime): SurfaceEngine {
  if (choice.sim) return { ...scriptedEngine(choice.engine, json), routeLine: choice.routeNote };
  const handoff = rt.cloud ? cloudEngine('gemini', rt.cloud) : undefined;
  if (choice.engine === 'nano' && chromeNano(rt) && !rt.isPhone) {
    const nano = rt.nanoStream!;
    return { id: 'nano', sim: false, routeLine: choice.routeNote, stream: (prompt, onText, opts) => nano(prompt, onText, opts), handoff };
  }
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
    hasLanguageModel: chromeNano(rt),
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
