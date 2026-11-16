// Music session — Spotify when she is connected, otherwise the built-in
// public-domain player. One place for play/pause/skip/volume/search so the
// remote, the studio panel, voice and gestures all run the same commands.

import { createMusicController, type MusicController } from './musicController';
import {
  currentTrack,
  DEFAULT_TRACKS,
  playerStatusLabel,
  clampVolume,
  type PlayerAction,
  type PlayerState,
} from './player';
import { parseMusicIntent, type MusicIntent } from './musicIntent';
import {
  clearTokens,
  getValidAccessToken,
  isNativeMusicShell,
  loadTokens,
  readClientId,
  spotifyStatus,
  startSpotifyConnect,
  WEB_APP_ORIGIN,
  type SpotifyConfigStatus,
} from './spotifyAuth';
import * as api from './spotifyApi';
import { isNoActiveDevice } from './spotifyApi';
import { startWebPlayback, type SdkPlayer } from './spotifySdk';

export type MusicVia = 'spotify' | 'local';

export interface MusicSessionState {
  via: MusicVia;
  status: SpotifyConfigStatus;
  playing: boolean;
  title: string;
  artist: string;
  volume: number;
  label: string;
  note: string;
}

export interface MusicApplyResult {
  ok: boolean;
  detail: string;
  via: MusicVia;
}

export interface MusicSession {
  state(): MusicSessionState;
  apply(intent: MusicIntent): Promise<MusicApplyResult>;
  applyAction(action: PlayerAction): Promise<MusicApplyResult>;
  applyUtterance(utterance: string): Promise<MusicApplyResult | null>;
  connect(): Promise<MusicApplyResult>;
  disconnect(): void;
  onChange(cb: (state: MusicSessionState) => void): void;
  destroy(): void;
  localController(): MusicController;
}

export function isSpotifyConnected(status: SpotifyConfigStatus = spotifyStatus()): boolean {
  return status.kind === 'connected';
}

export function createMusicSession(opts: {
  onCall?: api.SpotifyLedger;
  audio?: HTMLAudioElement;
} = {}): MusicSession {
  const audio = opts.audio ?? new Audio();
  audio.preload = 'none';
  const local = createMusicController(audio, DEFAULT_TRACKS);
  let sdk: SdkPlayer | null = null;
  let sdkTried = false;
  let changeCb: ((s: MusicSessionState) => void) | null = null;
  let cached: { title: string; artist: string; playing: boolean; volume: number } | null = null;
  const apiOpts = (): api.SpotifyApiOptions => ({ onCall: opts.onCall });

  function localSnap(s: PlayerState = local.state()): Pick<MusicSessionState, 'playing' | 'title' | 'artist' | 'volume' | 'label'> {
    const t = currentTrack(s);
    return {
      playing: s.playing,
      title: t?.title ?? '',
      artist: t?.artist ?? '',
      volume: s.volume,
      label: playerStatusLabel(s),
    };
  }

  function snapshot(): MusicSessionState {
    const status = spotifyStatus();
    const via: MusicVia = status.kind === 'connected' ? 'spotify' : 'local';
    const note =
      status.kind === 'connected'
        ? (cached?.title ? 'Spotify Premium' : 'Spotify connected')
        : 'message' in status
          ? status.message
          : 'Built-in player (public domain)';
    if (via === 'spotify' && cached) {
      const who = cached.artist ? ` — ${cached.artist}` : '';
      const title = cached.title || 'Spotify';
      return {
        via,
        status,
        playing: cached.playing,
        title,
        artist: cached.artist,
        volume: cached.volume,
        label: `${cached.playing ? '▶' : '❚❚'} ${title}${who}`,
        note,
      };
    }
    const loc = localSnap();
    return { via, status, ...loc, note };
  }

  function emit(): void {
    changeCb?.(snapshot());
  }

  local.onChange(() => {
    if (spotifyStatus().kind !== 'connected') emit();
  });

  async function refreshFromSpotify(): Promise<void> {
    try {
      const pb = await api.getPlayback(apiOpts());
      if (pb) cached = { title: pb.title, artist: pb.artist, playing: pb.playing, volume: pb.volume };
      emit();
    } catch {
      emit();
    }
  }

  async function ensureDevice(): Promise<string | undefined> {
    const devices = await api.listDevices(apiOpts());
    const active = devices.find((d) => d.isActive) ?? devices[0];
    if (active) {
      if (!active.isActive) await api.transferPlayback(active.id, apiOpts(), false);
      return active.id;
    }
    if (sdk) return sdk.deviceId;
    if (sdkTried || isNativeMusicShell()) return undefined;
    sdkTried = true;
    try {
      sdk = await startWebPlayback({
        getToken: () => getValidAccessToken(),
        volume: cached?.volume ?? local.state().volume,
      });
      await api.transferPlayback(sdk.deviceId, apiOpts(), false);
      return sdk.deviceId;
    } catch {
      sdk = null;
      return undefined;
    }
  }

  async function runSpotify(intent: MusicIntent): Promise<MusicApplyResult> {
    const via: MusicVia = 'spotify';
    const fail = (detail: string): MusicApplyResult => ({ ok: false, detail, via });
    try {
      switch (intent.type) {
        case 'connect':
          return connect();
        case 'disconnect':
          disconnect();
          return { ok: true, detail: 'Spotify disconnected. Using the built-in player.', via: 'local' };
        case 'play':
          try {
            await api.play(apiOpts());
          } catch (err) {
            if (!isNoActiveDevice(err)) throw err;
            const id = await ensureDevice();
            if (!id) return fail('Open Spotify on your phone, speaker or this computer, then try again.');
            await api.play(apiOpts(), { device_id: id });
          }
          await refreshFromSpotify();
          return { ok: true, detail: cached?.title ? `Playing ${cached.title}` : 'Playing on Spotify', via };
        case 'pause':
          await api.pause(apiOpts());
          if (cached) cached = { ...cached, playing: false };
          emit();
          return { ok: true, detail: 'Paused', via };
        case 'toggle':
          return runSpotify(cached?.playing || local.state().playing ? { type: 'pause' } : { type: 'play' });
        case 'next':
          await api.next(apiOpts());
          await refreshFromSpotify();
          return { ok: true, detail: cached?.title ? `Next: ${cached.title}` : 'Next track', via };
        case 'prev':
          await api.previous(apiOpts());
          await refreshFromSpotify();
          return { ok: true, detail: cached?.title ? `Previous: ${cached.title}` : 'Previous track', via };
        case 'volume':
        case 'volumeAdjust': {
          const base = cached?.volume ?? local.state().volume;
          const volume = clampVolume(intent.type === 'volume' ? intent.volume : base + intent.delta);
          await api.setVolumePercent(volume * 100, apiOpts());
          if (cached) cached = { ...cached, volume };
          local.dispatch({ type: 'setVolume', volume });
          emit();
          return { ok: true, detail: `Volume ${Math.round(volume * 100)}%`, via };
        }
        case 'searchPlay': {
          const id = await ensureDevice();
          const { hit, deviceNote } = await api.searchAndPlay(intent.query, apiOpts(), id);
          cached = {
            title: hit.name,
            artist: hit.artist ?? '',
            playing: true,
            volume: cached?.volume ?? local.state().volume,
          };
          emit();
          const who = hit.artist ? ` — ${hit.artist}` : '';
          const where = deviceNote ? ` ${deviceNote}` : '';
          return { ok: true, detail: `Playing ${hit.name}${who}${where}`, via };
        }
        default:
          return fail('Unknown music command');
      }
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'Spotify request failed');
    }
  }

  function intentFromAction(action: PlayerAction): MusicIntent | null {
    switch (action.type) {
      case 'play': return { type: 'play' };
      case 'pause': return { type: 'pause' };
      case 'toggle': return { type: 'toggle' };
      case 'next': return { type: 'next' };
      case 'prev': return { type: 'prev' };
      case 'setVolume': return { type: 'volume', volume: action.volume };
      case 'ended': return { type: 'next' };
      default: return null;
    }
  }

  async function runLocal(intent: MusicIntent): Promise<MusicApplyResult> {
    const via: MusicVia = 'local';
    switch (intent.type) {
      case 'connect':
        return connect();
      case 'disconnect':
        return { ok: true, detail: 'Using the built-in player.', via };
      case 'play': local.dispatch({ type: 'play' }); break;
      case 'pause': local.dispatch({ type: 'pause' }); break;
      case 'toggle': local.dispatch({ type: 'toggle' }); break;
      case 'next': local.dispatch({ type: 'next' }); break;
      case 'prev': local.dispatch({ type: 'prev' }); break;
      case 'volume': local.dispatch({ type: 'setVolume', volume: intent.volume }); break;
      case 'volumeAdjust':
        local.dispatch({ type: 'setVolume', volume: local.state().volume + intent.delta });
        break;
      case 'searchPlay': {
        const tracks = local.state().tracks;
        const q = intent.query.toLowerCase();
        const idx = tracks.findIndex((t) =>
          t.title.toLowerCase().includes(q) || (t.artist ?? '').toLowerCase().includes(q));
        if (idx >= 0) local.dispatch({ type: 'select', index: idx });
        else local.dispatch({ type: 'play' });
        const t = currentTrack(local.state());
        return {
          ok: true,
          detail: t
            ? (idx >= 0 ? `Playing ${t.title} on the built-in player` : `No local match for “${intent.query}”. Playing ${t.title}.`)
            : `No local match for “${intent.query}”`,
          via,
        };
      }
      default:
        return { ok: false, detail: 'Unknown music command', via };
    }
    const t = currentTrack(local.state());
    const s = local.state();
    const detail = intent.type === 'pause' ? 'Paused'
      : intent.type === 'volume' || intent.type === 'volumeAdjust' ? `Volume ${Math.round(s.volume * 100)}%`
      : t ? `${s.playing ? 'Playing' : 'Ready'} ${t.title}` : 'No track';
    return { ok: true, detail, via };
  }

  async function apply(intent: MusicIntent): Promise<MusicApplyResult> {
    if (intent.type === 'connect') return connect();
    if (intent.type === 'disconnect') {
      disconnect();
      return { ok: true, detail: 'Spotify disconnected. Using the built-in player.', via: 'local' };
    }
    if (isSpotifyConnected() && loadTokens()) return runSpotify(intent);
    return runLocal(intent);
  }

  async function connect(): Promise<MusicApplyResult> {
    const status = spotifyStatus();
    if (status.kind === 'not-configured') {
      return { ok: false, detail: status.message, via: 'local' };
    }
    if (status.kind === 'native-shell') {
      return { ok: false, detail: status.message, via: 'local' };
    }
    if (!readClientId()) {
      return { ok: false, detail: 'Spotify not set up.', via: 'local' };
    }
    const started = await startSpotifyConnect({});
    if (!started.ok) return { ok: false, detail: started.error, via: 'local' };
    return { ok: true, detail: 'Opening Spotify…', via: 'spotify' };
  }

  function disconnect(): void {
    clearTokens();
    sdk?.disconnect();
    sdk = null;
    cached = null;
    emit();
  }

  // If we already have tokens, pull the current Spotify state once (best-effort).
  if (isSpotifyConnected()) void refreshFromSpotify();

  return {
    state: snapshot,
    apply,
    async applyAction(action) {
      const intent = intentFromAction(action);
      if (!intent) {
        local.dispatch(action);
        return { ok: true, detail: playerStatusLabel(local.state()), via: 'local' };
      }
      return apply(intent);
    },
    async applyUtterance(utterance) {
      const intent = parseMusicIntent(utterance);
      if (!intent) return null;
      return apply(intent);
    },
    connect,
    disconnect,
    onChange(cb) {
      changeCb = cb;
      cb(snapshot());
    },
    destroy() {
      local.destroy();
      sdk?.disconnect();
      sdk = null;
      changeCb = null;
    },
    localController: () => local,
  };
}

export function openWebAppToConnect(): void {
  const url = `${WEB_APP_ORIGIN}/studio`;
  if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
}
