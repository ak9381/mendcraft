// @vitest-environment happy-dom
// The demo dashboard, proven without touching a device: "build the dashboard"
// (the journey's recorded replies) gives a lamp, a speaker and a gimbal tile;
// every press on those tiles is followed down to what would go out — the
// WiZ bridge's /setPilot params, the Spotify Web API calls on the Marshall,
// the gimbal relay message to the iPhone. All fakes: no lamp, speaker or
// stand moves.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { mountCanvas, type CanvasHandle } from '../../src/canvas/canvasApp';
import { createReplayEngines } from '../../src/canvas/replayEngine';
import { createWizAwareConnector } from '../../src/canvas/wizDevices';
import { createWizClient } from '../../src/devices/wizClient';
import { createSpotifyAwareConnector } from '../../src/canvas/spotifyConnector';
import * as spotifyApi from '../../src/music/spotifyApi';
import type { DeviceIntent } from '../../src/canvas/deviceActions';

function replies() {
  const out: Record<string, string> = {}; const recorded: string[] = []; const liveShape: string[] = [];
  for (const f of readdirSync('tests/fixtures/replies')) {
    if (!f.endsWith('.json')) continue;
    const r = JSON.parse(readFileSync(`tests/fixtures/replies/${f}`, 'utf8')) as { reply: string; source?: string; shape?: string };
    const k = f.slice(0, -5);
    out[k] = r.reply;
    if (r.source === 'recorded') recorded.push(k);
    if (r.source === 'recorded' || r.shape === 'live') liveShape.push(k);
  }
  return createReplayEngines(out, { recorded, liveShape });
}

let handle: CanvasHandle | null = null;
let root: HTMLElement;
afterEach(() => { handle?.destroy(); handle = null; document.body.innerHTML = ''; });

/** Every tile press, as the device store hands it to its connector. */
const acts: DeviceIntent[] = [];
async function dashboard(): Promise<CanvasHandle> {
  acts.length = 0;
  if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  root = document.createElement('div');
  document.body.append(root);
  handle = mountCanvas(root, {
    autoHands: false, reducedMotion: true, sim: true, simStand: true, engines: replies(), artifactBy: () => 'gemini',
    connector: { run: async (i) => { acts.push(JSON.parse(JSON.stringify(i))); return {}; } },
    devices: { 'wiz-lamp-1': { cls: 'lamp', on: false, brightness: 50, sim: true }, 'speaker-a': { cls: 'music', on: false, brightness: 0, playing: false, volume: 40, sim: true } },
    deviceLabels: { 'wiz-lamp-1': 'Lamp', 'speaker-a': 'Speaker' },
  });
  const h = handle;
  h.run('connect devices');
  await vi.waitFor(() => expect(h.edgeLayout().right).toBeTruthy(), { timeout: 18000 });
  h.run('build the dashboard');
  await vi.waitFor(() => expect(h.statusSince(0).join(' ')).toMatch(/Approve or say “keep”/), { timeout: 15000 });
  h.keep();
  await vi.waitFor(() => expect(root.querySelector('[data-mc-tile="gimbal-tile"]')).toBeTruthy(), { timeout: 8000 });
  return h;
}
const tile = (key: string) => root.querySelector<HTMLElement>(`[data-mc-tile="${key}"]`)!;
function press(key: string, text: string): void {
  const b = [...(tile(key).shadowRoot?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((x) => x.textContent?.trim() === text || x.getAttribute('aria-label') === text);
  if (!b) throw new Error(`no "${text}" on ${key}`);
  b.click();
}
async function pressed(key: string, text: string): Promise<DeviceIntent> {
  const n = acts.length;
  press(key, text);
  await vi.waitFor(() => expect(acts.length).toBeGreaterThan(n), { timeout: 4000 });
  return acts.at(-1)!;
}

/** The WiZ path production builds (canvasApp: createWizAwareConnector over
 *  the bridge client), with the bridge itself faked: what /setPilot gets. */
function wizWire() {
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = async (input: string, init?: { body?: unknown }) => {
    const path = input.replace('http://127.0.0.1:38888', '');
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    sent.push({ path, body });
    const result = path === '/setPilot' ? { success: true } : { state: true, dimming: 80 };
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  const client = createWizClient('http://127.0.0.1:38888', fetchImpl, 'tok');
  const c = createWizAwareConnector({ client, fallback: { run: async () => ({}) }, status: { up: true }, bulbIp: () => '192.168.1.40' });
  return { run: (i: DeviceIntent) => c.run(i), setPilot: () => sent.filter((s) => s.path === '/setPilot').map((s) => s.body) };
}
/** The Spotify path production builds (createSpotifyAwareConnector over the
 *  Web API module), with the Web API faked: a Marshall in the device list. */
function spotifyWire() {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: { method?: string; body?: string }) => {
    const path = url.replace('https://api.spotify.com/v1', '');
    calls.push(`${init?.method ?? 'GET'} ${path}${init?.body && init.body !== '{}' ? ` ${init.body}` : ''}`);
    const json = path === '/me/player/devices'
      ? { devices: [{ id: 'd-phone', name: 'iPhone', type: 'Smartphone', is_active: true }, { id: 'd-marshall', name: 'Marshall Stanmore II', type: 'Speaker', is_active: false, volume_percent: 40 }] }
      : path === '/me/player' && (init?.method ?? 'GET') === 'GET' ? { is_playing: true, item: { name: 'Blue in Green', artists: [{ name: 'Miles Davis' }] }, device: { id: 'd-marshall', name: 'Marshall Stanmore II', volume_percent: 50 } }
        : null;
    return { ok: true, status: json ? 200 : 204, text: async () => (json ? JSON.stringify(json) : '') };
  }) as unknown as spotifyApi.SpotifyApiOptions['fetchImpl'];
  const o: spotifyApi.SpotifyApiOptions = { accessToken: 'test-token', fetchImpl };
  const c = createSpotifyAwareConnector({
    inner: { run: async () => { throw new Error('never the built-in player'); } },
    isConnected: () => true,
    listDevices: () => spotifyApi.listDevices(o),
    transferPlayback: (id, play) => spotifyApi.transferPlayback(id, o, play),
    searchAndPlay: (q, id) => spotifyApi.searchAndPlay(q, o, id),
    pause: () => spotifyApi.pause(o),
    resume: () => spotifyApi.play(o),
    next: async () => { await spotifyApi.next(o); const pb = await spotifyApi.getPlayback(o); return pb?.title ? { title: pb.title } : null; },
    previous: async () => { await spotifyApi.previous(o); const pb = await spotifyApi.getPlayback(o); return pb?.title ? { title: pb.title } : null; },
    nowPlaying: async () => { const pb = await spotifyApi.getPlayback(o); return pb?.title ? { title: pb.title, artist: pb.artist } : null; },
    speakerName: () => 'Speaker',
    setVolume: (pct) => spotifyApi.setVolumePercent(pct, o),
    say: () => undefined,
  });
  return { run: (i: DeviceIntent) => c.run(i), calls };
}

describe('the demo dashboard, every control down to the wire (no device moves)', () => {
  it('build the dashboard: a lamp, a speaker and a gimbal tile', async () => {
    const h = await dashboard();
    const plan = JSON.stringify(Object.values(h.snapshot().surfaces));
    expect(plan).toContain('"type":"lamp"');
    expect(plan).toContain('"type":"music"');
    expect(plan).toContain('"type":"gimbal"');
    expect(tile('lamp-wiz-lamp-1')).toBeTruthy();
    expect(tile('music-speaker-a')).toBeTruthy();
  }, 60000);

  it('lamp: power, brightness and the level chips become /setPilot state and dimming', async () => {
    await dashboard();
    const wiz = wizWire();
    const power = await pressed('lamp-wiz-lamp-1', 'Power');
    expect(power.deviceId).toBe('wiz-lamp-1');
    expect(typeof power.on).toBe('boolean');
    await wiz.run(power);
    // Power on also carries the level it comes back at (one dim message: state + dimming).
    expect(wiz.setPilot().at(-1)).toEqual({ ip: '192.168.1.40', params: { state: power.on, ...(power.on && typeof power.brightness === 'number' ? { dimming: power.brightness } : {}) } });
    for (const [label, dim] of [['Full', 100], ['Low', 25], ['Half', 50]] as const) {
      const i = await pressed('lamp-wiz-lamp-1', label);
      expect(i.brightness).toBe(dim);
      await wiz.run(i);
      expect(wiz.setPilot().at(-1)).toEqual({ ip: '192.168.1.40', params: { state: true, dimming: dim } });
    }
    const down = await pressed('lamp-wiz-lamp-1', 'Brightness down');
    expect(typeof down.brightness).toBe('number');
    await wiz.run(down);
    expect(wiz.setPilot().at(-1)!.params).toMatchObject({ state: true, dimming: down.brightness });
  }, 60000);

  it('speaker: play moves playback to the Marshall then plays; pause, next and volume go to Spotify', async () => {
    await dashboard();
    const sp = spotifyWire();
    const play = await pressed('music-speaker-a', 'Play or pause');
    expect(play).toMatchObject({ deviceId: 'speaker-a', playing: true });
    await sp.run(play);
    expect(sp.calls.slice(0, 2)).toEqual(['GET /me/player/devices', 'PUT /me/player {"device_ids":["d-marshall"],"play":true}']);
    // Pause: the same tile button again (the store now says playing).
    const pause = await pressed('music-speaker-a', 'Play or pause');
    expect(pause).toMatchObject({ deviceId: 'speaker-a', playing: false });
    await sp.run(pause);
    expect(sp.calls).toContain('PUT /me/player/pause');
    const next = await pressed('music-speaker-a', 'Next');
    await sp.run(next);
    expect(sp.calls).toContain('POST /me/player/next');
    const up = await pressed('music-speaker-a', 'Volume up');
    expect(typeof up.volume).toBe('number');
    await sp.run(up);
    expect(sp.calls).toContain(`PUT /me/player/volume?volume_percent=${up.volume}`);
  }, 60000);

  it('gimbal: Follow me and Hold still go to the iPhone as one allow-listed mode word', async () => {
    const h = await dashboard() as CanvasHandle & { simRelayLog?: () => { kind: string; text: string }[] };
    press('gimbal-tile', 'Follow me');
    await vi.waitFor(() => expect(h.simRelayLog?.().at(-1)).toEqual({ kind: 'gimbalMode', text: 'face' }));
    press('gimbal-tile', 'Hold still');
    await vi.waitFor(() => expect(h.simRelayLog?.().at(-1)).toEqual({ kind: 'gimbalMode', text: 'hold' }));
    press('gimbal-tile', 'Follow my hands');
    await vi.waitFor(() => expect(h.simRelayLog?.().at(-1)).toEqual({ kind: 'gimbalMode', text: 'hands' }));
  }, 60000);
});
