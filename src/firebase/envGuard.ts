// Shared Firebase env checks used by the runtime (src/firebase/app.ts) and by
// the Vite production-build guard. Keep this module free of import.meta and
// Firebase SDK imports so Node/vite.config can load it.

/** Values that look like an un-filled template placeholder, not a real key. */
export const PLACEHOLDER_RE = /your|placeholder|changeme|replace|xxx|<|^\s*$/i;

export function isUsableSecret(value: unknown): boolean {
  return typeof value === 'string' && !PLACEHOLDER_RE.test(value);
}

/** Firebase AI Logic is usable only with a real API key (a placeholder means rules-only). */
export function isUsableFirebaseApiKey(value: unknown): boolean {
  return isUsableSecret(value);
}

export function isUsableRecaptchaSiteKey(value: unknown): boolean {
  return isUsableSecret(value);
}

export const FIREBASE_BUILD_GUARD_MSG =
  'Production build is missing a real VITE_FIREBASE_API_KEY. Put the web key in .env.local and do not override it with placeholder values in .env.production.local.';

export const RECAPTCHA_BUILD_GUARD_MSG =
  'Production build is missing a real VITE_RECAPTCHA_SITE_KEY. Put the reCAPTCHA Enterprise site key in .env.local and do not override it with placeholder values in .env.production.local.';

/** Throws if a production/build env cannot talk to Firebase AI Logic. */
export function assertFirebaseBuildEnv(env: Record<string, string>): void {
  if (!isUsableFirebaseApiKey(env.VITE_FIREBASE_API_KEY)) {
    throw new Error(FIREBASE_BUILD_GUARD_MSG);
  }
  if (!isUsableRecaptchaSiteKey(env.VITE_RECAPTCHA_SITE_KEY)) {
    throw new Error(RECAPTCHA_BUILD_GUARD_MSG);
  }
}
