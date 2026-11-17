import { describe, expect, it } from 'vitest';
import {
  PREBUILT_LINKS, connectSpeaker, controlUrl, findSpeaker, hubCards, isConnectDemo, linkCard, loadSpeakers,
  saveSpeaker, savedCards, speakerRequest, usesSpotifyConnect, type HubEnv,
} from '../src/devices/hub';
import { builtinWizConnector } from '../src/devices/connector';
import { buildConnectorPrompt } from '../src/devices/identify';

function memKV() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}
const env = (o: Partial<HubEnv> = {}): HubEnv => ({ camera: false, room: null, iosApp: false, gimbal: false, online: true, ...o });
const dev = (name: string, type = 'Speaker', id = name) => ({ id, name, type, isActive: false, volume: 50 });

describe('connect anything hub', () => {
  it('ships the four prebuilt links: browser, iPad, Android, gimbal (no drone)', () => {
    expect(PREBUILT_LINKS.map((l) => l.id)).toEqual(['browser', 'ipad', 'android', 'gimbal']);
    expect(JSON.stringify(PREBUILT_LINKS).toLowerCase()).not.toContain('drone');
  });

  it('shows honest link states', () => {
    const b = PREBUILT_LINKS[0];
    expect(linkCard(b, env()).state).toBe('ready');
    expect(linkCard(b, env({ camera: true })).state).toBe('connected');
    const android = PREBUILT_LINKS[2];
    expect(linkCard(android, env({ online: false })).state).toBe('needs');
    expect(linkCard(android, env({ room: { token: 't', phone: true } })).state).toBe('connected');
    const gimbal = PREBUILT_LINKS[3];
    expect(linkCard(gimbal, env()).state).toBe('needs');
    expect(linkCard(gimbal, env({ iosApp: true, gimbal: true })).state).toBe('connected');
  });

  it('builds the iPad control link', () => {
    expect(controlUrl('https://mendcraft.web.app/', 'abc')).toBe('https://mendcraft.web.app/control?room=abc');
  });

  it('lists saved connectors as reusable offline', () => {
    const wiz = builtinWizConnector(1);
    const cards = savedCards({ [wiz.key]: wiz }, [{ id: `${wiz.key}@192.168.1.5`, name: 'Desk lamp', connectorKey: wiz.key, host: '192.168.1.5', addedAt: 1, verified: 'done' }]);
    expect(cards).toHaveLength(1);
    expect(cards[0].offline).toBe(true);
    expect(cards[0].detail).toContain('seen working');
    expect(savedCards({ [wiz.key]: wiz }, [])[0].state).toBe('ready');
    expect(hubCards(env(), {}, [], []).filter((c) => c.group === 'ready')).toHaveLength(4);
  });

  it('routes speakers without a local API through Spotify Connect', () => {
    expect(usesSpotifyConnect('speaker', 'Marshall')).toBe(true);
    expect(usesSpotifyConnect('speaker', '')).toBe(true);
    expect(usesSpotifyConnect('smart-bulb', 'WiZ')).toBe(false);
    expect(speakerRequest('connect the marshall speaker')).toBe('Marshall');
    expect(speakerRequest('add the speaker')).toBe('');
    expect(speakerRequest('play some music')).toBeNull();
    expect(speakerRequest('add the lamp')).toBeNull();
  });

  it('finds the speaker by brand, never a laptop or phone', () => {
    const list = [dev('MacBook', 'Computer'), dev('Pixel 8', 'Smartphone'), dev('Marshall Stanmore III')];
    expect(findSpeaker(list, 'marshall')?.name).toBe('Marshall Stanmore III');
    expect(findSpeaker(list.slice(0, 2), 'marshall')).toBeNull();
  });

  it('connects only after her confirm, and saves the link', async () => {
    let moved = '';
    const api = {
      connected: () => true, wait: async () => undefined,
      listDevices: async () => [{ ...dev('Marshall Acton', 'Speaker', 'm1'), isActive: moved === 'm1' }],
      transferPlayback: async (id: string) => { moved = id; },
    };
    const no = await connectSpeaker('Marshall', api, async () => false);
    expect(no.ok).toBe(false);
    expect(moved).toBe('');
    const yes = await connectSpeaker('Marshall', api, async () => true, () => 5);
    expect(yes.ok).toBe(true);
    expect(moved).toBe('m1');
    const kv = memKV();
    if (yes.ok) saveSpeaker(yes.link, kv);
    expect(loadSpeakers(kv)).toEqual([{ key: 'spotify|marshall', brand: 'Marshall', deviceName: 'Marshall Acton', addedAt: 5 }]);
  });

  it('fails visibly when the speaker never becomes active', async () => {
    const r = await connectSpeaker('Marshall', {
      connected: () => true, wait: async () => undefined,
      listDevices: async () => [dev('Marshall Acton', 'Speaker', 'm1')], transferPlayback: async () => undefined,
    }, async () => true);
    expect(!r.ok && r.detail).toMatch(/never became the active speaker/);
  });

  it('asks for Spotify first, and explains when the speaker is not visible', async () => {
    const off = await connectSpeaker('Marshall', { connected: () => false, listDevices: async () => [], transferPlayback: async () => undefined }, async () => true);
    expect(!off.ok && off.reason).toBe('spotify');
    const none = await connectSpeaker('Marshall', { connected: () => true, listDevices: async () => [], transferPlayback: async () => undefined }, async () => true);
    expect(!none.ok && none.reason).toBe('not-found');
  });

  it('opens in demo mode unless ?full=1', () => {
    expect(isConnectDemo('')).toBe(true);
    expect(isConnectDemo('?full=1')).toBe(false);
  });

  it('the connector prompt knows the common plug APIs', () => {
    const p = buildConnectorPrompt({ kind: 'plug', brand: 'Shelly', model: '', label: 'plug', confidence: 0.8 });
    expect(p).toContain('/relay/0?turn=on');
  });
});
