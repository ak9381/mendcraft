// Music controller — binds the pure reducer (player.ts) to one HTMLAudioElement.
// It owns the <audio> side effects (src, play/pause, volume, ended) and emits a
// state on every change so a UI can render and the relay can publish it. Kept
// thin: all decisions live in the tested reducer.

import {
  currentTrack,
  initialPlayerState,
  playerReducer,
  type PlayerAction,
  type PlayerState,
  type Track,
} from './player';

export interface MusicController {
  state(): PlayerState;
  dispatch(action: PlayerAction): void;
  onChange(cb: (state: PlayerState) => void): void;
  destroy(): void;
}

export function createMusicController(
  audio: HTMLAudioElement,
  initialTracks: Track[] = [],
): MusicController {
  let state = initialPlayerState(initialTracks);
  let changeCb: ((s: PlayerState) => void) | null = null;

  function emit(): void {
    changeCb?.(state);
  }

  // Reflect reducer state onto the <audio>. Only touch the element when the
  // relevant field actually changed, so we don't restart playback needlessly.
  function sync(prev: PlayerState): void {
    const track = currentTrack(state);
    const prevTrack = prev.index >= 0 ? prev.tracks[prev.index] : null;
    if (track && track.src !== prevTrack?.src) {
      audio.src = track.src;
    } else if (!track && audio.src) {
      audio.removeAttribute('src');
      audio.load();
    }
    if (state.volume !== prev.volume) audio.volume = state.volume;
    if (state.playing) {
      // play() can reject (autoplay policy / load error) — surface as paused.
      void audio.play().catch(() => {
        if (state.playing) apply({ type: 'pause' });
      });
    } else if (!audio.paused) {
      audio.pause();
    }
  }

  function apply(action: PlayerAction): void {
    const prev = state;
    const next = playerReducer(state, action);
    if (next === prev) return;
    state = next;
    sync(prev);
    emit();
  }

  const onEnded = () => apply({ type: 'ended' });
  audio.addEventListener('ended', onEnded);

  return {
    state: () => state,
    dispatch: apply,
    onChange(cb) {
      changeCb = cb;
      cb(state);
    },
    destroy() {
      audio.removeEventListener('ended', onEnded);
      audio.pause();
      changeCb = null;
    },
  };
}
