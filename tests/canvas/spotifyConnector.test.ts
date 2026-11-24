import { describe, expect, it, vi } from 'vitest';
import { createDeviceStore } from '../../src/canvas/deviceActions';
import { listDevices } from '../../src/music/spotifyApi';
import { createSpotifyAwareConnector, NOT_CONNECTED_NOTICE, spotifySearchQuery } from '../../src/canvas/spotifyConnector';
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

  it('no Marshall and no browser device (phone shell): built-in + notice', async () => {
    const r = rig({ listDevices: async () => [], browserDevice: async () => undefined });
    const ack = await r.c.run({ deviceId: 'speaker-1', playing: true, query: 'jazz' });
    expect(r.calls).toEqual([]);
    expect(ack.trackTitle).toBe('Built-in');
    expect(r.said).toHaveLength(1);
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
    expect(ack).toEqual({ playing: false });
    expect(ack).not.toHaveProperty('trackTitle');
    expect(r.said[0]).toMatch(/No Spotify match/);
  });

  it('non-speaker devices pass straight through', async () => {
    const r = rig();
    await r.c.run({ deviceId: 'wiz-desk', on: true });
    expect(r.inner.run).toHaveBeenCalledOnce();
    expect(r.calls).toEqual([]);
  });

  it('transport goes to Spotify only after this connector started a Spotify play', async () => {
    const pause = vi.fn(async () => {});
    const r = rig({ pause });
    await r.c.run({ deviceId: 'speaker-1', playing: false });
    expect(pause).not.toHaveBeenCalled();
    await r.c.run({ deviceId: 'speaker-1', playing: true, query: 'jazz' });
    expect(await r.c.run({ deviceId: 'speaker-1', playing: false })).toEqual({ playing: false });
    expect(pause).toHaveBeenCalledOnce();
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
    expect(await r.c.run({ deviceId: 'speaker-1', next: true })).toEqual({ playing: true, trackTitle: '' });
  });

  it('no-device fallback says so and uses the built-in player', async () => {
    const r = rig({ listDevices: async () => { throw new Error('x'); }, browserDevice: undefined });
    const ack = await r.c.run({ deviceId: 'speaker-1', playing: true, query: 'jazz' });
    expect(r.said[0]).toBe('No Spotify speaker or browser player is available — playing the built-in track.');
    expect(ack.trackTitle).toBe('Built-in');
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
