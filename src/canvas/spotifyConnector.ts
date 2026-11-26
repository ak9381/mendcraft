// Speaker tile -> Spotify. Wraps the canvas's device connector: when Spotify
// is really connected, EVERY speaker action (play, pause, previous, next,
// volume, "play <query>") goes to Spotify, on the best device its own device
// list offers (see pickSpotifyDevice). The tile's track title is the real
// track's title, never invented, and the tile says where it plays ("Spotify ·
// iPhone"). Only when Spotify is NOT connected does the built-in player run,
// labelled as such. Connected but no device to play on: nothing plays and she
// is told how to make one show up — never a silent built-in fallback.
import type { DeviceConnector, DeviceIntent } from './deviceActions';
import type { DeviceState } from './surfacePlan';
import type { SpotifyDevice, SpotifySearchHit } from '../music/spotifyApi';

export const NOT_CONNECTED_NOTICE = "Spotify isn't connected — playing the built-in track.";
export const NO_DEVICE_NOTICE = 'Open Spotify on your phone so it shows up, then try again.';
/** The tile's honest label for the fallback player. */
export const BUILTIN_LABEL = 'Built-in player — Spotify not connected';

export interface SpotifyConnectorDeps {
  inner: DeviceConnector;
  isConnected(): boolean;
  listDevices(): Promise<SpotifyDevice[]>;
  transferPlayback(deviceId: string, play: boolean): Promise<void>;
  searchAndPlay(query: string, deviceId: string): Promise<{ hit: SpotifySearchHit; deviceNote: string }>;
  /** This browser as a Connect device (Web Playback SDK). Return undefined where
   *  it can't run (phone shell / iOS WKWebView) — it is then never offered. */
  browserDevice?(): Promise<string | undefined>;
  pause?(): Promise<void>;
  resume?(): Promise<void>;
  next?(): Promise<{ title: string } | null>;
  previous?(): Promise<{ title: string } | null>;
  /** What Spotify is playing right now (for the tile's title after a resume). */
  nowPlaying?(): Promise<{ title: string; artist?: string } | null>;
  setVolume?(percent: number): Promise<void>;
  /** The speaker tile's own name ("Marshall", "Uxbridge speaker"): a Spotify
   *  device with that name is preferred. */
  speakerName?(deviceId: string): string;
  say(text: string): void;
  /** Where the music is really playing — kept current here so the canvas can
   *  say it ("on iPhone via Spotify" / "on the built-in player"). */
  status?: MusicWhere;
}

export interface MusicWhere {
  /** Spotify is carrying the speaker right now. */
  spotify: boolean;
  /** The Spotify device's own name ('this browser', 'iPhone', a speaker). */
  target: string;
}

/** "Playing Morning light on the built-in player." / "Playing on iPhone via
 *  Spotify." — what plays (when known) and where, never a made-up title. */
export function playingLine(where: MusicWhere | null | undefined, title?: string): string {
  const what = title?.trim() ? `Playing ${title.trim()}` : 'Playing';
  if (where?.spotify) return `${what} on ${where.target || 'Spotify'} via Spotify.`;
  return `${what} on the built-in player.`;
}

export function isSpeakerDevice(deviceId: string): boolean {
  return deviceId.startsWith('speaker-');
}

/** Words that mean the user is talking to the canvas, not asking for music. */
const CANVAS_WORDS = /\b(boards?|3d|plans?|layouts?|floors?|canvas|dashboards?|tiles?|rooms?|demo|tour)\b/;
/** Not a search: transport or vague requests the device-command parser handles. */
const NOT_A_SEARCH = /^(next|previous|prev|last|again|it|this|that|something|anything|with|back|resume|more)\b/;

/** The Spotify search for a spoken "play ...", or null when it should fall
 *  through to the normal device commands. Only when Spotify is connected. */
export function spotifySearchQuery(query: string, connected: boolean): string | null {
  if (!connected) return null;
  const q = query.trim().toLowerCase();
  if (!q || CANVAS_WORDS.test(q) || NOT_A_SEARCH.test(q)) return null;
  return query.trim();
}

/** Speaker names a Spotify Connect device may carry even when the tile is just "Speaker". */
const SPEAKER_BRANDS = /marshall|uxbridge|stanmore|acton|woburn/i;
const GENERIC = new Set(['speaker', 'speakers', 'music', 'the', 'my', 'room', 'living', 'player', 'audio']);
const PHONE = /smartphone|phone/i;
const PHONE_NAME = /iphone|phone|android|pixel|galaxy/i;

/** Which of Spotify's own devices to play on, best first:
 *  1. one named like the speaker (its tile name, or a Marshall / Uxbridge),
 *  2. the device Spotify is active on now,
 *  3. a phone (the speaker is often on the phone's Bluetooth, so Spotify
 *     lists only "iPhone"),
 *  4. any other listed device.
 *  null = the list has nothing usable. Pure. */
export function pickSpotifyDevice(devices: readonly SpotifyDevice[], speakerName = ''): SpotifyDevice | null {
  const words = speakerName.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !GENERIC.has(w));
  const named = devices.find((d) => words.some((w) => d.name.toLowerCase().includes(w)))
    ?? devices.find((d) => SPEAKER_BRANDS.test(d.name));
  return named
    ?? devices.find((d) => d.isActive)
    ?? devices.find((d) => PHONE.test(d.type) || PHONE_NAME.test(d.name))
    ?? devices[0]
    ?? null;
}

/** "Playing Blue in Green by Miles Davis on iPhone via Spotify." */
export function spotifyPlayingLine(title: string, artist: string | undefined, deviceName: string): string {
  const what = title ? `${title}${artist ? ` by ${artist}` : ''}` : 'Spotify';
  return `Playing ${what} on ${deviceName} via Spotify.`;
}

export function createSpotifyAwareConnector(deps: SpotifyConnectorDeps): DeviceConnector {
  // The device this connector last moved playback to (null until it has).
  let target: { id: string; name: string } | null = null;

  async function pickDevice(deviceId: string): Promise<{ id: string; name: string } | null> {
    let devices: SpotifyDevice[] = [];
    try { devices = await deps.listDevices(); } catch { /* fall through to this browser */ }
    const hit = pickSpotifyDevice(devices, deps.speakerName?.(deviceId) ?? '');
    if (hit) return { id: hit.id, name: hit.name };
    const browserId = await deps.browserDevice?.().catch(() => undefined);
    return browserId ? { id: browserId, name: 'this browser' } : null;
  }

  const mark = (spotify: boolean, where = ''): void => { if (deps.status) { deps.status.spotify = spotify; deps.status.target = where; } };
  const spotify = (extra: Partial<DeviceState>): Partial<DeviceState> => ({ ...extra, source: 'spotify', playingOn: target?.name ?? '', sim: false });

  /** Connected, but Spotify has nowhere to play: say how to fix it. Nothing
   *  plays — the built-in player is never started silently in its place. */
  function noDevice(): Partial<DeviceState> {
    target = null;
    mark(false);
    deps.say(NO_DEVICE_NOTICE);
    return { playing: false, source: 'spotify', playingOn: '' };
  }

  async function builtin(intent: DeviceIntent, notice?: string): Promise<Partial<DeviceState>> {
    if (notice) deps.say(notice);
    target = null;
    mark(false);
    const { query: _q, ...rest } = intent;
    return { ...(await deps.inner.run(rest)), source: 'builtin', playingOn: '' };
  }

  /** Move playback to the chosen device, once per session (`play` starts it there). */
  async function ensureTarget(deviceId: string, play: boolean): Promise<boolean> {
    if (target) return true;
    const t = await pickDevice(deviceId);
    if (!t) return false;
    await deps.transferPlayback(t.id, play);
    target = t;
    mark(true, t.name);
    return true;
  }

  return {
    async run(intent: DeviceIntent): Promise<Partial<DeviceState>> {
      if (!isSpeakerDevice(intent.deviceId)) return deps.inner.run(intent);
      if (!deps.isConnected()) return builtin(intent, intent.query ? NOT_CONNECTED_NOTICE : undefined);

      if (intent.query) {
        try {
          const t = await pickDevice(intent.deviceId);
          if (!t) return noDevice();
          await deps.transferPlayback(t.id, false);
          target = t;
          mark(true, t.name);
          const { hit } = await deps.searchAndPlay(intent.query, t.id);
          deps.say(spotifyPlayingLine(hit.name, hit.artist, t.name));
          return spotify({ playing: true, trackTitle: hit.name });
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          deps.say(/^No Spotify match/i.test(msg) ? `${msg}.` : `Couldn't play “${intent.query}” on Spotify.`);
          // Nothing played, and no title is made up: the tile just stops.
          return { playing: false, source: 'spotify' };
        }
      }

      try {
        if (intent.next || intent.previous) {
          if (!(await ensureTarget(intent.deviceId, false))) return noDevice();
          const step = intent.next ? deps.next : deps.previous;
          const n = step ? await step() : null;
          return spotify({ playing: true, trackTitle: n?.title ?? '' });
        }
        if (intent.playing === false) {
          if (deps.pause) await deps.pause();
          return spotify({ playing: false });
        }
        if (intent.playing === true) {
          const fresh = !target;
          // First play of the session starts playback on the chosen device;
          // after that Play is a plain resume there.
          if (!(await ensureTarget(intent.deviceId, true))) return noDevice();
          if (!fresh && deps.resume) await deps.resume();
          const np = await deps.nowPlaying?.().catch(() => null);
          deps.say(spotifyPlayingLine(np?.title ?? '', np?.artist, target!.name));
          return spotify({ playing: true, ...(np?.title ? { trackTitle: np.title } : {}) });
        }
        if (intent.volume !== undefined) {
          if (!(await ensureTarget(intent.deviceId, false))) return noDevice();
          if (deps.setVolume) await deps.setVolume(intent.volume);
          return spotify({ volume: intent.volume });
        }
      } catch (err) {
        // Throw so the store restores the previous state and shows its error
        // instead of the tile claiming a change that didn't happen.
        deps.say("Spotify didn't respond.");
        throw err instanceof Error ? err : new Error('Spotify request failed');
      }
      return spotify({});
    },
  };
}
