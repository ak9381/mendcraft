// Apple Music (MusicKit JS) — an HONEST stub. Driving Apple Music needs a
// MusicKit *developer token* (a signed JWT from an Apple Developer account),
// which we do not ship. With no token we return a clear "not configured" status
// and the UI keeps our own in-app player working — we never fake a connection or
// pull in a paid SDK. Wiring a real token later only means filling in the two
// marked spots; the status contract stays the same.

export type AppleMusicStatus =
  | { kind: 'not-configured'; message: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

/** The developer token would come from build-time config; intentionally absent. */
function readDeveloperToken(): string | null {
  try {
    // Vite exposes VITE_* env; none is set, so this is null by design.
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return env?.VITE_APPLE_MUSIC_DEV_TOKEN ?? null;
  } catch {
    return null;
  }
}

const NOT_CONFIGURED =
  'Apple Music needs a MusicKit developer token (not configured). Using the built-in player instead.';

/** Report whether Apple Music could be used. Without a token: not-configured. */
export function appleMusicStatus(): AppleMusicStatus {
  const token = readDeveloperToken();
  if (!token) return { kind: 'not-configured', message: NOT_CONFIGURED };
  // A token exists but MusicKit JS is not bundled (no paid SDK). Still honest.
  if (typeof (globalThis as { MusicKit?: unknown }).MusicKit === 'undefined') {
    return {
      kind: 'error',
      message: 'MusicKit JS is not loaded; add the SDK and a user-authorize step to enable Apple Music.',
    };
  }
  return { kind: 'ready' };
}

export function appleMusicConfigured(): boolean {
  return appleMusicStatus().kind === 'ready';
}
