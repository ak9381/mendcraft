// Spotify Web API Connect client (play/pause/skip/volume, devices, transfer,
// search + play). Every request is labelled in the outbound ledger as
// "spotify". Access tokens never go in the ledger — only the path and a short
// search query.

import {
  SPOTIFY_API_BASE,
  type SpotifyFetch,
  type SpotifyEnv,
  getValidAccessToken,
  type StorageLike,
} from './spotifyAuth';

export interface SpotifyCallInfo {
  job: 'spotify';
  reason: string;
  sent: string;
  ms?: number;
}

export type SpotifyLedger = (info: SpotifyCallInfo) => void;

export interface SpotifyApiOptions {
  env?: SpotifyEnv;
  storage?: StorageLike | null;
  fetchImpl?: SpotifyFetch;
  onCall?: SpotifyLedger;
  now?: number;
  /** When set, skip token lookup (tests). */
  accessToken?: string;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  volume: number | null;
}

export interface SpotifyPlayback {
  playing: boolean;
  title: string;
  artist: string;
  /** 0..1, or null when Spotify did not report one. */
  volume: number | null;
  deviceId: string | null;
  deviceName: string;
}

export interface SpotifySearchHit {
  kind: 'track' | 'playlist';
  id: string;
  uri: string;
  name: string;
  artist?: string;
}

const defaultFetch: SpotifyFetch = (input, init) => fetch(input, init);

async function accessToken(opts: SpotifyApiOptions): Promise<string> {
  if (opts.accessToken) return opts.accessToken;
  return getValidAccessToken({
    env: opts.env,
    storage: opts.storage,
    now: opts.now,
    fetchImpl: opts.fetchImpl,
  });
}

interface ApiResult {
  status: number;
  json: unknown;
}

async function api(
  method: string,
  path: string,
  opts: SpotifyApiOptions,
  body?: unknown,
  reason = 'Spotify Web API',
): Promise<ApiResult> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const token = await accessToken(opts);
  const url = path.startsWith('http') ? path : `${SPOTIFY_API_BASE}${path}`;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
  const res = await (opts.fetchImpl ?? defaultFetch)(url, init);
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  }
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  const sent = redactLedger(`${method} ${path.replace(SPOTIFY_API_BASE, '')}`);
  opts.onCall?.({ job: 'spotify', reason, sent, ms });
  if (!res.ok && res.status !== 204) {
    const err = (json as { error?: { message?: string; reason?: string } } | null)?.error;
    const msg = err?.message || err?.reason || `Spotify HTTP ${res.status}`;
    const e = new Error(msg) as Error & { status: number; reason?: string };
    e.status = res.status;
    e.reason = err?.reason;
    throw e;
  }
  return { status: res.status, json };
}

/** Ledger text: keep the path + a short `q=` value, never a bearer token. */
export function redactLedger(sent: string): string {
  return sent
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/access_token=[^&\s]+/gi, 'access_token=[redacted]');
}

export async function getPlayback(opts: SpotifyApiOptions = {}): Promise<SpotifyPlayback | null> {
  const { status, json } = await api('GET', '/me/player', opts, undefined, 'Spotify playback state');
  if (status === 204 || !json || typeof json !== 'object') return null;
  const o = json as {
    is_playing?: boolean;
    device?: { id?: string; name?: string; volume_percent?: number };
    item?: { name?: string; artists?: Array<{ name?: string }> };
  };
  const artists = (o.item?.artists ?? []).map((a) => a.name).filter(Boolean).join(', ');
  const vol = o.device?.volume_percent;
  return {
    playing: Boolean(o.is_playing),
    title: o.item?.name ?? '',
    artist: artists,
    // null = Spotify did not say (never a made-up 100 %).
    volume: typeof vol === 'number' ? Math.min(1, Math.max(0, vol / 100)) : null,
    deviceId: o.device?.id ?? null,
    deviceName: o.device?.name ?? '',
  };
}

export async function listDevices(opts: SpotifyApiOptions = {}): Promise<SpotifyDevice[]> {
  const { json } = await api('GET', '/me/player/devices', opts, undefined, 'Spotify devices');
  const devices = (json as { devices?: Array<{ id?: string; name?: string; type?: string; is_active?: boolean; volume_percent?: number | null }> })?.devices ?? [];
  return devices
    .filter((d) => typeof d.id === 'string' && d.id)
    .map((d) => ({
      id: d.id as string,
      name: d.name ?? 'Device',
      type: d.type ?? 'unknown',
      isActive: Boolean(d.is_active),
      volume: typeof d.volume_percent === 'number' ? d.volume_percent / 100 : null,
    }));
}

export async function transferPlayback(deviceId: string, opts: SpotifyApiOptions = {}, play = true): Promise<void> {
  await api('PUT', '/me/player', opts, { device_ids: [deviceId], play }, 'Spotify transfer playback');
}

export async function play(opts: SpotifyApiOptions = {}, body?: { uris?: string[]; context_uri?: string; device_id?: string }): Promise<void> {
  const q = body?.device_id ? `?device_id=${encodeURIComponent(body.device_id)}` : '';
  const payload = body ? { uris: body.uris, context_uri: body.context_uri } : undefined;
  await api('PUT', `/me/player/play${q}`, opts, payload ?? {}, 'Spotify play');
}

export async function pause(opts: SpotifyApiOptions = {}): Promise<void> {
  await api('PUT', '/me/player/pause', opts, undefined, 'Spotify pause');
}

export async function next(opts: SpotifyApiOptions = {}): Promise<void> {
  await api('POST', '/me/player/next', opts, undefined, 'Spotify next');
}

export async function previous(opts: SpotifyApiOptions = {}): Promise<void> {
  await api('POST', '/me/player/previous', opts, undefined, 'Spotify previous');
}

export async function setVolumePercent(percent: number, opts: SpotifyApiOptions = {}): Promise<void> {
  const v = Math.round(Math.min(100, Math.max(0, percent)));
  await api('PUT', `/me/player/volume?volume_percent=${v}`, opts, undefined, 'Spotify volume');
}

export async function search(query: string, opts: SpotifyApiOptions = {}): Promise<SpotifySearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const path = `/search?q=${encodeURIComponent(q)}&type=track,playlist&limit=5`;
  const { json } = await api('GET', path, opts, undefined, 'Spotify search');
  const data = json as {
    tracks?: { items?: Array<{ id?: string; uri?: string; name?: string; artists?: Array<{ name?: string }> }> };
    playlists?: { items?: Array<{ id?: string; uri?: string; name?: string }> };
  };
  const hits: SpotifySearchHit[] = [];
  for (const t of data.tracks?.items ?? []) {
    if (!t.id || !t.uri) continue;
    hits.push({
      kind: 'track',
      id: t.id,
      uri: t.uri,
      name: t.name ?? 'Track',
      artist: (t.artists ?? []).map((a) => a.name).filter(Boolean).join(', '),
    });
  }
  for (const p of data.playlists?.items ?? []) {
    if (!p?.id || !p.uri) continue;
    hits.push({ kind: 'playlist', id: p.id, uri: p.uri, name: p.name ?? 'Playlist' });
  }
  return hits;
}

/** Prefer a playlist when the query sounds like a set of songs; otherwise the first track. */
export function pickSearchHit(query: string, hits: readonly SpotifySearchHit[]): SpotifySearchHit | null {
  if (!hits.length) return null;
  const wantsSet = /\b(songs?|playlist|mix|radio|album|hits|tracks)\b/i.test(query);
  if (wantsSet) {
    const list = hits.find((h) => h.kind === 'playlist');
    if (list) return list;
  }
  return hits.find((h) => h.kind === 'track') ?? hits[0];
}

export function isNoActiveDevice(err: unknown): boolean {
  const e = err as { status?: number; reason?: string; message?: string };
  if (e?.status === 404) return true;
  const msg = `${e?.reason ?? ''} ${e?.message ?? ''}`.toLowerCase();
  return msg.includes('no active device') || msg.includes('no device');
}

/** Search and start playback. If nothing is active, transfer to the first
 *  available device (or a preferred device id) and retry once. */
export async function searchAndPlay(
  query: string,
  opts: SpotifyApiOptions = {},
  preferDeviceId?: string | null,
): Promise<{ hit: SpotifySearchHit; deviceNote: string }> {
  const hits = await search(query, opts);
  const hit = pickSearchHit(query, hits);
  if (!hit) throw new Error(`No Spotify match for “${query}”`);
  const body = hit.kind === 'playlist' ? { context_uri: hit.uri } : { uris: [hit.uri] };
  try {
    await play(opts, preferDeviceId ? { ...body, device_id: preferDeviceId } : body);
    return { hit, deviceNote: '' };
  } catch (err) {
    if (!isNoActiveDevice(err)) throw err;
    const devices = await listDevices(opts);
    const target = devices.find((d) => d.id === preferDeviceId) ?? devices.find((d) => d.isActive) ?? devices[0];
    if (!target) {
      const e = new Error('Open Spotify on your phone, speaker or this computer, then try again.') as Error & { status: number };
      e.status = 404;
      throw e;
    }
    await transferPlayback(target.id, opts, true);
    await play(opts, { ...body, device_id: target.id });
    return { hit, deviceNote: `on ${target.name}` };
  }
}
