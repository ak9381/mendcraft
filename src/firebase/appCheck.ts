// App Check init, split out of src/ai/hybrid.ts. App Check is REQUIRED for
// Firebase AI Logic: a missing reCAPTCHA site key or a failed init is not swallowed —
// the caller falls back to the deterministic rule parser and tells the UI.

import type { FirebaseApp } from 'firebase/app';
import { env, PLACEHOLDER_RE } from './app';
import { isDebugTokenShape } from './debugToken';

export type AppCheckStatus = 'skipped' | 'ready' | 'failed';

export const APP_CHECK_FAIL_MSG =
  'App Check is required and failed to start. Using rules only.';
const NO_KEY_MSG =
  'App Check is required but no reCAPTCHA site key is configured. Using rules only.';

export interface AppCheckResult {
  status: AppCheckStatus;
  message: string | null;
  /** Underlying error, so the caller can log it (not shown to the user). */
  error?: unknown;
}

export interface AppCheckDebugOpts {
  dev?: boolean;
  hostname?: string;
  search?: string;
  /** Test seam: the VITE_APPCHECK_DEBUG_TOKEN value (null = not set). */
  envToken?: string | null;
}

function isLocalHostname(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').split('%')[0];
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function isViteDev(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  const dev = env().DEV;
  return dev === true || dev === 'true';
}

/**
 * Debug App Check is allowed only in a Vite dev build, or on a local server
 * with `?debug` (the local preview plugin injects the token into HTML).
 * Production builds never enable it, including on the hosted site with `?debug`.
 */
export function shouldUseAppCheckDebug(opts: AppCheckDebugOpts = {}): boolean {
  if (isViteDev(opts.dev)) return true;
  const hostname = opts.hostname ?? (typeof location !== 'undefined' ? location.hostname : '');
  const search = opts.search ?? (typeof location !== 'undefined' ? location.search : '');
  if (!isLocalHostname(hostname)) return false;
  const raw = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(raw).has('debug');
}

/**
 * Point the Firebase SDK at a pre-registered debug token when allowed.
 * Prefers a token already injected by the local dev/preview server; in Vite
 * dev only, falls back to `true` (SDK-generated). Never writes a token in a
 * production bundle, and never auto-generates one on `?debug` without inject.
 * Returns whether a debug token is now set.
 */
export function applyAppCheckDebugToken(opts: AppCheckDebugOpts = {}): boolean {
  if (!shouldUseAppCheckDebug(opts)) return false;
  const g = globalThis as Record<string, unknown>;
  const target = ((g.self as Record<string, unknown> | undefined) ?? g);
  if (typeof target.FIREBASE_APPCHECK_DEBUG_TOKEN === 'string' && target.FIREBASE_APPCHECK_DEBUG_TOKEN) {
    return true;
  }
  if (isViteDev(opts.dev)) {
    // A stable token from the env beats an SDK-generated one: the generated
    // token is different for every origin (localhost vs 127.0.0.1 vs a port),
    // and each one would have to be registered by hand.
    const fromEnv = opts.envToken !== undefined ? opts.envToken : env().VITE_APPCHECK_DEBUG_TOKEN;
    target.FIREBASE_APPCHECK_DEBUG_TOKEN = isDebugTokenShape(fromEnv) ? fromEnv.trim() : true;
    return true;
  }
  return false;
}

/** How this page's App Check debug token was chosen (for the status line). */
export function appCheckDebugKind(): 'stable' | 'generated' | 'none' {
  const g = globalThis as Record<string, unknown>;
  const v = ((g.self as Record<string, unknown> | undefined) ?? g).FIREBASE_APPCHECK_DEBUG_TOKEN;
  return typeof v === 'string' && v ? 'stable' : v === true ? 'generated' : 'none';
}

let appCheckInstance: unknown = null;

/** Ask App Check for a token now. Resolves null when one was issued, or the
 *  error when it was refused (e.g. HTTP 403: the debug token of this address
 *  is not registered). Used to explain a failed Gemini call plainly. */
export async function appCheckTokenError(timeoutMs = 4000): Promise<unknown | null> {
  if (!appCheckInstance) return null;
  try {
    const { getToken } = await import('firebase/app-check');
    // A slow answer proves nothing either way: only a refusal is reported.
    await Promise.race([
      getToken(appCheckInstance as Parameters<typeof getToken>[0], false),
      new Promise<void>((resolve) => { setTimeout(resolve, timeoutMs); }),
    ]);
    return null;
  } catch (error) {
    return error ?? new Error('App Check token refused');
  }
}

/**
 * Start App Check with reCAPTCHA Enterprise. A local debug token is applied
 * first, and only in dev or on a local `?debug` server. Returns a `failed`
 * result rather than throwing, so hybrid.ts can degrade to rules.
 */
export async function initAppCheck(app: FirebaseApp): Promise<AppCheckResult> {
  const e = env();
  const siteKey = e.VITE_RECAPTCHA_SITE_KEY;
  if (typeof siteKey !== 'string' || !siteKey || PLACEHOLDER_RE.test(siteKey)) {
    return { status: 'failed', message: NO_KEY_MSG };
  }
  try {
    applyAppCheckDebugToken();
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('firebase/app-check');
    appCheckInstance = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
    return { status: 'ready', message: null };
  } catch (error) {
    return { status: 'failed', message: APP_CHECK_FAIL_MSG, error };
  }
}
