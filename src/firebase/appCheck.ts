// App Check init, split out of src/ai/hybrid.ts. App Check is REQUIRED for
// Firebase AI Logic: a missing reCAPTCHA key or a failed init is not swallowed —
// the caller falls back to the deterministic rule parser and tells the UI.

import type { FirebaseApp } from 'firebase/app';
import { env, PLACEHOLDER_RE } from './app';

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

/**
 * Start App Check with reCAPTCHA Enterprise. In DEV (or with VITE_APPCHECK_DEBUG)
 * register the debug-token flag first so the emulator token works. Returns a
 * `failed` result rather than throwing, so hybrid.ts can degrade to rules.
 */
export async function initAppCheck(app: FirebaseApp): Promise<AppCheckResult> {
  const e = env();
  const siteKey = e.VITE_RECAPTCHA_SITE_KEY;
  if (typeof siteKey !== 'string' || !siteKey || PLACEHOLDER_RE.test(siteKey)) {
    return { status: 'failed', message: NO_KEY_MSG };
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
    return { status: 'ready', message: null };
  } catch (error) {
    return { status: 'failed', message: APP_CHECK_FAIL_MSG, error };
  }
}
