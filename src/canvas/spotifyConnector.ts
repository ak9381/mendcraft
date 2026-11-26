// Speaker tile -> Spotify. Wraps the canvas's device connector: when Spotify
// is really connected, EVERY speaker action (play, pause, previous, next,
// volume, "play <query>") goes to Spotify, on the best device its own device
// list offers (see pickSpotifyDevice). The tile's track title is the real
// track's title, never invented, and the tile says where it plays ("Spotify ·
// iPhone"). Spotify NOT connected (or its sign-in gone): nothing plays and she
// is told to connect it — there is no stand-in player on the canvas.
// Connected but no device to play on: nothing plays and she is told how to
// make one show up.
import { DeviceError, type DeviceConnector, type DeviceIntent } from './deviceActions';
import type { DeviceState } from './surfacePlan';
import type { SpotifyDevice, SpotifySearchHit } from '../music/spotifyApi';

/** Said (and shown on the tile) when a speaker press arrives and Spotify is not connected. */
export const SPOTIFY_CONNECT_LINE = "Spotify isn't connected. Connect it, then try again. Nothing changed.";
/** The connector's name for the same line. */
export const NOT_CONNECTED_NOTICE = SPOTIFY_CONNECT_LINE;
/** How long the in-browser player gets to become ready before we give up on it. */
export const BROWSER_DEVICE_MS = 4000;
/** Asking Spotify what plays right after starting it: this many times, this far apart. */
export const NOW_PLAYING_TRIES = 5;
export const NOW_PLAYING_GAP_MS = 600;
export const NO_DEVICE_NOTICE = 'Open Spotify on your phone so it shows up, then try again.';
export const PREMIUM_NOTICE = 'Spotify needs Premium to control playback.';
export const NO_ANSWER_NOTICE = "Spotify didn't respond.";

/** Spotify answers 403 (reason PREMIUM_REQUIRED) when a free account tries to control playback. */
export function isPremiumRequired(err: unknown): boolean {
  // Only when Spotify says so: a bare 403 can also be a restriction on one command.
  const e = err as { reason?: string; message?: string } | null;
  return e?.reason === 'PREMIUM_REQUIRED' || /premium required/i.test(e?.message ?? '');
}
/** The device playback was on is gone (Spotify's NO_ACTIVE_DEVICE) — not any 404. */
export function isDeviceGone(err: unknown): boolean {
  const e = err as { reason?: string; message?: string } | null;
  return e?.reason === 'NO_ACTIVE_DEVICE' || /no active device/i.test(e?.message ?? '');
}
/** The stored sign-in no longer works (revoked, expired refresh token, 401). */
export function isSpotifyAuthFailure(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | null;
  return e?.status === 401 || /invalid_grant|refresh token|revoked|connect spotify first|access token/i.test(e?.message ?? '');
}

export interface SpotifyConnectorDeps {
  inner: DeviceConnector;
  isConnected(): boolean;
  listDevices(): Promise<SpotifyDevice[]>;
  transferPlayback(deviceId: string, play: boolean): Promise<void>;
  searchAndPlay(query: string, deviceId: string): Promise<{ hit: SpotifySearchHit; deviceNote: string }>;
  /** This browser as a Connect device (Web Playback SDK). Return undefined where
   *  it can't run (phone shell / iOS WKWebView) — it is then never offered. */
  browserDevice?(): Promise<string | undefined>;
  /** Test hook: how long the in-browser player gets (default BROWSER_DEVICE_MS). */
  browserDeviceMs?: number;
  /** Test hooks for settledNowPlaying (defaults NOW_PLAYING_TRIES / NOW_PLAYING_GAP_MS). */
  nowPlayingTries?: number;
  nowPlayingGapMs?: number;
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

/** "Playing Blue in Green on iPhone via Spotify." / "Playing." — what plays
 *  (when known) and where, never a made-up title or player. */
export function playingLine(where: MusicWhere | null | undefined, title?: string): string {
  const what = title?.trim() ? `Playing ${title.trim()}` : 'Playing';
  if (where?.spotify) return `${what} on ${where.target || 'Spotify'} via Spotify.`;
  return `${what}.`;
}

/** The one speaker a Spotify sign-in gives this canvas (registered only while connected). */
export const SPOTIFY_SPEAKER_ID = 'speaker-spotify';
export const SPOTIFY_SPEAKER_LABEL = 'Speaker';

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
    // The in-browser player can hang (it never becomes ready): give it a few
    // seconds, then say how to fix it instead of a bare "couldn't reach".
    const browserId = deps.browserDevice
      ? await Promise.race([
        deps.browserDevice().catch(() => undefined),
        new Promise<undefined>((r) => setTimeout(() => r(undefined), deps.browserDeviceMs ?? BROWSER_DEVICE_MS)),
      ])
      : undefined;
    return browserId ? { id: browserId, name: 'this browser' } : null;
  }

  const mark = (spotify: boolean, where = ''): void => { if (deps.status) { deps.status.spotify = spotify; deps.status.target = where; } };
  const spotify = (extra: Partial<DeviceState>): Partial<DeviceState> => ({ ...extra, source: 'spotify', playingOn: target?.name ?? '', sim: false });

  /** Connected, but Spotify has nowhere to play: say how to fix it. Nothing
   *  plays in its place. */
  function noDevice(): Partial<DeviceState> {
    target = null;
    mark(false);
    deps.say(NO_DEVICE_NOTICE);
    return { playing: false, source: 'spotify', playingOn: '' };
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

  /** Right after a transfer Spotify still answers "nothing playing" for a
   *  moment: ask again a few times before giving up on the title. */
  async function settledNowPlaying(): Promise<{ title: string; artist?: string } | null> {
    if (!deps.nowPlaying) return null;
    const tries = deps.nowPlayingTries ?? NOW_PLAYING_TRIES;
    for (let i = 0; i < tries; i++) {
      const np = await deps.nowPlaying().catch(() => null);
      if (np?.title) return np;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, deps.nowPlayingGapMs ?? NOW_PLAYING_GAP_MS));
    }
    return null;
  }

  /** One speaker action on Spotify. Throws what Spotify threw. */
  async function transport(intent: DeviceIntent): Promise<Partial<DeviceState>> {
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
      const np = await settledNowPlaying();
      deps.say(spotifyPlayingLine(np?.title ?? '', np?.artist, target!.name));
      // What Spotify says is playing, or no title at all.
      return spotify({ playing: true, trackTitle: np?.title ?? '' });
    }
    if (intent.volume !== undefined) {
      if (!(await ensureTarget(intent.deviceId, false))) return noDevice();
      if (deps.setVolume) await deps.setVolume(intent.volume);
      return spotify({ volume: intent.volume });
    }
    return spotify({});
  }

  /** Say it, and throw it: the store restores the tile and shows this reason. */
  function refuse(message: string): never {
    deps.say(message);
    throw new DeviceError(message);
  }
  /** The stored sign-in stopped working: as good as not connected. */
  function signedOut(): never {
    target = null;
    mark(false);
    refuse(SPOTIFY_CONNECT_LINE);
  }

  return {
    async run(intent: DeviceIntent): Promise<Partial<DeviceState>> {
      if (!isSpeakerDevice(intent.deviceId)) return deps.inner.run(intent);
      // Not connected: nothing plays, nothing changes, she is told to connect it.
      if (!deps.isConnected()) { target = null; mark(false); refuse(SPOTIFY_CONNECT_LINE); }

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
          // The sign-in is gone: that is "not connected".
          if (isSpotifyAuthFailure(err)) signedOut();
          if (isPremiumRequired(err)) refuse(PREMIUM_NOTICE);
          if (isDeviceGone(err)) return noDevice();
          const msg = err instanceof Error ? err.message : '';
          deps.say(/^No Spotify match/i.test(msg) ? `${msg}.` : `Couldn't play “${intent.query}” on Spotify.`);
          // Nothing played, and no title is made up: the tile just stops.
          return { playing: false, source: 'spotify' };
        }
      }

      try {
        return await transport(intent);
      } catch (first) {
        let err: unknown = first;
        // The chosen device went away (a sleeping phone answers 404 "no active
        // device"): forget it, pick again from Spotify's list as it is NOW and
        // try once more. Still nothing to play on: say how to fix it.
        if (isDeviceGone(err)) {
          target = null;
          mark(false);
          try {
            return await transport(intent);
          } catch (second) {
            if (isDeviceGone(second)) return noDevice();
            err = second;
          }
        }
        if (isSpotifyAuthFailure(err)) signedOut();
        if (isPremiumRequired(err)) refuse(PREMIUM_NOTICE);
        refuse(NO_ANSWER_NOTICE);
      }
    },
  };
}
