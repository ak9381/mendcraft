import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALLOWED_UDP_PORTS, builtinWizConnector, coerceConnector, connectorKey, fillTemplate, isPrivateIPv4, isWizIdentity,
  planRequest, runAction, type Connector,
} from '../src/devices/connector';
import { getCachedConnector, loadDevices, saveConnector, saveDevice, CONNECTORS_KEY } from '../src/devices/connectorCache';
import {
  buildIdentifyPrompt, deviceNameIn, identityFromWords, isAddDevicePhrase, parseEffect, parseIdentity, writerSaysUnsupported,
  type DeviceIdentity,
} from '../src/devices/identify';
import {
  defaultMode, detectModes, runAddDevice, sourceLabel, type FlowDeps, type FlowFrame, type StepEvent,
} from '../src/devices/addDeviceFlow';
import { aimAngles, aimGimbalAt, getGimbalPlugin, getLanPlugin, MAX_STEP_RAD, type LanPlugin } from '../src/devices/native';
import { discoverDevices, makeTransports, WEB_STUB_NOTE } from '../src/devices/discovery';
import { createSimWorld } from '../src/devices/simDevice';
import { checkDeviceEffect, identifyDevice, setModelsForTest, writeDeviceConnector, type MultimodalGenModel, type TextGenModel } from '../src/ai/hybrid';

function memStore(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, get length() { return m.size; },
  } as Storage;
}

const goodRaw = () => ({
  deviceKind: 'smart-bulb', brand: 'WiZ', protocol: 'udp json',
  discovery: { method: 'wiz-udp-broadcast', port: 38899 },
  actions: [
    { id: 'power-on', verb: 'on', label: 'On', params: [], successCue: 'lit', request: { transport: 'udp', port: 38899, payload: { method: 'setPilot', params: { state: true } } } },
    { id: 'dim', verb: 'set', label: 'Dim', params: [{ name: 'level', type: 'number', min: 10, max: 100, default: 50 }], successCue: 'dimmer',
      request: { transport: 'udp', port: 38899, payloadJson: '{"method":"setPilot","params":{"dimming":"{{level}}"}}' } },
  ],
  test: { action: 'power-on' },
});

describe('connector allowlist (no eval, data only)', () => {
  it('accepts a good connector and parses payloadJson as data', () => {
    const c = coerceConnector(goodRaw(), 'cloud')!;
    expect(c).not.toBeNull();
    expect(c.key).toBe('wiz|smart-bulb');
    expect(c.actions.map((a) => a.id)).toEqual(['power-on', 'dim']);
    expect(c.actions[1].request).toMatchObject({ transport: 'udp', payload: { method: 'setPilot', params: { dimming: '{{level}}' } } });
  });
  it('drops actions with a disallowed port, method, path, or free placeholder', () => {
    const raw = goodRaw();
    raw.actions.push(
      { id: 'evil-port', label: 'x', params: [], successCue: '', request: { transport: 'udp', port: 22, payload: { a: 1 } } } as never,
      { id: 'evil-method', label: 'x', params: [], successCue: '', request: { transport: 'http', port: 80, method: 'DELETE', path: '/' } } as never,
      { id: 'evil-path', label: 'x', params: [], successCue: '', request: { transport: 'http', port: 80, method: 'GET', path: '/../etc' } } as never,
      { id: 'abs-url', label: 'x', params: [], successCue: '', request: { transport: 'http', port: 80, method: 'GET', path: 'http://evil.com/' } } as never,
      { id: 'free-var', label: 'x', params: [], successCue: '', request: { transport: 'udp', port: 38899, payload: { x: '{{secret}}' } } } as never,
      { id: 'proto', label: 'x', params: [], successCue: '', request: { transport: 'udp', port: 38899, payloadJson: '{"__proto__":{"a":1}}' } } as never,
      { id: 'Bad Id', label: 'x', params: [], successCue: '', request: { transport: 'udp', port: 38899, payload: { a: 1 } } } as never,
    );
    const c = coerceConnector(raw, 'cloud')!;
    expect(c.actions.map((a) => a.id)).toEqual(['power-on', 'dim']);
  });
  it('rejects a connector with no valid action or an unknown discovery method', () => {
    expect(coerceConnector({ ...goodRaw(), actions: [] }, 'cloud')).toBeNull();
    expect(coerceConnector({ ...goodRaw(), discovery: { method: 'shell' } }, 'cloud')).toBeNull();
    expect(coerceConnector('rm -rf /', 'cloud')).toBeNull();
  });
  it('only private IPv4 hosts', () => {
    expect(isPrivateIPv4('192.168.1.4')).toBe(true);
    expect(isPrivateIPv4('10.0.0.9')).toBe(true);
    expect(isPrivateIPv4('172.20.1.1')).toBe(true);
    expect(isPrivateIPv4('172.32.1.1')).toBe(false);
    expect(isPrivateIPv4('8.8.8.8')).toBe(false);
    expect(isPrivateIPv4('evil.com')).toBe(false);
    expect(planRequest(builtinWizConnector(), 'power-on', {}, '8.8.8.8').ok).toBe(false);
  });
  it('fills templates by exact substitution and clamps params', () => {
    const c = coerceConnector(goodRaw(), 'cloud')!;
    const p = planRequest(c, 'dim', { level: 900 }, '192.168.1.5');
    expect(p.ok && p.request).toMatchObject({ transport: 'udp', host: '192.168.1.5', port: 38899, payload: { params: { dimming: 100 } } });
    expect(fillTemplate('/set?v={{x}}', { x: 'a b' })).toBe('/set?v=a%20b');
    expect(fillTemplate({ k: '{{n}}' }, { n: 5 })).toEqual({ k: 5 });
  });
  it('builds an http request on an allowed port only', () => {
    const c = coerceConnector({
      brand: 'Acme', deviceKind: 'fan', discovery: { method: 'mdns', service: '_acme._tcp' },
      actions: [{ id: 'speed', verb: 'set', label: 'Speed', params: [{ name: 'speed', type: 'number', min: 0, max: 3 }], successCue: 'blades spin',
        request: { transport: 'http', port: 8080, method: 'post', path: '/api/speed/{{speed}}', bodyJson: '{"speed":"{{speed}}"}' } }],
    }, 'cloud')!;
    const p = planRequest(c, 'speed', { speed: 2 }, '10.0.0.7');
    expect(p.ok && p.request).toEqual({ transport: 'http', host: '10.0.0.7', port: 8080, method: 'POST', url: 'http://10.0.0.7:8080/api/speed/2', body: { speed: 2 } });
  });
  it('runAction reports a missing transport honestly', async () => {
    const r = await runAction(builtinWizConnector(), 'power-on', {}, '192.168.1.9', {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/iPhone app|WiZ bridge/);
  });
  it('built-in WiZ seed is valid and has a visible prepare→test pair', () => {
    const c = builtinWizConnector();
    expect(c.test).toEqual({ action: 'power-on', prepare: 'power-off' });
    expect(ALLOWED_UDP_PORTS).toContain(38899);
    expect(isWizIdentity('WiZ', 'smart-bulb')).toBe(true);
    expect(isWizIdentity('Philips', 'smart-bulb')).toBe(false);
  });
});

describe('connector cache', () => {
  it('round-trips and re-validates on read', () => {
    const s = memStore();
    saveConnector(builtinWizConnector(), s);
    expect(getCachedConnector(connectorKey('WiZ', 'smart-bulb'), s)?.actions.length).toBe(5);
    // tamper: a disallowed port in storage is dropped on read
    const raw = JSON.parse(s.getItem(CONNECTORS_KEY)!);
    raw['wiz|smart-bulb'].actions = raw['wiz|smart-bulb'].actions.map((a: { request: { port: number } }) => ({ ...a, request: { ...a.request, port: 22 } }));
    s.setItem(CONNECTORS_KEY, JSON.stringify(raw));
    expect(getCachedConnector('wiz|smart-bulb', s)).toBeNull();
  });
  it('stores paired devices, private hosts only, de-duplicated', () => {
    const s = memStore();
    const d = { id: 'a', name: 'Lamp', connectorKey: 'wiz|smart-bulb', host: '192.168.1.2', addedAt: 1, verified: 'done' as const };
    saveDevice(d, s);
    saveDevice({ ...d, id: 'b' }, s);
    expect(loadDevices(s).map((x) => x.id)).toEqual(['b']);
    s.setItem('mendcraft.devices', JSON.stringify([{ ...d, host: '1.2.3.4' }]));
    expect(loadDevices(s)).toEqual([]);
  });
});

describe('identify / effect parsing and phrases', () => {
  it('parses an identity and clamps the box', () => {
    expect(parseIdentity({ kind: 'smart-bulb', brand: 'WiZ', label: 'Lamp', confidence: 1.4, box: { x: 0.5, y: -1, w: 0.2, h: 0.3 } }))
      .toEqual({ kind: 'smart-bulb', brand: 'WiZ', model: '', label: 'Lamp', confidence: 1, box: { x: 0.5, y: 0, w: 0.2, h: 0.3 } });
    expect(parseIdentity({ kind: 'none', label: 'x', confidence: 1 })).toBeNull();
    expect(parseIdentity({ kind: 'toaster', label: 'Toaster', confidence: 0.5 })?.kind).toBe('other');
  });
  it('room-mode prompt carries the pointer and the name', () => {
    const p = buildIdentifyPrompt({ pointer: { x: 0.25, y: 0.5 }, name: 'lamp' });
    expect(p).toContain('x=0.25');
    expect(p).toContain('"lamp"');
    expect(buildIdentifyPrompt()).not.toContain('pointing');
  });
  it('parses effect verdicts', () => {
    expect(parseEffect({ verdict: 'done', reason: 'lit' })).toEqual({ verdict: 'done', reason: 'lit' });
    expect(parseEffect({ verdict: 'yes' })).toBeNull();
    expect(writerSaysUnsupported({ supported: false })).toBe(true);
  });
  it('recognises "add device" in English and Kannada', () => {
    for (const t of ['add device', 'Add a device', 'add the lamp', 'connect my speaker', 'new device', 'ಸಾಧನ ಸೇರಿಸು', 'ಹೊಸ ಸಾಧನ', 'ದೀಪ ಸೇರಿಸಿ', 'ಡಿವೈಸ್ ಆಡ್ ಮಾಡು']) {
      expect(isAddDevicePhrase(t), t).toBe(true);
    }
    for (const t of ['add a door', 'make the lamp brighter', 'add a window']) expect(isAddDevicePhrase(t), t).toBe(false);
  });
  it('voice mode: identity from words', () => {
    expect(identityFromWords('add the lamp')).toMatchObject({ kind: 'smart-bulb', brand: 'WiZ' });
    expect(identityFromWords('ದೀಪ ಸೇರಿಸಿ')?.kind).toBe('smart-bulb');
    expect(identityFromWords('add device')).toBeNull();
    expect(deviceNameIn('connect the speaker')?.kind).toBe('speaker');
  });
});

describe('setup auto-detect offers the three ways in order', () => {
  it('camera present → point first; no gimbal needed', () => {
    const o = detectModes({ camera: true, iosApp: false, bridge: false, sim: false });
    expect(o.map((x) => x.mode)).toEqual(['point', 'room', 'voice']);
    expect(defaultMode(o)).toBe('point');
  });
  it('no camera → voice is the default and is always available', () => {
    const o = detectModes({ camera: false, iosApp: false, bridge: false, sim: false });
    expect(o.filter((x) => x.available).map((x) => x.mode)).toEqual(['voice']);
    expect(defaultMode(o)).toBe('voice');
    expect(o[2].why).toMatch(/type its address/);
  });
});

const frame = (tag: string): FlowFrame => ({ mimeType: 'image/jpeg', dataBase64: tag });
const wizId: DeviceIdentity = { kind: 'smart-bulb', brand: 'WiZ', model: '', label: 'Lamp', confidence: 0.9, box: { x: 0.6, y: 0.2, w: 0.2, h: 0.4 } };

function fakeDeps(over: Partial<FlowDeps> = {}) {
  const events: StepEvent[] = [];
  const sent: string[] = [];
  let shots = 0;
  const deps: FlowDeps = {
    sim: false,
    capture: async () => frame(`f${++shots}`),
    identify: async () => ({ identity: wizId, source: 'on-device' }),
    cachedConnector: () => null,
    writeConnector: async () => ({ ok: true, connector: builtinWizConnector(), source: 'cloud', text: '{}' }),
    saveConnector: vi.fn(),
    discover: async () => ({ found: [{ host: '192.168.1.42' }], source: 'native', note: '' }),
    confirm: async () => true,
    run: async (c: Connector, a: string, h: string) => { sent.push(a); return runAction(c, a, {}, h, { udp: async () => ({ result: { success: true } }) }); },
    check: async () => ({ verdict: 'done', reason: 'lit', source: 'on-device' }),
    saveDevice: vi.fn(),
    wait: async () => {},
    onStep: (e) => events.push(e),
    ...over,
  };
  return { deps, events, sent };
}

describe('runAddDevice', () => {
  it('point mode: identify → write once → find → confirm → prepare/test → green tick', async () => {
    const { deps, events, sent } = fakeDeps();
    const out = await runAddDevice(deps);
    expect(out.ok && out.verdict).toBe('done');
    expect(sent).toEqual(['power-off', 'power-on', 'status']);
    expect(deps.saveConnector).toHaveBeenCalledOnce();
    expect(deps.saveDevice).toHaveBeenCalledOnce();
    const final = events.filter((e) => e.state !== 'active');
    expect(final.map((e) => e.step)).toEqual(['look', 'identify', 'connector', 'find', 'confirm', 'test', 'verify']);
    expect(final.find((e) => e.step === 'identify')?.source).toBe('on-device');
    expect(final.find((e) => e.step === 'connector')?.source).toBe('cloud');
  });
  it('reuses a cached connector without calling the cloud writer', async () => {
    const write = vi.fn();
    const { deps, events } = fakeDeps({ cachedConnector: () => builtinWizConnector(), writeConnector: write });
    await runAddDevice(deps);
    expect(write).not.toHaveBeenCalled();
    expect(events.find((e) => e.step === 'connector' && e.state === 'ok')?.source).toBe('cache');
  });
  it('cancelling the pinch confirm sends nothing to the device', async () => {
    const { deps, sent } = fakeDeps({ confirm: async () => false });
    const out = await runAddDevice(deps);
    expect(out).toMatchObject({ ok: false, at: 'confirm' });
    expect(sent).toEqual([]);
  });
  it('no gimbal: aim is optional and a throwing gimbal never breaks the flow', async () => {
    const { deps } = fakeDeps({ aim: async () => { throw new Error('no dock'); } });
    expect((await runAddDevice(deps)).ok).toBe(true);
  });
  it('room mode passes her pointer and the name to identify', async () => {
    const identify = vi.fn(async () => ({ identity: wizId, source: 'on-device' as const }));
    const { deps } = fakeDeps({ mode: 'room', hint: { pointer: { x: 0.3, y: 0.4 }, name: 'lamp' }, identify });
    await runAddDevice(deps);
    expect(identify).toHaveBeenCalledWith(expect.anything(), { pointer: { x: 0.3, y: 0.4 }, name: 'lamp' });
  });
  it('voice mode: no camera at all, finds it on Wi-Fi, verify is skipped honestly', async () => {
    const capture = vi.fn(async () => frame('x'));
    const identify = vi.fn();
    const { deps, events } = fakeDeps({ mode: 'voice', capture, identify, identityFromWords: () => identityFromWords('add the lamp') });
    const out = await runAddDevice(deps);
    expect(out.ok && out.verdict).toBe('unsure');
    expect(capture).not.toHaveBeenCalled();
    expect(identify).not.toHaveBeenCalled();
    expect(events.find((e) => e.step === 'verify')?.state).toBe('skip');
  });
  it('voice mode without a device word asks which device', async () => {
    const { deps } = fakeDeps({ mode: 'voice', identityFromWords: () => null });
    expect(await runAddDevice(deps)).toMatchObject({ ok: false, at: 'identify' });
  });
  it('stub discovery asks for a typed address', async () => {
    const askHost = vi.fn(async () => '192.168.0.20');
    const { deps, events } = fakeDeps({ discover: async () => ({ found: [], source: 'stub', note: WEB_STUB_NOTE }), askHost });
    const out = await runAddDevice(deps);
    expect(askHost).toHaveBeenCalledWith(WEB_STUB_NOTE);
    expect(out.ok && out.device.host).toBe('192.168.0.20');
    expect(events.find((e) => e.step === 'find' && e.state === 'ok')?.source).toBe('manual');
  });
  it('not_done verdict → no green tick', async () => {
    const { deps, events } = fakeDeps({ check: async () => ({ verdict: 'not_done', reason: 'still dark', source: 'cloud' }) });
    const out = await runAddDevice(deps);
    expect(out.ok && out.verdict).toBe('not_done');
    expect(events.find((e) => e.step === 'verify' && e.state !== 'active')?.state).toBe('fail');
  });
  it('labels every source honestly, SIM-prefixed in sim', () => {
    expect(sourceLabel('on-device')).toBe('Gemini Nano · on device');
    expect(sourceLabel('cloud')).toBe('Gemini · cloud');
    expect(sourceLabel('cloud', true)).toBe('SIM · Gemini · cloud');
  });
});

describe('sim world (?sim=1, no hardware)', () => {
  it('full flow flips the fake lamp and verifies it', async () => {
    const w = createSimWorld((on) => frame(on ? 'on' : 'off'));
    const { deps } = fakeDeps({
      sim: true, capture: () => w.capture('point'), identify: (f) => w.identify(f), writeConnector: (_i, fb, t) => w.write(fb, t),
      cachedConnector: (id) => w.cached(connectorKey(id.brand, id.kind)), discover: () => w.discover(),
      run: (c, a, h) => w.run(c, a, h), check: () => w.check(),
    });
    const out = await runAddDevice(deps);
    expect(w.lampOn).toBe(true);
    expect(out.ok && out.verdict).toBe('done');
    expect(w.cached('wiz|smart-bulb')).not.toBeNull();
  }, 10000);
});

describe('gimbal (optional) and native layer', () => {
  it('aim angles centre the box, with deadband and a max step', () => {
    expect(aimAngles({ x: 0.45, y: 0.45, w: 0.1, h: 0.1 })).toEqual({ yaw: 0, pitch: 0 });
    const a = aimAngles({ x: 0.8, y: 0.0, w: 0.2, h: 0.2 });
    expect(a.yaw).toBeGreaterThan(0);
    expect(a.pitch).toBeGreaterThan(0); // box above centre → tilt up
    expect(Math.abs(a.yaw)).toBeLessThanOrEqual(MAX_STEP_RAD);
  });
  it('web has no native plugins; aim is a no-op false', async () => {
    expect(getLanPlugin({})).toBeNull();
    expect(getGimbalPlugin({})).toBeNull();
    expect(await aimGimbalAt({ x: 0, y: 0, w: 0.1, h: 0.1 }, {})).toBe(false);
  });
  it('aims through DockKit plugin on iOS when docked', async () => {
    const aim = vi.fn(async () => ({ ok: true }));
    const w = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { MendcraftGimbal: { isAvailable: async () => ({ available: true }), aim, release: async () => {} } } } };
    expect(await aimGimbalAt({ x: 0.8, y: 0.4, w: 0.2, h: 0.2 }, w)).toBe(true);
    expect(aim).toHaveBeenCalledOnce();
  });
});

describe('discovery + transports', () => {
  const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  it('browser without bridge → honest stub', async () => {
    const f = vi.fn(async () => { throw new Error('refused'); });
    const r = await discoverDevices(builtinWizConnector(), { lan: null, fetch: f, bridgeUrl: 'http://127.0.0.1:38888' });
    expect(r).toEqual({ found: [], source: 'stub', note: WEB_STUB_NOTE });
  });
  it('browser with the WiZ bridge → bulbs from /discover', async () => {
    const f = vi.fn(async (u: string) => (u.endsWith('/health') ? okJson({ ok: true }) : okJson({ bulbs: [{ ip: '192.168.1.42', mac: 'aa' }] })));
    const r = await discoverDevices(builtinWizConnector(), { lan: null, fetch: f, bridgeUrl: 'http://127.0.0.1:38888' });
    expect(r.source).toBe('bridge');
    expect(r.found[0]).toMatchObject({ host: '192.168.1.42' });
  });
  it('iOS app → native discovery', async () => {
    const lan = { discover: vi.fn(async () => ({ devices: [{ host: '192.168.1.7' }] })), sendUdp: vi.fn(), http: vi.fn() } as unknown as LanPlugin;
    const r = await discoverDevices(builtinWizConnector(), { lan });
    expect(r).toMatchObject({ source: 'native', found: [{ host: '192.168.1.7' }] });
  });
  it('browser UDP only relays WiZ setPilot via the bridge', async () => {
    const f = vi.fn(async () => okJson({ result: { success: true } }));
    const t = makeTransports({ lan: null, fetch: f, bridgeUrl: 'http://127.0.0.1:38888' });
    await t.udp!('192.168.1.42', 38899, { method: 'setPilot', params: { state: true } });
    expect(f).toHaveBeenCalledWith('http://127.0.0.1:38888/setPilot', expect.objectContaining({ method: 'POST' }));
    await expect(t.udp!('192.168.1.42', 4003, { msg: {} })).rejects.toThrow(/iPhone app/);
  });
});

describe('hybrid add-device calls', () => {
  afterEach(() => setModelsForTest(null));
  const mm = (text: string, src?: string): MultimodalGenModel => ({ generateContent: async () => ({ response: { text: () => text, inferenceSource: src } }) });
  const boom: MultimodalGenModel = { generateContent: async () => { throw new Error('nano failed'); } };
  const img = { mimeType: 'image/jpeg', dataBase64: 'abc' };
  it('identify prefers Nano and labels it on-device', async () => {
    setModelsForTest({ deviceSee: mm('{"kind":"smart-bulb","brand":"WiZ","label":"Lamp","confidence":0.8}', 'on_device') });
    const r = await identifyDevice(img);
    expect(r).toMatchObject({ source: 'on-device', identity: { brand: 'WiZ' } });
  });
  it('identify falls back to cloud when Nano throws, labelled cloud', async () => {
    setModelsForTest({ deviceSee: boom, deviceSeeCloud: mm('{"kind":"lamp","label":"Lamp","confidence":0.7}') });
    expect((await identifyDevice(img))?.source).toBe('cloud');
  });
  it('connector writer output must pass the allowlist', async () => {
    const tm = (t: string): TextGenModel => ({ generateContent: async () => ({ response: { text: () => t } }) });
    setModelsForTest({ connectorWriter: tm(JSON.stringify(goodRaw())) });
    const good = await writeDeviceConnector(wizId);
    expect(good.ok && good.connector.actions.length).toBe(2);
    setModelsForTest({ connectorWriter: tm(JSON.stringify({ ...goodRaw(), actions: [{ id: 'x', verb: 'on', label: 'x', request: { transport: 'udp', port: 22, payloadJson: '{}' } }] })) });
    const bad = await writeDeviceConnector(wizId);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.errors.join(' ')).toMatch(/request not allowed/);
    setModelsForTest({ connectorWriter: tm('{"supported":false,"actions":[],"discovery":{"method":"manual"}}') });
    const unsup = await writeDeviceConnector(wizId);
    expect(!unsup.ok && unsup.unsupported).toBe(true);
  });
  it('effect check: Nano verdict, or unsure (rules) with no model', async () => {
    setModelsForTest({ effectCheck: mm('{"verdict":"done","reason":"lit"}', 'on_device') });
    expect(await checkDeviceEffect(img, img, 'lit')).toMatchObject({ verdict: 'done', source: 'on-device' });
    setModelsForTest({ enabled: false });
    expect(await checkDeviceEffect(img, img, 'lit')).toMatchObject({ verdict: 'unsure', source: 'rules' });
  });
});
