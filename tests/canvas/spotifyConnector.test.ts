import { describe, expect, it, vi } from 'vitest';
import { createDeviceStore } from '../../src/canvas/deviceActions';
import { listDevices } from '../../src/music/spotifyApi';
import { BUILTIN_LABEL, createSpotifyAwareConnector, NO_DEVICE_NOTICE, NOT_CONNECTED_NOTICE, pickSpotifyDevice, spotifyPlayingLine, spotifySearchQuery } from '../../src/canvas/spotifyConnector';
import type { DeviceConnector } from '../../src/canvas/deviceActions';

function rig(over: Partial<Parameters<typeof createSpotifyAwareConnector>[0]> = {}) {
  const calls: string[] = [];
  const said: string[] = [];
  const inner: DeviceConnector = { run: vi.fn(async () => ({ playing: true, trackTitle: 'Built-in' })) };
  const deps = {
    inner,
    isConnected: () => true,
    listDevices: async () => [
      { id: 'd-phone', name: 'iPhone', type: 'Smartphone', isActive: true, volume: 0.5 },
      { id: 'd-mar', name: 'Marshall Stanmore II', type: 'Speaker', isActive: false, volume: 0.4 },
    ],
    transferPlayback: async (id: string, play: boolean) => { calls.push(`transfer:${id}:${play}`); },
    searchAndPlay: async (q: string, id: string) => {
      calls.push(`play:${q}:${id}`);
      return { hit: { kind: 'track' as const, id: 't', uri: 'spotify:track:t', name: 'Real Title', artist: 'Real Artist' }, deviceNote: '' };
    },
    browserDevice: async () => 'd-browser' as string | undefined,
    say: (t: string) => { said.push(t); },
    ...over,
  };
  return { c: createSpotifyAwareConnector(deps), calls, said, inner };
}

describe('createSpotifyAwareConnector', () => {
  it('connected + Marshall present: transfers (no autoplay) then plays, real title', async () => {
    const r = rig();
    const ack = await r.c.run({ deviceId: 'speaker-1', playing: true, query: 'jazz' });
    expect(r.calls).toEqual(['transfer:d-mar:false', 'play:jazz:d-mar']);
    expect(ack).toMatchObject({ playing: true, trackTitle: 'Real Title', sim: false });
    expect(r.inner.run).not.toHaveBeenCalled();
  });

  it('no Marshall: uses the browser device', async () => {
    const r = rig({ listDevices: async () => [] });
    await r.c.run({ deviceId: 'speaker-1', playing: true, query: 'jazz' });
    expect(r.calls).toEqual(['transfer:d-browser:false', 'play:jazz:d-browser']);
  });

  it('connected, empty device list and no browser player: says how to fix it — never silent built-in playback', async () => {
    const r = rig({ listDevices: async () => [], browserDevice: async () => undefined });
    const ack = await r.c.run({ deviceId: 'speaker-1', playing: true, query: 'jazz' });
    expect(r.calls).toEqual([]);
    expect(r.inner.run).not.toHaveBeenCalled();
    expect(ack).toEqual({ playing: false, source: 'spotify', playingOn: '' });
    expect(r.said).toEqual([NO_DEVICE_NOTICE]);
    expect(NO_DEVICE_NOTICE).toBe('Open Spotify on your phone so it shows up, then try again.');
  });

  it('not connected: inner built-in player + the exact notice, no Spotify calls', async () => {
    const r = rig({ isConnected: () => false });
    const ack = await r.c.run({ deviceId: 'speaker-1', playing: true, query: 'jazz' });
    expect(r.calls).toEqual([]);
    expect(r.said).toEqual([NOT_CONNECTED_NOTICE]);
    expect(ack.trackTitle).toBe('Built-in');
    expect(vi.mocked(r.inner.run).mock.calls[0][0]).not.toHaveProperty('query');
  });

  it('search miss: notice, no fake title, playing false', async () => {
    const r = rig({ searchAndPlay: async () => { throw new Error('No Spotify match for “zzz”'); } });
    const ack = await r.c.run({ deviceId: 'speaker-1', playing: true, query: 'zzz' });
    expect(ack).toEqual({ playing: false, source: 'spotify' });
    expect(ack).not.toHaveProperty('trackTitle');
    expect(r.said[0]).toMatch(/No Spotify match/);
  });

  it('non-speaker devices pass straight through', async () => {
    const r = rig();
    await r.c.run({ deviceId: 'wiz-desk', on: true });
    expect(r.inner.run).toHaveBeenCalledOnce();
    expect(r.calls).toEqual([]);
  });

  it('connected: every transport press goes to Spotify, never the built-in player', async () => {
    const pause = vi.fn(async () => {});
    const resume = vi.fn(async () => {});
    const setVolume = vi.fn(async () => {});
    const r = rig({ pause, resume, setVolume, nowPlaying: async () => ({ title: 'Blue in Green', artist: 'Miles Davis' }) });
    // Play with no search: playback moves to the chosen device and starts there.
    const play = await r.c.run({ deviceId: 'speaker-1', playing: true });
    expect(r.calls).toEqual(['transfer:d-mar:true']);
    expect(play).toMatchObject({ playing: true, trackTitle: 'Blue in Green', source: 'spotify', playingOn: 'Marshall Stanmore II' });
    expect(r.said.at(-1)).toBe('Playing Blue in Green by Miles Davis on Marshall Stanmore II via Spotify.');
    expect(await r.c.run({ deviceId: 'speaker-1', playing: false })).toMatchObject({ playing: false, source: 'spotify' });
    expect(pause).toHaveBeenCalledOnce();
    // Play again: a plain resume on the same device, no second transfer.
    await r.c.run({ deviceId: 'speaker-1', playing: true });
    expect(resume).toHaveBeenCalledOnce();
    expect(r.calls).toEqual(['transfer:d-mar:true']);
    expect(await r.c.run({ deviceId: 'speaker-1', volume: 80 })).toMatchObject({ volume: 80, source: 'spotify' });
    expect(setVolume).toHaveBeenCalledWith(80);
    expect(r.inner.run).not.toHaveBeenCalled();
  });

  it('previous / next go to Spotify and bring back the real title', async () => {
    const r = rig({ next: async () => ({ title: 'Next One' }), previous: async () => ({ title: 'Earlier One' }) });
    expect(await r.c.run({ deviceId: 'speaker-1', next: true })).toMatchObject({ playing: true, trackTitle: 'Next One', source: 'spotify' });
    expect(await r.c.run({ deviceId: 'speaker-1', previous: true })).toMatchObject({ playing: true, trackTitle: 'Earlier One' });
    expect(r.inner.run).not.toHaveBeenCalled();
  });

  it('not connected: transport uses the built-in player, labelled as such', async () => {
    const r = rig({ isConnected: () => false });
    const ack = await r.c.run({ deviceId: 'speaker-1', playing: true });
    expect(ack).toMatchObject({ playing: true, source: 'builtin', playingOn: '' });
    expect(r.calls).toEqual([]);
    expect(BUILTIN_LABEL).toBe('Built-in player — Spotify not connected');
  });
});

describe('spotifyAware connector — fixes', () => {
  it('transport failure throws (store restores state) and says so', async () => {
    const r = rig({ pause: async () => { throw new Error('boom'); } });
    await r.c.run({ deviceId: 'speaker-1', playing: true, query: 'jazz' });
    await expect(r.c.run({ deviceId: 'speaker-1', playing: false })).rejects.toThrow('boom');
    expect(r.said.at(-1)).toBe("Spotify didn't respond.");
  });

  it('next() without a title clears trackTitle', async () => {
    const r = rig({ next: async () => null });
    await r.c.run({ deviceId: 'speaker-1', playing: true, query: 'jazz' });
    expect(await r.c.run({ deviceId: 'speaker-1', next: true })).toMatchObject({ playing: true, trackTitle: '' });
  });

  it('the device list failing with no browser player: same honest notice, nothing plays', async () => {
    const r = rig({ listDevices: async () => { throw new Error('x'); }, browserDevice: undefined });
    const ack = await r.c.run({ deviceId: 'speaker-1', playing: true });
    expect(r.said[0]).toBe(NO_DEVICE_NOTICE);
    expect(ack.playing).toBe(false);
    expect(r.inner.run).not.toHaveBeenCalled();
  });

  it('a slow Spotify play (>3s) still lands on the tile; a failure reverts it', async () => {
    vi.useFakeTimers();
    try {
      const mk = (fail: boolean) => {
        const slow = rig({
          searchAndPlay: () => new Promise((res, rej) => setTimeout(() => (fail
            ? rej(new Error('No Spotify match for “q”'))
            : res({ hit: { kind: 'track' as const, id: 't', uri: 'u', name: 'Slow Song' }, deviceNote: '' })), 5000)),
        });
        const store = createDeviceStore(
          { 'speaker-1': { on: false, brightness: 0, playing: false, trackTitle: 'Morning light', volume: 40 } },
          slow.c, () => {}, () => null,
        );
        return store.act({ deviceId: 'speaker-1', playing: true, query: 'q' });
      };
      const okP = mk(false);
      await vi.advanceTimersByTimeAsync(6000);
      expect(await okP).toMatchObject({ playing: true, trackTitle: 'Slow Song', error: '' });
      const badP = mk(true);
      await vi.advanceTimersByTimeAsync(6000);
      const bad = await badP;
      expect(bad.playing).toBe(false);
      expect(bad.trackTitle).toBe('Morning light');
    } finally { vi.useRealTimers(); }
  });
});

describe('which Spotify device plays (a fake Spotify device list)', () => {
  const dev = (id: string, name: string, type: string, isActive = false) => ({ id, name, type, isActive, volume: 0.5 });

  it('prefers a device named like the speaker (its tile name, or a Marshall / Uxbridge)', () => {
    const list = [dev('a', 'MacBook Pro', 'Computer', true), dev('b', 'iPhone', 'Smartphone'), dev('c', 'Uxbridge Voice', 'Speaker')];
    expect(pickSpotifyDevice(list, 'Speaker')?.id).toBe('c');
    expect(pickSpotifyDevice([...list, dev('d', 'Kitchen Sonos', 'Speaker')], 'Kitchen speaker')?.id).toBe('d');
  });

  it('then the active device, then a phone, then anything listed', () => {
    expect(pickSpotifyDevice([dev('b', 'iPhone', 'Smartphone'), dev('a', 'MacBook Pro', 'Computer', true)], 'Speaker')?.id).toBe('a');
    expect(pickSpotifyDevice([dev('a', 'MacBook Pro', 'Computer'), dev('b', 'iPhone', 'Smartphone')], 'Speaker')?.id).toBe('b');
    expect(pickSpotifyDevice([dev('a', 'MacBook Pro', 'Computer'), dev('t', 'Living room TV', 'TV')], 'Speaker')?.id).toBe('a');
    expect(pickSpotifyDevice([], 'Speaker')).toBeNull();
  });

  it('the speaker is on the iPhone\'s Bluetooth, so Spotify lists only "iPhone": play goes there and says so', async () => {
    const r = rig({
      listDevices: async () => [{ id: 'd-phone', name: 'iPhone', type: 'Smartphone', isActive: false, volume: 0.5 }],
      speakerName: () => 'Marshall speaker',
    });
    const ack = await r.c.run({ deviceId: 'speaker-1', playing: true, query: 'jazz' });
    // Transfer to the chosen device BEFORE the play call.
    expect(r.calls).toEqual(['transfer:d-phone:false', 'play:jazz:d-phone']);
    expect(ack).toMatchObject({ playing: true, trackTitle: 'Real Title', source: 'spotify', playingOn: 'iPhone' });
    expect(r.said).toEqual(['Playing Real Title by Real Artist on iPhone via Spotify.']);
    expect(r.inner.run).not.toHaveBeenCalled();
  });

  it('this browser is used only when Spotify lists no device at all', async () => {
    const r = rig({ listDevices: async () => [] });
    const ack = await r.c.run({ deviceId: 'speaker-1', playing: true, query: 'jazz' });
    expect(r.calls).toEqual(['transfer:d-browser:false', 'play:jazz:d-browser']);
    expect(ack.playingOn).toBe('this browser');
  });

  it('spotifyPlayingLine names the track, the artist and the device', () => {
    expect(spotifyPlayingLine('Song', undefined, 'iPhone')).toBe('Playing Song on iPhone via Spotify.');
    expect(spotifyPlayingLine('', undefined, 'iPhone')).toBe('Playing Spotify on iPhone via Spotify.');
  });
});

describe('spotifySearchQuery routing', () => {
  it('searches only when connected and the query is music-like', () => {
    expect(spotifySearchQuery('jazz', true)).toBe('jazz');
    expect(spotifySearchQuery('jazz', false)).toBeNull();
    for (const q of ['the floor plan in 3D', 'with the layout', 'next song', 'it', 'something', 'previous song', 'again', 'my board']) {
      expect(spotifySearchQuery(q, true), q).toBeNull();
    }
  });
});

describe('spotify api ledger hook', () => {
  it('records path only, never the bearer token', async () => {
    const seen: string[] = [];
    await listDevices({
      accessToken: 'SECRET-TOKEN',
      fetchImpl: (async () => ({ ok: true, status: 200, text: async () => '{"devices":[]}' })) as never,
      onCall: (i) => { seen.push(JSON.stringify(i)); },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('"job":"spotify"');
    expect(seen[0]).not.toContain('SECRET-TOKEN');
  });
});
