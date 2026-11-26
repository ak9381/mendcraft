// Firebase AI Logic hybrid wrapper: on-device model when available (Gemini
// Nano in Chrome, Apple Foundation Models in the iOS Capacitor shell, or
// Android ML Kit), gemini-3.5-flash-lite in the cloud otherwise,
// deterministic rule parser as the always-on floor. Every model response is
// re-validated with validateOp before it can reach the engine.

import { type Op } from '../core/ops';
import { parseRefinedQuery, refinePrompt } from '../references/query';
import { getActiveMode } from '../core/modes';
import { coercePlanGenerate } from '../plan/ai';
import { parsePlanCommand, isPlanGenerate } from '../plan/ruleParser';
import { buildPlanTemplate, type PlanTemplateName } from '../plan/templates';
import { validatePlanOp, type PlanOp } from '../plan/ops';
import {
  buildFusionConstraint,
  buildFusionPrompt,
  normalizeTranscript,
  parseFusionResult,
  ruleConfidence,
  type FusionContext,
} from './intentFusion';
import {
  DEIXIS_CONSTRAINT,
  buildDeixisPrompt,
  parseDeixisResult,
  type DeixisCandidate,
  type DeixisResolution,
} from './deixis';
import { buildA11yConstraint, coerceA11yExplanations, type A11yExplanation, type A11yIssue } from '../core/a11y';
import {
  PROFILE_CONSTRAINT, buildAdaptPrompt, coerceProfileAdaptation, type ProfileAdaptation,
} from '../input/handProfile';
import type { HandMetrics } from '../input/handMetrics';
import {
  LANG_DETECT_CONSTRAINT, cloudDetectPrompt, parseCloudDetection, type Detection,
} from './langDetect';
import { buildRecipePickPrompt, parseRecipePick, type RecipeRef } from '../recipes/match';
import { getFirebaseApp, isFirebaseConfigured } from '../firebase/app';
import {
  CONNECTOR_CONSTRAINT, EFFECT_CONSTRAINT, IDENTIFY_CONSTRAINT,
  buildConnectorPrompt, buildEffectPrompt, buildIdentifyPrompt, parseEffect, parseIdentity, writerSaysUnsupported,
  type DeviceIdentity, type EffectVerdict, type IdentifyHint,
} from '../devices/identify';
import { coerceConnector, type Connector } from '../devices/connector';
import { appCheckTokenError, initAppCheck, APP_CHECK_FAIL_MSG, type AppCheckStatus } from '../firebase/appCheck';
import { cloudCallError, explainCloudFailure, GEMINI_NOT_SET_UP, type CloudFailure } from './cloudErrors';
import { nanoQueue, NanoQueueSkipped } from './nanoQueue';
import { nanoTrace } from './nanoTrace';
import { watchCloudFetch } from './cloudFetchWatch';
import { initRemoteConfig, remoteSettings } from '../firebase/remoteConfig';
import {
  classifyCloudFailure,
  delay,
  extractJson,
  hasCompleteJson,
  HIGH_DEMAND_BACKOFF_MS,
  mergeStreamText,
  RATE_LIMIT_BACKOFF_MS,
  safeResponseText,
  safeStreamChunk,
  type CloudFailKind,
} from './cloudJson';
import { HEDGE_AFTER_MS, HEDGE_CLOUD_MODEL, PRIMARY_CLOUD_MODEL, raceHedged } from './hedge';
import { initTelemetry, recordInference } from '../firebase/telemetry';
import { refinePromptForMockups, parseGeneratedOptions, generatedToHits, REF_GENERATE_CONSTRAINT } from '../references/mockups';
import type { GenerateKind, RefHit } from '../references/types';
import { CAD_TOOL_CONSTRAINT, cadToolPrompt, coerceToolCall, type ToolCall } from '../cad/tools';
import {
  CONDENSE_CONSTRAINT, CONDENSE_TIMEOUT_MS, coerceCondensed, condensePrompt, wordCount,
  type CondenseOutcome,
} from './condense';
import { COPILOT_ANSWER_CONSTRAINT, EMAIL_CONSTRAINT, copilotAnswerPrompt, emailPrompt } from '../cad/copilot';
import { MATERIAL_CONSTRAINT, MATERIAL_PROMPT, coerceMaterialPlan, presetFor, type MaterialPlan } from '../cad/materials';
import { coerceEmailDraft, type EmailDraft } from '../cad/siteChecklist';
import { fillVisible, protectText } from '../privacy/directory';
import {
  appleStatusToDevice, appleTextModel, checkAppleAvailability, getAppleAIPlugin,
  type AppleAIPlugin,
} from './appleAI';
import type { OnDeviceKind } from './router';

export type { AppCheckStatus } from '../firebase/appCheck';
export type { FusionContext, FusionCursor, NearbyElement } from './intentFusion';
export type Source = 'on-device' | 'cloud' | 'rules';
/**
 * On-device model state, mirroring Chrome's LanguageModel.availability():
 * unsupported = no Prompt API in this browser; unavailable = API present but
 * this device/flags can't run Nano; downloadable = click to download.
 */
export type DeviceModelStatus =
  | 'idle'
  | 'unsupported'
  | 'unavailable'
  | 'downloadable'
  | 'downloading'
  | 'ready'
  | 'failed';

/** The compile result is mode-specific (a validated op, a template, a generate
 *  directive, or a clarify). The shell only checks for `clarify` and otherwise
 *  hands it to the active mode's controller, so it is typed loosely here. */
export interface CompileResult {
  result: object;
  source: Source;
  ms: number;
}

/** Plan-mode "generate a whole plan" result (ops already re-validated). */
export interface GeneratePlanResult {
  ops?: PlanOp[];
  clarify?: string;
  /** Honest note shown instead of "Plan created." (e.g. a template fallback). */
  note?: string;
  source: Source;
}

export interface VerifyResult {
  matchesIntent: boolean;
  issue: string | null;
  source: Source;
}

export interface HybridStatus {
  appCheck: AppCheckStatus;
  deviceModel: DeviceModelStatus;
  message: string | null;
  /** Last AI error (cloud or on-device), for the UI and console. */
  lastError: string | null;
  /** Why the last cloud JSON call failed, if it did. */
  lastFailKind: CloudFailKind | null;
}

/** Minimal surface of Chrome's global LanguageModel (Prompt API). */
export interface LanguageModelProvider {
  availability(options?: unknown): Promise<string>;
}

/** Minimal surface of a GenerativeModel that this module needs (mockable). */
export interface TextGenModel {
  generateContent(
    request: string,
  ): Promise<{ response: { text: () => string; inferenceSource?: string } }>;
  /** Optional streaming path. On a timeout we keep any JSON already received
   *  instead of dropping the whole call. */
  generateContentStream?(
    request: string,
  ): Promise<{
    stream: AsyncIterable<{ text: () => string; inferenceSource?: string }>;
    response: Promise<{ text: () => string; inferenceSource?: string }>;
  }>;
  initializeDeviceModel?(onProgress?: (p: number) => void): Promise<void>;
}

/**
 * Server prompt-template model (firebase/ai getTemplateGenerativeModel). Used
 * for the big cloud jobs when a template ID is configured in Remote Config; the
 * template and its output schema live on the Firebase server, so the request is
 * just an ID plus variables. Still re-validated like any other model output.
 */
export interface TemplateGenModel {
  generateContent(request: {
    templateId: string;
    templateVariables: Record<string, unknown>;
  }): Promise<{ response: { text: () => string; inferenceSource?: string } }>;
}

/** One inline image part of a multimodal request (JPEG/PNG, base64). */
export interface ImagePart {
  inlineData: { mimeType: string; data: string };
}

/** Minimal surface of a GenerativeModel taking text + image parts (mockable). */
export interface MultimodalGenModel {
  generateContent(
    request: Array<string | ImagePart>,
  ): Promise<{ response: { text: () => string; inferenceSource?: string } }>;
}

/** One inline audio part returned by the cloud TTS model (base64 PCM/wav). */
export interface AudioPart {
  inlineData: { mimeType: string; data: string };
}

/**
 * Cloud text-to-speech model (ONLY_IN_CLOUD, responseModalities AUDIO). Returns
 * audio inline-data parts rather than text; used to speak a short confirmation
 * in the user's language when the browser has no good voice for it. @beta.
 */
export interface AudioGenModel {
  generateContent(
    request: string,
  ): Promise<{ response: { inlineDataParts?: () => AudioPart[] | undefined } }>;
}

interface Models {
  intent: TextGenModel | null;
  template: TextGenModel | null;
  verify: TextGenModel | null;
  /** Deictic intent-fusion model: op schema + confidence (PREFER_ON_DEVICE). */
  fusion?: TextGenModel | null;
  /** Point-and-say resolver: camera crop + pointer (PREFER_ON_DEVICE, image input). */
  deixis?: MultimodalGenModel | null;
  deixisCloud?: MultimodalGenModel | null;
  /** Cloud-only twins used if the on-device call itself throws. */
  intentCloud?: TextGenModel | null;
  verifyCloud?: TextGenModel | null;
  fusionCloud?: TextGenModel | null;
  /** Fusion on Nano with non-English input allowed (en/es/ja), used only when
   *  Chrome reports the spoken language is available on-device. */
  fusionLang?: TextGenModel | null;
  /** Cloud language detector, used only when Chrome's Language Detector is missing. */
  langDetect?: TextGenModel | null;
  /** Accessibility explainer (ONLY_IN_CLOUD, a11y-explain schema). */
  a11yExplain?: TextGenModel | null;
  a11yExplainHedge?: TextGenModel | null;
  /** On-device hand-profile picker (PREFER_ON_DEVICE, numbers-only; never cloud). */
  handAdapt?: TextGenModel | null;
  /** Ramble condenser (ONLY_ON_DEVICE; the raw ramble never rides to the cloud). */
  condense?: TextGenModel | null;
  /** Next-step chips: Nano picks ids from a fixed list (ONLY_ON_DEVICE; never cloud). */
  nextSteps?: TextGenModel | null;
  /** Server prompt-template model for the big cloud jobs (may be null). */
  promptTemplate?: TemplateGenModel | null;
  /** Cloud TTS model (spoken replies in her language); null if unsupported. */
  tts?: AudioGenModel | null;
  /** Add-a-device: name the device from one frame (PREFER_ON_DEVICE, image in). */
  deviceSee?: MultimodalGenModel | null;
  deviceSeeCloud?: MultimodalGenModel | null;
  /** Add-a-device: before/after frames → was the effect visible? (PREFER_ON_DEVICE). */
  effectCheck?: MultimodalGenModel | null;
  effectCheckCloud?: MultimodalGenModel | null;
  /** Add-a-device: write a declarative connector once (ONLY_IN_CLOUD). */
  connectorWriter?: TextGenModel | null;
  /** Reference drawings / layout frames as SVG JSON (ONLY_IN_CLOUD, text model). */
  refGenerate?: TextGenModel | null;
  /** CAD copilot: Nano picks ONE typed CAD tool (PREFER_ON_DEVICE) + cloud twin. */
  cadTool?: TextGenModel | null;
  cadToolCloud?: TextGenModel | null;
  /** CAD copilot: hard questions, client email drafts, 3D materials (ONLY_IN_CLOUD). */
  copilotAnswer?: TextGenModel | null;
  /** Backup cloud model (gemini-3.1-flash-lite) for hedged copilot answers. */
  copilotAnswerHedge?: TextGenModel | null;
  copilotEmail?: TextGenModel | null;
  copilotEmailHedge?: TextGenModel | null;
  copilotMaterials?: TextGenModel | null;
  copilotMaterialsHedge?: TextGenModel | null;
  /** Unconstrained JSON cloud model for the smart canvas (plans + language packs). */
  canvasCloud?: TextGenModel | null;
  canvasCloudHedge?: TextGenModel | null;
}

export interface ModelOverrides {
  intent?: TextGenModel | null;
  template?: TextGenModel | null;
  verify?: TextGenModel | null;
  fusion?: TextGenModel | null;
  deixis?: MultimodalGenModel | null;
  deixisCloud?: MultimodalGenModel | null;
  intentCloud?: TextGenModel | null;
  verifyCloud?: TextGenModel | null;
  fusionCloud?: TextGenModel | null;
  fusionLang?: TextGenModel | null;
  langDetect?: TextGenModel | null;
  a11yExplain?: TextGenModel | null;
  a11yExplainHedge?: TextGenModel | null;
  handAdapt?: TextGenModel | null;
  condense?: TextGenModel | null;
  nextSteps?: TextGenModel | null;
  promptTemplate?: TemplateGenModel | null;
  tts?: AudioGenModel | null;
  deviceSee?: MultimodalGenModel | null;
  deviceSeeCloud?: MultimodalGenModel | null;
  effectCheck?: MultimodalGenModel | null;
  effectCheckCloud?: MultimodalGenModel | null;
  connectorWriter?: TextGenModel | null;
  refGenerate?: TextGenModel | null;
  cadTool?: TextGenModel | null;
  cadToolCloud?: TextGenModel | null;
  copilotAnswer?: TextGenModel | null;
  copilotAnswerHedge?: TextGenModel | null;
  copilotEmail?: TextGenModel | null;
  copilotEmailHedge?: TextGenModel | null;
  copilotMaterials?: TextGenModel | null;
  copilotMaterialsHedge?: TextGenModel | null;
  canvasCloud?: TextGenModel | null;
  canvasCloudHedge?: TextGenModel | null;
  /** Fake for the per-turn ONLY_ON_DEVICE model (streamOnDevice). */
  onDeviceModel?: ((params: OnDeviceModelParams) => TextGenModel) | null;
  enabled?: boolean;
  appCheck?: AppCheckStatus;
  /** Force the reported on-device model status (test seam for adaptHandProfile). */
  deviceModel?: DeviceModelStatus;
  /** Fake Chrome LanguageModel; null = browser without the Prompt API. */
  languageModel?: LanguageModelProvider | null;
  /** Fake or injected MendcraftAppleAI Capacitor plugin (iOS on-device model). */
  appleAI?: AppleAIPlugin | null;
}

/**
 * Text-only, English on-device session. Passed to the SDK and to our own
 * availability() checks so both ask Chrome the same question. (The SDK's
 * default also expects image input, which needs the multimodal flag.)
 */
export const ON_DEVICE_CREATE_OPTIONS = {
  expectedInputs: [{ type: 'text' as const, languages: ['en'] }],
  expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
};

/** Languages Gemini Nano accepts as input today (Chrome's Prompt API). A
 *  non-English command only tries Nano when availability() says the language
 *  is 'available' for that exact language; otherwise it goes to the cloud. */
export const NANO_INPUT_LANGUAGES = ['en', 'es', 'ja'] as const;

export const ON_DEVICE_LANG_CREATE_OPTIONS = {
  expectedInputs: [{ type: 'text' as const, languages: [...NANO_INPUT_LANGUAGES] }],
  expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
};

/** Point-and-say session: text + ONE still image in, text out. Only the deixis
 *  model asks Chrome for multimodal Nano (needs the multimodal flag). */
export const DEIXIS_CREATE_OPTIONS = {
  expectedInputs: [{ type: 'text' as const, languages: ['en'] }, { type: 'image' as const }],
  expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
};

const ON_DEVICE_TIMEOUT_MS = 15000;
/** Cloud budget for a warm call. A hung cloud call must still fall back to
 *  rules promptly — first calls after load or reconnect get a longer budget. */
export const CLOUD_GENERATE_TIMEOUT_MS = 8000;
/** Extra budget for the first cloud generate (App Check + model cold start). */
export const CLOUD_FIRST_TIMEOUT_MS = 20000;

// ---------------------------------------------------------------------------
// Structured-output schemas. The on-device Prompt API takes a plain JSON Schema
// (`responseConstraint`), which the active EditorMode owns (core/modes) so this
// layer stays mode-agnostic. The cloud path needs Firebase `Schema` objects, so
// toFirebaseSchema() converts the same plain constraints at runtime — one
// source of truth per mode, no hand-kept duplicate.

/** Convert a plain JSON-Schema node into a Firebase AI `Schema`. Supports the
 *  subset our constraints use: object (all props optional), array, number,
 *  string, boolean, and anyOf. `S` is the firebase/ai `Schema` builder. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toFirebaseSchema(node: Record<string, unknown>, S: any): any {
  if (Array.isArray(node.anyOf)) {
    return S.anyOf({ anyOf: (node.anyOf as Record<string, unknown>[]).map((n) => toFirebaseSchema(n, S)) });
  }
  switch (node.type) {
    case 'number': return S.number();
    case 'string': return S.string();
    case 'boolean': return S.boolean();
    case 'array':
      return S.array({ items: toFirebaseSchema((node.items as Record<string, unknown>) ?? { type: 'string' }, S) });
    case 'object':
    default: {
      const props = (node.properties as Record<string, Record<string, unknown>>) ?? {};
      const properties: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) properties[k] = toFirebaseSchema(v, S);
      const keys = Object.keys(properties);
      // Properties are optional by default (small models omit most fields per op),
      // but a node may name a `required` subset — these the model MUST return
      // (e.g. a generated plan's `rooms`), so the field can't be silently dropped.
      const required = Array.isArray(node.required) ? (node.required as string[]) : [];
      const optionalProperties = keys.filter((k) => !required.includes(k));
      return S.object(keys.length ? { properties, optionalProperties } : { properties });
    }
  }
}

// ---------------------------------------------------------------------------
// Config / lazy init. Firebase init (app, App Check, Remote Config, telemetry)
// lives in src/firebase/*; this module only orchestrates it and owns the test
// seam, status, and routing.

let testOverrides: ModelOverrides | null = null;
/** Builds a Firebase AI Logic ONLY_ON_DEVICE model for one call (set by
 *  initFirebase). Null until Firebase AI Logic has started. */
let onDeviceFactory: ((params: OnDeviceModelParams) => TextGenModel) | null = null;
let cached: Models | null = null;
let initPromise: Promise<Models | null> | null = null;
let deviceModelStatus: DeviceModelStatus = 'idle';
/** Which on-device engine last reported ready (Nano vs Apple). */
let onDeviceKind: OnDeviceKind | null = null;
let appCheckState: AppCheckStatus = 'skipped';
let statusMessage: string | null = null;
let lastError: string | null = null;
let lastFailKind: CloudFailKind | null = null;
/** True once a cloud generate has finished (or returned usable partial JSON). */
let cloudSettled = false;
let warmPromise: Promise<boolean> | null = null;
let warmDevicePromise: Promise<boolean> | null = null;

function resetStatus(): void {
  deviceModelStatus = 'idle';
  onDeviceKind = null;
  appCheckState = 'skipped';
  statusMessage = null;
  lastError = null;
  lastFailKind = null;
  cloudSettled = false;
  warmPromise = null;
  warmDevicePromise = null;
}

/** Short = guideline explain and similar; long = materials, email, copilot. */
export function cloudBudgetMs(kind: 'short' | 'long' = 'short'): number {
  if (kind === 'long') return cloudSettled ? CLOUD_GENERATE_TIMEOUT_MS * 2 : CLOUD_FIRST_TIMEOUT_MS;
  return cloudSettled ? CLOUD_GENERATE_TIMEOUT_MS : Math.max(CLOUD_GENERATE_TIMEOUT_MS, 12_000);
}

function markCloudSettled(): void {
  cloudSettled = true;
}

function noteError(where: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  lastError = `${where}: ${msg}`;
  console.warn(`[mendcraft] ${lastError}`, err);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** How long an on-device call may wait for the model before it gives up
 *  (and its caller falls back to rules or its redacted cloud twin). */
export const ON_DEVICE_MAX_WAIT_MS = 6000;
/** The longest one SDK on-device call may hold the model's slot. */
export const ON_DEVICE_MAX_RUN_MS = 20_000;

/** Route a model's calls through the shared Nano queue: one on-device prompt
 *  at a time, and a call that waited too long is never started. A streamed
 *  call holds its slot until the stream has finished. */
export function queueOnDevice<T extends object>(model: T, queue = nanoQueue, maxWaitMs = ON_DEVICE_MAX_WAIT_MS, maxRunMs = ON_DEVICE_MAX_RUN_MS): T {
  const m = model as Record<string, unknown>;
  // The SDK's on-device call can't be aborted, so a call that never settles
  // must not hold the one slot for ever: it gives it back after maxRunMs.
  const bounded = <R,>(p: Promise<R>): Promise<R> => withTimeout(p, maxRunMs, 'on-device call');
  const once = m.generateContent;
  if (typeof once === 'function') {
    m.generateContent = (...args: unknown[]) => queue.run(() => bounded((once as (...a: unknown[]) => Promise<unknown>).apply(model, args)), { maxWaitMs });
  }
  const streamed = m.generateContentStream;
  if (typeof streamed === 'function') {
    m.generateContentStream = (...args: unknown[]) => new Promise((resolve, reject) => {
      queue.run(async () => {
        const started = await bounded((streamed as (...a: unknown[]) => Promise<{ response?: Promise<unknown> }>).apply(model, args));
        resolve(started);
        try { await bounded(Promise.resolve(started.response)); } catch { /* the reader sees the error */ }
      }, { maxWaitMs }).catch(reject);
    });
  }
  return model;
}

type ModelResponse = { text: () => string; inferenceSource?: string };

/**
 * Run a cloud generate with a hard timeout. If the model can stream, a timeout
 * still counts when we already have parseable JSON (partial output). Otherwise
 * the caller falls back to rules.
 */
export async function generateWithBudget(
  model: TextGenModel,
  prompt: string,
  ms: number,
  label: string,
  onChunk?: (text: string) => void,
): Promise<{ response: ModelResponse }> {
  if (typeof model.generateContentStream === 'function') {
    let latest = '';
    let inferenceSource: string | undefined;
    const run = (async () => {
      const started = await model.generateContentStream!(prompt);
      try {
        for await (const chunk of started.stream) {
          const safe = safeStreamChunk(chunk);
          if (safe.failKind === 'safety') throw new Error(`${label} safety: blocked`);
          if (safe.text) {
            latest = mergeStreamText(latest, safe.text);
            try { onChunk?.(latest); } catch { /* UI preview must not fail the call */ }
            // The SDK's final `response` sometimes hangs for seconds after the
            // last useful chunk. Once we have a fully closed JSON value, stop.
            if (hasCompleteJson(latest)) {
              markCloudSettled();
              return { text: () => latest, inferenceSource: chunk.inferenceSource ?? inferenceSource };
            }
          }
          if (chunk.inferenceSource) inferenceSource = chunk.inferenceSource;
        }
      } catch (err) {
        // A mid-stream parse/text() error is recoverable when we already have text.
        if (!latest) throw err;
      }
      if (started.response) {
        try {
          const final = await started.response;
          const safe = safeResponseText(final);
          if (safe.failKind === 'safety') throw new Error(`${label} safety: blocked`);
          return { text: () => safe.text || final.text(), inferenceSource: final.inferenceSource ?? inferenceSource };
        } catch (err) {
          if (latest) return { text: () => latest, inferenceSource };
          throw err;
        }
      }
      return { text: () => latest, inferenceSource };
    })();
    try {
      const response = await withTimeout(run, ms, label);
      markCloudSettled();
      return { response };
    } catch (err) {
      if (latest && extractJson(latest) != null) {
        markCloudSettled();
        return { response: { text: () => latest, inferenceSource } };
      }
      throw err;
    }
  }
  const { response } = await withTimeout(model.generateContent(prompt), ms, label);
  markCloudSettled();
  const safe = safeResponseText(response);
  if (safe.failKind === 'safety') {
    throw new Error(`${label} safety: ${safe.failKind}`);
  }
  if (safe.text) {
    return { response: { text: () => safe.text, inferenceSource: (response as { inferenceSource?: string }).inferenceSource } };
  }
  return { response };
}

/** What a canvas cloud call is expected to return: a board plan, any JSON
 *  object (a language pack, one revised tile), or a short plain-text reply
 *  (the model is JSON-only, so the words arrive as a JSON string or inside
 *  a one-field object). */
export type CanvasReplyShape = 'board' | 'json' | 'text';

const TEXT_KEYS = ['reply', 'response', 'answer', 'text', 'message'];
export function acceptCanvasReply(raw: unknown, shape: CanvasReplyShape): unknown | null {
  if (shape === 'board') return looksLikeSurfacePlan(raw) ? raw : null;
  if (shape === 'json') return raw && typeof raw === 'object' && Object.keys(raw as object).length ? raw : null;
  if (typeof raw === 'string') return raw.trim() || null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  for (const k of TEXT_KEYS) if (typeof o[k] === 'string' && (o[k] as string).trim()) return (o[k] as string).trim();
  const strings = Object.values(o).filter((v): v is string => typeof v === 'string' && !!v.trim());
  return strings.length === 1 ? strings[0].trim() : null;
}

/** A canvas reply worth racing on: an object with a `tiles` list at the top
 *  or one envelope down (e.g. {"plan":{...}}), which the canvas layer unwraps.
 *  A bare `{}` or tile-less object must NOT win the hedge race — it made the
 *  live board turn fail with "tiles must be a list" while the backup model
 *  would have answered (live-build study, 01:40 IST). */
export function looksLikeSurfacePlan(raw: unknown, depth = 0): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || depth > 2) return false;
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.tiles)) return true;
  return Object.values(o).some((v) => looksLikeSurfacePlan(v, depth + 1));
}

export interface CanvasCloudHooks {
  /** The real fetch was called for one Gemini request of this call (a hedge or a
   *  retry is another one). Seen on the real fetch — see cloudFetchWatch. */
  onSend?: () => void;
  /** That request failed with no response at all: the network never
   *  delivered it. */
  onRetract?: () => void;
}
type CanvasCloudResult =
  | { ok: true; text: string }
  | { ok: false; why: string; kind: CloudFailKind | null;
      /** Known for certain from the real fetch: no request of this call was
       *  delivered. Undefined when fetch could not be watched. */
      nothingSent?: boolean };

/** The cloud board call with its own failure record (two overlapping calls
 *  never read each other's error). */
async function runCanvasCloud(prompt: string, onChunk: ((text: string) => void) | undefined, shape: CanvasReplyShape, hooks: CanvasCloudHooks): Promise<CanvasCloudResult> {
  const models = await ensureModels();
  // Never use the copilot/template/intent models: those have their own response
  // schemas and will ignore a surface-plan prompt. The canvas model is JSON-only.
  let primary = models?.canvasCloud ?? null;
  let backup = models?.canvasCloudHedge ?? null;
  if (!primary) {
    const why = appCheckState === 'failed' ? `AppCheck: ${statusMessage ?? 'failed to start'}` : !isEnabled() ? GEMINI_NOT_SET_UP : 'no cloud model answered';
    return { ok: false, why, kind: null, nothingSent: true }; // no model to call: nothing was even tried
  }
  // Same privacy path as the rest of hybrid: directory tokens, then rules-first
  // redaction. The canvas ledger should record this redacted payload.
  const sent = protectText(prompt);
  // Bytes are booked on the REAL fetch: while this call runs, requests to the
  // Gemini endpoint that carry this prompt are counted as they are issued.
  const watch = watchCloudFetch(sent.text, { onIssued: hooks.onSend, onUndelivered: hooks.onRetract });
  const nothingSent = (): boolean | undefined => (watch.active ? watch.delivered() === 0 : undefined);
  // The watch outlives this function when the hedge's losing leg is still
  // retrying: its requests are sends too. It stops when every leg is done.
  let handedOver = false;
  let failKind: CloudFailKind | null = null;
  let failWhy = '';
  try {
    const got = await requestHedgedJson(
      primary,
      backup,
      sent.text,
      cloudBudgetMs('long'),
      'canvas plan',
      (raw) => acceptCanvasReply(raw, shape),
      shape === 'text' ? undefined : onChunk,
      // The primary's reason wins; a backup failure only fills a gap.
      (kind, detail) => { if (!failWhy) { failKind = kind; failWhy = `canvas plan: ${kind}${detail ? `: ${detail.slice(0, 400)}` : ''}`; } },
      (handedOver = true, () => watch.stop()),
    );
    if (!got) return { ok: false, why: failWhy || 'no cloud model answered', kind: failKind, nothingSent: nothingSent() };
    const visible = fillVisible(typeof got.value === 'string' ? got.value : JSON.stringify(got.value));
    try { onChunk?.(visible.text); } catch { /* UI preview must not fail the call */ }
    return { ok: true, text: visible.text };
  } catch (err) {
    noteError('canvas plan', err);
    return { ok: false, why: err instanceof Error ? err.message : String(err), kind: null, nothingSent: nothingSent() };
  } finally {
    if (!handedOver) watch.stop();
  }
}

/**
 * Smart-canvas seam: stream a surface-plan prompt through the cloud (Firebase AI
 * Logic) and resolve the full text. Returns null when no cloud model is reachable
 * or the call failed. Re-validation of the returned JSON happens in the canvas
 * layer (coerceSurfacePlan / gate).
 */
export async function streamCanvasPlan(prompt: string, onChunk?: (text: string) => void, shape: CanvasReplyShape = 'board'): Promise<string | null> {
  const got = await runCanvasCloud(prompt, onChunk, shape, {});
  return got.ok ? got.text : null;
}

/**
 * The same cloud board call, but a failure is an error that says why in plain
 * words (App Check 403, no connection, quota, …) instead of a silent null —
 * the canvas shows that line and offers Retry; it never substitutes a draft.
 */
export async function streamCanvasPlanOrThrow(prompt: string, onChunk?: (text: string) => void, shape: CanvasReplyShape = 'board', hooks: CanvasCloudHooks = {}): Promise<string> {
  const got = await runCanvasCloud(shape === 'text' ? `${prompt}\nReply as JSON: {"reply": string}` : prompt, onChunk, shape, hooks);
  if (got.ok) return got.text;
  const source = got.kind === 'parse' || got.kind === 'empty' ? 'parse' : got.why;
  throw await cloudCallError(source, testOverrides ? undefined : appCheckTokenError, got.nothingSent);
}

// ---------------------------------------------------------------------------
// ON-DEVICE BOARD CALLS, through Firebase AI Logic (ONLY_ON_DEVICE).

/** What the SDK hands to Chrome's Prompt API for one on-device model. */
export interface OnDeviceModelParams {
  createOptions: Record<string, unknown>;
  promptOptions?: { responseConstraint?: Record<string, unknown> };
}

export interface OnDeviceStreamRequest {
  /** Fixed instructions: ride in the session's `initialPrompts`. */
  system?: string;
  /** This turn's prompt. */
  prompt: string;
  /** JSON schema the reply must match (`responseConstraint`). */
  constraint?: Record<string, unknown>;
  /** Stop: the wait ends at once and the session is destroyed. */
  signal?: AbortSignal;
  onChunk?: (full: string) => void;
  /** The queue gave this call the model: the caller's deadline starts now. */
  onStart?: () => void;
  /** Injectable for tests. */
  queue?: typeof nanoQueue;
  yieldToPage?: () => Promise<void>;
  now?: () => number;
}

/** Text in, text out, English. */
export const NANO_CREATE_OPTIONS = ON_DEVICE_CREATE_OPTIONS;
/** How long a board call may wait for the one model before it gives up
 *  (and the turn goes to Gemini). */
export const ON_DEVICE_BOARD_MAX_WAIT_MS = 15_000;
/** How long a burst of buffered chunks may run before the page gets a turn. */
const ON_DEVICE_YIELD_EVERY_MS = 24;

/** The SDK's on-device path cannot be aborted, and (measured on real Chrome)
 *  aborting the signal given to create() does not stop a prompt that is
 *  already running. The SDK does keep the session it made on the model's
 *  Chrome adapter, so stopping also destroys that session directly. */
function destroySdkSession(model: unknown): void {
  try {
    const session = (model as { chromeAdapter?: { oldSession?: { destroy?: () => void } } } | null)?.chromeAdapter?.oldSession;
    session?.destroy?.();
  } catch { /* already gone */ }
}

/** Has the SDK already created this model's session (its create() resolved)? */
function sdkSessionReady(model: unknown): boolean {
  try { return !!(model as { chromeAdapter?: { oldSession?: unknown } } | null)?.chromeAdapter?.oldSession; } catch { return false; }
}

/** Destroys the previous call's session (the SDK keeps each model's last
 *  session alive; one finished board session is enough to keep Nano loaded). */
let lastOnDeviceStop: (() => void) | null = null;

function onDeviceModelFor(params: OnDeviceModelParams): TextGenModel {
  const make = testOverrides ? testOverrides.onDeviceModel ?? null : onDeviceFactory;
  if (!make) throw new Error(isEnabled() ? 'Firebase AI Logic didn’t start, so the on-device model can’t be used' : 'Firebase AI Logic isn’t set up, so the on-device model can’t be used');
  return make(params);
}

/**
 * ONE on-device prompt through Firebase AI Logic: a per-call ONLY_ON_DEVICE
 * model (so the reply schema can name this turn's devices), streamed, through
 * the page's one Nano queue. The source is re-checked on every chunk — text
 * that did not come from the device is refused.
 *
 * Stopping: the SDK's on-device path takes no abort signal, so stopping means
 * (1) the caller stops waiting at once and the queue slot is freed, (2) the
 * stream iterator is returned, and (3) the AbortSignal given to the session's
 * create() is aborted, which is how the Prompt API destroys a session.
 */
export async function streamOnDevice(req: OnDeviceStreamRequest): Promise<string> {
  const queue = req.queue ?? nanoQueue;
  const now = req.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const yieldToPage = req.yieldToPage ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
  await ensureModels();
  const asked = Date.now();
  return queue.run(async () => {
    if (req.signal?.aborted) throw new Error('stopped');
    const t0 = Date.now();
    nanoTrace(`on-device call: waited ${t0 - asked} ms for the model's queue`);
    try { req.onStart?.(); } catch { /* the caller's clock must not fail the call */ }
    lastOnDeviceStop?.();
    const session = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let iterator: AsyncIterator<{ text: () => string; inferenceSource?: string }> | null = null;
    let model: TextGenModel | null = null;
    const stop = (): void => {
      try { void iterator?.return?.(); } catch { /* already done */ }
      session?.abort();
      destroySdkSession(model);
    };
    model = onDeviceModelFor({
      createOptions: {
        ...ON_DEVICE_CREATE_OPTIONS,
        ...(req.system ? { initialPrompts: [{ role: 'system', content: [{ type: 'text', value: req.system }] }] } : {}),
        ...(session ? { signal: session.signal } : {}),
      },
      ...(req.constraint ? { promptOptions: { responseConstraint: req.constraint } } : {}),
    });
    let onAbort: (() => void) | null = null;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => { stop(); reject(new Error('stopped')); };
      req.signal?.addEventListener('abort', onAbort, { once: true });
    });
    aborted.catch(() => undefined);
    const work = (async (): Promise<string> => {
      let full = '';
      const take = (chunk: { text: () => string; inferenceSource?: string }): void => {
        if (sourceOf(chunk) !== 'on-device') throw new Error('the reply did not come from the on-device model');
        let piece = '';
        try { piece = chunk.text(); } catch { piece = ''; }
        if (!piece) return;
        // Deltas (current Chrome) or the text so far (older builds). A delta
        // that repeats the tail ("ro" + "o") is still new text.
        full = full && piece.length > full.length && piece.startsWith(full) ? piece : full + piece;
        try { req.onChunk?.(full); } catch (e) { if (e instanceof Error && e.name === 'MidStreamOffline') throw e; }
      };
      if (typeof model.generateContentStream === 'function') {
        const started = await model.generateContentStream(req.prompt);
        started.response?.catch(() => undefined);
        iterator = started.stream[Symbol.asyncIterator]();
        let lastYield = now();
        for (;;) {
          const step = await iterator.next();
          if (step.done) break;
          if (req.signal?.aborted) throw new Error('stopped');
          take(step.value);
          // Buffered chunks resolve back to back as microtasks: hand the page
          // a frame so a long reply can never freeze it.
          if (now() - lastYield >= ON_DEVICE_YIELD_EVERY_MS) { await yieldToPage(); lastYield = now(); }
        }
      } else {
        const { response } = await model.generateContent(req.prompt);
        take(response);
      }
      if (req.signal?.aborted) throw new Error('stopped');
      return full;
    })();
    work.catch(() => undefined);
    let finished = false;
    try {
      // maxRun: a call Chrome never settles still gives the slot back.
      const text = await withTimeout(Promise.race([work, aborted]), ON_DEVICE_MAX_RUN_MS, 'on-device call')
        .catch((e) => { throw /timed out after/.test(e instanceof Error ? e.message : '') ? new Error(`took longer than ${Math.round(ON_DEVICE_MAX_RUN_MS / 1000)} s`) : e; });
      finished = true;
      recordInference('on-device', 'board', Date.now() - t0);
      onDeviceLoaded = true;
      nanoTrace(`on-device call: done in ${Date.now() - t0} ms, output ${text.length} chars`);
      // Keep this finished session (it keeps Nano loaded) until the next call.
      const kept = model;
      lastOnDeviceStop = () => { session?.abort(); destroySdkSession(kept); };
      return text;
    } finally {
      if (onAbort) req.signal?.removeEventListener('abort', onAbort);
      if (!finished) { nanoTrace(`on-device call: stopped after ${Date.now() - t0} ms`); stop(); }
    }
  }, { priority: 10, signal: req.signal, maxWaitMs: ON_DEVICE_BOARD_MAX_WAIT_MS });
}

/** The warm-up's reply schema (kept to keywords Chrome accepts). */
export const WARM_CONSTRAINT: Record<string, unknown> = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
let boardWarm: Promise<boolean> | null = null;
/** The warm-up's model while it runs (to see whether its session exists yet). */
let warming: TextGenModel | null = null;
/** Once the warm-up's session exists, its ~10-character reply gets this long. */
export const WARM_PROMPT_TIMEOUT_MS = 5000;
/** How often the warm-up looks whether its session has been created. */
const WARM_SESSION_POLL_MS = 100;
/** An on-device call has finished on this page: the model is in memory. */
let onDeviceLoaded = false;
export const onDeviceModelLoaded = (): boolean => onDeviceLoaded;

/**
 * Load Nano ahead of the first board turn: one tiny on-device prompt through
 * the same SDK path, so the cold start (about 14 s on the laptop measured)
 * is paid by the page and not by her first request. It runs below every real
 * job.
 *
 * create() is NOT timed: it is where the cold load happens, it can be long,
 * and while it runs the warm-up is pre-emptible (a request pushes it aside:
 * session destroyed, slot freed). Once the session exists the model is
 * loaded, only the tiny reply is left, and that gets WARM_PROMPT_TIMEOUT_MS;
 * from then on the warm-up is left to finish rather than thrown away.
 * Resolves true when the model is loaded (also when a real call already
 * loaded it). A false result may be retried — see ai/nanoWarm.
 */
export function warmBoardOnDevice(queue = nanoQueue, opts: { promptTimeoutMs?: number } = {}): Promise<boolean> {
  if (onDeviceLoaded) return Promise.resolve(true);
  boardWarm ??= (async () => {
    await ensureModels();
    try {
      await queue.run(async (ctx) => {
        const session = typeof AbortController !== 'undefined' ? new AbortController() : null;
        let model: TextGenModel | null = null;
        // Pushed aside: stop the session, and end this job (and its session
        // poll) now rather than leave it waiting on a prompt that will never
        // be answered.
        const steppedAside = new Promise<never>((_, reject) => {
          ctx.signal?.addEventListener('abort', () => {
            session?.abort(); destroySdkSession(model); nanoTrace('warm-up: stepped aside for a request');
            reject(new NanoQueueSkipped('stepped aside for a request'));
          }, { once: true });
        });
        steppedAside.catch(() => undefined);
        model = onDeviceModelFor({
          createOptions: { ...ON_DEVICE_CREATE_OPTIONS, ...(session ? { signal: session.signal } : {}) },
          promptOptions: { responseConstraint: WARM_CONSTRAINT },
        });
        warming = model;
        nanoTrace('warm-up: started');
        const kept = model;
        const t0 = Date.now();
        let poll: ReturnType<typeof setInterval> | null = null;
        let deadline: ReturnType<typeof setTimeout> | null = null;
        // The prompt's clock starts when the session exists, never before.
        const promptTimedOut = new Promise<never>((_, reject) => {
          const arm = (): void => {
            if (deadline || !sdkSessionReady(kept)) return;
            if (poll) { clearInterval(poll); poll = null; }
            nanoTrace(`warm-up: session created after ${Date.now() - t0} ms`);
            deadline = setTimeout(() => reject(new Error('on-device warm-up prompt timed out')), opts.promptTimeoutMs ?? WARM_PROMPT_TIMEOUT_MS);
          };
          poll = setInterval(arm, WARM_SESSION_POLL_MS);
          arm();
        });
        promptTimedOut.catch(() => undefined);
        try {
          const reply = model.generateContent('Reply with JSON only: {"ok":true}');
          reply.catch(() => undefined);
          await Promise.race([reply, promptTimedOut, steppedAside]);
        } catch (e) {
          // Timed out (or failed): its session must not keep generating.
          session?.abort(); destroySdkSession(kept);
          nanoTrace('warm-up: stopped (timed out or failed)');
          throw e;
        } finally {
          if (poll) clearInterval(poll);
          if (deadline) clearTimeout(deadline);
        }
        lastOnDeviceStop ??= () => { session?.abort(); destroySdkSession(kept); };
      }, { priority: -1, preemptible: () => !sdkSessionReady(warming), maxWaitMs: 0 });
      onDeviceLoaded = true;
      nanoTrace('warm-up: done — the model is loaded');
      return true;
    } catch {
      return false;
    } finally {
      boardWarm = null; // a later attempt starts fresh (and returns at once when loaded)
    }
  })();
  return boardWarm;
}

/** Is this address unable to pass App Check right now? Null when a token was
 *  issued (or App Check isn't running). Asks App Check only — no model call. */
export async function cloudAccessProblem(): Promise<CloudFailure | null> {
  if (testOverrides || !isEnabled() || appCheckState !== 'ready') return null;
  const refused = await appCheckTokenError();
  if (!refused) return null;
  const f = explainCloudFailure(`AppCheck: ${refused instanceof Error ? refused.message : String(refused)}`);
  return f.kind === 'app-check-403' || f.kind === 'app-check' ? f : null;
}

/** Test seam: inject mock models (and force enabled/disabled) without Firebase. */
export function setModelsForTest(overrides: ModelOverrides | null): void {
  testOverrides = overrides;
  onDeviceFactory = null;
  lastOnDeviceStop = null;
  boardWarm = null;
  onDeviceLoaded = false;
  cached = null;
  initPromise = null;
  resetStatus();
}

export function isEnabled(): boolean {
  if (testOverrides?.enabled !== undefined) return testOverrides.enabled;
  return isFirebaseConfigured();
}

export function getDeviceModelStatus(): DeviceModelStatus {
  return deviceModelStatus;
}

export function getOnDeviceKind(): OnDeviceKind | null {
  return onDeviceKind;
}

export function getHybridStatus(): HybridStatus {
  return { appCheck: appCheckState, deviceModel: deviceModelStatus, message: statusMessage, lastError, lastFailKind };
}

export async function prepareHybrid(): Promise<HybridStatus> {
  await ensureModels();
  if (!testOverrides && isEnabled() && appCheckState !== 'failed') {
    void warmCloud();
  }
  return getHybridStatus();
}

/** Cheap cloud ping after load or when the network comes back, so the first
 *  real copilot call is not the cold-start one. No-ops in tests. */
export async function warmCloud(): Promise<boolean> {
  if (testOverrides) return false;
  if (warmPromise) return warmPromise;
  warmPromise = (async () => {
    const models = await ensureModels();
    const model = models?.a11yExplain ?? models?.copilotAnswer ?? models?.template ?? models?.intentCloud ?? models?.intent;
    if (!model) return false;
    try {
      await generateWithBudget(model, 'Reply with JSON only: {"ok":true}', CLOUD_FIRST_TIMEOUT_MS, 'cloud warm-up');
      return true;
    } catch (err) {
      noteError('cloud warm-up', err);
      const msg = err instanceof Error ? err.message : String(err);
      // A schema or model error still means App Check and the connection ran,
      // so later user calls can use the warm budget. Only a timeout stays cold.
      if (!/timed out/i.test(msg)) {
        markCloudSettled();
        return true;
      }
      return false;
    } finally {
      if (!cloudSettled) warmPromise = null;
    }
  })();
  return warmPromise;
}


/** Create and ping the on-device session so the first real Nano intent pick
 *  is a short follow-up rather than a cold create. No-ops in tests, when Nano
 *  is not ready, or when Firebase is unconfigured. */
export async function warmOnDevice(): Promise<boolean> {
  if (testOverrides) return false;
  if (deviceModelStatus !== 'ready') return false;
  if (warmDevicePromise) return warmDevicePromise;
  warmDevicePromise = (async () => {
    const models = await ensureModels();
    const model = models?.cadTool ?? models?.intent;
    if (!model) return false;
    try {
      if (model.initializeDeviceModel) await model.initializeDeviceModel();
      await withTimeout(
        model.generateContent('She said: "zoom to fit"\nReply JSON only: {"tool":"zoom","args":{"to":"fit"},"confidence":1}'),
        ON_DEVICE_TIMEOUT_MS,
        'on-device warm-up',
      );
      return true;
    } catch (err) {
      noteError('on-device warm-up', err);
      warmDevicePromise = null;
      return false;
    }
  })();
  return warmDevicePromise;
}

/**
 * What the pure router (ai/router.ts) needs to know about the world. Call after
 * prepareHybrid() so App Check / device status are real, not 'idle'/'skipped'.
 */
export function routerEnv(): { deviceReady: boolean; cloudReady: boolean } {
  return {
    deviceReady: deviceModelStatus === 'ready',
    cloudReady: isEnabled() && appCheckState !== 'failed',
  };
}

/**
 * Longer free-form design requests belong on the cloud-only template model
 * (e.g. "design a stand for my phone"), not the short-command intent path.
 */
export function isDesignRequest(utterance: string): boolean {
  const t = utterance.trim().toLowerCase();
  if (!t) return false;
  if (/\bdesign\b/.test(t)) return true;
  if (/\b(i need|i want|something to|something for)\b/.test(t)) return true;
  if (/\bfor my\b/.test(t)) return true;
  if (/\b(create|build me|make me)\b/.test(t) && t.split(/\s+/).length >= 5) return true;
  return false;
}

async function ensureModels(): Promise<Models | null> {
  if (testOverrides) {
    if (testOverrides.enabled === false) {
      appCheckState = testOverrides.appCheck ?? 'skipped';
      return null;
    }
    if (testOverrides.appCheck === 'failed') {
      appCheckState = 'failed';
      statusMessage = APP_CHECK_FAIL_MSG;
      return null;
    }
    appCheckState = testOverrides.appCheck ?? 'ready';
    if (testOverrides.deviceModel) deviceModelStatus = testOverrides.deviceModel;
    return {
      intent: testOverrides.intent ?? null,
      template: testOverrides.template ?? null,
      verify: testOverrides.verify ?? null,
      fusion: testOverrides.fusion ?? null,
      deixis: testOverrides.deixis ?? null,
      deixisCloud: testOverrides.deixisCloud ?? null,
      intentCloud: testOverrides.intentCloud ?? null,
      verifyCloud: testOverrides.verifyCloud ?? null,
      fusionCloud: testOverrides.fusionCloud ?? null,
      fusionLang: testOverrides.fusionLang ?? null,
      langDetect: testOverrides.langDetect ?? null,
      a11yExplain: testOverrides.a11yExplain ?? null,
      a11yExplainHedge: testOverrides.a11yExplainHedge ?? null,
      handAdapt: testOverrides.handAdapt ?? null,
      condense: testOverrides.condense ?? null,
      nextSteps: testOverrides.nextSteps ?? null,
      promptTemplate: testOverrides.promptTemplate ?? null,
      tts: testOverrides.tts ?? null,
      deviceSee: testOverrides.deviceSee ?? null,
      deviceSeeCloud: testOverrides.deviceSeeCloud ?? null,
      effectCheck: testOverrides.effectCheck ?? null,
      effectCheckCloud: testOverrides.effectCheckCloud ?? null,
      connectorWriter: testOverrides.connectorWriter ?? null,
      refGenerate: testOverrides.refGenerate ?? null,
      cadTool: testOverrides.cadTool ?? null,
      cadToolCloud: testOverrides.cadToolCloud ?? null,
      copilotAnswer: testOverrides.copilotAnswer ?? null,
      copilotAnswerHedge: testOverrides.copilotAnswerHedge ?? null,
      copilotEmail: testOverrides.copilotEmail ?? null,
      copilotEmailHedge: testOverrides.copilotEmailHedge ?? null,
      copilotMaterials: testOverrides.copilotMaterials ?? null,
      copilotMaterialsHedge: testOverrides.copilotMaterialsHedge ?? null,
      canvasCloud: testOverrides.canvasCloud ?? null,
      canvasCloudHedge: testOverrides.canvasCloudHedge ?? null,
    };
  }
  let base: Models | null = null;
  if (isEnabled()) {
    if (!cached) initPromise ??= initFirebase();
    base = cached ?? (await initPromise);
  } else {
    appCheckState = 'skipped';
  }
  return withAppleModels(base);
}

async function initFirebase(): Promise<Models | null> {
  try {
    const app = await getFirebaseApp();

    // App Check is required for Firebase AI Logic. A missing key or a failed
    // init is not swallowable: fall back to rules and tell the UI.
    const ac = await initAppCheck(app);
    appCheckState = ac.status;
    if (ac.status === 'failed') {
      if (ac.error) noteError('App Check init', ac.error);
      statusMessage = ac.message;
      cached = null;
      return null;
    }

    // Remote Config: fetch the cloud model name + prompt text BEFORE building the
    // models, so the fetched model name is actually applied (not fetched-and-
    // ignored). The realtime listener keeps the preamble + template IDs — which
    // are read per request — current without a redeploy.
    await initRemoteConfig(app);
    await initTelemetry(app);
    const cloudModel = remoteSettings().cloudModel;

    const { getAI, getGenerativeModel, getTemplateGenerativeModel, GoogleAIBackend, InferenceMode, Schema, ResponseModality, ThinkingLevel } =
      await import('firebase/ai');
    // useLimitedUseAppCheckTokens: each Firebase AI Logic request carries a
    // fresh single-use App Check token (for replay protection) instead of the
    // reusable one. This is a CLIENT opt-in only; console replay-protection
    // enforcement is a separate human step (see docs/CONSOLE-STEPS.md) and must
    // be turned on only after a limited-use build is live.
    const ai = getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true });

    // Build all cloud schemas from the ACTIVE mode's plain-JSON constraints, so
    // the cloud and on-device paths share one source of truth per mode.
    const modeAi = getActiveMode().ai;
    const opSchema = toFirebaseSchema(modeAi.opConstraint, Schema);
    const verifySchema = toFirebaseSchema(modeAi.verifyConstraint, Schema);
    const templateSchema = toFirebaseSchema(modeAi.generateConstraint, Schema);
    // Intent fusion: the same op vocabulary + a confidence field, one source of
    // truth (the mode's opConstraint) for both the Nano and cloud schemas.
    // Every ONLY_ON_DEVICE model shares the page's one Nano queue (see
    // queueOnDevice): Nano is a single model, and the SDK's Chrome adapter
    // destroys a model's previous session when a new call starts.
    const onDeviceModel = (params: Parameters<typeof getGenerativeModel>[1]) => queueOnDevice(getGenerativeModel(ai, params));
    // Per-call on-device models (streamOnDevice): same SDK, same mode, built
    // per turn because the reply schema names this turn's devices.
    onDeviceFactory = (onDeviceParams) => getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: onDeviceParams as never,
    }) as unknown as TextGenModel;
    const fusionConstraint = buildFusionConstraint(modeAi.opConstraint);
    const fusionSchema = toFirebaseSchema(fusionConstraint, Schema);

    // ONLY_ON_DEVICE, like handAdapt/condense below: compileCommand() sends the
    // raw utterance here, and PREFER_ON_DEVICE's cloud fallback can fire
    // silently (no throw) on the SDK's own call — which would leak that raw
    // text with no redaction, since the explicit cloud retry (intentCloud,
    // via callWithCloudRetry) only runs on a thrown error. ONLY_ON_DEVICE
    // removes the silent path entirely; the explicit retry still carries the
    // redacted prompt.
    const intent = onDeviceModel({
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: {
        createOptions: ON_DEVICE_CREATE_OPTIONS,
        promptOptions: { responseConstraint: modeAi.opConstraint },
      },
    });

    const verify = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: 'application/json', responseSchema: verifySchema },
      },
      onDeviceParams: {
        createOptions: ON_DEVICE_CREATE_OPTIONS,
        promptOptions: { responseConstraint: modeAi.verifyConstraint },
      },
    });

    const template = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: 'application/json', responseSchema: templateSchema },
      },
    });

    // ONLY_ON_DEVICE for the same reason as `intent` above — fuseIntent()'s
    // non-forceCloud path sends the raw utterance here by design (Nano never
    // leaves the device), which PREFER_ON_DEVICE's silent cloud fallback would
    // defeat. The explicit forceCloud/retry paths keep using fusionCloud with
    // the redacted prompt.
    const fusion = onDeviceModel({
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: {
        createOptions: ON_DEVICE_CREATE_OPTIONS,
        promptOptions: { responseConstraint: fusionConstraint },
      },
    });

    // Point-and-say: the one multimodal model — a still crop + pointer resolve
    // "this". Image payloads ride the same Firebase AI Logic call, nothing else.
    const deixisSchema = toFirebaseSchema(DEIXIS_CONSTRAINT, Schema);
    // ONLY_ON_DEVICE, same reasoning as `intent`/`fusion` — resolveDeixis()
    // sends the raw utterance AND the camera crop image here; a silent
    // PREFER_ON_DEVICE cloud fallback would leak both. deixisCloud below
    // still serves the explicit retry-on-throw path with redacted parts.
    const deixis = onDeviceModel({
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: {
        createOptions: DEIXIS_CREATE_OPTIONS,
        promptOptions: { responseConstraint: DEIXIS_CONSTRAINT },
      },
    }) as unknown as MultimodalGenModel;
    const deixisCloud = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: 'application/json', responseSchema: deixisSchema },
      },
    }) as unknown as MultimodalGenModel;

    const intentCloud = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: 'application/json', responseSchema: opSchema },
      },
    });
    const fusionCloud = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: 'application/json', responseSchema: fusionSchema },
      },
    });
    // Nano with non-English input (en/es/ja). Same schema as `fusion`; the
    // caller only routes here after checkLanguageAvailability() said yes.
    // ONLY_ON_DEVICE, same reasoning as `fusion` above.
    const fusionLang = onDeviceModel({
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: {
        createOptions: ON_DEVICE_LANG_CREATE_OPTIONS,
        promptOptions: { responseConstraint: fusionConstraint },
      },
    });
    // Cloud language detection: only when Chrome's on-device Language Detector
    // is missing. Sends the transcript text only (ledger job 'lang-detect').
    const langDetect = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: 'application/json', responseSchema: toFirebaseSchema(LANG_DETECT_CONSTRAINT, Schema) },
      },
    });
    const verifyCloud = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: 'application/json', responseSchema: verifySchema },
      },
    });
    // Hand-adaptive input: ONLY_ON_DEVICE, with NO inCloudParams at all. The raw
    // hand numbers must never leave the device, and ONLY_ON_DEVICE gives the SDK
    // no cloud transport to fall back to (it errors instead of going to cloud if
    // Nano is not ready) — so the metrics prompt is physically unable to be
    // uploaded. This is stronger than PREFER_ON_DEVICE, which can silently fall
    // back to the cloud. adaptHandProfile() still gates on Nano being ready so
    // the ONLY_ON_DEVICE "not ready" error never fires in normal use.
    const handAdapt = onDeviceModel({
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: {
        createOptions: ON_DEVICE_CREATE_OPTIONS,
        promptOptions: { responseConstraint: PROFILE_CONSTRAINT },
      },
    });

    // Ramble condenser (ai/condense): ONLY_ON_DEVICE like handAdapt — the long
    // natural ramble must never ride this call to the cloud. A miss keeps her
    // raw words everywhere and the route line unchanged.
    const condense = onDeviceModel({
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: {
        createOptions: ON_DEVICE_CREATE_OPTIONS,
        promptOptions: { responseConstraint: CONDENSE_CONSTRAINT },
      },
    });
    // Next-step chips: ONLY_ON_DEVICE with no cloud params — the pick is a
    // convenience, so a missing Nano means the rule list, never a cloud call.
    const nextSteps = getGenerativeModel(ai, { // queued per call in pickNextStepsOnDevice, with its own short max run
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: {
        createOptions: ON_DEVICE_CREATE_OPTIONS,
        promptOptions: { responseConstraint: NEXT_STEPS_CONSTRAINT },
      },
    });

    // Server prompt-template model (@beta on the web SDK). Only used when a
    // template ID is set in Remote Config; otherwise the big jobs use the inline
    // prompt above. Guarded so an SDK without it never breaks init.
    let promptTemplate: TemplateGenModel | null = null;
    try {
      promptTemplate = getTemplateGenerativeModel(ai) as unknown as TemplateGenModel;
    } catch (err) {
      noteError('prompt template model', err);
      promptTemplate = null;
    }

    // Cloud TTS model (@beta): ONLY_IN_CLOUD audio output for spoken replies in
    // a language the browser can't voice well (e.g. Kannada). The model name and
    // prebuilt voice come from Remote Config (sane defaults). Guarded so an SDK
    // without audio output / the TTS model never breaks init — the caller then
    // falls back to browser speechSynthesis.
    let tts: AudioGenModel | null = null;
    try {
      const rc = remoteSettings();
      tts = getGenerativeModel(ai, {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: {
          model: rc.ttsModel,
          generationConfig: {
            responseModalities: [ResponseModality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: rc.ttsVoice } } },
          },
        },
      }) as unknown as AudioGenModel;
    } catch (err) {
      noteError('cloud tts model', err);
      tts = null;
    }

    // Add-a-device (Control Anything-style, with proof): the two camera jobs
    // prefer Nano with image input; the connector writer is cloud-only and
    // runs once per brand+kind (the result is cached and reused offline).
    const identifySchema = toFirebaseSchema(IDENTIFY_CONSTRAINT, Schema);
    const effectSchema = toFirebaseSchema(EFFECT_CONSTRAINT, Schema);
    const deviceSee = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams: { model: cloudModel, generationConfig: { responseMimeType: 'application/json', responseSchema: identifySchema } },
      onDeviceParams: { createOptions: DEIXIS_CREATE_OPTIONS, promptOptions: { responseConstraint: IDENTIFY_CONSTRAINT } },
    }) as unknown as MultimodalGenModel;
    const deviceSeeCloud = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: { model: cloudModel, generationConfig: { responseMimeType: 'application/json', responseSchema: identifySchema } },
    }) as unknown as MultimodalGenModel;
    const effectCheck = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams: { model: cloudModel, generationConfig: { responseMimeType: 'application/json', responseSchema: effectSchema } },
      onDeviceParams: { createOptions: DEIXIS_CREATE_OPTIONS, promptOptions: { responseConstraint: EFFECT_CONSTRAINT } },
    }) as unknown as MultimodalGenModel;
    const effectCheckCloud = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: { model: cloudModel, generationConfig: { responseMimeType: 'application/json', responseSchema: effectSchema } },
    }) as unknown as MultimodalGenModel;
    const connectorWriter = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: 'application/json', responseSchema: toFirebaseSchema(CONNECTOR_CONSTRAINT, Schema) },
      },
    });

    // Reference drawings and layout frames: a cloud *text* model returns SVG
    // JSON. Image-generating models need the Blaze plan; billing is not enabled.
    const refGenerate = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: 'application/json', responseSchema: toFirebaseSchema(REF_GENERATE_CONSTRAINT, Schema) },
      },
    });

    // CAD copilot. Nano picks a typed tool on the device; the cloud twin only
    // runs if the on-device call throws. Hard questions, email drafts and 3D
    // materials are cloud-only text/JSON models (no image models: no billing).
    // ONLY_ON_DEVICE, same reasoning as `intent`/`fusion`/`deixis` above —
    // pickCadTool() sends the raw utterance here; cadToolCloud below still
    // serves the explicit retry-on-throw path with a redacted prompt.
    const cadTool = onDeviceModel({
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: { createOptions: ON_DEVICE_CREATE_OPTIONS, promptOptions: { responseConstraint: CAD_TOOL_CONSTRAINT } },
    });
    const jsonGen = (constraint: Record<string, unknown>) => ({
      responseMimeType: 'application/json' as const,
      responseSchema: toFirebaseSchema(constraint, Schema),
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    });
    const cloudJson = (constraint: Record<string, unknown>, model = cloudModel) => getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: { model, generationConfig: jsonGen(constraint) },
    });
    const cadToolCloud = cloudJson(CAD_TOOL_CONSTRAINT);
    const copilotAnswer = cloudJson(COPILOT_ANSWER_CONSTRAINT);
    const copilotAnswerHedge = cloudModel === HEDGE_CLOUD_MODEL
      ? null
      : cloudJson(COPILOT_ANSWER_CONSTRAINT, HEDGE_CLOUD_MODEL);
    // Smart canvas: JSON in, JSON out, no copilot/template schema so a board
    // plan or a language pack can both come back as the prompt describes.
    const canvasJsonGen = {
      responseMimeType: 'application/json' as const,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    };
    const canvasCloud = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: { model: cloudModel, generationConfig: canvasJsonGen },
    });
    const canvasCloudHedge = cloudModel === HEDGE_CLOUD_MODEL
      ? null
      : getGenerativeModel(ai, {
          mode: InferenceMode.ONLY_IN_CLOUD,
          inCloudParams: { model: HEDGE_CLOUD_MODEL, generationConfig: canvasJsonGen },
        });
    const copilotEmail = cloudJson(EMAIL_CONSTRAINT);
    const copilotEmailHedge = cloudModel === HEDGE_CLOUD_MODEL ? null : cloudJson(EMAIL_CONSTRAINT, HEDGE_CLOUD_MODEL);
    const copilotMaterials = cloudJson(MATERIAL_CONSTRAINT);
    const copilotMaterialsHedge = cloudModel === HEDGE_CLOUD_MODEL ? null : cloudJson(MATERIAL_CONSTRAINT, HEDGE_CLOUD_MODEL);
    const a11yConstraint = buildA11yConstraint(modeAi.opConstraint);
    const a11yExplain = cloudJson(a11yConstraint);
    const a11yExplainHedge = cloudModel === HEDGE_CLOUD_MODEL ? null : cloudJson(a11yConstraint, HEDGE_CLOUD_MODEL);

    cached = {
      cadTool, cadToolCloud, copilotAnswer, copilotAnswerHedge, copilotEmail, copilotEmailHedge, copilotMaterials, copilotMaterialsHedge,
      canvasCloud, canvasCloudHedge,
      intent, template, verify, fusion, fusionLang, langDetect, deixis, deixisCloud, intentCloud, verifyCloud, fusionCloud, a11yExplain, a11yExplainHedge, handAdapt, condense, nextSteps, promptTemplate, tts,
      deviceSee, deviceSeeCloud, effectCheck, effectCheckCloud, connectorWriter, refGenerate,
    };
    return cached;
  } catch (err) {
    noteError('Firebase AI init', err);
    if (appCheckState !== 'failed') {
      statusMessage = 'Firebase AI could not start. Using rules only.';
    }
    cached = null;
    return null;
  }
}

function applePlugin(): AppleAIPlugin | null {
  if (testOverrides && 'appleAI' in testOverrides) return testOverrides.appleAI ?? null;
  return getAppleAIPlugin();
}

function blankModels(): Models {
  return {
    intent: null,
    template: null,
    verify: null,
    fusion: null,
    deixis: null,
    deixisCloud: null,
    intentCloud: null,
    verifyCloud: null,
    fusionCloud: null,
    fusionLang: null,
    langDetect: null,
    a11yExplain: null,
    a11yExplainHedge: null,
    handAdapt: null,
    condense: null,
    nextSteps: null,
    promptTemplate: null,
    tts: null,
    deviceSee: null,
    deviceSeeCloud: null,
    effectCheck: null,
    effectCheckCloud: null,
    connectorWriter: null,
    refGenerate: null,
    cadTool: null,
    cadToolCloud: null,
    copilotAnswer: null,
    copilotAnswerHedge: null,
    copilotEmail: null,
    copilotEmailHedge: null,
    copilotMaterials: null,
    copilotMaterialsHedge: null,
    canvasCloud: null,
    canvasCloudHedge: null,
  };
}

/** Overlay Apple on-device text models when the iOS plugin is available.
 *  Image jobs stay on the existing path (on-device Apple is text-only here).
 *  Does not require Firebase — Quick still works if the cloud path is down. */
async function withAppleModels(base: Models | null): Promise<Models | null> {
  const plugin = applePlugin();
  if (!plugin) return base;
  const checked = await checkAppleAvailability(plugin);
  if (checked?.status !== 'available') return base;
  onDeviceKind = 'apple';
  deviceModelStatus = 'ready';
  const modeAi = getActiveMode().ai;
  const fusionConstraint = buildFusionConstraint(modeAi.opConstraint);
  const overlay: Partial<Models> = {
    intent: appleTextModel(modeAi.opConstraint, plugin),
    verify: appleTextModel(modeAi.verifyConstraint, plugin),
    fusion: appleTextModel(fusionConstraint, plugin),
    fusionLang: appleTextModel(fusionConstraint, plugin),
    handAdapt: appleTextModel(PROFILE_CONSTRAINT, plugin),
    condense: appleTextModel(CONDENSE_CONSTRAINT, plugin),
    nextSteps: appleTextModel(NEXT_STEPS_CONSTRAINT, plugin),
    cadTool: appleTextModel(CAD_TOOL_CONSTRAINT, plugin),
  };
  return { ...(base ?? blankModels()), ...overlay };
}

function languageModelProvider(): LanguageModelProvider | null {
  if (testOverrides && 'languageModel' in testOverrides) return testOverrides.languageModel ?? null;
  const lm = (globalThis as Record<string, unknown>).LanguageModel as LanguageModelProvider | undefined;
  return lm && typeof lm.availability === 'function' ? lm : null;
}

function mapAvailability(a: string): DeviceModelStatus {
  switch (a) {
    case 'available': return 'ready';
    case 'downloadable': return 'downloadable';
    case 'downloading': return 'downloading';
    default: return 'unavailable';
  }
}

/**
 * Ask Chrome (without downloading anything) whether Nano can run here.
 * Safe to call on page load; updates and returns the device status.
 */
export async function checkDeviceAvailability(): Promise<DeviceModelStatus> {
  const preferChrome = Boolean(testOverrides && 'languageModel' in testOverrides);
  if (!preferChrome) {
    const plugin = applePlugin();
    if (plugin) {
      const checked = await checkAppleAvailability(plugin);
      const status = checked?.status ?? 'unavailable';
      deviceModelStatus = appleStatusToDevice(status);
      onDeviceKind = 'apple';
      return deviceModelStatus;
    }
  }
  const lm = languageModelProvider();
  if (!lm) {
    deviceModelStatus = 'unsupported';
    onDeviceKind = null;
    return deviceModelStatus;
  }
  try {
    deviceModelStatus = mapAvailability(await lm.availability(ON_DEVICE_CREATE_OPTIONS));
    onDeviceKind = deviceModelStatus === 'ready' || deviceModelStatus === 'downloadable' || deviceModelStatus === 'downloading'
      ? 'nano'
      : null;
  } catch (err) {
    noteError('LanguageModel.availability', err);
    deviceModelStatus = 'unavailable';
    onDeviceKind = null;
  }
  return deviceModelStatus;
}

/**
 * Ask Chrome whether Nano can run a given language on-device (no download),
 * by querying availability() with that language as expected input/output. The
 * router uses this to try Nano first for a supported language and fall back to
 * the cloud translate path otherwise. 'en' is always on-device-capable when the
 * base model is ready, so it short-circuits without a query.
 */
export async function checkLanguageAvailability(langCode: string): Promise<boolean> {
  if (langCode === 'en') return deviceModelStatus === 'ready';
  const lm = languageModelProvider();
  if (!lm) return false;
  try {
    const a = await lm.availability({
      expectedInputs: [{ type: 'text', languages: [langCode] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
    return a === 'available';
  } catch (err) {
    noteError('LanguageModel.availability (lang)', err);
    return false;
  }
}

/**
 * Download/warm the on-device model. Must be called from a user gesture
 * (Chrome Prompt API requirement). Returns true only if Chrome reports the
 * model "available" afterwards; the SDK's initializeDeviceModel silently
 * returns in PREFER_ON_DEVICE mode when Nano is unavailable, so its success
 * alone is not proof.
 */
export async function initDeviceModel(onProgress?: (p: number) => void): Promise<boolean> {
  const preferChrome = Boolean(testOverrides && 'languageModel' in testOverrides);
  const plugin = preferChrome ? null : applePlugin();
  if (plugin) {
    const before = await checkDeviceAvailability();
    if (before === 'unsupported' || before === 'unavailable' || before === 'failed') return false;
    if (before === 'ready') {
      try { await plugin.prewarm?.(); } catch (err) { noteError('Apple prewarm', err); }
      return true;
    }
    deviceModelStatus = 'downloading';
    try { await plugin.prewarm?.(); } catch (err) { noteError('Apple prewarm', err); }
    const after = await checkDeviceAvailability();
    return after === 'ready';
  }
  const before = await checkDeviceAvailability();
  if (before === 'unsupported' || before === 'unavailable') return false;
  const models = await ensureModels();
  if (!models?.intent?.initializeDeviceModel) {
    deviceModelStatus = 'failed';
    if (!lastError) lastError = 'Firebase AI is not configured, so on-device AI cannot start.';
    return false;
  }
  deviceModelStatus = before === 'ready' ? 'ready' : 'downloading';
  try {
    await models.intent.initializeDeviceModel(onProgress);
    const after = await checkDeviceAvailability();
    if (after === 'ready') return true;
    deviceModelStatus = after === 'unavailable' || after === 'unsupported' ? after : 'failed';
    return false;
  } catch (err) {
    noteError('initializeDeviceModel', err);
    deviceModelStatus = 'failed';
    return false;
  }
}

// ---------------------------------------------------------------------------
// Prompts come from the active EditorMode (core/modes). The intent prompt
// doubles as the Nano system prompt, so modes keep it compact.
//
// ---------------------------------------------------------------------------
// Response handling.

function sourceOf(resp: { inferenceSource?: string }): Source {
  if (resp.inferenceSource === 'on_device') return 'on-device';
  return 'cloud';
}

/**
 * Hybrid call. In PREFER_ON_DEVICE the SDK does not fall back to the cloud if
 * the on-device prompt itself throws (or hangs), so retry once on the
 * cloud-only twin before giving up to the rule parser. The retry sends
 * `cloudPrompt` (the caller's REDACTED rebuild — see ai/redact), never the raw
 * on-device prompt, so her words don't ride a failure path to the cloud.
 */
const nanoBusyListeners = new Set<(label: string) => void>();
/** Hear about an on-device job that went to the cloud twin because the one
 *  on-device model was busy (the canvas shows "Nano busy → Gemini"). */
export function onNanoBusyHandoff(cb: (label: string) => void): () => void {
  nanoBusyListeners.add(cb);
  return () => { nanoBusyListeners.delete(cb); };
}
function tellNanoBusy(label: string): void {
  for (const cb of nanoBusyListeners) { try { cb(label); } catch { /* a listener must not fail the call */ } }
}

async function callWithCloudRetry(
  hybrid: TextGenModel,
  cloud: TextGenModel | null,
  prompt: string,
  label: string,
  timeoutMs: number = ON_DEVICE_TIMEOUT_MS,
  cloudPrompt: string = prompt,
): Promise<ModelResponse | null> {
  try {
    const { response } = await withTimeout(hybrid.generateContent(prompt), timeoutMs, label);
    return response;
  } catch (err) {
    noteError(`${label} (hybrid)`, err);
    if (!cloud) throw err;
    if (err instanceof NanoQueueSkipped) tellNanoBusy(label);
    // The cloud retry needs its own hard timeout just like every other cloud
    // call here: if it hangs (slow network / stalled AI-Logic stream) the caller
    // would otherwise never resolve OR reject, so the rules-floor fallback never
    // fires and the turn freezes with no error surfaced.
    const { response } = await withTimeout(
      cloud.generateContent(cloudPrompt),
      CLOUD_GENERATE_TIMEOUT_MS,
      `${label} (cloud retry)`,
    );
    return { text: () => response.text(), inferenceSource: 'in_cloud' };
  }
}

/** Fusion context bound for the cloud: nearby-element labels are plan text that
 *  can carry a person's name, so they get the same rules-first redaction as the
 *  utterance. Ids/kinds (what the model actually answers with) are untouched. */
function redactCtxForCloud(ctx: FusionContext, planNames: string[]): FusionContext {
  if (!ctx.nearby.some((n) => n.label)) return ctx;
  return {
    ...ctx,
    nearby: ctx.nearby.map((n) => (n.label ? { ...n, label: protectText(n.label, planNames).text } : n)),
  };
}

/** Prepend the Remote Config prompt preamble (if any) to a big-job prompt. */
function withPreamble(prompt: string): string {
  const pre = remoteSettings().promptPreamble.trim();
  return pre ? `${pre}\n${prompt}` : prompt;
}

/**
 * Run a big cloud job (plan / screen / part generation). If a server prompt-
 * template ID is configured in Remote Config for this job, call the template
 * model first — the prompt and output schema live on the Firebase server, so the
 * request is just the ID plus the user's text. On any failure, fall back to the
 * inline-prompt cloud model. Either way the caller re-validates the returned text
 * before it can touch the design.
 */
async function runBigCloudJob(
  models: Models,
  jobPrompt: string,
  request: string,
  templateId: string,
  label: string,
): Promise<ModelResponse | null> {
  // One shared budget across both legs: a template timeout must not add a second
  // full timeout on top, or a big job could spin ~2× before degrading to rules.
  const deadline = Date.now() + CLOUD_GENERATE_TIMEOUT_MS;
  const remaining = () => Math.max(0, deadline - Date.now());
  if (templateId && models.promptTemplate) {
    try {
      const { response } = await withTimeout(
        models.promptTemplate.generateContent({
          templateId,
          templateVariables: { request, preamble: remoteSettings().promptPreamble },
        }),
        remaining(),
        `${label} template`,
      );
      return { text: () => response.text(), inferenceSource: response.inferenceSource ?? 'in_cloud' };
    } catch (err) {
      noteError(`${label} server template`, err);
      // Server template missing/unprovisioned — fall through to the inline model.
    }
  }
  if (!models.template) return null;
  const { response } = await withTimeout(
    models.template.generateContent(jobPrompt),
    remaining(),
    label,
  );
  return response;
}

// ---------------------------------------------------------------------------
// Public API.

export async function compileCommand(
  utterance: string,
  sceneSummary: string,
  selectedId: string | null,
  opts?: { planNames?: string[] },
): Promise<CompileResult> {
  const t0 = Date.now();
  const models = await ensureModels();
  if (models?.intent) {
    try {
      const buildPrompt = (u: string) =>
        `${getActiveMode().ai.intentPrompt}\nScene: ${sceneSummary}\nSelected: ${selectedId ?? 'none'}\nCommand: "${u}"`;
      const prompt = buildPrompt(utterance);
      const cloudPrompt = buildPrompt(protectText(utterance, opts?.planNames ?? []).text);
      const response = await callWithCloudRetry(
        models.intent, models.intentCloud ?? null, prompt, 'intent', ON_DEVICE_TIMEOUT_MS, cloudPrompt,
      );
      // The active mode coerces untrusted JSON into a validated result (or null).
      const result = response ? getActiveMode().coerce(extractJson(response.text()), utterance) : null;
      if (result) {
        const source = sourceOf(response!);
        recordInference(source, 'compile', Date.now() - t0);
        return { result, source, ms: Date.now() - t0 };
      }
      // Model answered but nothing valid came out — record the raw text so an
      // unexpected RULES-badge fallback is explainable (not a silent drop).
      if (response) noteError('intent coerce', new Error(`model op not accepted: ${response.text().slice(0, 200)}`));
    } catch (err) {
      noteError('intent model', err);
    }
  }
  const result = getActiveMode().parse(utterance);
  recordInference('rules', 'compile', Date.now() - t0);
  return { result, source: 'rules', ms: Date.now() - t0 };
}

/** A fused deictic command: a mode-validated result + the model's confidence. */
export interface FusionOutcome {
  result: object;
  /** 0..1. Rules path: 1 for a concrete op, 0 for a clarify. */
  confidence: number;
  source: Source;
  ms: number;
  /** English translation of a non-English transcript (fusion with a language). */
  translation?: string;
  /** Short spoken confirmation in the speaker's language (non-English only). */
  reply?: string;
}

/**
 * ON-DEVICE INTENT FUSION (PREFER_ON_DEVICE): resolve a messy voice transcript
 * plus pointer/hand context ("put a door here", "make that one wider") into one
 * typed, re-validated op with a confidence score. Prompt building and result
 * parsing live in intentFusion.ts (pure, unit-tested without a network).
 *
 * The command router (ai/router.ts) calls intentFusion.exactRuleParse() FIRST —
 * an exact rule-parsed command short-circuits fusion entirely. This function
 * only rule-parses as a last-resort floor when no model is available.
 *
 * `forceCloud` is the router's low-confidence escalation: re-ask the ONLY_IN_CLOUD
 * fusion twin instead of Nano (falls to the rules floor if no cloud model).
 */
export async function fuseIntent(
  utterance: string,
  ctx: FusionContext,
  opts?: {
    forceCloud?: boolean;
    lang?: { code: string; englishName: string };
    /** Personal-phrasebook few-shot block (ai/phrasebook.buildFewShotPrefix).
     *  Private speech — attached to the on-device model always, but to the cloud
     *  ONLY when `examplesCloudOk` says this is the sanctioned escalation. */
    fewShot?: string;
    /** The router already escalated THIS command, so the few-shot may go cloud. */
    examplesCloudOk?: boolean;
    /** Plan text labels (main.planLabelNames) so a cloud leg redacts the same
     *  person-like labels the ledger's commandPayload does. */
    planNames?: string[];
  },
): Promise<FusionOutcome> {
  const t0 = Date.now();
  const models = await ensureModels();
  const mode = getActiveMode();
  // A non-English command that reached the on-device path uses the Nano
  // session that accepts that language (the router only sends it here when
  // Chrome said the language is available on-device).
  const nonEnglish = !!opts?.lang && opts.lang.code !== 'en';
  const onDevice = nonEnglish ? (models?.fusionLang ?? models?.fusion) : models?.fusion;
  const primary = opts?.forceCloud ? models?.fusionCloud : onDevice;
  if (models && primary) {
    try {
      // Privacy gate: the phrasebook may ride a cloud call only on the sanctioned
      // escalation; otherwise it is on-device only.
      const fewShot = opts?.fewShot && (!opts.forceCloud || opts.examplesCloudOk) ? opts.fewShot : undefined;
      // Rules-first redaction (ai/redact): any prompt bound for the cloud —
      // forceCloud or the retry below — carries the SAME redacted utterance the
      // ledger records. Only the on-device Nano prompt keeps her raw words.
      const planNames = opts?.planNames ?? [];
      const cloudPrompt = buildFusionPrompt(
        mode.ai.intentPrompt, protectText(utterance, planNames).text,
        redactCtxForCloud(ctx, planNames), opts?.lang, fewShot,
      );
      const prompt = opts?.forceCloud
        ? cloudPrompt
        : buildFusionPrompt(mode.ai.intentPrompt, utterance, ctx, opts?.lang, fewShot);
      // An on-device call carrying the private phrasebook must NOT silently fall
      // back to the cloud twin (that would leak it without an escalation); it
      // drops to the rules floor instead. Only an explicit forceCloud escalation
      // sends examples to the cloud.
      const retry = opts?.forceCloud || fewShot ? null : models.fusionCloud ?? null;
      const response = await callWithCloudRetry(
        primary, retry, prompt, opts?.forceCloud ? 'fuse-cloud' : 'fuse', ON_DEVICE_TIMEOUT_MS, cloudPrompt,
      );
      const parsed = response
        ? parseFusionResult(extractJson(response.text()), mode.coerce.bind(mode), utterance)
        : null;
      if (parsed) {
        const source = sourceOf(response!);
        recordInference(source, 'fuse', Date.now() - t0);
        return { ...parsed, source, ms: Date.now() - t0 };
      }
      if (response) noteError('fuse coerce', new Error(`model op not accepted: ${response.text().slice(0, 200)}`));
    } catch (err) {
      noteError('fusion model', err);
    }
  }
  // Deterministic floor: rule-parse the cleaned transcript (fillers/stutters
  // stripped), so "uh move move it left 10" still works with no model at all.
  const result = mode.parse(normalizeTranscript(utterance));
  recordInference('rules', 'fuse', Date.now() - t0);
  return { result, confidence: ruleConfidence(result), source: 'rules', ms: Date.now() - t0 };
}

/** CLOUD LANGUAGE DETECTION: only used when Chrome's on-device Language
 *  Detector is missing and the on-device script/word checks were ambiguous.
 *  Sends the transcript text only; the caller records it in the ledger as
 *  'lang-detect'. Returns null with no cloud model or on any failure. */
export async function detectLanguageCloud(
  text: string,
  opts?: { planNames?: string[] },
): Promise<{ detection: Detection; ms: number } | null> {
  const t0 = Date.now();
  const models = await ensureModels();
  const model = models?.langDetect;
  if (!model) return null;
  try {
    // ONLY_IN_CLOUD: the transcript is redacted (ai/redact) before it leaves,
    // matching the ledger's recorded payload. Detection only needs the script
    // and common words, never her family's names.
    const sent = protectText(text, opts?.planNames ?? []).text;
    const { response } = await withTimeout(model.generateContent(cloudDetectPrompt(sent)), CLOUD_GENERATE_TIMEOUT_MS, 'lang-detect');
    const detection = parseCloudDetection(extractJson(response.text()));
    if (!detection) return null;
    recordInference('cloud', 'lang-detect', Date.now() - t0);
    return { detection, ms: Date.now() - t0 };
  } catch (err) {
    noteError('lang-detect', err);
    return null;
  }
}

/** RECIPE PICK (taught-once recipes): map an utterance to one saved recipe id.
 *  Same hybrid shape as fuseIntent — PREFER_ON_DEVICE via the fusion model,
 *  `forceCloud` for non-English (Kannada goes to the cloud like other Kannada
 *  text; the caller records that send in the ledger). The pick is parsed
 *  STRICTLY against the known ids (an invented id becomes null). Returns null
 *  when no model is available at all → the caller's rules matcher is the floor. */
export interface RecipePickOutcome {
  id: string | null;
  confidence: number;
  source: Source;
  ms: number;
}

export async function pickRecipeHybrid(
  utterance: string,
  candidates: readonly RecipeRef[],
  opts?: { forceCloud?: boolean; lang?: { code: string; englishName: string }; planNames?: string[] },
): Promise<RecipePickOutcome | null> {
  if (candidates.length === 0) return null;
  const t0 = Date.now();
  const models = await ensureModels();
  const primary = opts?.forceCloud ? models?.fusionCloud : models?.fusion;
  if (!models || !primary) return null;
  try {
    // Cloud legs (forceCloud or the retry) get the redacted utterance — the
    // same text the ledger records; the on-device prompt keeps her raw words.
    const cloudPrompt = buildRecipePickPrompt(
      protectText(utterance, opts?.planNames ?? []).text, candidates, opts?.lang?.englishName,
    );
    const prompt = opts?.forceCloud ? cloudPrompt : buildRecipePickPrompt(utterance, candidates, opts?.lang?.englishName);
    const retry = opts?.forceCloud ? null : models.fusionCloud ?? null;
    const response = await callWithCloudRetry(primary, retry, prompt, 'recipe-pick', ON_DEVICE_TIMEOUT_MS, cloudPrompt);
    if (!response) return null;
    const pick = parseRecipePick(extractJson(response.text()), candidates.map((c) => c.id));
    const source = sourceOf(response);
    recordInference(source, 'recipe-pick', Date.now() - t0);
    return { ...pick, source, ms: Date.now() - t0 };
  } catch (err) {
    noteError('recipe pick', err);
    return null;
  }
}

/** The still frame sent with a point-and-say command (one tight JPEG crop). */
export interface DeixisImage {
  mimeType: 'image/jpeg' | 'image/png';
  dataBase64: string;
}

export interface DeixisOutcome {
  resolution: DeixisResolution;
  source: Source;
  ms: number;
}

/**
 * POINT AND SAY "THIS" (PREFER_ON_DEVICE, image input): resolve what the user
 * is pointing at — on the canvas (candidate list) or a real object in the
 * camera view (one tight crop around the pointer) — plus which property to
 * change. Prompt/crop building and response validation live in deixis.ts
 * (pure). Returns null when no model is available or nothing valid came back;
 * the caller then falls through to the ordinary fusion path, so point-and-say
 * never breaks a command that would have worked without it. The frame crop is
 * sent ONLY here, only through Firebase AI Logic, never stored.
 */
export async function resolveDeixis(
  utterance: string,
  image: DeixisImage | null,
  opts: {
    pointer: { x: number; y: number } | null;
    candidates: readonly DeixisCandidate[];
    space: 'plan';
    planNames?: string[];
  },
): Promise<DeixisOutcome | null> {
  const t0 = Date.now();
  const models = await ensureModels();
  if (!models?.deixis) return null;
  const prompt = buildDeixisPrompt(utterance, {
    hasImage: image !== null,
    pointer: opts.pointer,
    candidates: opts.candidates,
    space: opts.space,
  });
  const parts: Array<string | ImagePart> = image
    ? [prompt, { inlineData: { mimeType: image.mimeType, data: image.dataBase64 } }]
    : [prompt];
  const planNames = opts.planNames ?? [];
  const cloudUtterance = protectText(utterance, planNames).text;
  const cloudCandidates = opts.candidates.map((c) => (
    c.label ? { ...c, label: protectText(c.label, planNames).text } : c
  ));
  const cloudPrompt = buildDeixisPrompt(cloudUtterance, {
    hasImage: image !== null,
    pointer: opts.pointer,
    candidates: cloudCandidates,
    space: opts.space,
  });
  const cloudParts: Array<string | ImagePart> = image
    ? [cloudPrompt, { inlineData: { mimeType: image.mimeType, data: image.dataBase64 } }]
    : [cloudPrompt];
  let response: ModelResponse | null = null;
  try {
    ({ response } = await withTimeout(models.deixis.generateContent(parts), ON_DEVICE_TIMEOUT_MS, 'deixis'));
  } catch (err) {
    noteError('deixis (hybrid)', err);
    if (!models.deixisCloud) return null;
    try {
      const r = await models.deixisCloud.generateContent(cloudParts);
      response = { text: () => r.response.text(), inferenceSource: 'in_cloud' };
    } catch (err2) {
      noteError('deixis (cloud)', err2);
      return null;
    }
  }
  const resolution = response
    ? parseDeixisResult(extractJson(response.text()), opts.candidates.map((c) => c.id))
    : null;
  if (!resolution) {
    if (response) noteError('deixis parse', new Error(`model answer not accepted: ${response.text().slice(0, 200)}`));
    return null;
  }
  const source = sourceOf(response!);
  recordInference(source, 'deixis', Date.now() - t0);
  return { resolution, source, ms: Date.now() - t0 };
}

export async function verifyOp(
  op: Op,
  beforeSummary: string,
  afterSummary: string,
  warnings: string[],
): Promise<VerifyResult> {
  const models = await ensureModels();
  if (models?.verify) {
    try {
      const prompt = `${getActiveMode().ai.verifyPrompt}
Op: ${JSON.stringify(op)}
Scene before: ${beforeSummary}
Scene after: ${afterSummary}
Printability warnings: ${JSON.stringify(warnings)}`;
      const response = await callWithCloudRetry(models.verify, models.verifyCloud ?? null, prompt, 'verify');
      if (!response) throw new Error('verifier returned nothing');
      const parsed = extractJson(response.text());
      if (typeof parsed === 'object' && parsed !== null) {
        const o = parsed as Record<string, unknown>;
        if (typeof o.matchesIntent === 'boolean') {
          const source = sourceOf(response);
          recordInference(source, 'verify');
          return {
            matchesIntent: o.matchesIntent,
            issue: typeof o.issue === 'string' && o.issue ? o.issue : null,
            source,
          };
        }
      }
    } catch (err) {
      noteError('verify model', err);
    }
  }
  recordInference('rules', 'verify');
  return { matchesIntent: warnings.length === 0, issue: warnings[0] ?? null, source: 'rules' };
}

/**
 * Plan-mode "generate a whole plan" (ONLY_IN_CLOUD, same hybrid wrapper as the
 * part template path). The cloud model returns {ops:[...]}; code re-validates
 * and caps them. Falls back to the deterministic rule parser + a plan template
 * when the cloud is unavailable, so "two bedroom plan" works with no AI.
 */
export async function generatePlan(prompt: string, opts?: { planNames?: string[] }): Promise<GeneratePlanResult> {
  const models = await ensureModels();
  if (models?.template) {
    try {
      const sent = protectText(prompt, opts?.planNames ?? []).text;
      const jobPrompt = withPreamble(`${getActiveMode().ai.templatePrompt}\nRequest: "${sent}"`);
      const response = await runBigCloudJob(
        models, jobPrompt, sent, remoteSettings().templateIds.plan, 'plan generate',
      );
      const coerced = response ? coercePlanGenerate(extractJson(response.text())) : null;
      if (coerced && 'ops' in coerced && coerced.ops.length) {
        const source = sourceOf(response!);
        recordInference(source, 'generate-plan');
        return { ops: coerced.ops, source };
      }
      if (coerced && 'clarify' in coerced) {
        const source = sourceOf(response!);
        recordInference(source, 'generate-plan');
        return { clarify: coerced.clarify, source };
      }
      // 200 but no usable plan — fall through to the deterministic template.
      noteError('plan generate', new Error('cloud plan was empty or invalid; using a template'));
    } catch (err) {
      noteError('plan generate model', err);
    }
  }
  recordInference('rules', 'generate-plan');
  // Rules fallback: a named template → re-validated ops. An unrecognised design
  // request still gets an honest two-bedroom plan rather than a dead-end clarify.
  const ruled = parsePlanCommand(prompt);
  let template: PlanTemplateName | null = isPlanGenerate(ruled) ? ruled.generate : null;
  let note: string | undefined;
  if (!template && getActiveMode().isDesignRequest(prompt)) {
    template = 'twoBedroom';
    note = 'Cloud plan was unavailable — built a two-bedroom template instead.';
  }
  if (template) {
    const ops: PlanOp[] = [];
    for (const env of buildPlanTemplate(template)) {
      const v = validatePlanOp(env);
      if (v.ok) ops.push(v.op);
    }
    if (ops.length) return { ops, note, source: 'rules' };
  }
  return { clarify: 'Try "two bedroom plan", "studio", or "room 4 by 3".', source: 'rules' };
}

/** Cloud explanations (and optional alternative fixes) for a11y issues. */
function logCloudFail(label: string, kind: CloudFailKind, detail = ''): void {
  lastFailKind = kind;
  noteError(label, new Error(`${kind}${detail ? `: ${detail.slice(0, 400)}` : ''}`));
}

/**
 * One structured JSON cloud call with tolerant parse, a single retry on empty
 * or invalid output, and backoff on HTTP 429. Safety blocks are not retried.
 */
async function requestJson<T>(
  model: TextGenModel,
  prompt: string,
  budgetMs: number,
  label: string,
  coerce: (raw: unknown) => T | null,
  onChunk?: (text: string) => void,
  onFail?: (kind: CloudFailKind, detail: string) => void,
): Promise<{ value: T; source: Source } | null> {
  const run = async (): Promise<{ value: T | null; kind: CloudFailKind | null; source: Source; detail: string }> => {
    try {
      const { response } = await generateWithBudget(model, prompt, budgetMs, label, onChunk);
      const text = response.text();
      if (!text || !text.trim()) return { value: null, kind: 'empty', source: sourceOf(response), detail: '' };
      const raw = extractJson(text);
      if (raw == null) return { value: null, kind: 'parse', source: sourceOf(response), detail: text };
      const value = coerce(raw);
      if (value == null) return { value: null, kind: 'parse', source: sourceOf(response), detail: text };
      return { value, kind: null, source: sourceOf(response), detail: '' };
    } catch (err) {
      return { value: null, kind: classifyCloudFailure(err), source: 'cloud', detail: err instanceof Error ? err.message : String(err) };
    }
  };

  let result = await run();
  if (!result.value && (result.kind === '429' || result.kind === 'high-demand')) {
    const waits = result.kind === '429' ? RATE_LIMIT_BACKOFF_MS : HIGH_DEMAND_BACKOFF_MS;
    for (const wait of waits) {
      await delay(wait);
      result = await run();
      if (result.value || (result.kind !== '429' && result.kind !== 'high-demand')) break;
    }
  } else if (!result.value && (result.kind === 'parse' || result.kind === 'empty' || result.kind === 'timeout')) {
    result = await run();
  }
  if (!result.value) {
    logCloudFail(label, result.kind ?? 'other', result.detail);
    try { onFail?.(result.kind ?? 'other', result.detail); } catch { /* reporting only */ }
    return null;
  }
  lastFailKind = null;
  lastError = null;
  return { value: result.value, source: result.source };
}

/** Structured JSON call with a 2 s hedge to gemini-3.1-flash-lite. */
async function requestHedgedJson<T>(
  primary: TextGenModel | null | undefined,
  backup: TextGenModel | null | undefined,
  prompt: string,
  budgetMs: number,
  label: string,
  coerce: (raw: unknown) => T | null,
  onChunk?: (text: string) => void,
  onFail?: (kind: CloudFailKind, detail: string) => void,
  /** Every leg that was started has finished — including the one that lost
   *  the race and went on retrying. Called exactly once. */
  onAllSettled?: () => void,
): Promise<{ value: T; source: Source; model: string; ms: number } | null> {
  if (!primary) { onAllSettled?.(); return null; }
  const primaryModel = remoteSettings().cloudModel || PRIMARY_CLOUD_MODEL;
  // The race resolves on the first good answer, but the losing leg keeps
  // going (its own retries and backoffs still send requests).
  const legs: Promise<unknown>[] = [];
  const leg = <R,>(p: Promise<R>): Promise<R> => { legs.push(p.then(() => undefined, () => undefined)); return p; };
  let raced: Awaited<ReturnType<typeof raceHedged<{ value: T; source: Source }>>>;
  try {
    raced = await raceHedged({
      primary: () => leg(requestJson(primary, prompt, budgetMs, label, coerce, onChunk, onFail))
        .then((got) => got ?? null),
      backup: backup
        ? () => leg(requestJson(backup, prompt, budgetMs, `${label} (3.1)`, coerce, undefined, onFail))
          .then((got) => got ?? null)
        : undefined,
      hedgeAfterMs: HEDGE_AFTER_MS,
      primaryModel,
      backupModel: HEDGE_CLOUD_MODEL,
    });
  } finally {
    // Once the race is over no new leg starts; wait for the ones that did.
    if (onAllSettled) void Promise.all(legs).then(onAllSettled, onAllSettled);
  }
  if (!raced) return null;
  console.info(`[mendcraft] ${label} hedge: ${raced.model} won in ${raced.ms} ms`);
  return { value: raced.value.value, source: raced.value.source, model: raced.model, ms: raced.ms };
}

export interface ExplainA11yResult {
  items: A11yExplanation[];
  source: Source;
  model?: string;
  ms?: number;
}

const A11Y_EXPLAIN_PROMPT = `You are an accessibility reviewer inside a design tool. The tool's own CODE already measured each issue below against the cited standard — do not re-measure or dispute the numbers. For EACH issue, write a short plain-language "explanation" (max 2 sentences: why it matters for the user, and what the fix does), keeping the cited standard's name. Optionally propose a "fix" as ONE op from the vocabulary below when a single op would resolve the issue. Reply JSON only: {"items":[{"id":"<issue id>","explanation":"...","fix":{...}?}]}.`;

/**
 * Explain deterministic accessibility issues via Firebase AI Logic
 * (ONLY_IN_CLOUD, same wrapper discipline as the generate paths: hard timeout,
 * re-validated output, honest rules fallback). The issues and their fixes are
 * computed in CODE first — a cloud failure only loses prose, never the check.
 */
export async function explainAccessibility(
  issues: readonly Pick<A11yIssue, 'id' | 'rule' | 'message' | 'citation'>[],
  summary: string,
  planNames: string[] = [],
): Promise<ExplainA11yResult> {
  const t0 = Date.now();
  const models = await ensureModels();
  if (models?.a11yExplain && issues.length) {
    try {
      const mode = getActiveMode();
      const prompt = withPreamble(
        `${A11Y_EXPLAIN_PROMPT}\nOp vocabulary:\n${mode.ai.intentPrompt}\nIssues: ${JSON.stringify(issues)}\nDesign: ${protectText(summary, planNames).text}`,
      );
      const got = await requestHedgedJson(
        models.a11yExplain,
        models.a11yExplainHedge,
        prompt,
        cloudBudgetMs('short'),
        'a11y explain',
        (raw) => {
          const items = coerceA11yExplanations(
            raw,
            issues.map((i) => i.id),
            (fix) => mode.coerce(fix),
          );
          return items.length ? items : null;
        },
      );
      if (got) {
        recordInference(got.source, 'a11y-explain', Date.now() - t0);
        return { items: got.value, source: got.source, model: got.model, ms: Date.now() - t0 };
      }
    } catch (err) {
      noteError('a11y explain model', err);
    }
  }
  // Rules floor: the deterministic messages already carry measurement +
  // citation, so an empty item list simply keeps those.
  recordInference('rules', 'a11y-explain', Date.now() - t0);
  return { items: [], source: 'rules' };
}

/** A spoken confirmation synthesized in the cloud: base64 audio + its mime. */
export interface SpeechAudio {
  mimeType: string;
  dataBase64: string;
  source: Source;
  ms: number;
}

/** Best-effort: is the cloud TTS model built and ready? True only after
 *  prepareHybrid() has run and the SDK provided an audio-output model. Used by
 *  the speech-route decision to know whether the cloud voice is an option. */
export function cloudTtsReady(): boolean {
  return cached?.tts != null;
}

/** 4s budget: a hung TTS call must fall back to speechSynthesis promptly, never
 *  leave the user without a reply. */
const TTS_TIMEOUT_MS = 4000;

/**
 * SPOKEN REPLY IN HER LANGUAGE (cloud): synthesize a SHORT fixed confirmation
 * (from language.confirmPhrase — never free text) as audio via Firebase AI
 * Logic, for a language the browser can't voice well. Returns the base64 audio
 * + mime so the caller plays it with Web Audio and records the cloud call in the
 * ledger; returns null on any failure so the caller falls back to speechSynthesis.
 */
export async function synthesizeSpeech(text: string): Promise<SpeechAudio | null> {
  const t0 = Date.now();
  const models = await ensureModels();
  if (!models?.tts || !text.trim()) return null;
  try {
    const { response } = await withTimeout(models.tts.generateContent(text), TTS_TIMEOUT_MS, 'tts');
    const part = response.inlineDataParts?.()?.find((p) => p.inlineData?.data);
    if (!part) {
      noteError('tts', new Error('cloud TTS returned no audio'));
      return null;
    }
    recordInference('cloud', 'tts', Date.now() - t0);
    return {
      mimeType: part.inlineData.mimeType || 'audio/L16;rate=24000',
      dataBase64: part.inlineData.data,
      source: 'cloud',
      ms: Date.now() - t0,
    };
  } catch (err) {
    noteError('tts model', err);
    return null;
  }
}

export interface AdaptHandResult extends ProfileAdaptation {
  ms: number;
}

/**
 * HAND-ADAPTIVE INPUT (on-device only). Feed the numbers computed from hand
 * landmarks (input/handMetrics — effort, tremor, pinch time, fatigue) to Nano
 * via the Prompt API's responseConstraint and get back one interaction profile.
 *
 * Privacy is the hard constraint: the raw numbers must never leave the device.
 * So this path, unlike every other hybrid call, uses an ONLY_ON_DEVICE model
 * with NO cloud transport (no inCloudParams, no cloud twin, no cloud retry), and
 * runs it only when Nano is actually ready here; the on-device source is then
 * re-checked belt-and-suspenders and anything else is discarded. When Nano is
 * unavailable the
 * deterministic rules pick (handProfile.fallbackProfile) stands in — the numbers
 * still never go anywhere. Telemetry records only the source + latency, never
 * the metrics themselves.
 */
export async function adaptHandProfile(metrics: HandMetrics): Promise<AdaptHandResult> {
  const t0 = Date.now();
  const models = await ensureModels();
  if (models?.handAdapt && deviceModelStatus === 'ready') {
    try {
      const prompt = buildAdaptPrompt(metrics);
      const { response } = await withTimeout(
        models.handAdapt.generateContent(prompt),
        ON_DEVICE_TIMEOUT_MS,
        'hand-adapt',
      );
      // Belt-and-suspenders: if this somehow resolved in the cloud, drop it so
      // the raw hand numbers are never acted on off-device.
      if (sourceOf(response) === 'on-device') {
        const parsed = coerceProfileAdaptation(extractJson(response.text()), metrics);
        recordInference('on-device', 'hand-adapt', Date.now() - t0);
        return { ...parsed, ms: Date.now() - t0 };
      }
      noteError('hand adapt', new Error('on-device model unavailable; keeping numbers on device'));
    } catch (err) {
      noteError('hand adapt model', err);
    }
  }
  const rules = coerceProfileAdaptation(null, metrics);
  recordInference('rules', 'hand-adapt', Date.now() - t0);
  return { ...rules, ms: Date.now() - t0 };
}

/**
 * NANO RAMBLE CONDENSER (on-device only). Turn a long natural ramble into one
 * short command before the copilot/fusion paths (and the cloud payload) see
 * it. Same privacy posture as adaptHandProfile: an ONLY_ON_DEVICE model with
 * no cloud transport, gated on Nano being ready, source re-checked
 * belt-and-suspenders. Null on any miss — the caller keeps her raw words and
 * the route line is unchanged. Never cloud; the deterministic gates live in
 * ai/condense.ts (shouldCondense / coerceCondensed).
 */
export async function condenseUtterance(
  utterance: string,
  opts?: { timeoutMs?: number },
): Promise<CondenseOutcome | null> {
  const t0 = Date.now();
  const models = await ensureModels();
  if (!models?.condense || deviceModelStatus !== 'ready') return null;
  try {
    const { response } = await withTimeout(
      models.condense.generateContent(condensePrompt(utterance)),
      opts?.timeoutMs ?? CONDENSE_TIMEOUT_MS,
      'condense',
    );
    if (sourceOf(response) !== 'on-device') {
      noteError('condense', new Error('resolved off-device; keeping her raw words'));
      return null;
    }
    const text = coerceCondensed(extractJson(response.text()), utterance);
    if (!text) return null;
    recordInference('on-device', 'condense', Date.now() - t0);
    return { text, fromWords: wordCount(utterance), toWords: wordCount(text), ms: Date.now() - t0 };
  } catch (err) {
    noteError('condense', err);
    return null;
  }
}

/** Prompt API responseConstraint for the next-step pick. */
export const NEXT_STEPS_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: { ids: { type: 'array', items: { type: 'string' } } },
  required: ['ids'],
};
/** A pick is a convenience that runs while the page is idle, so it gets a
 *  generous budget — the rule chips are already on screen meanwhile. */
export const NEXT_STEPS_TIMEOUT_MS = 8000;

/**
 * NEXT-STEP CHIPS (on-device only). Nano reorders a fixed list of step ids;
 * the caller (canvas/nextSteps) parses the reply strictly. Same posture as
 * condenseUtterance: ONLY_ON_DEVICE model, gated on Nano being ready, source
 * re-checked. Null on any miss — the caller shows the rule list, labelled so.
 */
export async function pickNextStepsOnDevice(prompt: string, opts?: { timeoutMs?: number }): Promise<string | null> {
  const t0 = Date.now();
  const models = await ensureModels();
  if (!models?.nextSteps) return null;
  if (deviceModelStatus === 'idle') await checkDeviceAvailability();
  if (deviceModelStatus !== 'ready') return null;
  // Never compete with a board turn (or anything else) for the one model.
  if (!testOverrides && !nanoQueue.idle()) return null;
  const budget = opts?.timeoutMs ?? NEXT_STEPS_TIMEOUT_MS;
  // A per-call model with its own session: when the pick runs out of time (or
  // fails) that session is destroyed, so Nano is not left generating a reply
  // nobody will read while the next real request waits behind it.
  const session = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let own: TextGenModel | null = null;
  let done = false;
  try {
    let response: ModelResponse;
    if (testOverrides) {
      ({ response } = await withTimeout(models.nextSteps.generateContent(prompt), budget, 'next steps'));
    } else {
      // Never waits in line, and holds the model's slot for its budget at most.
      ({ response } = await nanoQueue.run(() => {
        own = onDeviceModelFor({
          createOptions: { ...ON_DEVICE_CREATE_OPTIONS, ...(session ? { signal: session.signal } : {}) },
          promptOptions: { responseConstraint: NEXT_STEPS_CONSTRAINT },
        });
        return withTimeout(own.generateContent(prompt), budget, 'next steps');
      }, { maxWaitMs: 0 }));
    }
    done = true;
    if (sourceOf(response) !== 'on-device') {
      noteError('next steps', new Error('resolved off-device; using the rule list'));
      return null;
    }
    recordInference('on-device', 'next-steps', Date.now() - t0);
    return response.text();
  } catch (err) {
    // A slow or busy model is expected here and the rule chips already show:
    // not an error worth a console warning on every load.
    if (err instanceof NanoQueueSkipped || /timed out/i.test(err instanceof Error ? err.message : '')) return null;
    noteError('next steps', err);
    return null;
  } finally {
    // Timed out or failed: stop the session. A finished pick's session is
    // dropped too — a chip pick is not worth keeping a session alive for.
    if (own) { if (!done) nanoTrace('next steps: stopped (timed out or failed)'); session?.abort(); destroySdkSession(own); }
  }
}

// ---------------------------------------------------------------------------
// ADD A DEVICE (Control Anything-style, plus reuse, a sandbox and proof).

export interface FrameImage { mimeType: string; dataBase64: string }

/** Filled in by a vision call: how many times the photo may have left the
 *  device (the hybrid model routed to the cloud, and/or the cloud twin was
 *  tried), and whether a cloud model actually answered — so the caller's
 *  ledger counts every send, even when the answer is unusable. */
export interface VisionTrace { cloudSends: number; cloudAnswered?: boolean }

/** Multimodal hybrid call: PREFER_ON_DEVICE first, cloud twin if it throws. */
async function callVision(
  hybridModel: MultimodalGenModel | null | undefined,
  cloud: MultimodalGenModel | null | undefined,
  parts: Array<string | ImagePart>,
  label: string,
  trace?: VisionTrace,
): Promise<ModelResponse | null> {
  if (hybridModel) {
    try {
      const { response } = await withTimeout(hybridModel.generateContent(parts), ON_DEVICE_TIMEOUT_MS, label);
      if (trace && sourceOf(response) === 'cloud') { trace.cloudSends += 1; trace.cloudAnswered = true; }
      return response;
    } catch (err) {
      // PREFER_ON_DEVICE without a ready Nano routes to the cloud: the photo
      // may have left even though no answer came back (e.g. our timeout).
      if (trace && deviceModelStatus !== 'ready') trace.cloudSends += 1;
      noteError(`${label} (hybrid)`, err);
    }
  }
  if (!cloud) return null;
  if (trace) trace.cloudSends += 1;
  try {
    const r = await withTimeout(cloud.generateContent(parts), CLOUD_GENERATE_TIMEOUT_MS * 2, `${label} cloud`);
    if (trace) trace.cloudAnswered = true;
    return { text: () => r.response.text(), inferenceSource: 'in_cloud' };
  } catch (err) {
    noteError(`${label} (cloud)`, err);
    return null;
  }
}

const imagePart = (f: FrameImage): ImagePart => ({ inlineData: { mimeType: f.mimeType, data: f.dataBase64 } });

/** Name the device in ONE camera frame. Null when nothing controllable is seen
 *  or no model is available. The frame goes only into this call; not stored. */
export async function identifyDevice(
  frame: FrameImage,
  hint?: IdentifyHint,
  trace?: VisionTrace,
): Promise<{ identity: DeviceIdentity; source: Source; ms: number } | null> {
  const t0 = Date.now();
  const models = await ensureModels();
  if (!models) return null;
  const response = await callVision(models.deviceSee, models.deviceSeeCloud, [buildIdentifyPrompt(hint), imagePart(frame)], 'device identify', trace);
  const identity = response ? parseIdentity(extractJson(response.text())) : null;
  if (!identity) return null;
  const source = sourceOf(response!);
  recordInference(source, 'device-identify', Date.now() - t0);
  return { identity, source, ms: Date.now() - t0 };
}

/** Cloud Gemini writes a declarative connector ONCE. The JSON is validated by
 *  the fixed interpreter's allowlist (coerceConnector) before it is used. */
export async function writeDeviceConnector(
  identity: DeviceIdentity,
): Promise<{ connector: Connector; source: Source; ms: number } | null> {
  const t0 = Date.now();
  const models = await ensureModels();
  if (!models?.connectorWriter) return null;
  try {
    const { response } = await withTimeout(
      models.connectorWriter.generateContent(withPreamble(buildConnectorPrompt(identity))),
      CLOUD_GENERATE_TIMEOUT_MS * 2,
      'connector writer',
    );
    const raw = extractJson(response.text());
    if (writerSaysUnsupported(raw)) return null;
    const c = coerceConnector(
      raw && typeof raw === 'object' ? { brand: identity.brand, deviceKind: identity.kind, ...(raw as object) } : raw,
      'cloud',
    );
    if (!c) { noteError('connector writer', new Error('connector failed the allowlist')); return null; }
    recordInference('cloud', 'connector-write', Date.now() - t0);
    return { connector: c, source: 'cloud', ms: Date.now() - t0 };
  } catch (err) {
    noteError('connector writer', err);
    return null;
  }
}

/** Compare BEFORE and AFTER frames for the action's success cue. */
export async function checkDeviceEffect(
  before: FrameImage,
  after: FrameImage,
  cue: string,
): Promise<{ verdict: EffectVerdict; reason: string; source: Source; ms: number }> {
  const t0 = Date.now();
  const models = await ensureModels();
  const response = models
    ? await callVision(models.effectCheck, models.effectCheckCloud, [buildEffectPrompt(cue), imagePart(before), imagePart(after)], 'effect check')
    : null;
  const parsed = response ? parseEffect(extractJson(response.text())) : null;
  if (!parsed) {
    recordInference('rules', 'effect-check', Date.now() - t0);
    return { verdict: 'unsure', reason: 'No vision model available to check.', source: 'rules', ms: Date.now() - t0 };
  }
  const source = sourceOf(response!);
  recordInference(source, 'effect-check', Date.now() - t0);
  return { ...parsed, source, ms: Date.now() - t0 };
}

/** Turn a fuzzy or non-English reference request into a short image-search
 *  query. Nano first (the intent PREFER_ON_DEVICE model) and the cloud twin
 *  otherwise. Returns null when no model can run; the caller keeps the local query. */
export async function refineSearchQuery(
  request: string,
): Promise<{ query: string; source: Source; ms: number } | null> {
  const t0 = Date.now();
  const models = await ensureModels();
  if (!models?.intent) return null;
  try {
    const response = await callWithCloudRetry(
      models.intent,
      models.intentCloud ?? null,
      refinePrompt(request),
      'refine-search',
      ON_DEVICE_TIMEOUT_MS,
      refinePrompt(protectText(request).text),
    );
    const query = response ? parseRefinedQuery(response.text()) : null;
    if (!query) return null;
    const source = sourceOf(response!);
    recordInference(source, 'refine-search', Date.now() - t0);
    return { query, source, ms: Date.now() - t0 };
  } catch (err) {
    noteError('refine-search', err);
    return null;
  }
}

/** Gemini SVG reference drawings or layout frames (cloud text model only).
 *  Image-generating models are not used — they need Blaze billing, which is
 *  not enabled. Returns 3–4 sanitized cards labeled Gemini · cloud, or null. */
export async function generateReferenceOptions(
  query: string,
  kind: GenerateKind,
): Promise<{ hits: RefHit[]; source: Source; ms: number } | null> {
  const t0 = Date.now();
  const models = await ensureModels();
  const model = models?.refGenerate;
  if (!model) return null;
  const q = query.trim();
  if (!q) return null;
  try {
    const { response } = await withTimeout(
      model.generateContent(refinePromptForMockups(q, kind)),
      CLOUD_GENERATE_TIMEOUT_MS,
      'ref-generate',
    );
    const options = parseGeneratedOptions(response.text(), kind);
    if (options.length < 3) return null;
    const source = sourceOf(response);
    recordInference(source, 'ref-generate', Date.now() - t0);
    return { hits: generatedToHits(options), source, ms: Date.now() - t0 };
  } catch (err) {
    noteError('ref-generate', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// CAD copilot (src/cad). Nano on the device understands her request and picks
// a typed tool; cloud Gemini handles only the hard parts. Every result is
// untrusted JSON, re-checked by the cad/ coercers before anything uses it.

/** Nano (on device) picks ONE CAD tool for her words. `allowCloud` = may the
 *  cloud twin run if the on-device call throws (false when offline). */
export async function pickCadTool(
  utterance: string,
  summary: string,
  opts: { allowCloud: boolean; timeoutMs?: number; planNames?: string[] },
): Promise<{ call: ToolCall; confidence: number; source: Source; ms: number } | null> {
  const t0 = Date.now();
  const models = await ensureModels();
  if (!models?.cadTool) return null;
  try {
    const build = (u: string) =>
      `${cadToolPrompt(summary.slice(0, 1200))}\nShe said: "${u}"\nReply JSON only: {"tool":"...","args":{...},"confidence":0..1}`;
    const prompt = build(utterance);
    const cloudPrompt = build(protectText(utterance, opts.planNames ?? []).text);
    const response = await callWithCloudRetry(
      models.cadTool, opts.allowCloud ? models.cadToolCloud ?? null : null, prompt, 'cad tool', opts.timeoutMs, cloudPrompt,
    );
    if (!response) return null;
    const raw = extractJson(response.text());
    const call = coerceToolCall(raw);
    if (!call) return null;
    const c = (raw as { confidence?: unknown }).confidence;
    const confidence = typeof c === 'number' && Number.isFinite(c) ? Math.min(1, Math.max(0, c > 1 ? c / 100 : c)) : 0.6;
    const source = sourceOf(response);
    recordInference(source, 'cad-tool', Date.now() - t0);
    return { call, confidence, source, ms: Date.now() - t0 };
  } catch (err) {
    noteError('cad tool', err);
    return null;
  }
}

/** Cloud Gemini answers a hard question about the plan (2-4 sentences) and may
 *  suggest tool calls, which the app stages as PENDING changes. */
function coerceCopilotAnswer(raw: unknown): { answer: string; calls: ToolCall[]; why: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const answer = typeof o.answer === 'string' ? o.answer.trim().slice(0, 1200)
    : typeof o.Answer === 'string' ? o.Answer.trim().slice(0, 1200) : '';
  if (!answer) return null;
  const calls = Array.isArray(o.calls) ? o.calls.map(coerceToolCall).filter((c): c is ToolCall => !!c).slice(0, 6) : [];
  return { answer, calls, why: typeof o.why === 'string' ? o.why.slice(0, 300) : '' };
}

export async function askCopilot(
  question: string,
  summary: string,
  region: string,
  onChunk?: (text: string) => void,
  planNames: string[] = [],
): Promise<{ answer: string; calls: ToolCall[]; why: string; source: Source; ms: number; model: string } | null> {
  const t0 = Date.now();
  const models = await ensureModels();
  if (!models?.copilotAnswer) return null;
  try {
    const peek = (text: string) => {
      const raw = extractJson(text);
      if (!raw || typeof raw !== 'object') return;
      const a = (raw as Record<string, unknown>).answer;
      if (typeof a === 'string' && a.trim()) onChunk?.(a.trim());
    };
    const sent = protectText(question).text;
    const prompt = withPreamble(copilotAnswerPrompt(sent, protectText(summary, planNames).text, region));
    const got = await requestHedgedJson(
      models.copilotAnswer,
      models.copilotAnswerHedge,
      prompt,
      cloudBudgetMs('long'),
      'copilot answer',
      coerceCopilotAnswer,
      onChunk ? peek : undefined,
    );
    if (!got) return null;
    recordInference('cloud', 'copilot-answer', Date.now() - t0);
    return { ...got.value, source: got.source, ms: Date.now() - t0, model: got.model };
  } catch (err) {
    noteError('copilot answer', err);
    return null;
  }
}

/** Cloud Gemini drafts a short client email from the site checklist. The app
 *  only ever SHOWS it and opens her mail app on her confirm; nothing is sent. */
export async function draftClientEmail(
  items: { question: string; answer?: string }[],
  summary: string,
  planNames: string[] = [],
): Promise<{ draft: EmailDraft; source: Source; ms: number; model?: string } | null> {
  const t0 = Date.now();
  const models = await ensureModels();
  if (!models?.copilotEmail || items.length === 0) return null;
  try {
    const safeItems = items.map((i) => ({
      question: protectText(i.question).text,
      answer: i.answer ? protectText(i.answer).text : i.answer,
    }));
    const safeSummary = protectText(summary, planNames).text;
    const got = await requestHedgedJson(
      models.copilotEmail,
      models.copilotEmailHedge,
      withPreamble(emailPrompt(safeItems, safeSummary)),
      cloudBudgetMs('long'),
      'client email',
      coerceEmailDraft,
    );
    if (!got) return null;
    recordInference('cloud', 'client-email', Date.now() - t0);
    return { draft: got.value, source: got.source, ms: Date.now() - t0, model: got.model };
  } catch (err) {
    noteError('client email', err);
    return null;
  }
}

/** Cloud Gemini proposes 3D materials + lighting as structured data. */
export async function proposeMaterials(
  request: string,
  summary: string,
  planNames: string[] = [],
): Promise<{ plan: MaterialPlan; source: Source; ms: number; model?: string } | null> {
  const t0 = Date.now();
  const models = await ensureModels();
  if (!models?.copilotMaterials) return null;
  try {
    const sent = protectText(request).text;
    const got = await requestHedgedJson(
      models.copilotMaterials,
      models.copilotMaterialsHedge,
      withPreamble(`${MATERIAL_PROMPT}\nRequest: "${sent}"\nRooms: ${protectText(summary, planNames).text.slice(0, 600)}`),
      cloudBudgetMs('long'),
      'materials',
      (raw) => coerceMaterialPlan(raw, presetFor(request)),
    );
    if (!got) return null;
    recordInference('cloud', 'materials', Date.now() - t0);
    return { plan: got.value, source: got.source, ms: Date.now() - t0, model: got.model };
  } catch (err) {
    noteError('materials', err);
    return null;
  }
}

/** Dev-only hook so a local headless probe can call cloud Gemini directly.
 *  Stripped from production builds by `import.meta.env.DEV`. */
if (import.meta.env.DEV) {
  (globalThis as unknown as { __mcCloudProbe?: unknown }).__mcCloudProbe = {
    prepareHybrid,
    getHybridStatus,
    warmCloud,
    askCopilot,
    condenseUtterance,
    draftClientEmail,
    proposeMaterials,
    explainAccessibility,
  };
}
