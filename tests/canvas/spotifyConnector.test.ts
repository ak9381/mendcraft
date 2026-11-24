import { describe, expect, it, vi } from 'vitest';
import { createSpotifyAwareConnector, NOT_CONNECTED_NOTICE } from '../../src/canvas/spotifyConnector';
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
