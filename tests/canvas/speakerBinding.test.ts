// The speaker tile through the checked binding: a music leaf is a generated
// DeviceTile; a press is resolved against the approved plan and the store;
// the speaker is played only by Spotify (fixed code), never by a silent
// built-in stand-in.
import { describe, expect, it } from 'vitest';
import { reduceA2uiMessages, renderNodeToDom, type RenderNode } from '../../src/canvas/fallbackRenderer';
import { CATALOG_SCHEMAS } from '../../src/canvas/catalogApi';
import { gateMessages } from '../../src/canvas/gate';
import { expandPlan, type DeviceState, type SurfacePlan } from '../../src/canvas/surfacePlan';
import { NOT_CONNECTED_REFUSAL, bindingIntent, pressIntent, standardControls } from '../../src/canvas/controlSpec';
import { VOLUME_RANGE_REFUSAL } from '../../src/canvas/deviceGuard';
import { DeviceError, type DeviceIntent } from '../../src/canvas/deviceActions';
import { SPOTIFY_CONNECT_LINE, createSpotifyAwareConnector } from '../../src/canvas/spotifyConnector';

interface FakeEl { tagName: string; textContent: string; children: FakeEl[]; attrs: Record<string, string> }
function fakeDoc(): Document {
  const create = (tag: string): FakeEl => {
    let text = '';
    const el = {
      tagName: tag.toUpperCase(), className: '', style: {}, children: [] as FakeEl[], attrs: {} as Record<string, string>,
      setAttribute(n: string, v: string) { el.attrs[n] = v; },
      appendChild(c: FakeEl) { el.children.push(c); return c; },
      addEventListener() { /* no events needed */ },
    } as unknown as FakeEl;
    Object.defineProperty(el, 'textContent', { get: () => text, set: (v: string) => { text = v; } });
    return el;
  };
  return { createElement: create } as unknown as Document;
}
const textOf = (el: FakeEl): string => [el.textContent, ...el.children.map(textOf)].join(' ');

const ID = 'speaker-spotify';
const TILE = `music-${ID}`;
const PLAIN: SurfacePlan = { kind: 'room', title: 'Music', tiles: [{ type: 'music', deviceId: ID, label: 'Speaker' }] };
const WITH_READOUT: SurfacePlan = {
  kind: 'room', title: 'Music', tiles: [{
    type: 'music', deviceId: ID, label: 'Speaker', controls: [
      { kind: 'readout', label: 'Now playing', show: 'trackTitle' },
      { kind: 'toggle', label: 'Play', intent: { playing: 'toggle' } },
    ],
  }],
};
const paused: DeviceState = { cls: 'music', on: false, brightness: 0, playing: false, volume: 50, source: 'spotify' };
const playing: DeviceState = { ...paused, playing: true, trackTitle: 'Blue in Green' };

function tileComp(plan: SurfacePlan, devices: Record<string, DeviceState>): Record<string, unknown> {
  const msgs = expandPlan(plan, 'f1', devices, { heading: false });
  const comps = (msgs[1] as { updateComponents: { components: Record<string, unknown>[] } }).updateComponents.components;
  return comps.find((c) => c.component === 'DeviceTile')!;
}
function tileNode(plan: SurfacePlan, devices: Record<string, DeviceState>): RenderNode {
  const { trees } = reduceA2uiMessages(undefined, expandPlan(plan, 'f1', devices, { heading: false }) as never);
  return Object.values(trees.f1.nodesById).find((n) => n.component === 'DeviceTile')!;
}

describe('speaker tile through the binding', () => {
  it('a music leaf expands to one DeviceTile with cls music and the gate accepts it', () => {
    const msgs = expandPlan(PLAIN, 'f1', { [ID]: paused });
    expect(gateMessages(msgs, CATALOG_SCHEMAS).ok).toBe(true);
    const comp = tileComp(PLAIN, { [ID]: paused });
    expect(comp).toMatchObject({ cls: 'music', deviceId: ID, standard: true, controls: standardControls('music') });
    expect(comp.onAct).toEqual({ event: { name: 'device.act', context: { deviceId: ID, tile: TILE } } });
    expect(JSON.stringify(msgs)).not.toContain('MusicTile');
  });

  it('playing toggle gives { playing: true } when paused and { playing: false } when playing', () => {
    expect(bindingIntent('music', ID, { playing: 'toggle' }, paused)).toEqual({ intent: { deviceId: ID, playing: true } });
    expect(bindingIntent('music', ID, { playing: 'toggle' }, playing)).toEqual({ intent: { deviceId: ID, playing: false } });
    // The same through a press on the standard tile (control 0 is play / pause).
    expect(pressIntent(PLAIN, { tile: TILE, control: 0 }, () => paused)).toMatchObject({ intent: { deviceId: ID, playing: true } });
  });

  it('volume $value 101 is refused with VOLUME_RANGE_REFUSAL', () => {
    expect(bindingIntent('music', ID, { volume: '$value' }, paused, 101)).toEqual({ refusal: VOLUME_RANGE_REFUSAL });
    expect(pressIntent(PLAIN, { tile: TILE, control: 1, value: 101 }, () => paused)).toMatchObject({ refusal: VOLUME_RANGE_REFUSAL });
    expect(pressIntent(PLAIN, { tile: TILE, control: 1, value: 30 }, () => paused)).toMatchObject({ intent: { deviceId: ID, volume: 30 } });
  });

  it('next and previous buttons give { next: true } and { previous: true }', () => {
    const get = () => playing;
    expect(pressIntent(PLAIN, { tile: TILE, control: 2 }, get)).toMatchObject({ intent: { deviceId: ID, previous: true } });
    expect(pressIntent(PLAIN, { tile: TILE, control: 3 }, get)).toMatchObject({ intent: { deviceId: ID, next: true } });
    expect(bindingIntent('music', ID, { next: true }, playing)).toEqual({ intent: { deviceId: ID, next: true } });
    expect(bindingIntent('music', ID, { previous: true }, playing)).toEqual({ intent: { deviceId: ID, previous: true } });
  });

  it('a readout with show trackTitle binds to /devices/<id>/trackTitle', () => {
    const comp = tileComp(WITH_READOUT, { [ID]: playing });
    expect(comp.trackTitle).toEqual({ path: `/devices/${ID}/trackTitle` });
    expect(comp.playingOn).toEqual({ path: `/devices/${ID}/playingOn` });
    expect(comp.source).toEqual({ path: `/devices/${ID}/source` });
    expect(gateMessages(expandPlan(WITH_READOUT, 'f1', { [ID]: playing }), CATALOG_SCHEMAS).ok).toBe(true);
    const el = renderNodeToDom(tileNode(WITH_READOUT, { [ID]: playing }), fakeDoc()) as unknown as FakeEl;
    expect(textOf(el)).toContain('Blue in Green');
  });

  it('with Spotify not connected a press says SPOTIFY_CONNECT_LINE and the tile shows no fake track', async () => {
    expect(SPOTIFY_CONNECT_LINE).toBe("Spotify isn't connected. Connect it, then try again. Nothing changed.");
    // No speaker in the store: the press is refused with the line, no intent.
    const none = () => undefined;
    expect(pressIntent(PLAIN, { tile: TILE, control: 0 }, none, { spotifyConnected: () => false })).toEqual({ refusal: SPOTIFY_CONNECT_LINE, deviceId: ID });
    // Spotify connected but this speaker is not here (another laptop's board): not connected.
    expect(pressIntent(PLAIN, { tile: TILE, control: 0 }, none, { spotifyConnected: () => true })).toMatchObject({ refusal: NOT_CONNECTED_REFUSAL });
    // The tile: "Not connected", and no track title of any kind.
    const comp = tileComp(WITH_READOUT, {});
    const el = renderNodeToDom(tileNode(WITH_READOUT, {}), fakeDoc()) as unknown as FakeEl;
    const text = textOf(el);
    expect(text).toContain('Not connected');
    expect(text).not.toMatch(/Morning light|Monsoon raga|Built-in/i);
    expect(comp).toMatchObject({ cls: 'music' });
    // The connector never plays a stand-in: it says the line and changes nothing.
    const said: string[] = [];
    const inner: DeviceIntent[] = [];
    const c = createSpotifyAwareConnector({
      inner: { run: async (i) => { inner.push(i); return { playing: true, trackTitle: 'Stand-in' }; } },
      isConnected: () => false,
      listDevices: async () => [], transferPlayback: async () => undefined,
      searchAndPlay: async () => { throw new Error('not called'); },
      say: (t) => said.push(t),
    });
    for (const i of [{ deviceId: ID, playing: true }, { deviceId: ID, playing: true, query: 'monsoon raga' }, { deviceId: ID, next: true }] as DeviceIntent[]) {
      await expect(c.run(i)).rejects.toBeInstanceOf(DeviceError);
    }
    expect(inner).toEqual([]);
    expect(said).toEqual([SPOTIFY_CONNECT_LINE, SPOTIFY_CONNECT_LINE, SPOTIFY_CONNECT_LINE]);
  });
});
