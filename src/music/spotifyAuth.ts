// Spotify Authorization Code with PKCE (no client secret). Tokens live in this
// browser's localStorage. The Client ID is a public Vite env
// (`VITE_SPOTIFY_CLIENT_ID`); when it is missing the UI shows "Spotify not set
// up" and the built-in public-domain player keeps working.
//
// Redirect URI is always `${origin}/spotify`. Inside a Capacitor native shell
// that bounce cannot return to the app, so Connect is sent to the hosted web
// app instead (see isNativeMusicShell).

export const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
export const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'streaming',
].join(' ');

export const TOKENS_KEY = 'mendcraft.spotify.tokens';
export const PKCE_KEY = 'mendcraft.spotify.pkce';
export const RETURN_KEY = 'mendcraft.spotify.return';

export const WEB_APP_ORIGIN = 'https://mendcraft.web.app';

export type SpotifyFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token should be treated as expired. */
  expiresAt: number;
  tokenType: string;
  scope: string;
}

export type SpotifyConfigStatus =
  | { kind: 'not-configured'; message: string }
  | { kind: 'native-shell'; message: string }
  | { kind: 'disconnected'; message: string }
  | { kind: 'connected' }
  | { kind: 'error'; message: string };

const NOT_SET_UP =
  'Spotify not set up. Add a Client ID (VITE_SPOTIFY_CLIENT_ID) and reconnect. Using the built-in player instead.';

const NATIVE_NOTE =
  'On the iPhone (and Android) app, connect Spotify in the web app at https://mendcraft.web.app — sign-in cannot return to this app yet (a custom URL scheme comes later).';

export interface SpotifyEnv {
  VITE_SPOTIFY_CLIENT_ID?: string;
}

export function readClientId(
  env: SpotifyEnv = ((import.meta as unknown as { env?: SpotifyEnv }).env ?? {}),
): string | null {
  const id = env.VITE_SPOTIFY_CLIENT_ID?.trim();
  return id ? id : null;
}

export function spotifyRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, '')}/spotify`;
}

/** Capacitor iOS/Android shell: the OAuth redirect to the hosted /spotify page
 *  cannot bounce back into the webview. */
export function isNativeMusicShell(
  cap: { isNativePlatform?: () => boolean } | undefined = typeof window === 'undefined'
    ? undefined
    : (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor,
): boolean {
  return Boolean(cap?.isNativePlatform?.());
}

export function spotifyStatus(
  opts: {
    env?: SpotifyEnv;
    tokens?: SpotifyTokens | null;
    native?: boolean;
  } = {},
): SpotifyConfigStatus {
  if (!readClientId(opts.env)) return { kind: 'not-configured', message: NOT_SET_UP };
  if (opts.native ?? isNativeMusicShell()) return { kind: 'native-shell', message: NATIVE_NOTE };
  const tokens = opts.tokens === undefined ? loadTokens() : opts.tokens;
  if (tokens?.accessToken || tokens?.refreshToken) return { kind: 'connected' };
  return { kind: 'disconnected', message: 'Connect Spotify (Premium) to play, pause, skip and search.' };
}

// ---- PKCE (pure + WebCrypto) ------------------------------------------------

const B64URL_RE = /^[A-Za-z0-9\-._~]+$/;

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function generateCodeVerifier(random: Uint8Array = randomBytes(32)): string {
  return base64UrlEncode(random);
}

export function generateState(random: Uint8Array = randomBytes(16)): string {
  return base64UrlEncode(random);
}

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

export async function codeChallenge(verifier: string): Promise<string> {
  if (!B64URL_RE.test(verifier) || verifier.length < 43 || verifier.length > 128) {
    throw new Error('PKCE verifier must be a 43–128 character unreserved string');
  }
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(hash));
}

export async function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  verifier: string;
  state: string;
  scopes?: string;
}): Promise<string> {
  const challenge = await codeChallenge(opts.verifier);
  const q = new URLSearchParams({
    client_id: opts.clientId,
    response_type: 'code',
    redirect_uri: opts.redirectUri,
    scope: opts.scopes ?? SPOTIFY_SCOPES,
    state: opts.state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  return `${SPOTIFY_AUTH_URL}?${q.toString()}`;
}

// ---- token storage ----------------------------------------------------------

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function loadTokens(storage: StorageLike | null = defaultStorage()): SpotifyTokens | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(TOKENS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SpotifyTokens>;
    if (typeof parsed.accessToken !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : '',
      expiresAt: parsed.expiresAt,
      tokenType: typeof parsed.tokenType === 'string' ? parsed.tokenType : 'Bearer',
      scope: typeof parsed.scope === 'string' ? parsed.scope : '',
    };
  } catch {
    return null;
  }
}

export function saveTokens(tokens: SpotifyTokens, storage: StorageLike | null = defaultStorage()): void {
  storage?.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

export function clearTokens(storage: StorageLike | null = defaultStorage()): void {
  storage?.removeItem(TOKENS_KEY);
  storage?.removeItem(PKCE_KEY);
}

export function isAccessTokenFresh(tokens: SpotifyTokens, now = Date.now(), skewMs = 60_000): boolean {
  return Boolean(tokens.accessToken) && tokens.expiresAt - skewMs > now;
}

export interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export function tokensFromResponse(data: TokenResponse, now = Date.now(), previous?: SpotifyTokens | null): SpotifyTokens {
  const access = data.access_token;
  if (!access) {
    throw new Error(data.error_description || data.error || 'Spotify did not return an access token');
  }
  const expiresIn = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : 3600;
  return {
    accessToken: access,
    refreshToken: data.refresh_token || previous?.refreshToken || '',
    expiresAt: now + expiresIn * 1000,
    tokenType: data.token_type || 'Bearer',
    scope: data.scope || previous?.scope || '',
  };
}

export async function exchangeAuthorizationCode(
  opts: {
    clientId: string;
    code: string;
    verifier: string;
    redirectUri: string;
    now?: number;
    fetchImpl?: SpotifyFetch;
  },
): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    code_verifier: opts.verifier,
  });
  const data = await postToken(body, opts.fetchImpl);
  return tokensFromResponse(data, opts.now ?? Date.now());
}

export async function refreshAccessToken(
  opts: {
    clientId: string;
    refreshToken: string;
    now?: number;
    previous?: SpotifyTokens | null;
    fetchImpl?: SpotifyFetch;
  },
): Promise<SpotifyTokens> {
  if (!opts.refreshToken) throw new Error('No Spotify refresh token');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
  });
  const data = await postToken(body, opts.fetchImpl);
  return tokensFromResponse(data, opts.now ?? Date.now(), opts.previous ?? {
    accessToken: '',
    refreshToken: opts.refreshToken,
    expiresAt: 0,
    tokenType: 'Bearer',
    scope: '',
  });
}

async function postToken(body: URLSearchParams, fetchImpl: SpotifyFetch = defaultFetch): Promise<TokenResponse> {
  const res = await fetchImpl(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Spotify token HTTP ${res.status}`);
  }
  return data;
}

const defaultFetch: SpotifyFetch = (input, init) => fetch(input, init);

/** Return a still-valid access token, refreshing when it is close to expiry. */
export async function getValidAccessToken(
  opts: {
    env?: SpotifyEnv;
    storage?: StorageLike | null;
    now?: number;
    fetchImpl?: SpotifyFetch;
  } = {},
): Promise<string> {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const clientId = readClientId(opts.env);
  if (!clientId) throw new Error(NOT_SET_UP);
  const current = loadTokens(storage);
  if (!current) throw new Error('Connect Spotify first');
  if (isAccessTokenFresh(current, opts.now)) return current.accessToken;
  const next = await refreshAccessToken({
    clientId,
    refreshToken: current.refreshToken,
    now: opts.now,
    previous: current,
    fetchImpl: opts.fetchImpl,
  });
  saveTokens(next, storage);
  return next.accessToken;
}

export interface PkceSession {
  verifier: string;
  state: string;
  redirectUri: string;
}

export function savePkceSession(session: PkceSession, storage: StorageLike | null = defaultStorage()): void {
  storage?.setItem(PKCE_KEY, JSON.stringify(session));
}

export function loadPkceSession(storage: StorageLike | null = defaultStorage()): PkceSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PKCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PkceSession>;
    if (!parsed.verifier || !parsed.state || !parsed.redirectUri) return null;
    return { verifier: parsed.verifier, state: parsed.state, redirectUri: parsed.redirectUri };
  } catch {
    return null;
  }
}

export function saveReturnPath(path: string, storage: StorageLike | null = defaultStorage()): void {
  const cleaned = path.startsWith('/') && !path.startsWith('/spotify') ? path : '/studio';
  storage?.setItem(RETURN_KEY, cleaned);
}

export function loadReturnPath(storage: StorageLike | null = defaultStorage()): string {
  const raw = storage?.getItem(RETURN_KEY);
  storage?.removeItem(RETURN_KEY);
  if (raw && raw.startsWith('/') && !raw.startsWith('/spotify')) return raw;
  return '/studio';
}

export function parseOAuthCallback(search: string): { code: string; state: string } | { error: string } {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const err = q.get('error');
  if (err) return { error: q.get('error_description') || err };
  const code = q.get('code');
  const state = q.get('state');
  if (!code || !state) return { error: 'Missing authorization code' };
  return { code, state };
}

/** Finish the /spotify redirect: verify state, exchange the code, store tokens.
 *  Pure over storage + fetch — the DOM bounce lives in spotifyCallback.ts. */
export async function completeSpotifyRedirect(
  search: string,
  opts: {
    env?: SpotifyEnv;
    storage?: StorageLike | null;
    origin?: string;
    now?: number;
    fetchImpl?: SpotifyFetch;
  } = {},
): Promise<{ ok: true; returnTo: string } | { ok: false; error: string; returnTo: string }> {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const returnTo = loadReturnPath(storage);
  const parsed = parseOAuthCallback(search);
  if ('error' in parsed) return { ok: false, error: parsed.error, returnTo };
  const session = loadPkceSession(storage);
  storage?.removeItem(PKCE_KEY);
  if (!session || session.state !== parsed.state) {
    return { ok: false, error: 'Spotify sign-in state did not match. Try Connect again.', returnTo };
  }
  const clientId = readClientId(opts.env);
  if (!clientId) return { ok: false, error: NOT_SET_UP, returnTo };
  try {
    const tokens = await exchangeAuthorizationCode({
      clientId,
      code: parsed.code,
      verifier: session.verifier,
      redirectUri: session.redirectUri,
      now: opts.now,
      fetchImpl: opts.fetchImpl,
    });
    saveTokens(tokens, storage);
    return { ok: true, returnTo };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Spotify sign-in failed', returnTo };
  }
}

/** Start the OAuth redirect (browser only). Throws a clear error in a native shell. */
export async function startSpotifyConnect(opts: {
  env?: SpotifyEnv;
  storage?: StorageLike | null;
  origin?: string;
  returnPath?: string;
  native?: boolean;
  assign?: (url: string) => void;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const native = opts.native ?? isNativeMusicShell();
  if (native) return { ok: false, error: NATIVE_NOTE };
  const clientId = readClientId(opts.env);
  if (!clientId) return { ok: false, error: NOT_SET_UP };
  const origin = opts.origin ?? (typeof window !== 'undefined' ? window.location.origin : WEB_APP_ORIGIN);
  const redirectUri = spotifyRedirectUri(origin);
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const verifier = generateCodeVerifier();
  const state = generateState();
  savePkceSession({ verifier, state, redirectUri }, storage);
  saveReturnPath(opts.returnPath ?? (typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '/studio'), storage);
  const url = await buildAuthorizeUrl({ clientId, redirectUri, verifier, state });
  const assign = opts.assign ?? ((href: string) => { window.location.assign(href); });
  assign(url);
  return { ok: true };
}
