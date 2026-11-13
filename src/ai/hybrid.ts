// Firebase AI Logic hybrid wrapper: Gemini Nano on-device when available,
// gemini-3.5-flash-lite in the cloud otherwise, deterministic rule parser as
// the always-on floor. Every model response is re-validated with validateOp
// before it can reach the engine.

import { type Op } from '../core/ops';
import { isTemplateName, type TemplateName } from '../core/templates';
import { getActiveMode } from '../core/modes';
import { parseCommand, isTemplateCommand } from '../core/ruleParser';
import { coercePlanGenerate } from '../plan/ai';
import { parsePlanCommand, isPlanGenerate } from '../plan/ruleParser';
import { buildPlanTemplate, type PlanTemplateName } from '../plan/templates';
import { validatePlanOp, type PlanOp } from '../plan/ops';
import { coerceUiGenerate } from '../ui/design/ai';
import { parseUiCommand, isUiGenerate } from '../ui/design/ruleParser';
import { buildUiTemplate } from '../ui/design/templates';
import type { Frame, FramePreset } from '../ui/design/doc';
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
import { getFirebaseApp, isFirebaseConfigured } from '../firebase/app';
import { initAppCheck, APP_CHECK_FAIL_MSG, type AppCheckStatus } from '../firebase/appCheck';
import { initRemoteConfig, remoteSettings } from '../firebase/remoteConfig';
import { initTelemetry, recordInference } from '../firebase/telemetry';

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

/** UI-mode "generate a whole screen" result (a validated Frame or a clarify). */
export interface GenerateUiResult {
  frame?: Frame;
  clarify?: string;
  note?: string;
  source: Source;
}

export interface VerifyResult {
  matchesIntent: boolean;
  issue: string | null;
  source: Source;
}

export type TemplateResult =
  | { template: TemplateName; params: Record<string, number>; source: Source }
  | { clarify: string; source: Source };

export interface HybridStatus {
  appCheck: AppCheckStatus;
  deviceModel: DeviceModelStatus;
  message: string | null;
  /** Last AI error (cloud or on-device), for the UI and console. */
  lastError: string | null;
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
  /** Accessibility explainer (ONLY_IN_CLOUD, a11y-explain schema). */
  a11yExplain?: TextGenModel | null;
  /** On-device hand-profile picker (PREFER_ON_DEVICE, numbers-only; never cloud). */
  handAdapt?: TextGenModel | null;
  /** Server prompt-template model for the big cloud jobs (may be null). */
  promptTemplate?: TemplateGenModel | null;
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
  a11yExplain?: TextGenModel | null;
  handAdapt?: TextGenModel | null;
  promptTemplate?: TemplateGenModel | null;
  enabled?: boolean;
  appCheck?: AppCheckStatus;
  /** Force the reported on-device model status (test seam for adaptHandProfile). */
  deviceModel?: DeviceModelStatus;
  /** Fake Chrome LanguageModel; null = browser without the Prompt API. */
  languageModel?: LanguageModelProvider | null;
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

/** Point-and-say session: text + ONE still image in, text out. Only the deixis
 *  model asks Chrome for multimodal Nano (needs the multimodal flag). */
export const DEIXIS_CREATE_OPTIONS = {
  expectedInputs: [{ type: 'text' as const, languages: ['en'] }, { type: 'image' as const }],
  expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
};

const ON_DEVICE_TIMEOUT_MS = 15000;
/** Cloud "generate a whole plan/template" budget. A hung cloud call must fall
 *  back to the deterministic template within a few seconds, never leave the UI
 *  spinning (the deployed path has to degrade to RULES honestly and promptly). */
const CLOUD_GENERATE_TIMEOUT_MS = 6000;

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
let cached: Models | null = null;
let initPromise: Promise<Models | null> | null = null;
let deviceModelStatus: DeviceModelStatus = 'idle';
let appCheckState: AppCheckStatus = 'skipped';
let statusMessage: string | null = null;
let lastError: string | null = null;

function resetStatus(): void {
  deviceModelStatus = 'idle';
  appCheckState = 'skipped';
  statusMessage = null;
  lastError = null;
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

/** Test seam: inject mock models (and force enabled/disabled) without Firebase. */
export function setModelsForTest(overrides: ModelOverrides | null): void {
  testOverrides = overrides;
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

export function getHybridStatus(): HybridStatus {
  return { appCheck: appCheckState, deviceModel: deviceModelStatus, message: statusMessage, lastError };
}

export async function prepareHybrid(): Promise<HybridStatus> {
  await ensureModels();
  return getHybridStatus();
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
      a11yExplain: testOverrides.a11yExplain ?? null,
      handAdapt: testOverrides.handAdapt ?? null,
      promptTemplate: testOverrides.promptTemplate ?? null,
    };
  }
  if (!isEnabled()) {
    appCheckState = 'skipped';
    return null;
  }
  if (cached) return cached;
  initPromise ??= initFirebase();
  return initPromise;
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

    const { getAI, getGenerativeModel, getTemplateGenerativeModel, GoogleAIBackend, InferenceMode, Schema } =
      await import('firebase/ai');
    const ai = getAI(app, { backend: new GoogleAIBackend() });

    // Build all cloud schemas from the ACTIVE mode's plain-JSON constraints, so
    // the cloud and on-device paths share one source of truth per mode.
    const modeAi = getActiveMode().ai;
    const opSchema = toFirebaseSchema(modeAi.opConstraint, Schema);
    const verifySchema = toFirebaseSchema(modeAi.verifyConstraint, Schema);
    const templateSchema = toFirebaseSchema(modeAi.generateConstraint, Schema);
    // Intent fusion: the same op vocabulary + a confidence field, one source of
    // truth (the mode's opConstraint) for both the Nano and cloud schemas.
    const fusionConstraint = buildFusionConstraint(modeAi.opConstraint);
    const fusionSchema = toFirebaseSchema(fusionConstraint, Schema);
    const a11ySchema = toFirebaseSchema(buildA11yConstraint(modeAi.opConstraint), Schema);

    const intent = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: 'application/json', responseSchema: opSchema },
      },
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

    const fusion = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: 'application/json', responseSchema: fusionSchema },
      },
      onDeviceParams: {
        createOptions: ON_DEVICE_CREATE_OPTIONS,
        promptOptions: { responseConstraint: fusionConstraint },
      },
    });

    // Point-and-say: the one multimodal model — a still crop + pointer resolve
    // "this". Image payloads ride the same Firebase AI Logic call, nothing else.
    const deixisSchema = toFirebaseSchema(DEIXIS_CONSTRAINT, Schema);
    const deixis = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: 'application/json', responseSchema: deixisSchema },
      },
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
    const verifyCloud = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: 'application/json', responseSchema: verifySchema },
      },
    });
    const a11yExplain = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: 'application/json', responseSchema: a11ySchema },
      },
    });

    // Hand-adaptive input: ONLY_ON_DEVICE, with NO inCloudParams at all. The raw
    // hand numbers must never leave the device, and ONLY_ON_DEVICE gives the SDK
    // no cloud transport to fall back to (it errors instead of going to cloud if
    // Nano is not ready) — so the metrics prompt is physically unable to be
    // uploaded. This is stronger than PREFER_ON_DEVICE, which can silently fall
    // back to the cloud. adaptHandProfile() still gates on Nano being ready so
    // the ONLY_ON_DEVICE "not ready" error never fires in normal use.
    const handAdapt = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: {
        createOptions: ON_DEVICE_CREATE_OPTIONS,
        promptOptions: { responseConstraint: PROFILE_CONSTRAINT },
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

    cached = { intent, template, verify, fusion, deixis, deixisCloud, intentCloud, verifyCloud, fusionCloud, a11yExplain, handAdapt, promptTemplate };
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
  const lm = languageModelProvider();
  if (!lm) {
    deviceModelStatus = 'unsupported';
    return deviceModelStatus;
  }
  try {
    deviceModelStatus = mapAvailability(await lm.availability(ON_DEVICE_CREATE_OPTIONS));
  } catch (err) {
    noteError('LanguageModel.availability', err);
    deviceModelStatus = 'unavailable';
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

function extractJson(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
}

function numericParams(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof raw === 'object' && raw !== null) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = typeof v === 'string' ? Number(v) : v;
      if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
    }
  }
  return out;
}

type ModelResponse = { text: () => string; inferenceSource?: string };

/**
 * Hybrid call. In PREFER_ON_DEVICE the SDK does not fall back to the cloud if
 * the on-device prompt itself throws (or hangs), so retry once on the
 * cloud-only twin before giving up to the rule parser.
 */
async function callWithCloudRetry(
  hybrid: TextGenModel,
  cloud: TextGenModel | null,
  prompt: string,
  label: string,
): Promise<ModelResponse | null> {
  try {
    const { response } = await withTimeout(hybrid.generateContent(prompt), ON_DEVICE_TIMEOUT_MS, label);
    return response;
  } catch (err) {
    noteError(`${label} (hybrid)`, err);
    if (!cloud) throw err;
    const { response } = await cloud.generateContent(prompt);
    return { text: () => response.text(), inferenceSource: 'in_cloud' };
  }
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
): Promise<CompileResult> {
  const t0 = Date.now();
  const models = await ensureModels();
  if (models?.intent) {
    try {
      const prompt = `${getActiveMode().ai.intentPrompt}\nScene: ${sceneSummary}\nSelected: ${selectedId ?? 'none'}\nCommand: "${utterance}"`;
      const response = await callWithCloudRetry(models.intent, models.intentCloud ?? null, prompt, 'intent');
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
  },
): Promise<FusionOutcome> {
  const t0 = Date.now();
  const models = await ensureModels();
  const mode = getActiveMode();
  const primary = opts?.forceCloud ? models?.fusionCloud : models?.fusion;
  if (models && primary) {
    try {
      // Privacy gate: the phrasebook may ride a cloud call only on the sanctioned
      // escalation; otherwise it is on-device only.
      const fewShot = opts?.fewShot && (!opts.forceCloud || opts.examplesCloudOk) ? opts.fewShot : undefined;
      const prompt = buildFusionPrompt(mode.ai.intentPrompt, utterance, ctx, opts?.lang, fewShot);
      // An on-device call carrying the private phrasebook must NOT silently fall
      // back to the cloud twin (that would leak it without an escalation); it
      // drops to the rules floor instead. Only an explicit forceCloud escalation
      // sends examples to the cloud.
      const retry = opts?.forceCloud || fewShot ? null : models.fusionCloud ?? null;
      const response = await callWithCloudRetry(primary, retry, prompt, opts?.forceCloud ? 'fuse-cloud' : 'fuse');
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
    space: 'plan' | 'ui';
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
  let response: ModelResponse | null = null;
  try {
    ({ response } = await withTimeout(models.deixis.generateContent(parts), ON_DEVICE_TIMEOUT_MS, 'deixis'));
  } catch (err) {
    noteError('deixis (hybrid)', err);
    if (!models.deixisCloud) return null;
    try {
      const r = await models.deixisCloud.generateContent(parts);
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

export async function generateTemplate(prompt: string): Promise<TemplateResult> {
  const models = await ensureModels();
  if (models?.template) {
    try {
      const jobPrompt = withPreamble(`${getActiveMode().ai.templatePrompt}\nRequest: "${prompt}"`);
      const response = await runBigCloudJob(
        models, jobPrompt, prompt, remoteSettings().templateIds.part, 'template',
      );
      const parsed = response ? extractJson(response.text()) : null;
      if (typeof parsed === 'object' && parsed !== null) {
        const o = parsed as Record<string, unknown>;
        if (isTemplateName(o.template)) {
          const source = sourceOf(response!);
          recordInference(source, 'generate-template');
          return { template: o.template, params: numericParams(o.params), source };
        }
      }
    } catch (err) {
      noteError('template model', err);
    }
  }
  recordInference('rules', 'generate-template');
  const ruled = parseCommand(prompt);
  if (isTemplateCommand(ruled)) return { ...ruled, source: 'rules' };
  return { clarify: 'Which design: cup grip, phone stand, hook, or utensil holder?', source: 'rules' };
}

/**
 * Plan-mode "generate a whole plan" (ONLY_IN_CLOUD, same hybrid wrapper as the
 * part template path). The cloud model returns {ops:[...]}; code re-validates
 * and caps them. Falls back to the deterministic rule parser + a plan template
 * when the cloud is unavailable, so "two bedroom plan" works with no AI.
 */
export async function generatePlan(prompt: string): Promise<GeneratePlanResult> {
  const models = await ensureModels();
  if (models?.template) {
    try {
      const jobPrompt = withPreamble(`${getActiveMode().ai.templatePrompt}\nRequest: "${prompt}"`);
      const response = await runBigCloudJob(
        models, jobPrompt, prompt, remoteSettings().templateIds.plan, 'plan generate',
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

/**
 * UI-mode "generate a whole screen" (same hybrid wrapper as the plan generate
 * path). The cloud model returns a compact DOCUMENT; code expands + re-validates
 * it into a Frame. Falls back to the deterministic rule parser + a UI template
 * (login / landing / pricing) when the cloud is unavailable, so "login screen"
 * works with no AI.
 */
export async function generateUi(prompt: string): Promise<GenerateUiResult> {
  const models = await ensureModels();
  if (models?.template) {
    try {
      const jobPrompt = withPreamble(`${getActiveMode().ai.templatePrompt}\nRequest: "${prompt}"`);
      const response = await runBigCloudJob(
        models, jobPrompt, prompt, remoteSettings().templateIds.screen, 'ui generate',
      );
      const coerced = response ? coerceUiGenerate(extractJson(response.text())) : null;
      if (coerced && 'frame' in coerced) {
        const source = sourceOf(response!);
        recordInference(source, 'generate-ui');
        return { frame: coerced.frame, source };
      }
      if (coerced && 'clarify' in coerced) {
        const source = sourceOf(response!);
        recordInference(source, 'generate-ui');
        return { clarify: coerced.clarify, source };
      }
      noteError('ui generate', new Error('cloud screen was empty or invalid; using a template'));
    } catch (err) {
      noteError('ui generate model', err);
    }
  }
  recordInference('rules', 'generate-ui');
  // Rules fallback: a named template → an expanded, validated Frame.
  const ruled = parseUiCommand(prompt);
  const mobile = /\b(mobile|phone)\b/.test(prompt.toLowerCase());
  const preset: FramePreset = mobile ? 'mobile' : 'desktop';
  let template = isUiGenerate(ruled) ? ruled.generate : null;
  let note: string | undefined;
  if (!template && getActiveMode().isDesignRequest(prompt)) {
    template = 'login';
    note = 'Cloud design was unavailable — built a login template instead.';
  }
  if (template) {
    const frame = buildUiTemplate(template, isUiGenerate(ruled) ? ruled.preset ?? preset : preset);
    if (frame) return { frame, note, source: 'rules' };
  }
  return { clarify: 'Try "login screen", "landing hero", "pricing section", or "mobile frame".', source: 'rules' };
}

/** Cloud explanations (and optional alternative fixes) for a11y issues. */
export interface ExplainA11yResult {
  items: A11yExplanation[];
  source: Source;
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
): Promise<ExplainA11yResult> {
  const t0 = Date.now();
  const models = await ensureModels();
  if (models?.a11yExplain && issues.length) {
    try {
      const mode = getActiveMode();
      const prompt = withPreamble(
        `${A11Y_EXPLAIN_PROMPT}\nOp vocabulary:\n${mode.ai.intentPrompt}\nIssues: ${JSON.stringify(issues)}\nDesign: ${summary}`,
      );
      const { response } = await withTimeout(
        models.a11yExplain.generateContent(prompt),
        CLOUD_GENERATE_TIMEOUT_MS,
        'a11y explain',
      );
      const items = coerceA11yExplanations(
        extractJson(response.text()),
        issues.map((i) => i.id),
        (raw) => mode.coerce(raw),
      );
      if (items.length) {
        const source = sourceOf(response);
        recordInference(source, 'a11y-explain', Date.now() - t0);
        return { items, source };
      }
      noteError('a11y explain', new Error('cloud explanations were empty or invalid'));
    } catch (err) {
      noteError('a11y explain model', err);
    }
  }
  // Rules floor: the deterministic messages already carry measurement +
  // citation, so an empty item list simply keeps those.
  recordInference('rules', 'a11y-explain', Date.now() - t0);
  return { items: [], source: 'rules' };
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
