// Optional Spotify Web Playback SDK — makes THIS browser a Connect device when
// nothing else is active. Loaded from sdk.scdn.co only after a user connects
// Spotify. A failure is honest (we just ask her to open Spotify on a phone or
// speaker). Not used inside a Capacitor native shell.

const SDK_SRC = 'https://sdk.scdn.co/spotify-player.js';

export interface SdkPlayer {
  deviceId: string;
  disconnect(): void;
}

type SpotifyPlayerCtor = new (opts: {
  name: string;
  getOAuthToken: (cb: (token: string) => void) => void;
  volume?: number;
}) => {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(ev: string, cb: (e: { device_id?: string; message?: string }) => void): void;
};

interface SpotifyGlobal {
  Player: SpotifyPlayerCtor;
}

declare global {
  interface Window {
    Spotify?: SpotifyGlobal;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

let loading: Promise<SpotifyGlobal> | null = null;

export function loadSpotifySdk(src = SDK_SRC): Promise<SpotifyGlobal> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.Spotify?.Player) return Promise.resolve(window.Spotify);
  if (loading) return loading;
  loading = new Promise<SpotifyGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    const done = () => {
      if (window.Spotify?.Player) resolve(window.Spotify);
      else reject(new Error('Spotify Web Playback SDK failed to load'));
    };
    window.onSpotifyWebPlaybackSDKReady = done;
    if (existing) {
      if (window.Spotify?.Player) done();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error('Could not load the Spotify Web Playback SDK'));
    };
    document.head.appendChild(s);
    setTimeout(() => {
      if (!window.Spotify?.Player) {
        loading = null;
        reject(new Error('Spotify Web Playback SDK timed out'));
      }
    }, 12_000);
  });
  return loading;
}

/** Start a hidden Mendcraft playback device. Resolves with its device id. */
export async function startWebPlayback(opts: {
  getToken: () => Promise<string>;
  volume?: number;
  name?: string;
}): Promise<SdkPlayer> {
  const sdk = await loadSpotifySdk();
  const player = new sdk.Player({
    name: opts.name ?? 'Mendcraft',
    getOAuthToken: (cb) => { void opts.getToken().then(cb, () => cb('')); },
    volume: opts.volume ?? 0.8,
  });
  return new Promise<SdkPlayer>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Spotify player did not become ready')), 12_000);
    player.addListener('ready', (ev) => {
      if (!ev.device_id) return;
      clearTimeout(timer);
      resolve({
        deviceId: ev.device_id,
        disconnect: () => player.disconnect(),
      });
    });
    player.addListener('initialization_error', (ev) => {
      clearTimeout(timer);
      reject(new Error(ev.message || 'Spotify player failed to start'));
    });
    player.addListener('authentication_error', (ev) => {
      clearTimeout(timer);
      reject(new Error(ev.message || 'Spotify player auth failed'));
    });
    void player.connect().then((ok) => {
      if (!ok) {
        clearTimeout(timer);
        reject(new Error('Spotify player could not connect'));
      }
    });
  });
}
