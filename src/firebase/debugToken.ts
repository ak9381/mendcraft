// Where the local dev server finds ONE stable App Check debug token, so every
// local address (localhost, 127.0.0.1, any port) presents the same registered
// token instead of a fresh SDK-generated one per origin. Node-only, free of
// import.meta and Firebase imports so vite.config and the tests can load it.
// The token is only ever injected into HTML served by the local dev/preview
// server; it is never written into `dist`.

export const DEBUG_TOKEN_ENV_KEYS = ['APPCHECK_DEBUG_TOKEN', 'VITE_APPCHECK_DEBUG_TOKEN'] as const;

/** App Check debug tokens are UUIDs (the console's "Generate token" makes a v4). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDebugTokenShape(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

export interface DebugTokenSources {
  /** process.env first, then the .env files (later entries are only consulted if earlier ones have none). */
  envs: Array<Record<string, string | undefined>>;
  /** Files holding just the token (e.g. ~/.secrets/mendcraft-appcheck-debug). */
  files: string[];
  readFile: (path: string) => string;
}

export interface DebugTokenResult {
  token: string | null;
  /** Where it came from — a key name or a file path, never the value. */
  source: string | null;
  /** A source had a value that is not a UUID (named, never printed). */
  rejected: string[];
}

export function resolveAppCheckDebugToken(src: DebugTokenSources): DebugTokenResult {
  const rejected: string[] = [];
  for (const env of src.envs) {
    for (const key of DEBUG_TOKEN_ENV_KEYS) {
      const value = env[key]?.trim();
      if (!value) continue;
      if (isDebugTokenShape(value)) return { token: value, source: key, rejected };
      rejected.push(key);
    }
  }
  for (const file of src.files) {
    let value = '';
    try { value = src.readFile(file).trim(); } catch { continue; }
    if (!value) continue;
    if (isDebugTokenShape(value)) return { token: value, source: file, rejected };
    rejected.push(file);
  }
  return { token: null, source: null, rejected };
}

export const NO_DEBUG_TOKEN_HINT =
  '[mendcraft] App Check: no debug token is configured for local dev, so Gemini calls from this server will be refused (403). '
  + 'Set APPCHECK_DEBUG_TOKEN in .env.local (or ~/.secrets/mendcraft-appcheck-debug) and register it once in '
  + 'Firebase console → App Check → Apps → Manage debug tokens. See docs/app-check-local-dev.md.';
