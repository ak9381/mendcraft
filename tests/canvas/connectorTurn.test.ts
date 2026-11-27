import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildConnectorPrompt, connectorArtifactId, lampConnectorKey, parseConnectorReply, WIZ_LAMP_IDENTITY } from '../../src/canvas/connectorTurn';
import { connectorState, createConnectorGate, createWizAwareConnector, NO_CONNECTOR_LINE, CONNECTOR_CANT_DO_THAT, type ApprovedConnector, type LampConnector } from '../../src/canvas/wizDevices';
import { coerceArtifact } from '../../src/artifacts/artifact';
import { createDeviceStore } from '../../src/canvas/deviceActions';
import { BridgeRefusedError, type WizClient } from '../../src/devices/wizClient';
import { RAW_WIZ, WIZ_INTENTS, wizConnector } from '../devices/wizSample';
import { coerceIntentMap } from '../../src/devices/intentMap';

const reply = (connector: unknown, intents: unknown = WIZ_INTENTS) => `Here it is:\n\`\`\`json\n${JSON.stringify({ connector, intents })}\n\`\`\``;
const approved = (): ApprovedConnector => ({ connector: wizConnector(), intents: coerceIntentMap(WIZ_INTENTS, wizConnector()) });
function fakeClient(): WizClient {
  return {
    baseUrl: 'http://127.0.0.1:38888',
    health: vi.fn(async () => true),
    discover: vi.fn(async () => []),
    getPilot: vi.fn(async () => ({ on: true, dimming: 60 })),
    setPilot: vi.fn(async () => ({ on: true, dimming: 60 })),
  };
}
const fallback = () => ({ run: vi.fn(async () => ({ on: true, brightness: 50 })) });

describe('buildConnectorPrompt', () => {
  it('names the brand and kind and the allow-list, and carries no address or token', () => {
    const s = buildConnectorPrompt(WIZ_LAMP_IDENTITY);
    expect(s.engine).toBe('gemini');
    expect(s.prompt).toMatch(/WiZ smart-bulb/);
    expect(s.prompt).toMatch(/38899/);
    expect(s.prompt).toMatch(/9123/);
    expect(s.prompt).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    expect(s.prompt).not.toMatch(/token|38888/i);
    expect(s.sent).toMatch(/No address, no token/);
  });
});

describe('parseConnectorReply', () => {
  it('takes a fenced reply and checks the intent map against the connector', () => {
    const r = parseConnectorReply(reply(RAW_WIZ), lampConnectorKey());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.connector.source).toBe('cloud');
    expect(r.value.connector.key).toBe('wiz|smart-bulb');
    expect(Object.keys(r.value.intents).sort()).toEqual(['brightness', 'off', 'on', 'temp']);
    expect(connectorArtifactId(r.value.connector.key)).toBe('connector-wiz-smart-bulb');
  });

  it('parseConnectorReply refuses a connector with port 22 or an absolute URL path', () => {
    const port22 = { ...RAW_WIZ, actions: [...RAW_WIZ.actions, { id: 'shell', label: 'Shell', params: [], request: { transport: 'udp', port: 22, payload: { x: 1 } } }] };
    const r1 = parseConnectorReply(reply(port22));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toMatch(/port 22/);
    const url = { ...RAW_WIZ, actions: [...RAW_WIZ.actions, { id: 'cloud-on', label: 'On', params: [], request: { transport: 'http', port: 80, method: 'GET', path: 'http://evil.example/on' } }] };
    const r2 = parseConnectorReply(reply(url));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/not a local path/);
  });

  it('refuses no JSON, "supported: false", another device, an empty intent map', () => {
    expect(parseConnectorReply('sorry').ok).toBe(false);
    expect(parseConnectorReply('{"supported": false}').ok).toBe(false);
    expect(parseConnectorReply(reply({ ...RAW_WIZ, brand: 'Govee' }), lampConnectorKey()).ok).toBe(false);
    expect(parseConnectorReply(reply(RAW_WIZ, { on: { action: 'reboot' } })).ok).toBe(false);
  });

  it('what it accepts is a valid stored artifact', () => {
    const r = parseConnectorReply(reply(RAW_WIZ));
    if (!r.ok) throw new Error(r.error);
    const a = coerceArtifact({ id: connectorArtifactId(r.value.connector.key), kind: 'connector', v: 1, title: 'WiZ bulb', by: 'gemini', at: 1, status: 'approved', data: { connector: r.value.connector, intents: r.value.intents } });
    expect(a.ok).toBe(true);
  });

  it('the recorded fixture parses and asks for port 38899', () => {
    const rec = JSON.parse(readFileSync(join(__dirname, '../fixtures/written/gemini.connector.json'), 'utf8')) as { reply: string };
    const r = parseConnectorReply(rec.reply, lampConnectorKey());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.connector.actions.every((a) => a.request.port === 38899)).toBe(true);
  });
});

describe('a lamp on a generated connector', () => {
  it('a lamp with no connector artifact reports connector "none" and a press says how to connect it', async () => {
    const client = fakeClient();
    const connectorFor = (): LampConnector => null;
    expect(connectorState(connectorFor())).toBe('none');
    const conn = createWizAwareConnector({ client, fallback: fallback(), status: { up: true }, bulbIp: () => '192.168.1.40', connectorFor });
    const store = createDeviceStore({ 'wiz-lamp-1': { cls: 'lamp', on: false, brightness: 50 } }, conn, () => undefined, () => null);
    const s = await store.act({ deviceId: 'wiz-lamp-1', on: true });
    expect(s.error).toBe(NO_CONNECTOR_LINE);
    expect(s.on).toBe(false);
    expect(client.setPilot).not.toHaveBeenCalled();
  });

  it('runs an intent as actionsForIntent → planRequest → runPlanned through the bridge client', async () => {
    const client = fakeClient();
    const conn = createWizAwareConnector({ client, fallback: fallback(), status: { up: true }, bulbIp: () => '192.168.1.40', connectorFor: approved });
    const res = await conn.run({ deviceId: 'wiz-lamp-1', on: true, brightness: 60 });
    expect(client.setPilot).toHaveBeenNthCalledWith(1, '192.168.1.40', { kind: 'power', on: true });
    expect(client.setPilot).toHaveBeenNthCalledWith(2, '192.168.1.40', { kind: 'dim', dimming: 60 });
    expect(res).toMatchObject({ on: true, brightness: 60, sim: false });
    expect(connectorState(approved())).toBe('generated');
    expect(connectorState('built-in')).toBe('built-in');
  });

  it('the bridge refusing the 2nd request of a press says part of it was already sent', async () => {
    const client = fakeClient();
    (client.setPilot as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async () => ({ on: true, dimming: 60 }))
      .mockImplementationOnce(async () => { throw new BridgeRefusedError('dimming out of range'); });
    const conn = createWizAwareConnector({ client, fallback: fallback(), status: { up: true }, bulbIp: () => '192.168.1.40', connectorFor: approved });
    const err = await conn.run({ deviceId: 'wiz-lamp-1', on: true, brightness: 60 }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/Part of this was already sent\.$/);
    expect(err.message).not.toMatch(/Nothing changed/);
    // A refusal of the FIRST request still means nothing changed: passed through as it was.
    const c2 = fakeClient();
    (c2.setPilot as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { throw new BridgeRefusedError('dimming out of range'); });
    const conn2 = createWizAwareConnector({ client: c2, fallback: fallback(), status: { up: true }, bulbIp: () => '192.168.1.40', connectorFor: approved });
    await expect(conn2.run({ deviceId: 'wiz-lamp-1', on: true, brightness: 60 })).rejects.toBeInstanceOf(BridgeRefusedError);
  });

  it('refuses what the map has no action for, and never reaches the bulb', async () => {
    const client = fakeClient();
    const conn = createWizAwareConnector({ client, fallback: fallback(), status: { up: true }, bulbIp: () => '192.168.1.40', connectorFor: approved });
    await expect(conn.run({ deviceId: 'wiz-lamp-1', sceneId: 6 })).rejects.toThrow(CONNECTOR_CANT_DO_THAT);
    expect(client.setPilot).not.toHaveBeenCalled();
  });

  it('refuses a value the connector declares out of range (no clamp)', async () => {
    const narrow = approved();
    narrow.connector.actions.find((a) => a.id === 'set-brightness')!.params[0].min = 30;
    const client = fakeClient();
    const conn = createWizAwareConnector({ client, fallback: fallback(), status: { up: true }, bulbIp: () => '192.168.1.40', connectorFor: () => narrow });
    await expect(conn.run({ deviceId: 'wiz-lamp-1', brightness: 20 })).rejects.toThrow(/30 to 100.*Nothing changed/);
    expect(client.setPilot).not.toHaveBeenCalled();
  });

  it('checks every request of a press before the first is sent: {on, temp 2100} sends nothing', async () => {
    // A connector that declares a wider white range than the bulb takes:
    // argsRefusal passes, the transport check refuses — before power-on goes out.
    const wide = approved();
    Object.assign(wide.connector.actions.find((a) => a.id === 'set-white')!.params[0], { min: 1000, max: 10000 });
    const client = fakeClient();
    const conn = createWizAwareConnector({ client, fallback: fallback(), status: { up: true }, bulbIp: () => '192.168.1.40', connectorFor: () => wide });
    await expect(conn.run({ deviceId: 'wiz-lamp-1', on: true, temp: 2100 })).rejects.toThrow(/Nothing changed/);
    expect(client.setPilot).not.toHaveBeenCalled();
    expect(client.getPilot).not.toHaveBeenCalled();
  });

  it('the simulated gate follows the same rules', async () => {
    const inner = fallback();
    const gate = createConnectorGate(inner, approved);
    await expect(gate.run({ deviceId: 'wiz-lamp-1', sceneId: 6 })).rejects.toThrow(CONNECTOR_CANT_DO_THAT);
    await gate.run({ deviceId: 'wiz-lamp-1', brightness: 60 });
    await gate.run({ deviceId: 'speaker-a', playing: true });
    expect(inner.run).toHaveBeenCalledTimes(2);
    await expect(createConnectorGate(inner, () => null).run({ deviceId: 'wiz-lamp-1', on: true })).rejects.toThrow(NO_CONNECTOR_LINE);
  });
});
