import { describe, expect, it } from 'vitest';
import { applyRealLamps, assignLampIds, discoverRealLamps, type LampSwapTarget, type RealLamp } from '../../src/canvas/realLamps';
import type { WizClient } from '../../src/devices/wizClient';
import type { DeviceState, SurfacePlan } from '../../src/canvas/surfacePlan';

// Review sim-2 §6 (I3 follow-ups).
function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}
function bridge(bulbs: Array<{ ip: string; mac?: string }>, defaultBulb = false): WizClient {
  return {
    baseUrl: 'http://127.0.0.1:38888',
    async health() { return true; },
    async discover() { return bulbs.map((b) => ({ ip: b.ip, mac: b.mac, state: { on: true, dimming: 50 } })); },
    async getPilot(ip) { if (!ip && defaultBulb) return { on: true, dimming: 50 }; if (bulbs.some((b) => b.ip === ip)) return { on: true }; throw new Error('no'); },
    async setPilot() { return null; },
  } as unknown as WizClient;
}

describe('the same bulb at a new address keeps its lamp (and its saved tile)', () => {
  it('one bulb, new address, same MAC → same id', async () => {
    const s = memory();
    const a = await discoverRealLamps(bridge([{ ip: '192.168.1.20', mac: 'a8bb50aa0001' }]), s);
    const b = await discoverRealLamps(bridge([{ ip: '192.168.1.37', mac: 'a8bb50aa0001' }]), s);
    expect(a![0].id).toBe('wiz-lamp-1');
    expect(b![0].id).toBe('wiz-lamp-1');
    expect(b![0].ip).toBe('192.168.1.37');
  });

  it('a bulb remembered by address (older build) is found again by its MAC, then follows the MAC', () => {
    const s = memory();
    expect(assignLampIds(['192.168.1.20'], s)).toEqual({ '192.168.1.20': 'wiz-lamp-1' });
    expect(assignLampIds(['192.168.1.20', '192.168.1.30'], s, ['m1', 'm2'])).toEqual({ '192.168.1.20': 'wiz-lamp-1', '192.168.1.30': 'wiz-lamp-2' });
    expect(assignLampIds(['192.168.1.31', '192.168.1.44'], s, ['m2', 'm1'])).toEqual({ '192.168.1.31': 'wiz-lamp-2', '192.168.1.44': 'wiz-lamp-1' });
  });

  it('the review probe: a bulb an older build knew at .20 answers at .37 with its MAC → the same id, so its saved tile is live', () => {
    const s = memory();
    expect(assignLampIds(['192.168.1.20'], s)).toEqual({ '192.168.1.20': 'wiz-lamp-1' });
    expect(assignLampIds(['192.168.1.37'], s, ['a8bb50aa0001'])).toEqual({ '192.168.1.37': 'wiz-lamp-1' });
    expect(assignLampIds(['192.168.1.52'], s, ['a8bb50aa0001'])).toEqual({ '192.168.1.52': 'wiz-lamp-1' });
  });

  it("the review's two-bulb sequence: both, only the second, none (default bulb), both again → the same two ids", async () => {
    const s = memory();
    const one = { ip: '192.168.1.20', mac: 'mac-one' }, two = { ip: '192.168.1.30', mac: 'mac-two' };
    expect((await discoverRealLamps(bridge([one, two]), s))!.map((l) => l.id)).toEqual(['wiz-lamp-1', 'wiz-lamp-2']);
    expect((await discoverRealLamps(bridge([two]), s))!.map((l) => l.id)).toEqual(['wiz-lamp-2']);
    expect((await discoverRealLamps(bridge([], true), s))!.map((l) => l.id)).toEqual(['wiz-lamp-2']);
    expect((await discoverRealLamps(bridge([one, two]), s))!.map((l) => l.id)).toEqual(['wiz-lamp-1', 'wiz-lamp-2']);
  });
});

describe('discovery re-renders only a board whose lamp came or went', () => {
  const lamp = (id: string): RealLamp => ({ id, ip: '1.2.3.4', label: 'Lamp', state: { on: true, brightness: 50, sim: false, unreachable: false } });
  function canvas(): LampSwapTarget {
    const state: Record<string, DeviceState> = {};
    return {
      store: { all: () => state, add: (id, st) => { state[id] = st; }, remove: (id) => { delete state[id]; } },
      surfaces: {
        a: { kind: 'room', title: 'A', tiles: [{ type: 'lamp', deviceId: 'wiz-lamp-1', label: 'Lamp' }] },
        b: { kind: 'room', title: 'B', tiles: [{ type: 'lamp', deviceId: 'wiz-lamp-2', label: 'Lamp 2' }] },
      } as Record<string, SurfacePlan>,
      labels: {},
      ips: new Map(),
    };
  }
  it('a tile still missing its lamp is not rebuilt every 30 s; only the board whose lamp answered is', () => {
    const c = canvas();
    expect(applyRealLamps(c, [lamp('wiz-lamp-1')]).sort()).toEqual(['a']);
    // the next looks: the same lamp, wiz-lamp-2 still missing → nothing to rebuild
    expect(applyRealLamps(c, [lamp('wiz-lamp-1')])).toEqual([]);
    expect(applyRealLamps(c, [lamp('wiz-lamp-1')])).toEqual([]);
    // wiz-lamp-2 answers → only board b
    expect(applyRealLamps(c, [lamp('wiz-lamp-1'), lamp('wiz-lamp-2')])).toEqual(['b']);
    // wiz-lamp-1 goes → only board a
    expect(applyRealLamps(c, [lamp('wiz-lamp-2')])).toEqual(['a']);
  });
});
