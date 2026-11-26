import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GIMBAL_NO_PHONE, gimbalPress, gimbalTileState, planHasGimbal } from '../../src/canvas/gimbalTile';
import { coerceSurfacePlan, expandPlan, SECOND_GIMBAL_NOTE, type SurfacePlan } from '../../src/canvas/surfacePlan';
import { standardControls } from '../../src/canvas/controlSpec';
import { gateMessages } from '../../src/canvas/gate';
import { CATALOG_SCHEMAS } from '../../src/canvas/catalogApi';
import { validateCommand } from '../../src/relay/protocol';
import { routeLine } from '../../src/canvas/routeLine';
import { createLocalNetworkCheck, LNA_BLOCKED_LINE, localNetworkBlocked } from '../../src/canvas/localNetwork';
import { createUnreachableLampConnector, createWizAwareConnector, LAMP_NOT_REACHABLE } from '../../src/canvas/wizDevices';
import { applyRealLamps, rememberedLamps } from '../../src/canvas/realLamps';
import { pointConnectFromIdentity } from '../../src/canvas/connectTurns';
import { DeviceError } from '../../src/canvas/deviceActions';

const src = (p: string): string => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');

describe('gimbal tile: status is only what the iPhone reported', () => {
  it('maps the reported gimbal state to the four honest lines', () => {
    expect(gimbalTileState({ gimbal: 'tracking', sensor: false, hands: false, canPoint: true }).status).toBe('Tracking you');
    expect(gimbalTileState({ gimbal: 'hands', sensor: true, hands: false, canPoint: true }).status).toBe('Following your hands');
    // 'hands' without live sensing frames is NOT following — and not confirmed still either
    expect(gimbalTileState({ gimbal: 'hands', sensor: false, hands: false, canPoint: true }).status).toBe('Docked · waiting to see your hands');
    expect(gimbalTileState({ gimbal: 'ready', sensor: false, hands: false, canPoint: true }).status).toBe('Holding still');
    expect(gimbalTileState({ gimbal: 'none', sensor: false, hands: false, canPoint: true })).toMatchObject({ docked: false, status: 'No stand docked' });
    expect(gimbalTileState(null).status).toBe('No stand docked');
    expect(gimbalTileState(null, { paired: false }).status).toBe(GIMBAL_NO_PHONE);
  });

  it('standard controls: Follow me / Follow my hands / Hold still / Nod / Shake and no Centre (aim() is relative only)', () => {
    const labels = standardControls('gimbal').flatMap((c) => (c.kind === 'chips' ? c.options.map((o) => o.label) : [c.label]));
    expect(labels).toEqual(['Follow me', 'Follow my hands', 'Hold still', 'Nod', 'Shake']);
    expect(src('canvas/gimbalTile.ts')).toMatch(/No "Centre" intent: the plugin's aim\(\) is a RELATIVE move/);
  });

  it('a press is only an allow-listed mode or cue', () => {
    expect(gimbalPress('gimbal.mode', 'face')).toEqual({ mode: 'face' });
    expect(gimbalPress('gimbal.mode', 'hands')).toEqual({ mode: 'hands' });
    expect(gimbalPress('gimbal.cue', 'yes')).toEqual({ cue: 'yes' });
    expect(gimbalPress('gimbal.cue', 'no')).toEqual({ cue: 'no' });
    // The wake-up is an allowed cue (spec 5.5): a reviewed "Wake up" button may send it.
    expect(gimbalPress('gimbal.cue', 'wakeup')).toEqual({ cue: 'wakeup' });
    expect(gimbalPress('gimbal.cue', 'spin')).toBeNull();
    expect(gimbalPress('gimbal.mode', 'spin')).toBeNull();
    expect(gimbalPress('lamp.toggle', 'face')).toBeNull();
  });

  it('is a valid catalog tile that passes the gate, with live /gimbal data', () => {
    const plan = coerceSurfacePlan({ kind: 'room', title: 'Room', tiles: [{ type: 'gimbal' }, { type: 'gimbal' }] });
    expect(plan.ok && plan.value.tiles).toEqual([{ type: 'gimbal', label: 'Gimbal' }]);
    expect(plan.ok && plan.notes).toContain(SECOND_GIMBAL_NOTE);
    expect(planHasGimbal((plan as { value: SurfacePlan }).value)).toBe(true);
    const msgs = expandPlan((plan as { value: SurfacePlan }).value, 's1', {}, { gimbal: { docked: true, mode: 'face', status: 'Tracking you' } });
    expect(gateMessages(msgs, CATALOG_SCHEMAS).ok).toBe(true);
    expect(JSON.stringify(msgs)).toContain('"component":"DeviceTile","cls":"gimbal"');
    expect(msgs.at(-1)).toMatchObject({ updateDataModel: { path: '/gimbal', value: { docked: true, mode: 'face', status: 'Tracking you' } } });
  });

  it('nothing adds the tile by itself: a stand docking only updates the tiles that are there', () => {
    const app = src('canvas/canvasApp.ts');
    expect(app).not.toMatch(/addGimbalTile|gimbalReported|gimbalOnNewDashboard/);
    expect(app).toMatch(/if \(platform === 'ios'\) \{ if \(sense && sense\.gimbal !== 'none'\) gimbalError = ''; pushGimbal\(\); \}/);
  });

  it('"add the gimbal" / "gimbal controls" are an ordinary board turn; "follow me" stays a gimbal phrase', () => {
    for (const t of ['add the gimbal', 'gimbal controls', 'Add gimbal controls.', 'add gimbal controls', 'show the gimbal tile', 'add the gimbal to the dashboard']) {
      expect(routeLine(t, { hasPlanBoard: false, devices: [] }).name).toBe('connectRoom');
    }
    expect(routeLine('follow me', { hasPlanBoard: false, devices: [] }).name).toBe('gimbal');
  });

  it('the relay carries a mode as one allow-listed word, host → phone only', () => {
    expect(validateCommand({ kind: 'gimbalMode', text: 'hands' })).toEqual({ kind: 'gimbalMode', text: 'hands' });
    expect(validateCommand({ kind: 'gimbalMode', text: 'turn left' })).toBeNull();
    expect(validateCommand({ kind: 'gimbalMode' })).toBeNull();
    const session = src('relay/session.ts');
    expect(session).toMatch(/msg\.from === 'host' && msg\.cmd\.kind === 'gimbalMode'/);
    const app = src('canvas/canvasApp.ts');
    // one path: the tile and "follow me" both go through gimbalMode(); the
    // iPhone drives its local plugin, the laptop asks the iPhone
    expect(app).toMatch(/if \(p\) gimbalTilePress\(p\); else say\(NOT_THIS_DEVICE_REFUSAL\)/);
    expect(app).toMatch(/gimbalMode\(g\); return true;/);
    expect(app).toMatch(/inputs\.gimbal\.setMode\(mode, \{ explicit: true \}\)/);
    expect(app).toMatch(/hostSession!\.sendGimbalMode\(mode\)/);
    expect(app).toMatch(/bodyLanguage\(press\.cue\)/);
    expect(src('canvas/canvasMain.ts')).toMatch(/s\?\.onGimbalMode\?\.\(\(mode\) => h\.gimbalMode\(mode\)\)/);
  });
});

describe('honest lamps in live mode', () => {
  const mem = (ids: string[]) => {
    const m = new Map<string, string>();
    m.set('mendcraft.wizLamps', JSON.stringify({ v: 2, ids: Object.fromEntries(ids.map((id, i) => [`h${String(i).padStart(16, '0')}`, id])), last: ids }));
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  };
  it('remembered real lamps start "Not reachable"; none remembered → the placeholders leave and the board offers Connect', () => {
    expect(rememberedLamps(mem(['wiz-lamp-1']))![0].state).toMatchObject({ sim: true, unreachable: true });
    const state: Record<string, { on: boolean; brightness: number }> = { 'wiz-lamp-1': { on: false, brightness: 40 }, 'wiz-lamp-2': { on: true, brightness: 70 }, 'speaker-a': { on: false, brightness: 0 } };
    const surfaces: Record<string, SurfacePlan> = { room: { kind: 'room', title: 'Living room', tiles: [{ type: 'lamp', deviceId: 'wiz-lamp-1', label: 'Desk lamp' }, { type: 'lamp', deviceId: 'wiz-lamp-2', label: 'Ceiling light' }] } };
    applyRealLamps({ store: { all: () => ({ ...state }), add: () => {}, remove: (id) => { delete state[id]; } }, surfaces, labels: {}, ips: new Map() }, []);
    expect(Object.keys(state)).toEqual(['speaker-a']);
    expect(surfaces.room.tiles).toEqual([{ type: 'connect', label: 'Connect a device' }]);
    const app = src('canvas/canvasApp.ts');
    expect(app).toMatch(/if \(liveLamps\) \{[\s\S]{0,200}applyRealLamps\(lampSwap, rememberedLamps\(storage\) \?\? \[\]\);/);
    expect(app).toMatch(/const liveLamps = !opts\.sim && !opts\.devices && !opts\.connector;/);
  });
  it('an unreachable lamp is refused, never simulated', async () => {
    const fallback = { run: async () => ({ on: true }) };
    await expect(createUnreachableLampConnector(fallback).run({ deviceId: 'wiz-lamp-1', on: true })).rejects.toThrow(LAMP_NOT_REACHABLE);
    await expect(createUnreachableLampConnector(fallback).run({ deviceId: 'speaker-a', playing: true })).resolves.toEqual({ on: true });
    const down = createWizAwareConnector({ client: {} as never, fallback, status: { up: false }, honest: true });
    await expect(down.run({ deviceId: 'wiz-lamp-1', on: true })).rejects.toBeInstanceOf(DeviceError);
    const sim = createWizAwareConnector({ client: {} as never, fallback, status: { up: false } });
    await expect(sim.run({ deviceId: 'wiz-lamp-1', on: true })).resolves.toMatchObject({ sim: true });
  });
});

describe('review fixes: bridge drop and recovery, stale gimbal status', () => {
  it('the bridge dropping mid-session reports once; a refused press asks for a re-check', async () => {
    let down = 0, refused = 0;
    const status = { up: true };
    const client = { setPilot: async () => { throw new Error('ECONNREFUSED'); } } as never;
    const c = createWizAwareConnector({ client, fallback: { run: async () => ({}) }, status, honest: true, onDown: () => { down++; }, onRefusedUnreachable: () => { refused++; } });
    await expect(c.run({ deviceId: 'wiz-lamp-1', on: true })).rejects.toThrow(LAMP_NOT_REACHABLE);
    expect(status.up).toBe(false);
    expect(down).toBe(1);
    expect(refused).toBe(1);
    await expect(c.run({ deviceId: 'wiz-lamp-1', on: true })).rejects.toThrow(LAMP_NOT_REACHABLE);
    expect(down).toBe(1); // already down: not reported again
    const app = src('canvas/canvasApp.ts');
    expect(app).toMatch(/onDown: \(\) => \{ bridgeWentDown\(\); \}/);
    expect(app).toMatch(/if \(liveLamps\) store\.patch\(id, \{ sim: true, unreachable: true \}\);/);
    // throttled re-discovery: every 30 s while a lamp is unreachable, and on a refused press
    expect(app).toMatch(/const REDISCOVER_MS = 30_000;/);
    expect(app).toMatch(/Date\.now\(\) - lastDiscoverAt < REDISCOVER_MS\) return;/);
    expect(app).toMatch(/onRefusedUnreachable: \(\) => \{ void rediscoverLamps\(\); \}/);
  });
  it('a re-discovered lamp is reachable again', () => {
    const state: Record<string, { on: boolean; brightness: number; sim?: boolean; unreachable?: boolean }> = { 'wiz-lamp-1': { on: false, brightness: 50, sim: true, unreachable: true } };
    applyRealLamps({ store: { all: () => ({ ...state }), add: (id, s) => { state[id] = s; }, remove: (id) => { delete state[id]; } }, surfaces: {}, labels: {}, ips: new Map() },
      [{ id: 'wiz-lamp-1', ip: '192.168.1.40', label: 'Lamp', state: { on: true, brightness: 60, sim: false, unreachable: false } }]);
    expect(state['wiz-lamp-1']).toMatchObject({ sim: false, unreachable: false });
    expect(src('canvas/realLamps.ts')).toMatch(/sim: false, unreachable: false \}/);
  });
  it('the tile reads the iPhone\'s report only while that iPhone is paired; disconnect forgets it', () => {
    const app = src('canvas/canvasApp.ts');
    expect(app).toMatch(/else if \(iphonePaired\(\) && phoneSense\.has\('ios'\)\) g = gimbalTileState/);
    expect(app).toMatch(/announceGate\.clear\(\);\s*forgetPhoneSense\(\);/);
    expect(app).toMatch(/pairFirst\.clearReal\(\);\s*forgetPhoneSense\(\);/);
  });
});

describe('Chrome local network access', () => {
  it('denied under either permission name → blocked; unknown names are not', async () => {
    expect(await localNetworkBlocked({ query: async ({ name }) => ({ state: name === 'local-network-access' ? 'denied' : 'granted' }) })).toBe(true);
    expect(await localNetworkBlocked({ query: async ({ name }) => { if (name === 'local-network-access') throw new TypeError('unknown'); return { state: 'denied' }; } })).toBe(true);
    expect(await localNetworkBlocked({ query: async () => { throw new TypeError('unknown'); } })).toBe(false);
    expect(await localNetworkBlocked({ query: async () => ({ state: 'prompt' }) })).toBe(false);
    expect(await localNetworkBlocked(null)).toBe(false);
  });
  it('the line is logged once', async () => {
    const logs: string[] = [];
    const c = createLocalNetworkCheck({ query: async () => ({ state: 'denied' }) }, (l) => logs.push(l));
    expect(await c.line()).toBe(LNA_BLOCKED_LINE);
    expect(await c.line()).toBe(LNA_BLOCKED_LINE);
    expect(logs).toEqual([LNA_BLOCKED_LINE]);
  });
});

describe('point identify: a smart bulb is her real lamp', () => {
  const bulb = { identity: { kind: 'smart-bulb', brand: '', model: '', label: 'Smart bulb', confidence: 0.9 }, source: 'on-device' as const };
  const lamp = { id: 'wiz-lamp-1', label: 'Lamp', kind: 'lamp' };
  it('proposes the reachable real lamp', () => {
    const out = pointConnectFromIdentity(bulb as never, { devices: [lamp], realLamps: ['wiz-lamp-1'] });
    expect(out.ok).toBe(true);
    expect(JSON.stringify(out)).toContain('wiz-lamp-1');
  });
  it('without a reachable lamp it is not proposed, and canvasApp says why', () => {
    expect(pointConnectFromIdentity(bulb as never, { devices: [lamp], realLamps: [] }).ok).toBe(false);
    expect(src('canvas/canvasApp.ts')).toMatch(/say\(\(await lna\.line\(\)\) \|\| BULB_UNREACHABLE_LINE/);
  });
});
