import { describe, expect, it } from 'vitest';
import {
  base64UrlEncode,
  buildAuthorizeUrl,
  codeChallenge,
  completeSpotifyRedirect,
  generateCodeVerifier,
  getValidAccessToken,
  isAccessTokenFresh,
  loadTokens,
  parseOAuthCallback,
  readClientId,
  refreshAccessToken,
  saveTokens,
  spotifyRedirectUri,
  spotifyStatus,
  tokensFromResponse,
  SPOTIFY_SCOPES,
  SPOTIFY_TOKEN_URL,
  type StorageLike,
  type SpotifyTokens,
} from '../src/music/spotifyAuth';
import {
  pickSearchHit,
  redactLedger,
  type SpotifySearchHit,
} from '../src/music/spotifyApi';
import { parseMusicIntent } from '../src/music/musicIntent';

function memoryStorage(init: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(init));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

const ENV = { VITE_SPOTIFY_CLIENT_ID: 'test_client_id' };

describe('PKCE', () => {
  it('encodes base64url without +, / or padding', () => {
    const bytes = Uint8Array.from([0xfb, 0xff, 0xef, 0x00]);
    const s = base64UrlEncode(bytes);
    expect(s).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(s).not.toMatch(/[+/=]/);
  });

  it('generates a 43–128 character unreserved verifier', () => {
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('the challenge is the base64url SHA-256 of the verifier', async () => {
    const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
    expect(verifier.length).toBe(66);
    const challenge = await codeChallenge(verifier);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    expect(challenge).toBe(base64UrlEncode(new Uint8Array(hash)));
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('builds an authorize URL with PKCE fields and the /spotify redirect', async () => {
    const verifier = generateCodeVerifier();
    const redirect = spotifyRedirectUri('https://mendcraft.web.app');
    expect(redirect).toBe('https://mendcraft.web.app/spotify');
    const url = new URL(await buildAuthorizeUrl({
      clientId: 'test_client_id',
      redirectUri: redirect,
      verifier,
      state: 'abc',
    }));
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(url.searchParams.get('client_id')).toBe('test_client_id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe('https://mendcraft.web.app/spotify');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(await codeChallenge(verifier));
    expect(url.searchParams.get('state')).toBe('abc');
    expect(url.searchParams.get('scope')).toBe(SPOTIFY_SCOPES);
  });
});

describe('status / config', () => {
  it('is not-configured without a client id', () => {
    const s = spotifyStatus({ env: {}, tokens: null, native: false });
    expect(s.kind).toBe('not-configured');
    if (s.kind === 'not-configured') expect(s.message).toMatch(/Spotify not set up/i);
    expect(readClientId({})).toBeNull();
    expect(readClientId(ENV)).toBe('test_client_id');
  });

  it('tells the native shell to connect on the web', () => {
    const s = spotifyStatus({ env: ENV, tokens: null, native: true });
    expect(s.kind).toBe('native-shell');
    if (s.kind === 'native-shell') expect(s.message).toMatch(/cannot return/i);
  });

  it('is connected only when tokens exist', () => {
    const tokens: SpotifyTokens = {
      accessToken: 'tok', refreshToken: 'ref', expiresAt: Date.now() + 3600_000,
      tokenType: 'Bearer', scope: SPOTIFY_SCOPES,
    };
    expect(spotifyStatus({ env: ENV, tokens, native: false }).kind).toBe('connected');
    expect(spotifyStatus({ env: ENV, tokens: null, native: false }).kind).toBe('disconnected');
  });
});

describe('token refresh', () => {
  it('reuses a fresh access token and refreshes an expired one', async () => {
    const storage = memoryStorage();
    const now = 1_700_000_000_000;
    saveTokens({
      accessToken: 'old', refreshToken: 'r1', expiresAt: now + 10_000,
      tokenType: 'Bearer', scope: '',
    }, storage);
    // Within the 60s skew it is treated as expired.
    expect(isAccessTokenFresh(loadTokens(storage)!, now, 60_000)).toBe(false);

    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body ?? '') });
      return new Response(JSON.stringify({
        access_token: 'new',
        refresh_token: 'r2',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: SPOTIFY_SCOPES,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const token = await getValidAccessToken({ env: ENV, storage, now, fetchImpl });
    expect(token).toBe('new');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SPOTIFY_TOKEN_URL);
    expect(calls[0].body).toContain('grant_type=refresh_token');
    expect(calls[0].body).toContain('refresh_token=r1');
    expect(calls[0].body).toContain('client_id=test_client_id');
    const saved = loadTokens(storage)!;
    expect(saved.accessToken).toBe('new');
    expect(saved.refreshToken).toBe('r2');
    expect(saved.expiresAt).toBe(now + 3600_000);
  });

  it('keeps the previous refresh token when Spotify omits a new one', async () => {
    const next = await refreshAccessToken({
      clientId: 'test_client_id',
      refreshToken: 'keep-me',
      now: 1000,
      previous: {
        accessToken: 'old', refreshToken: 'keep-me', expiresAt: 0,
        tokenType: 'Bearer', scope: 'streaming',
      },
      fetchImpl: async () => new Response(JSON.stringify({
        access_token: 'n', token_type: 'Bearer', expires_in: 60,
      }), { status: 200 }),
    });
    expect(next.accessToken).toBe('n');
    expect(next.refreshToken).toBe('keep-me');
    expect(next.scope).toBe('streaming');
  });

  it('surfaces a Spotify token error', async () => {
    await expect(refreshAccessToken({
      clientId: 'x',
      refreshToken: 'r',
      fetchImpl: async () => new Response(JSON.stringify({
        error: 'invalid_grant', error_description: 'Refresh token revoked',
      }), { status: 400 }),
    })).rejects.toThrow(/revoked/);
  });

  it('tokensFromResponse computes expiry from expires_in', () => {
    const t = tokensFromResponse({ access_token: 'a', expires_in: 120 }, 1000);
    expect(t.expiresAt).toBe(121_000);
  });
});

describe('OAuth callback', () => {
  it('parses code, state, and errors', () => {
    expect(parseOAuthCallback('?code=abc&state=s1')).toEqual({ code: 'abc', state: 's1' });
    expect(parseOAuthCallback('error=access_denied')).toEqual({ error: 'access_denied' });
    expect(parseOAuthCallback('')).toEqual({ error: 'Missing authorization code' });
  });

  it('exchanges the code when state matches, and stores tokens', async () => {
    const storage = memoryStorage();
    storage.setItem('mendcraft.spotify.pkce', JSON.stringify({
      verifier: 'v'.repeat(43),
      state: 'st',
      redirectUri: 'https://mendcraft.web.app/spotify',
    }));
    storage.setItem('mendcraft.spotify.return', '/phone');
    const result = await completeSpotifyRedirect('?code=thecode&state=st', {
      env: ENV,
      storage,
      now: 5000,
      fetchImpl: async (_url, init) => {
        const body = String(init?.body ?? '');
        expect(body).toContain('grant_type=authorization_code');
        expect(body).toContain('code=thecode');
        expect(body).toContain('code_verifier=' + 'v'.repeat(43));
        expect(body).toContain('redirect_uri=https%3A%2F%2Fmendcraft.web.app%2Fspotify');
        return new Response(JSON.stringify({
          access_token: 'acc', refresh_token: 'ref', expires_in: 10, token_type: 'Bearer',
        }), { status: 200 });
      },
    });
    expect(result).toEqual({ ok: true, returnTo: '/phone' });
    expect(loadTokens(storage)?.accessToken).toBe('acc');
  });

  it('rejects a state mismatch without exchanging', async () => {
    const storage = memoryStorage();
    storage.setItem('mendcraft.spotify.pkce', JSON.stringify({
      verifier: 'v'.repeat(43), state: 'expected', redirectUri: 'https://x/spotify',
    }));
    const calls: string[] = [];
    const result = await completeSpotifyRedirect('?code=c&state=other', {
      env: ENV,
      storage,
      fetchImpl: async (url) => { calls.push(url); return new Response('{}', { status: 200 }); },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/state/i);
    expect(calls).toEqual([]);
  });
});

describe('ledger redaction', () => {
  it('strips bearer tokens from outbound text', () => {
    expect(redactLedger('GET /me/player Authorization: Bearer hunter2.abc')).toBe(
      'GET /me/player Authorization: Bearer [redacted]',
    );
  });
});

describe('search hit picking', () => {
  const track: SpotifySearchHit = { kind: 'track', id: 't1', uri: 'spotify:track:t1', name: 'Song', artist: 'A' };
  const list: SpotifySearchHit = { kind: 'playlist', id: 'p1', uri: 'spotify:playlist:p1', name: 'Kannada hits' };

  it('prefers a playlist when the query sounds like a set of songs', () => {
    expect(pickSearchHit('old kannada songs', [track, list])?.kind).toBe('playlist');
    expect(pickSearchHit('bohemian rhapsody', [track, list])?.kind).toBe('track');
    expect(pickSearchHit('x', [])).toBeNull();
  });
});

describe('intent mapping', () => {
  it('maps play / pause / skip / volume', () => {
    expect(parseMusicIntent('play')).toEqual({ type: 'play' });
    expect(parseMusicIntent('Play music')).toEqual({ type: 'play' });
    expect(parseMusicIntent('resume')).toEqual({ type: 'play' });
    expect(parseMusicIntent('pause')).toEqual({ type: 'pause' });
    expect(parseMusicIntent('stop the music')).toEqual({ type: 'pause' });
    expect(parseMusicIntent('next song')).toEqual({ type: 'next' });
    expect(parseMusicIntent('skip')).toEqual({ type: 'next' });
    expect(parseMusicIntent('previous track')).toEqual({ type: 'prev' });
    expect(parseMusicIntent('volume up')).toEqual({ type: 'volumeAdjust', delta: 0.1 });
    expect(parseMusicIntent('quieter')).toEqual({ type: 'volumeAdjust', delta: -0.1 });
    expect(parseMusicIntent('set volume to 50%')).toEqual({ type: 'volume', volume: 0.5 });
    expect(parseMusicIntent('volume 200')).toEqual({ type: 'volume', volume: 1 });
  });

  it('maps search-and-play, including "play some old Kannada songs"', () => {
    expect(parseMusicIntent('play some old Kannada songs')).toEqual({
      type: 'searchPlay', query: 'old kannada songs',
    });
    expect(parseMusicIntent('play Bohemian Rhapsody')).toEqual({
      type: 'searchPlay', query: 'bohemian rhapsody',
    });
    expect(parseMusicIntent('connect spotify')).toEqual({ type: 'connect' });
    expect(parseMusicIntent('disconnect spotify')).toEqual({ type: 'disconnect' });
  });

  it('leaves design / tour commands alone, and bare "stop"', () => {
    expect(parseMusicIntent('play the demo')).toBeNull();
    expect(parseMusicIntent('play demo')).toBeNull();
    expect(parseMusicIntent('play the tour')).toBeNull();
    expect(parseMusicIntent('add a door')).toBeNull();
    expect(parseMusicIntent('stop')).toBeNull();
    expect(parseMusicIntent('')).toBeNull();
  });

  it('recognises a few Kannada and Hindi music phrases', () => {
    expect(parseMusicIntent('ಹಾಡು ಹಾಕು')).toEqual({ type: 'play' });
    expect(parseMusicIntent('गाना चलाओ')).toEqual({ type: 'play' });
    expect(parseMusicIntent('ಮುಂದಿನ ಹಾಡು')).toEqual({ type: 'next' });
  });
});
