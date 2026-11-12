// Firebase AI Logic hybrid wrapper: Gemini Nano on-device when available,
// gemini-3.5-flash-lite in the cloud otherwise, deterministic rule parser as
// the always-on floor. Every model response is re-validated with validateOp
// before it can reach the engine.

import { validateOp, type Op } from '../core/ops';
import { isTemplateName, type TemplateName } from '../core/templates';
import { getActiveMode } from '../core/modes';
import {
  parseCommand,
  isTemplateCommand,
  type Clarify,
  type RuleParse,
  type TemplateCommand,
} from '../core/ruleParser';

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
export type AppCheckStatus = 'skipped' | 'ready' | 'failed';

export interface CompileResult {
  result: Op | TemplateCommand | Clarify;
  source: Source;
  ms: number;
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

interface Models {
  intent: TextGenModel | null;
  template: TextGenModel | null;
  verify: TextGenModel | null;
  /** Cloud-only twins used if the on-device call itself throws. */
  intentCloud?: TextGenModel | null;
  verifyCloud?: TextGenModel | null;
}

export interface ModelOverrides {
  intent?: TextGenModel | null;
  template?: TextGenModel | null;
  verify?: TextGenModel | null;
  intentCloud?: TextGenModel | null;
  verifyCloud?: TextGenModel | null;
  enabled?: boolean;
  appCheck?: AppCheckStatus;
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

const ON_DEVICE_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Structured-output schemas. The on-device Prompt API takes a plain JSON
// Schema (`responseConstraint`); the cloud path takes the Firebase `Schema`
// builder (`responseSchema`). The constraints now live on the active
// EditorMode (core/modes) so this layer stays mode-agnostic; they remain the
// source of truth and must stay in lockstep with the Schema objects built in
// initFirebase. Re-exported for back-compat and tests.

/** On-device constraint for the intent/edit-op model. `depth` is mm or "through". */
export const OP_RESPONSE_CONSTRAINT = getActiveMode().ai.opConstraint;

/** On-device constraint for the verifier model — not the edit-op schema. */
export const VERIFY_RESPONSE_CONSTRAINT = getActiveMode().ai.verifyConstraint;

// ---------------------------------------------------------------------------
// Config / lazy init.

interface Env {
  [key: string]: string | boolean | undefined;
}

function env(): Env {
  return ((import.meta as unknown as { env?: Env }).env ?? {}) as Env;
}

const PLACEHOLDER_RE = /your|placeholder|changeme|replace|xxx|<|^\s*$/i;

const APP_CHECK_FAIL_MSG = 'App Check is required and failed to start. Using rules only.';

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
  const key = env().VITE_FIREBASE_API_KEY;
  return typeof key === 'string' && !PLACEHOLDER_RE.test(key);
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
    return {
      intent: testOverrides.intent ?? null,
      template: testOverrides.template ?? null,
      verify: testOverrides.verify ?? null,
      intentCloud: testOverrides.intentCloud ?? null,
      verifyCloud: testOverrides.verifyCloud ?? null,
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
    const e = env();
    const { initializeApp, getApps } = await import('firebase/app');
    const app =
      getApps()[0] ??
      initializeApp({
        apiKey: String(e.VITE_FIREBASE_API_KEY),
        authDomain: e.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
        projectId: e.VITE_FIREBASE_PROJECT_ID as string | undefined,
        appId: e.VITE_FIREBASE_APP_ID as string | undefined,
        messagingSenderId: e.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
        storageBucket: e.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
      });

    // App Check is required for Firebase AI Logic. A missing key or a failed
    // init is not swallowable: fall back to rules and tell the UI.
    const siteKey = e.VITE_RECAPTCHA_SITE_KEY;
    if (typeof siteKey !== 'string' || !siteKey || PLACEHOLDER_RE.test(siteKey)) {
      appCheckState = 'failed';
      statusMessage = 'App Check is required but no reCAPTCHA site key is configured. Using rules only.';
      cached = null;
      return null;
    }
    try {
      if (e.DEV === true || e.DEV === 'true' || e.VITE_APPCHECK_DEBUG === 'true') {
        const g = globalThis as Record<string, unknown>;
        ((g.self as Record<string, unknown> | undefined) ?? g).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      }
      const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('firebase/app-check');
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
      appCheckState = 'ready';
    } catch (err) {
      noteError('App Check init', err);
      appCheckState = 'failed';
      statusMessage = APP_CHECK_FAIL_MSG;
      cached = null;
      return null;
    }

    const { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema } = await import('firebase/ai');
    const ai = getAI(app, { backend: new GoogleAIBackend() });

    const sizeProps = {
      w: Schema.number(), d: Schema.number(), h: Schema.number(),
      diameter: Schema.number(), height: Schema.number(),
      topDiameter: Schema.number(), tube: Schema.number(),
    };
    const vecProps = { x: Schema.number(), y: Schema.number(), z: Schema.number() };
    const opSchema = Schema.object({
      properties: {
        op: Schema.string(),
        shape: Schema.string(),
        params: Schema.object({ properties: sizeProps, optionalProperties: Object.keys(sizeProps) }),
        target: Schema.string(),
        tool: Schema.string(),
        targets: Schema.array({ items: Schema.string() }),
        dx: Schema.number(), dy: Schema.number(), dz: Schema.number(),
        axis: Schema.string(),
        deg: Schema.number(),
        factor: Schema.number(),
        deltaMm: Schema.object({ properties: vecProps, optionalProperties: ['x', 'y', 'z'] }),
        diameter: Schema.number(),
        depth: Schema.anyOf({ anyOf: [Schema.number(), Schema.string()] }),
        count: Schema.number(),
        spacing: Schema.number(),
        radius: Schema.number(),
        to: Schema.string(),
        mode: Schema.string(),
        template: Schema.string(),
        clarify: Schema.string(),
      },
      optionalProperties: [
        'shape', 'params', 'target', 'tool', 'targets', 'dx', 'dy', 'dz', 'axis',
        'deg', 'factor', 'deltaMm', 'diameter', 'depth', 'count', 'spacing',
        'radius', 'to', 'mode', 'template', 'clarify', 'op',
      ],
    });

    const verifySchema = Schema.object({
      properties: {
        matchesIntent: Schema.boolean(),
        issue: Schema.string(),
      },
      optionalProperties: ['issue'],
    });

    const intent = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams: {
        model: 'gemini-3.5-flash-lite',
        generationConfig: { responseMimeType: 'application/json', responseSchema: opSchema },
      },
      onDeviceParams: {
        createOptions: ON_DEVICE_CREATE_OPTIONS,
        promptOptions: { responseConstraint: OP_RESPONSE_CONSTRAINT },
      },
    });

    const verify = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams: {
        model: 'gemini-3.5-flash-lite',
        generationConfig: { responseMimeType: 'application/json', responseSchema: verifySchema },
      },
      onDeviceParams: {
        createOptions: ON_DEVICE_CREATE_OPTIONS,
        promptOptions: { responseConstraint: VERIFY_RESPONSE_CONSTRAINT },
      },
    });

    const templateSchema = Schema.object({
      properties: {
        template: Schema.string(),
        params: Schema.object({
          properties: {
            cupDiameterMm: Schema.number(), heightMm: Schema.number(), wallMm: Schema.number(),
            angleDeg: Schema.number(), phoneThicknessMm: Schema.number(), widthMm: Schema.number(),
            depthMm: Schema.number(), rodDiameterMm: Schema.number(), diameterMm: Schema.number(),
          },
          optionalProperties: [
            'cupDiameterMm', 'heightMm', 'wallMm', 'angleDeg', 'phoneThicknessMm',
            'widthMm', 'depthMm', 'rodDiameterMm', 'diameterMm',
          ],
        }),
      },
      optionalProperties: ['params'],
    });

    const template = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: 'gemini-3.5-flash-lite',
        generationConfig: { responseMimeType: 'application/json', responseSchema: templateSchema },
      },
    });

    const intentCloud = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: 'gemini-3.5-flash-lite',
        generationConfig: { responseMimeType: 'application/json', responseSchema: opSchema },
      },
    });
    const verifyCloud = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: 'gemini-3.5-flash-lite',
        generationConfig: { responseMimeType: 'application/json', responseSchema: verifySchema },
      },
    });

    cached = { intent, template, verify, intentCloud, verifyCloud };
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

/** Validate untrusted model JSON into a compile result, or null if unusable. */
function coerceResult(raw: unknown): Op | TemplateCommand | Clarify | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.clarify === 'string' && obj.clarify.trim()) return { clarify: obj.clarify.trim() };
  if (obj.template !== undefined) {
    if (!isTemplateName(obj.template)) return null;
    return { template: obj.template, params: numericParams(obj.params) };
  }
  const v = validateOp(obj);
  return v.ok ? v.op : null;
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
      const prompt = `${getActiveMode().ai.intentPrompt}\nScene: ${sceneSummary}\nSelected part: ${selectedId ?? 'none'}\nCommand: "${utterance}"`;
      const response = await callWithCloudRetry(models.intent, models.intentCloud ?? null, prompt, 'intent');
      const result = response ? coerceResult(extractJson(response.text())) : null;
      if (result) return { result, source: sourceOf(response!), ms: Date.now() - t0 };
    } catch (err) {
      noteError('intent model', err);
    }
  }
  const result: RuleParse = parseCommand(utterance);
  return { result, source: 'rules', ms: Date.now() - t0 };
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
          return {
            matchesIntent: o.matchesIntent,
            issue: typeof o.issue === 'string' && o.issue ? o.issue : null,
            source: sourceOf(response),
          };
        }
      }
    } catch (err) {
      noteError('verify model', err);
    }
  }
  return { matchesIntent: warnings.length === 0, issue: warnings[0] ?? null, source: 'rules' };
}

export async function generateTemplate(prompt: string): Promise<TemplateResult> {
  const models = await ensureModels();
  if (models?.template) {
    try {
      const { response } = await models.template.generateContent(
        `${getActiveMode().ai.templatePrompt}\nRequest: "${prompt}"`,
      );
      const parsed = extractJson(response.text());
      if (typeof parsed === 'object' && parsed !== null) {
        const o = parsed as Record<string, unknown>;
        if (isTemplateName(o.template)) {
          return { template: o.template, params: numericParams(o.params), source: sourceOf(response) };
        }
      }
    } catch (err) {
      noteError('template model', err);
    }
  }
  const ruled = parseCommand(prompt);
  if (isTemplateCommand(ruled)) return { ...ruled, source: 'rules' };
  return { clarify: 'Which design: cup grip, phone stand, hook, or utensil holder?', source: 'rules' };
}
