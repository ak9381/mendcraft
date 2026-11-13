import { describe, expect, it } from 'vitest';
import {
  clampVolume,
  currentTrack,
  initialPlayerState,
  playerReducer,
  playerStatusLabel,
  type PlayerState,
  type Track,
} from '../src/music/player';

const T = (id: string): Track => ({ id, title: id.toUpperCase(), src: `blob:${id}` });
const THREE: Track[] = [T('a'), T('b'), T('c')];

function state(over: Partial<PlayerState> = {}): PlayerState {
  return { ...initialPlayerState(THREE), ...over };
}

describe('initial state', () => {
  it('points at the first track, paused; empty list → index -1', () => {
    expect(initialPlayerState(THREE)).toEqual({ tracks: THREE, index: 0, playing: false, volume: 1 });
    expect(initialPlayerState([]).index).toBe(-1);
  });
});

describe('play / pause / toggle', () => {
  it('toggles and respects an empty playlist', () => {
    expect(playerReducer(state(), { type: 'play' }).playing).toBe(true);
    expect(playerReducer(state({ playing: true }), { type: 'pause' }).playing).toBe(false);
    expect(playerReducer(state({ playing: false }), { type: 'toggle' }).playing).toBe(true);
    const empty = initialPlayerState([]);
    expect(playerReducer(empty, { type: 'play' })).toBe(empty); // no-op, same ref
    expect(playerReducer(empty, { type: 'toggle' })).toBe(empty);
  });
});

describe('next / prev wrap around and start playing', () => {
  it('wraps forward and backward', () => {
    expect(playerReducer(state({ index: 2 }), { type: 'next' })).toMatchObject({ index: 0, playing: true });
    expect(playerReducer(state({ index: 0 }), { type: 'prev' })).toMatchObject({ index: 2, playing: true });
  });
});

describe('select / setVolume', () => {
  it('select switches and plays; out-of-range is ignored', () => {
    expect(playerReducer(state(), { type: 'select', index: 2 })).toMatchObject({ index: 2, playing: true });
    expect(playerReducer(state(), { type: 'select', index: 9 }).index).toBe(0);
    expect(playerReducer(state(), { type: 'select', index: -1 }).index).toBe(0);
  });
  it('clamps volume to 0..1', () => {
    expect(clampVolume(2)).toBe(1);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(NaN)).toBe(1);
    expect(playerReducer(state(), { type: 'setVolume', volume: 0.3 }).volume).toBe(0.3);
  });
});

describe('ended advances', () => {
  it('moves to the next track and keeps playing, wrapping at the end', () => {
    expect(playerReducer(state({ index: 0, playing: true }), { type: 'ended' })).toMatchObject({ index: 1, playing: true });
    expect(playerReducer(state({ index: 2, playing: true }), { type: 'ended' })).toMatchObject({ index: 0, playing: true });
  });
});

describe('load / addTracks', () => {
  it('load resets to first and pauses; addTracks appends without autoplay', () => {
    const loaded = playerReducer(state({ index: 2, playing: true }), { type: 'load', tracks: [T('x')] });
    expect(loaded).toMatchObject({ index: 0, playing: false, tracks: [T('x')] });
    const fromEmpty = playerReducer(initialPlayerState([]), { type: 'addTracks', tracks: [T('y')] });
    expect(fromEmpty).toMatchObject({ index: 0, playing: false });
    const appended = playerReducer(state({ index: 1 }), { type: 'addTracks', tracks: [T('z')] });
    expect(appended.tracks).toHaveLength(4);
    expect(appended.index).toBe(1);
  });
});

describe('helpers', () => {
  it('currentTrack and status label', () => {
    expect(currentTrack(state({ index: 1 }))?.id).toBe('b');
    expect(currentTrack(initialPlayerState([]))).toBeNull();
    expect(playerStatusLabel(state({ index: 0, playing: true }))).toBe('▶ A');
    expect(playerStatusLabel(initialPlayerState([]))).toBe('No track');
  });
});
