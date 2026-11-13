// Music player — PURE state reducer, no DOM and no <audio>. The controller
// (musicController.ts) binds this to an HTMLAudioElement; this module is the
// fully-tested brain: a playlist, a cursor, play/pause, next/prev (wrap-around),
// and volume. Deterministic over its input, so every transition is unit-tested.

export interface Track {
  id: string;
  title: string;
  artist?: string;
  /** Audio source: an https URL (streamed) or an object URL for a local file. */
  src: string;
  /** True for user-picked local files (object URLs) — shown as "on this device". */
  local?: boolean;
}

export interface PlayerState {
  tracks: Track[];
  /** Index of the current track, or -1 when the playlist is empty. */
  index: number;
  playing: boolean;
  /** 0..1 */
  volume: number;
}

export type PlayerAction =
  | { type: 'load'; tracks: Track[] }
  | { type: 'addTracks'; tracks: Track[] }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'select'; index: number }
  | { type: 'setVolume'; volume: number }
  /** The <audio> reached the end of the current track. */
  | { type: 'ended' };

export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

export function initialPlayerState(tracks: Track[] = []): PlayerState {
  return { tracks, index: tracks.length ? 0 : -1, playing: false, volume: 1 };
}

/** Wrap an index into [0, len) — keeps next/prev cyclic on a non-empty list. */
function wrap(i: number, len: number): number {
  if (len <= 0) return -1;
  return ((i % len) + len) % len;
}

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  const len = state.tracks.length;
  switch (action.type) {
    case 'load': {
      const tracks = action.tracks.slice();
      return { ...state, tracks, index: tracks.length ? 0 : -1, playing: false };
    }
    case 'addTracks': {
      if (!action.tracks.length) return state;
      const tracks = state.tracks.concat(action.tracks);
      // First tracks added to an empty list become the cursor but don't auto-play.
      return { ...state, tracks, index: state.index < 0 ? 0 : state.index };
    }
    case 'play':
      return len ? { ...state, playing: true } : state;
    case 'pause':
      return { ...state, playing: false };
    case 'toggle':
      return len ? { ...state, playing: !state.playing } : state;
    case 'next':
      return len ? { ...state, index: wrap(state.index + 1, len), playing: true } : state;
    case 'prev':
      return len ? { ...state, index: wrap(state.index - 1, len), playing: true } : state;
    case 'select': {
      if (!len || action.index < 0 || action.index >= len) return state;
      return { ...state, index: action.index, playing: true };
    }
    case 'setVolume':
      return { ...state, volume: clampVolume(action.volume) };
    case 'ended':
      // Advance and keep playing (wraps to the top at the end of the list).
      return len ? { ...state, index: wrap(state.index + 1, len), playing: true } : state;
    default:
      return state;
  }
}

export function currentTrack(state: PlayerState): Track | null {
  if (state.index < 0 || state.index >= state.tracks.length) return null;
  return state.tracks[state.index];
}

/** One-line status for a now-playing row / the control-room snapshot. */
export function playerStatusLabel(state: PlayerState): string {
  const t = currentTrack(state);
  if (!t) return 'No track';
  const who = t.artist ? ` — ${t.artist}` : '';
  return `${state.playing ? '▶' : '❚❚'} ${t.title}${who}`;
}

// A small built-in playlist of freely-licensed recordings. These STREAM from the
// Internet Archive (public-domain / CC0 performances), so they need a network;
// the remote's "Add tracks" picker loads local files that play fully offline.
export const DEFAULT_TRACKS: Track[] = [
  {
    id: 'pd-gymnopedie',
    title: 'Gymnopédie No. 1',
    artist: 'Erik Satie (public domain)',
    src: 'https://archive.org/download/ErikSatie_201303/01Gymnopdie1.mp3',
  },
  {
    id: 'pd-moonlight',
    title: 'Moonlight Sonata (1st mvt)',
    artist: 'Beethoven (public domain)',
    src: 'https://archive.org/download/MoonlightSonata_755/Beethoven-MoonlightSonata.mp3',
  },
  {
    id: 'pd-clair-de-lune',
    title: 'Clair de Lune',
    artist: 'Debussy (public domain)',
    src: 'https://archive.org/download/ClairDeLune_755/ClairDeLune.mp3',
  },
];
