// Speaker tile -> Spotify. Wraps the canvas's device connector: when Spotify
// is really connected (Premium), "play <query>" on a speaker-* tile searches
// Spotify and plays on a Connect device named like "Marshall" (else this
// browser's own Web Playback device). The tile's track title is the real hit's
// title, never invented. Not connected, or no usable device / no match: the
// built-in player keeps working and a spoken notice says so — no fake session.
import type { DeviceConnector, DeviceIntent } from './deviceActions';
import type { DeviceState } from './surfacePlan';
import type { SpotifyDevice, SpotifySearchHit } from '../music/spotifyApi';

export const NOT_CONNECTED_NOTICE = "Spotify isn't connected — playing the built-in track.";

export interface SpotifyConnectorDeps {
  inner: DeviceConnector;
  isConnected(): boolean;
  listDevices(): Promise<SpotifyDevice[]>;
  transferPlayback(deviceId: string, play: boolean): Promise<void>;
  searchAndPlay(query: string, deviceId: string): Promise<{ hit: SpotifySearchHit; deviceNote: string }>;
  /** This browser as a Connect device (Web Playback SDK). Return undefined where
   *  it can't run (phone shell / iOS WKWebView) — it is then never offered. */
  browserDevice?(): Promise<string | undefined>;
  /** Transport for the session this connector started (optional). */
  pause?(): Promise<void>;
  resume?(): Promise<void>;
  next?(): Promise<{ title: string } | null>;
  setVolume?(percent: number): Promise<void>;
  say(text: string): void;
}

export function isSpeakerDevice(deviceId: string): boolean {
  return deviceId.startsWith('speaker-');
}

const MARSHALL = /marshall/i;

export function createSpotifyAwareConnector(deps: SpotifyConnectorDeps): DeviceConnector {
  // Only true after Spotify actually accepted a play from this connector.
  let spotifyActive = false;

  async function pickDevice(): Promise<{ id: string; name: string } | null> {
    let devices: SpotifyDevice[] = [];
    try { devices = await deps.listDevices(); } catch { /* fall through to browser */ }
    const marshall = devices.find((d) => MARSHALL.test(d.name));
    if (marshall) return { id: marshall.id, name: marshall.name };
    const browserId = await deps.browserDevice?.().catch(() => undefined);
    if (browserId) return { id: browserId, name: 'this browser' };
    return null;
  }

  async function fallback(intent: DeviceIntent, notice: string): Promise<Partial<DeviceState>> {
    deps.say(notice);
    spotifyActive = false;
    const { query: _q, ...rest } = intent;
    return deps.inner.run(rest);
  }

  return {
    async run(intent: DeviceIntent): Promise<Partial<DeviceState>> {
      if (!isSpeakerDevice(intent.deviceId)) return deps.inner.run(intent);

      if (intent.query) {
        if (!deps.isConnected()) return fallback(intent, NOT_CONNECTED_NOTICE);
        try {
          const target = await pickDevice();
          if (!target) {
            return fallback(intent, 'No Spotify speaker or browser player is available — playing the built-in track.');
          }
          await deps.transferPlayback(target.id, false);
          const { hit } = await deps.searchAndPlay(intent.query, target.id);
          spotifyActive = true;
          deps.say(`Playing ${hit.name}${hit.artist ? ` by ${hit.artist}` : ''} on ${target.name}.`);
          return { playing: true, trackTitle: hit.name, sim: false };
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          spotifyActive = false;
          deps.say(/^No Spotify match/i.test(msg) ? `${msg}.` : `Couldn't play “${intent.query}” on Spotify.`);
          // Nothing played, and no title is made up: the tile just stops.
          return { playing: false };
        }
      }

      if (spotifyActive && deps.isConnected()) {
        try {
          if (intent.next && deps.next) {
            const n = await deps.next();
            return n?.title ? { playing: true, trackTitle: n.title } : { playing: true };
          }
          if (intent.playing === false && deps.pause) { await deps.pause(); return { playing: false }; }
          if (intent.playing === true && deps.resume) { await deps.resume(); return { playing: true }; }
          if (intent.volume !== undefined && deps.setVolume) { await deps.setVolume(intent.volume); return { volume: intent.volume }; }
        } catch {
          deps.say("Spotify didn't respond.");
          return {};
        }
      }
      return deps.inner.run(intent);
    },
  };
}
