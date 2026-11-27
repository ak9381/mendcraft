import { describe, expect, it, vi } from 'vitest';
import { planRequest, type PlannedRequest } from '../../src/devices/connector';
import { lampIntentFromPilot, LAMP_CANT_TAKE, NEEDS_PHONE_APP, runPlanned } from '../../src/devices/connectorTransport';
import type { WizClient } from '../../src/devices/wizClient';
import type { LanPlugin } from '../../src/devices/native';
import { wizConnector } from './wizSample';

const HOST = '192.168.1.40';
function fakeWiz(): WizClient {
  return {
    baseUrl: 'http://127.0.0.1:38888',
    health: vi.fn(async () => true),
    discover: vi.fn(async () => []),
    getPilot: vi.fn(async () => ({ on: true, dimming: 60 })),
    setPilot: vi.fn(async () => ({ on: true, dimming: 60 })),
  };
}
const udp = (port: number, payload: unknown): PlannedRequest => ({ transport: 'udp', host: HOST, port, payload: payload as never });

describe('runPlanned', () => {
  it('runPlanned accepts udp 38899 setPilot and calls wiz.setPilot with the payload params', async () => {
    const wiz = fakeWiz();
    const plan = planRequest(wizConnector(), 'set-brightness', { dimming: 60 }, HOST);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const r = await runPlanned(plan.request, { wiz });
    expect(r).toMatchObject({ ok: true, state: { on: true, dimming: 60 } });
    expect(wiz.setPilot).toHaveBeenCalledWith(HOST, { kind: 'dim', dimming: 60 });
  });

  it('runPlanned refuses udp 4003, http 80 and method "reboot" in the browser with NEEDS_PHONE_APP', async () => {
    const wiz = fakeWiz();
    expect(await runPlanned(udp(4003, { msg: { cmd: 'turn', data: { value: 1 } } }), { wiz })).toEqual({ ok: false, why: NEEDS_PHONE_APP });
    expect(await runPlanned({ transport: 'http', host: HOST, port: 80, method: 'GET', url: `http://${HOST}/on` }, { wiz })).toEqual({ ok: false, why: NEEDS_PHONE_APP });
    expect(await runPlanned(udp(38899, { method: 'reboot', params: {} }), { wiz })).toEqual({ ok: false, why: NEEDS_PHONE_APP });
    expect(wiz.setPilot).not.toHaveBeenCalled();
    expect(wiz.getPilot).not.toHaveBeenCalled();
  });

  it('refuses a port outside the allow-list and an address off the Wi-Fi, whatever the transport', async () => {
    const wiz = fakeWiz();
    const native: LanPlugin = { sendUdp: vi.fn(async () => ({})), http: vi.fn(async () => ({ status: 200 })), discover: vi.fn(async () => ({ devices: [] })) };
    expect((await runPlanned(udp(22, { method: 'setPilot', params: { state: true } }), { wiz, native })).ok).toBe(false);
    expect((await runPlanned({ ...udp(38899, { method: 'setPilot', params: { state: true } }), host: '8.8.8.8' }, { wiz, native })).ok).toBe(false);
    expect((await runPlanned({ transport: 'http', host: HOST, port: 80, method: 'GET', url: 'http://evil.example/on' }, { wiz, native })).ok).toBe(false);
    expect(native.sendUdp).not.toHaveBeenCalled();
    expect(native.http).not.toHaveBeenCalled();
  });

  it('refuses a network or broadcast address (last octet 0 or 255)', async () => {
    const wiz = fakeWiz();
    for (const host of ['192.168.1.0', '192.168.1.255', '10.0.0.255']) {
      expect((await runPlanned({ ...udp(38899, { method: 'setPilot', params: { state: true } }), host }, { wiz })).ok).toBe(false);
    }
    expect(wiz.setPilot).not.toHaveBeenCalled();
  });

  it('refuses setPilot params the bridge would not take, never clamping them', async () => {
    const wiz = fakeWiz();
    for (const params of [{ dimming: 500 }, { dimming: 5 }, { state: false, dimming: 50 }, { dimming: 50, temp: 3000 }, { reboot: true }, { r: 10 }]) {
      expect(await runPlanned(udp(38899, { method: 'setPilot', params }), { wiz })).toEqual({ ok: false, why: LAMP_CANT_TAKE });
    }
    expect(wiz.setPilot).not.toHaveBeenCalled();
  });

  it('in the phone app, other allowed requests go to the LAN plugin; the WiZ port still takes only setPilot/getPilot', async () => {
    const wiz = fakeWiz();
    const native: LanPlugin = { sendUdp: vi.fn(async () => ({})), http: vi.fn(async () => ({ status: 200 })), discover: vi.fn(async () => ({ devices: [] })) };
    expect((await runPlanned(udp(4003, { msg: { cmd: 'turn' } }), { wiz, native })).ok).toBe(true);
    expect((await runPlanned({ transport: 'http', host: HOST, port: 8080, method: 'POST', url: `http://${HOST}:8080/on`, body: { on: true } }, { wiz, native })).ok).toBe(true);
    expect((await runPlanned(udp(38899, { method: 'reboot', params: {} }), { wiz, native })).ok).toBe(false);
    expect((await runPlanned(udp(38899, { method: 'setPilot', params: { state: true } }), { wiz, native })).ok).toBe(true);
    expect(native.sendUdp).toHaveBeenLastCalledWith(expect.objectContaining({ port: 38899, payload: '{"method":"setPilot","params":{"state":true}}' }));
    expect(wiz.setPilot).not.toHaveBeenCalled();
  });
});

describe('lampIntentFromPilot', () => {
  it('maps one mode at a time', () => {
    expect(lampIntentFromPilot({ state: true })).toEqual({ kind: 'power', on: true });
    expect(lampIntentFromPilot({ state: true, temp: 2700 })).toEqual({ kind: 'temp', temp: 2700 });
    expect(lampIntentFromPilot({ r: 1, g: 2, b: 3 })).toEqual({ kind: 'color', rgb: { r: 1, g: 2, b: 3 } });
    expect(lampIntentFromPilot({ sceneId: 6 })).toEqual({ kind: 'scene', sceneId: 6 });
    expect(lampIntentFromPilot({ sceneId: 99 })).toBeNull();
    expect(lampIntentFromPilot({})).toBeNull();
  });
});
