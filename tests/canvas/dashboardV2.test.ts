// Dashboard v2: gesture-first device tiles (no sliders), the lamp's colours /
// scenes / whites through the real device path with range REFUSAL, voice
// routes for them, and room boards that never scroll inside themselves.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createActQueue, createDeviceStore, lampLook, simulatedAck, tileIntent, type DeviceConnector, type DeviceIntent } from '../../src/canvas/deviceActions';
import { mountItemHandles } from '../../src/canvas/editBoard';
import { COLOUR_RANGE_REFUSAL, LAMP_RANGE_REFUSAL, SCENE_REFUSAL, TEMP_RANGE_REFUSAL, levelRefusal } from '../../src/canvas/deviceGuard';
import { parseDeviceCommands, type DeviceRef } from '../../src/canvas/deviceCommands';
import { reduceA2uiMessages, renderNodeToDom, type FallbackAction } from '../../src/canvas/fallbackRenderer';
import { gateMessages } from '../../src/canvas/gate';
import { CATALOG_SCHEMAS } from '../../src/canvas/catalogApi';
import {
  BRIGHTNESS_PRESETS, LAMP_COLOURS, LAMP_SCENES, VOLUME_PRESETS, WHITE_PRESETS,
  activeColourKey, colourFromSpeech, lampStateLine, rangeNudge, rangePresets, rangeStep, sceneFromSpeech, tempStep,
} from '../../src/canvas/lampPresets';
import { routeLine } from '../../src/canvas/routeLine';
import { coerceSurfacePlan, expandPlan, type DeviceState } from '../../src/canvas/surfacePlan';
import { impossibleAttempt } from '../../src/canvas/tryToBreak';
import { createWizAwareConnector, wizIntentFor } from '../../src/canvas/wizDevices';
import { focusWholeBoard, ROOM_MIN_Z } from '../../src/canvas/camera';
import { fitFocusedSize, ROOM_MAX_W } from '../../src/canvas/canvasApp';
import { BridgeRefusedError, createWizClient, type WizClient } from '../../src/devices/wizClient';
import { WIZ_SCENES, isWizScene, pilotParamsForIntent } from '../../src/devices/wiz';
import { SCENE_ID_MAX, validateParams } from '../../scripts/wizBridge.lib.mjs';

const lamp = (over: Partial<DeviceState> = {}): DeviceState => ({ on: true, brightness: 60, ...over });
const devices: DeviceRef[] = [
  { id: 'wiz-desk', label: 'Desk lamp', kind: 'lamp', on: true, brightness: 60 },
  { id: 'wiz-ceiling', label: 'Ceiling light', kind: 'lamp', on: false, brightness: 40 },
  { id: 'speaker-1', label: 'Speaker', kind: 'music', volume: 40 },
];

describe('lamp presets match what a WiZ bulb accepts', () => {
  it('offers 5 brightness chips, 8 colours, 6 scenes and 3 whites — all inside the bulb\'s ranges', () => {
    expect(BRIGHTNESS_PRESETS).toEqual([10, 25, 50, 75, 100]);
    expect(LAMP_COLOURS.map((c) => c.label)).toEqual(['Warm white', 'Daylight', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple']);
    expect(LAMP_SCENES.map((s) => s.label)).toEqual(['Relax', 'Focus', 'Cozy', 'Night light', 'Sunset', 'Party']);
    expect(WHITE_PRESETS.map((w) => w.label)).toEqual(['Warm', 'Neutral', 'Cool']);
    expect(VOLUME_PRESETS.map((v) => v.label)).toEqual(['Quiet', 'Medium', 'Loud']);
    for (const c of LAMP_COLOURS) expect(levelRefusal(c.rgb ? { rgb: c.rgb } : { temp: c.temp })).toBeNull();
    for (const w of WHITE_PRESETS) expect(levelRefusal({ temp: w.temp })).toBeNull();
    for (const s of LAMP_SCENES) { expect(isWizScene(s.sceneId)).toBe(true); expect(WIZ_SCENES[s.sceneId]).toBe(s.label); }
    for (const b of BRIGHTNESS_PRESETS) expect(levelRefusal({ brightness: b })).toBeNull();
  });

  it('scene ids are the documented WiZ ones', () => {
    expect(WIZ_SCENES).toMatchObject({ 1: 'Ocean', 2: 'Romance', 3: 'Sunset', 4: 'Party', 5: 'Fireplace', 6: 'Cozy', 11: 'Warm white', 12: 'Daylight', 13: 'Cool white', 14: 'Night light', 15: 'Focus', 16: 'Relax', 17: 'True colors', 18: 'TV time', 19: 'Plant growth', 29: 'Candlelight' });
    expect(Math.max(...Object.keys(WIZ_SCENES).map(Number))).toBe(SCENE_ID_MAX);
  });

  it('warmer / cooler step the white and stay inside 2200–6500 K', () => {
    expect(tempStep(4000, -1)).toBe(3500);
    expect(tempStep(undefined, 1)).toBe(4500);
    expect(tempStep(2300, -1)).toBe(2200);
    expect(tempStep(6400, 1)).toBe(6500);
  });

  it('the state line names the look; the active swatch follows the state', () => {
    expect(lampStateLine({ on: false, brightness: 40 })).toBe('Off');
    expect(lampStateLine({ on: true, brightness: 70, sceneId: 3 })).toBe('On · 70% · Sunset');
    expect(lampStateLine({ on: true, brightness: 40, color: '#0000ff' })).toBe('On · 40% · Blue');
    expect(lampStateLine({ on: true, brightness: 40, temp: 4000 })).toBe('On · 40% · 4000 K');
    expect(activeColourKey({ color: '#0000ff' })).toBe('blue');
    expect(activeColourKey({ temp: 2700 })).toBe('warm-white');
    expect(activeColourKey({ color: '#0000ff', sceneId: 3 })).toBe('');
  });
});

describe('validation refuses out-of-range values (never clamps)', () => {
  it('levelRefusal covers brightness, white, colour and scene', () => {
    expect(levelRefusal({ brightness: 500 })).toBe(LAMP_RANGE_REFUSAL);
    expect(levelRefusal({ temp: 9000 })).toBe(TEMP_RANGE_REFUSAL);
    expect(levelRefusal({ temp: 1000 })).toBe(TEMP_RANGE_REFUSAL);
    expect(levelRefusal({ rgb: { r: 300, g: 0, b: 0 } })).toBe(COLOUR_RANGE_REFUSAL);
    expect(levelRefusal({ rgb: { r: -1, g: 0, b: 0 } })).toBe(COLOUR_RANGE_REFUSAL);
    expect(levelRefusal({ rgb: { r: 1.5, g: 0, b: 0 } })).toBe(COLOUR_RANGE_REFUSAL);
    expect(levelRefusal({ sceneId: 99 })).toBe(SCENE_REFUSAL);
    expect(levelRefusal({ sceneId: 0 })).toBe(SCENE_REFUSAL);
    expect(levelRefusal({ temp: 2200, brightness: 10 })).toBeNull();
  });

  it('the store refuses each one: nothing changes and the connector is never called', async () => {
    const run = vi.fn(async () => ({}));
    const store = createDeviceStore({ 'wiz-desk': lamp({ color: '#00ff00' }) }, { run }, () => {}, () => null);
    const bad: DeviceIntent[] = [
      { deviceId: 'wiz-desk', brightness: 500 },
      { deviceId: 'wiz-desk', temp: 9000 },
      { deviceId: 'wiz-desk', rgb: { r: 999, g: 0, b: 0 } },
      { deviceId: 'wiz-desk', sceneId: 99 },
    ];
    for (const i of bad) {
      const s = await store.act(i);
      expect(s.error).toMatch(/Nothing changed\.$/);
      expect(s).toMatchObject({ on: true, brightness: 60, color: '#00ff00' });
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('try-to-break still refuses 500 %', () => {
    expect(impossibleAttempt('set the desk lamp to 500% brightness', devices)).toMatchObject({ kind: 'brightness', level: 500 });
    expect(impossibleAttempt('set the desk lamp to 50%', devices)).toBeNull();
  });

  it('the bridge refuses bad params with a reason and passes good ones through unchanged', () => {
    expect(validateParams({ state: true, dimming: 60 })).toEqual({ ok: true, params: { state: true, dimming: 60 } });
    expect(validateParams({ state: true, r: 0, g: 0, b: 255 })).toEqual({ ok: true, params: { state: true, r: 0, g: 0, b: 255 } });
    expect(validateParams({ state: true, temp: 2700 })).toEqual({ ok: true, params: { state: true, temp: 2700 } });
    expect(validateParams({ state: true, sceneId: 3 })).toEqual({ ok: true, params: { state: true, sceneId: 3 } });
    const refused = [
      { dimming: 500 }, { dimming: 5 }, { dimming: 50.5 }, { dimming: '60' },
      { temp: 9000 }, { temp: 2199 },
      { r: 256, g: 0, b: 0 }, { r: -1, g: 0, b: 0 }, { r: 10 }, { r: 1, g: 2 },
      { sceneId: 0 }, { sceneId: 33 }, { sceneId: 1000 },
      { state: 'on' }, { speed: 100 }, { evil: 'x', state: true },
      { temp: 2700, sceneId: 3 }, { r: 1, g: 2, b: 3, temp: 2700 },
      {}, null, [1],
    ];
    for (const p of refused) {
      const v = validateParams(p as never);
      expect(v.ok, JSON.stringify(p)).toBe(false);
      if (!v.ok) expect(v.error.length).toBeGreaterThan(0);
    }
  });

  it('the bridge script validates /setPilot with validateParams and answers 400', () => {
    const src = readFileSync('scripts/wiz-bridge.mjs', 'utf8');
    expect(src).toMatch(/validateParams\(body\.params\)/);
    expect(src).toMatch(/if \(!checked\.ok\) return send\(res, origin, 400/);
    expect(src).not.toMatch(/sanitizeParams\(body\.params\)/);
  });

  it('a 400 from the bridge is a refusal (not "offline") in the client', async () => {
    const client = createWizClient('http://127.0.0.1:38888', async () => ({ ok: false, status: 400, json: async () => ({ error: 'dimming must be a whole number from 10 to 100' }) }), 't');
    await expect(client.setPilot('192.168.1.5', { kind: 'dim', dimming: 50 })).rejects.toBeInstanceOf(BridgeRefusedError);
  });
});

describe('lamp intents reach the bulb as the right setPilot params', () => {
  it('pilotParamsForIntent builds r/g/b, temp and sceneId', () => {
    expect(pilotParamsForIntent({ kind: 'color', rgb: { r: 0, g: 0, b: 255 } })).toEqual({ state: true, r: 0, g: 0, b: 255 });
    expect(pilotParamsForIntent({ kind: 'temp', temp: 2700 })).toEqual({ state: true, temp: 2700 });
    expect(pilotParamsForIntent({ kind: 'scene', sceneId: 3 })).toEqual({ state: true, sceneId: 3 });
    expect(pilotParamsForIntent({ kind: 'scene', sceneId: 99 })).toEqual({ state: true }); // never guessed into another scene
    for (const s of LAMP_SCENES) expect(validateParams(pilotParamsForIntent({ kind: 'scene', sceneId: s.sceneId })).ok).toBe(true);
    for (const c of LAMP_COLOURS) expect(validateParams(pilotParamsForIntent(c.rgb ? { kind: 'color', rgb: c.rgb } : { kind: 'temp', temp: c.temp! })).ok).toBe(true);
  });

  it('wizIntentFor picks one bulb mode per intent', () => {
    expect(wizIntentFor({ deviceId: 'wiz-lamp-1', on: true, sceneId: 3 })).toEqual({ kind: 'scene', sceneId: 3 });
    expect(wizIntentFor({ deviceId: 'wiz-lamp-1', on: true, rgb: { r: 255, g: 0, b: 0 } })).toEqual({ kind: 'color', rgb: { r: 255, g: 0, b: 0 } });
    expect(wizIntentFor({ deviceId: 'wiz-lamp-1', on: true, temp: 4000 })).toEqual({ kind: 'temp', temp: 4000 });
    expect(wizIntentFor({ deviceId: 'wiz-lamp-1', on: true, brightness: 50 })).toEqual({ kind: 'dim', dimming: 50 });
    expect(wizIntentFor({ deviceId: 'wiz-lamp-1', on: false })).toEqual({ kind: 'power', on: false });
  });

  function rig(setPilot: WizClient['setPilot'], up = true) {
    const client: WizClient = { baseUrl: 'x', health: async () => true, discover: async () => [], getPilot: async () => ({ on: true }), setPilot: vi.fn(setPilot) };
    const fallback: DeviceConnector = { run: vi.fn(async (i) => simulatedAck(lamp(), i)) };
    const status = { up };
    return { client, fallback, status, c: createWizAwareConnector({ client, fallback, status }) };
  }

  it('store → wizAware connector → bridge client, for a colour, a white and a scene (any wiz- id, not a hard-coded one)', async () => {
    const r = rig(async (_ip, intent) => (intent.kind === 'scene' ? { on: true, dimming: 60, sceneId: intent.sceneId }
      : intent.kind === 'color' ? { on: true, dimming: 60, rgb: intent.rgb } : intent.kind === 'temp' ? { on: true, dimming: 60, temp: intent.temp } : { on: true }));
    const store = createDeviceStore({ 'wiz-lamp-7': lamp() }, r.c, () => {}, () => null);
    expect(await store.act(tileIntent('lamp.color', 'wiz-lamp-7', lamp(), 'blue')!)).toMatchObject({ on: true, color: '#0000ff', sceneId: 0, temp: 0, sim: false, error: '' });
    expect(r.client.setPilot).toHaveBeenLastCalledWith('', { kind: 'color', rgb: { r: 0, g: 0, b: 255 } });
    expect(await store.act(tileIntent('lamp.scene', 'wiz-lamp-7', lamp(), 'sunset')!)).toMatchObject({ sceneId: 3, color: '', temp: 0 });
    expect(r.client.setPilot).toHaveBeenLastCalledWith('', { kind: 'scene', sceneId: 3 });
    expect(await store.act(tileIntent('lamp.white', 'wiz-lamp-7', lamp(), 'cool')!)).toMatchObject({ temp: 6500, color: '', sceneId: 0 });
    expect(r.client.setPilot).toHaveBeenLastCalledWith('', { kind: 'temp', temp: 6500 });
    expect(r.fallback.run).not.toHaveBeenCalled();
  });

  it('bridge down: the simulated lamp takes the change and keeps its SIM label', async () => {
    const r = rig(async () => ({ on: true }), false);
    const ack = await r.c.run({ deviceId: 'wiz-lamp-7', on: true, sceneId: 16 });
    expect(r.client.setPilot).not.toHaveBeenCalled();
    expect(ack).toMatchObject({ on: true, sceneId: 16, sim: true });
    const dropped = rig(async () => { throw new Error('socket hang up'); });
    expect(await dropped.c.run({ deviceId: 'wiz-lamp-7', on: true, rgb: { r: 255, g: 0, b: 0 } })).toMatchObject({ color: '#ff0000', sim: true });
    expect(dropped.status.up).toBe(false);
  });

  it('a bridge refusal is shown as a refusal: nothing is simulated in its place', async () => {
    const r = rig(async () => { throw new BridgeRefusedError('temp must be a whole number from 2200 to 6500'); });
    const store = createDeviceStore({ 'wiz-lamp-7': lamp({ temp: 4000 }) }, r.c, () => {}, () => null);
    const s = await store.act({ deviceId: 'wiz-lamp-7', on: true, temp: 3000 });
    expect(s).toMatchObject({ temp: 4000, error: 'Lamp refused the change' });
    expect(r.fallback.run).not.toHaveBeenCalled();
    expect(r.status.up).toBe(true);
  });
});

describe('a tile press is one intent', () => {
  it('maps every lamp and speaker control', () => {
    const cur = lamp({ brightness: 60, temp: 4000, volume: 40, playing: false });
    expect(tileIntent('lamp.toggle', 'd', cur)).toEqual({ deviceId: 'd', on: false });
    expect(tileIntent('lamp.brighter', 'd', cur)).toEqual({ deviceId: 'd', on: true, brightness: 70 });
    expect(tileIntent('lamp.dimmer', 'd', cur)).toEqual({ deviceId: 'd', brightness: 50 });
    expect(tileIntent('lamp.dimmer', 'd', lamp({ brightness: 10 }))).toEqual({ deviceId: 'd', brightness: 10 });
    expect(tileIntent('lamp.level', 'd', cur, 25)).toEqual({ deviceId: 'd', on: true, brightness: 25 });
    expect(tileIntent('lamp.color', 'd', cur, 'red')).toEqual({ deviceId: 'd', on: true, rgb: { r: 255, g: 0, b: 0 } });
    expect(tileIntent('lamp.color', 'd', cur, 'daylight')).toEqual({ deviceId: 'd', on: true, temp: 5000 });
    expect(tileIntent('lamp.scene', 'd', cur, 'party')).toEqual({ deviceId: 'd', on: true, sceneId: 4 });
    expect(tileIntent('lamp.white', 'd', cur, 'neutral')).toEqual({ deviceId: 'd', on: true, temp: 4000 });
    expect(tileIntent('lamp.warmer', 'd', cur)).toEqual({ deviceId: 'd', on: true, temp: 3500 });
    expect(tileIntent('lamp.cooler', 'd', cur)).toEqual({ deviceId: 'd', on: true, temp: 4500 });
    expect(tileIntent('music.playPause', 'd', cur)).toEqual({ deviceId: 'd', playing: true });
    expect(tileIntent('music.previous', 'd', cur)).toEqual({ deviceId: 'd', previous: true });
    expect(tileIntent('music.next', 'd', cur)).toEqual({ deviceId: 'd', next: true });
    expect(tileIntent('music.louder', 'd', cur)).toEqual({ deviceId: 'd', volume: 50 });
    expect(tileIntent('music.softer', 'd', cur)).toEqual({ deviceId: 'd', volume: 30 });
    expect(tileIntent('music.volume', 'd', cur, 80)).toEqual({ deviceId: 'd', volume: 80 });
  });

  it('an unknown preset key or action is nothing (never a guess)', () => {
    expect(tileIntent('lamp.color', 'd', lamp(), 'ultraviolet')).toBeNull();
    expect(tileIntent('lamp.scene', 'd', lamp(), 'rave')).toBeNull();
    expect(tileIntent('lamp.level', 'd', lamp())).toBeNull();
    expect(tileIntent('lamp.explode', 'd', lamp())).toBeNull();
  });

  it('a level typed straight in (keyboard fine control) is still range-checked by the store', async () => {
    const run = vi.fn(async (i: DeviceIntent) => simulatedAck(lamp(), i));
    const store = createDeviceStore({ d: lamp() }, { run }, () => {}, () => null);
    expect((await store.act(tileIntent('lamp.level', 'd', lamp(), 500)!)).error).toBe(LAMP_RANGE_REFUSAL);
    expect((await store.act(tileIntent('lamp.white', 'd', lamp(), 9000)!)).error).toBe(TEMP_RANGE_REFUSAL);
    expect(run).not.toHaveBeenCalled();
  });

  it('the built-in (SIM) device does what it was asked: a colour, a white and a scene replace each other', () => {
    expect(lampLook({ deviceId: 'd', sceneId: 3 })).toEqual({ sceneId: 3, color: '', temp: 0 });
    expect(simulatedAck(lamp({ on: false }), { deviceId: 'd', rgb: { r: 0, g: 255, b: 0 } })).toMatchObject({ on: true, color: '#00ff00', sceneId: 0, temp: 0 });
    const tracks = ['A', 'B', 'C'];
    expect(simulatedAck(lamp({ trackTitle: 'A' }), { deviceId: 'd', previous: true }, tracks)).toMatchObject({ trackTitle: 'C', playing: true });
    expect(simulatedAck(lamp({ trackTitle: 'A' }), { deviceId: 'd', next: true }, tracks)).toMatchObject({ trackTitle: 'B', playing: true });
  });
});

describe('voice routes to the new controls', () => {
  const world = { hasPlanBoard: false, devices };
  const intents = (text: string) => {
    const r = routeLine(text, world);
    return r.name === 'device' ? r.result.intents : r.name;
  };

  it('"make the lamp blue" sets a colour', () => {
    expect(intents('make the desk lamp blue')).toEqual([{ deviceId: 'wiz-desk', on: true, rgb: { r: 0, g: 0, b: 255 } }]);
    expect(intents('make the lamp blue')).toEqual([
      { deviceId: 'wiz-desk', on: true, rgb: { r: 0, g: 0, b: 255 } }, { deviceId: 'wiz-ceiling', on: true, rgb: { r: 0, g: 0, b: 255 } },
    ]);
    expect(intents('turn the ceiling light purple')).toEqual([{ deviceId: 'wiz-ceiling', on: true, rgb: { r: 160, g: 0, b: 255 } }]);
  });

  it('"set the lamp to sunset" sets a scene; any scene the bulb knows works', () => {
    expect(intents('set the desk lamp to sunset')).toEqual([{ deviceId: 'wiz-desk', on: true, sceneId: 3 }]);
    expect(intents('set the lamp to night light')).toEqual([{ deviceId: 'wiz-desk', on: true, sceneId: 14 }, { deviceId: 'wiz-ceiling', on: true, sceneId: 14 }]);
    expect(intents('party scene')).toEqual([{ deviceId: 'wiz-desk', on: true, sceneId: 4 }, { deviceId: 'wiz-ceiling', on: true, sceneId: 4 }]);
    expect(sceneFromSpeech('candlelight please')).toEqual({ sceneId: 29, label: 'Candlelight' });
    expect(colourFromSpeech('violet')?.key).toBe('purple');
  });

  it('"warmer" / "cooler" change the white', () => {
    expect(intents('warmer')).toEqual([{ deviceId: 'wiz-desk', on: true, temp: 3500 }, { deviceId: 'wiz-ceiling', on: true, temp: 3500 }]);
    expect(intents('make the desk lamp cooler')).toEqual([{ deviceId: 'wiz-desk', on: true, temp: 4500 }]);
  });

  it('a colour or scene word alone, or next to "off", is not a lamp command', () => {
    expect(parseDeviceCommands('blue', devices)).toBeNull();
    expect(parseDeviceCommands('sunset', devices)).toBeNull();
    expect(intents('turn the lights off after the party')).toEqual([{ deviceId: 'wiz-desk', on: false }, { deviceId: 'wiz-ceiling', on: false }]);
    expect(intents('set the desk lamp to 50%')).toEqual([{ deviceId: 'wiz-desk', on: true, brightness: 50 }]);
  });

  it('speaker: previous, and volume by preset name', () => {
    expect(intents('previous song')).toEqual([{ deviceId: 'speaker-1', previous: true }]);
    expect(intents('set the volume to loud')).toEqual([{ deviceId: 'speaker-1', volume: 80 }]);
    expect(intents('music volume quiet')).toEqual([{ deviceId: 'speaker-1', volume: 20 }]);
    expect(intents('louder')).toEqual([{ deviceId: 'speaker-1', volume: 60 }]);
  });

  it('"open AI activity" opens the tab; "AI activity" still opens the drawer; "AI monitor" the monitor', () => {
    expect(routeLine('open AI activity', world).name).toBe('activityTab');
    expect(routeLine('Open AI activity in a new tab.', world).name).toBe('activityTab');
    expect(routeLine('AI activity', world).name).toBe('showAi');
    expect(routeLine('open the AI monitor', world).name).toBe('monitor');
  });
});

// ---- the tiles themselves (plain-DOM render path; same structure as the Lit tiles) ----

interface FakeEl {
  tagName: string; className: string; textContent: string; style: Record<string, string>; children: FakeEl[];
  attrs: Record<string, string>; listeners: Record<string, Array<(e: unknown) => void>>;
  setAttribute(n: string, v: string): void; appendChild(c: FakeEl): FakeEl; addEventListener(t: string, f: (e: unknown) => void): void; fire(t: string): void;
}
function fakeDoc() {
  return {
    createElement: (tag: string): FakeEl => {
      const el: FakeEl = {
        tagName: tag.toUpperCase(), className: '', textContent: '', style: {}, children: [], attrs: {}, listeners: {},
        setAttribute(n, v) { el.attrs[n] = v; },
        appendChild(c) { el.children.push(c); return c; },
        addEventListener(t, f) { (el.listeners[t] ??= []).push(f); },
        fire(t) { (el.listeners[t] ?? []).forEach((f) => f({})); },
      };
      return el;
    },
  };
}
const all = (el: FakeEl, pred: (e: FakeEl) => boolean): FakeEl[] => [...(pred(el) ? [el] : []), ...el.children.flatMap((c) => all(c, pred))];
const buttons = (el: FakeEl) => all(el, (e) => e.tagName === 'BUTTON');
const text = (el: FakeEl): string => el.textContent + el.children.map(text).join('');

function renderTile(component: 'LampTile' | 'MusicTile', tile: unknown, state: Record<string, DeviceState>, onAction: (a: FallbackAction) => void = () => {}) {
  const plan = coerceSurfacePlan({ kind: 'room', title: 'x', tiles: [tile] });
  if (!plan.ok) throw new Error(plan.error);
  const msgs = expandPlan(plan.value, 's1', state);
  const gate = gateMessages(msgs, CATALOG_SCHEMAS);
  expect(gate.ok).toBe(true); // the new props and actions pass the strict catalog check
  const node = Object.values(reduceA2uiMessages(undefined, msgs).trees.s1.nodesById).find((n) => n.component === component)!;
  return renderNodeToDom(node, fakeDoc() as never, onAction) as unknown as FakeEl;
}

describe('lamp tile: discrete controls replace the slider', () => {
  const state = { 'wiz-lamp-2': lamp({ brightness: 50, color: '#0000ff', temp: 0, sceneId: 0 }) };
  const tile = { type: 'lamp', deviceId: 'wiz-lamp-2', label: 'Desk lamp' };

  it('has no slider and no text field — every control is a button', () => {
    const el = renderTile('LampTile', tile, state);
    expect(all(el, (e) => e.tagName === 'INPUT' || e.tagName === 'SELECT' || e.tagName === 'TEXTAREA')).toEqual([]);
    expect(all(el, (e) => e.attrs.role === 'slider')).toEqual([]);
    // toggle + (− + 5 presets +) + 8 colours + 6 scenes + (− + 3 whites)
    expect(buttons(el)).toHaveLength(1 + 7 + 8 + 6 + 5);
  });

  it('shows 5 brightness chips, 8 colour swatches, 6 scene chips and 3 whites, with the current ones pressed', () => {
    const el = renderTile('LampTile', tile, state);
    const by = (act: string) => buttons(el).filter((b) => b.attrs['data-act'] === act);
    expect(by('level').map((b) => b.textContent)).toEqual(['10%', '25%', '50%', '75%', '100%']);
    expect(by('color').map((b) => b.textContent)).toEqual(LAMP_COLOURS.map((c) => c.label));
    expect(by('scene').map((b) => b.textContent)).toEqual(LAMP_SCENES.map((s) => s.label));
    expect(by('white').map((b) => b.textContent)).toEqual(['Warm', 'Neutral', 'Cool']);
    expect(by('level').filter((b) => b.attrs['aria-pressed'] === 'true').map((b) => b.textContent)).toEqual(['50%']);
    expect(by('color').filter((b) => b.attrs['aria-pressed'] === 'true').map((b) => b.textContent)).toEqual(['Blue']);
    expect(text(el)).toContain('On · 50% · Blue');
  });

  it('level-control contract: one [data-level] element per level with value, step buttons and a readout', () => {
    const el = renderTile('LampTile', tile, state);
    const levels = all(el, (e) => 'data-level' in e.attrs);
    expect(levels.map((l) => l.attrs['data-level'])).toEqual(['brightness', 'temp']);
    const [b, t] = levels;
    expect(b.attrs).toMatchObject({ 'aria-valuenow': '50', 'aria-valuemin': '10', 'aria-valuemax': '100', 'data-level-step': '10' });
    expect(t.attrs).toMatchObject({ 'aria-valuemin': '2200', 'aria-valuemax': '6500', 'data-level-step': '500' });
    for (const l of levels) {
      expect(all(l, (e) => e.tagName === 'BUTTON' && 'data-level-inc' in e.attrs)).toHaveLength(1);
      expect(all(l, (e) => e.tagName === 'BUTTON' && 'data-level-dec' in e.attrs)).toHaveLength(1);
      expect(all(l, (e) => 'data-level-readout' in e.attrs)).toHaveLength(1);
    }
    expect(all(b, (e) => 'data-level-readout' in e.attrs)[0].textContent).toBe('50 %');
  });

  it('every press is one action through the normal device path', () => {
    const got: FallbackAction[] = [];
    const el = renderTile('LampTile', tile, state, (a) => got.push(a));
    const press = (pred: (b: FakeEl) => boolean) => buttons(el).find(pred)!.fire('click');
    press((b) => b.textContent === 'Sunset');
    press((b) => b.textContent === 'Red');
    press((b) => b.textContent === '75%');
    press((b) => b.textContent === 'Cool');
    const temp = all(el, (e) => e.attrs['data-level'] === 'temp')[0];
    all(temp, (e) => 'data-level-inc' in e.attrs)[0].fire('click');
    all(temp, (e) => 'data-level-dec' in e.attrs)[0].fire('click');
    expect(got.map((a) => [a.name, a.context?.value])).toEqual([
      ['lamp.scene', 'sunset'], ['lamp.color', 'red'], ['lamp.level', 75], ['lamp.white', 'cool'], ['lamp.cooler', undefined], ['lamp.warmer', undefined],
    ]);
    expect(got.every((a) => a.context?.deviceId === 'wiz-lamp-2')).toBe(true);
    // …and each lands as a valid intent.
    for (const a of got) expect(levelRefusal(tileIntent(a.name, 'wiz-lamp-2', state['wiz-lamp-2'], a.context?.value as string | number | undefined)!)).toBeNull();
  });

  it('a simulated lamp keeps its SIM label', () => {
    expect(text(renderTile('LampTile', tile, { 'wiz-lamp-2': lamp({ sim: true }) }))).toContain('SIM');
    expect(text(renderTile('LampTile', tile, { 'wiz-lamp-2': lamp({ sim: false }) }))).not.toContain('SIM');
  });
});

describe('speaker tile', () => {
  const tile = { type: 'music', deviceId: 'speaker-1', label: 'Speaker' };
  const base: DeviceState = { on: false, brightness: 0, playing: true, trackTitle: 'Blue in Green', volume: 50 };

  it('big Previous / Play-Pause / Next, volume − / + and Quiet / Medium / Loud, and the track title — no slider', () => {
    const el = renderTile('MusicTile', tile, { 'speaker-1': base });
    expect(buttons(el).map((b) => b.textContent)).toEqual(['Previous', 'Pause', 'Next', '−', '+', 'Quiet', 'Medium', 'Loud']);
    expect(all(el, (e) => e.tagName === 'INPUT')).toEqual([]);
    expect(all(el, (e) => 'data-track' in e.attrs)[0].textContent).toBe('Blue in Green');
    const vol = all(el, (e) => e.attrs['data-level'] === 'volume')[0];
    expect(vol.attrs).toMatchObject({ 'aria-valuenow': '50', 'aria-valuemin': '0', 'aria-valuemax': '100' });
    expect(all(vol, (e) => 'data-level-readout' in e.attrs)[0].textContent).toBe('50 %');
    expect(buttons(el).filter((b) => b.attrs['aria-pressed'] === 'true').map((b) => b.textContent)).toEqual(['Medium']);
  });

  it('says honestly which player is behind it', () => {
    expect(text(renderTile('MusicTile', tile, { 'speaker-1': base }))).toContain('Built-in player — Spotify not connected');
    const sp = text(renderTile('MusicTile', tile, { 'speaker-1': { ...base, source: 'spotify', playingOn: 'iPhone' } }));
    expect(sp).toContain('Spotify · iPhone');
    expect(sp).not.toContain('Built-in player');
  });

  it('each press is one action', () => {
    const got: FallbackAction[] = [];
    const el = renderTile('MusicTile', tile, { 'speaker-1': base }, (a) => got.push(a));
    for (const b of buttons(el)) b.fire('click');
    expect(got.map((a) => a.name)).toEqual(['music.previous', 'music.playPause', 'music.next', 'music.softer', 'music.louder', 'music.volume', 'music.volume', 'music.volume']);
    expect(got.slice(5).map((a) => a.context?.value)).toEqual([20, 50, 80]);
  });
});

describe('the Lit tiles (what the canvas renders)', () => {
  const src = readFileSync('src/canvas/deviceTiles.ts', 'utf8');
  it('contain no slider', () => {
    expect(src).not.toMatch(/type="range"/);
    expect(src).not.toMatch(/role="slider"/);
    expect(readFileSync('src/canvas/widgets.ts', 'utf8')).not.toMatch(/type="range"/);
  });
  it('every button is at least 56 px, with 12 px between controls', () => {
    expect(src).toMatch(/button \{[^}]*min-height: 56px; min-width: 56px;/);
    expect(src).toMatch(/\.chips \{ display: grid; gap: 12px;/);
    expect(src).toMatch(/\.steps \{[^}]*gap: 12px;/);
    expect(src).not.toMatch(/font-size: 1[0-4]px/); // 15 px text floor
  });
  it('follow the level-control contract for brightness, temp and volume', () => {
    for (const k of ['brightness', 'temp', 'volume']) expect(src).toContain(`data-level="${k}"`);
    expect(src.match(/<button[^>]*data-level-inc/g)).toHaveLength(3);
    expect(src.match(/<button[^>]*data-level-dec/g)).toHaveLength(3);
    expect(src.match(/data-level-readout/g)!.length).toBeGreaterThanOrEqual(3);
    expect(src.match(/aria-valuenow=/g)).toHaveLength(3);
  });
});

describe('form "slider" fields become discrete controls', () => {
  it('a round step and five evenly spaced presets', () => {
    expect(rangeStep(0, 100)).toBe(10);
    expect(rangeStep(60, 80)).toBe(2);
    expect(rangePresets(0, 100)).toEqual([0, 25, 50, 75, 100]);
    expect(rangePresets(60, 80)).toEqual([60, 65, 70, 75, 80]);
    expect(rangePresets(5, 5)).toEqual([5]);
    expect(rangeNudge(95, 1, 0, 100)).toBe(100);
    expect(rangeNudge(0, -1, 0, 100)).toBe(0);
    expect(rangeNudge(0.1, 1, 0, 1)).toBe(0.2);
  });
});

describe('room dashboards: every tile visible, no scroll inside the board', () => {
  const css = readFileSync('src/canvas/canvas.css', 'utf8');
  const app = readFileSync('src/canvas/canvasApp.ts', 'utf8');

  it('the room board body does not scroll, and its tiles reflow in a grid that fits the width', () => {
    const body = /\.mc-frame\[data-kind="room"\] \.mc-frame-body \{([^}]*)\}/.exec(css)![1];
    expect(body).toMatch(/overflow: visible/);
    expect(body).not.toMatch(/overflow: (auto|scroll)/);
    const grid = /\.mc-frame\[data-kind="room"\] \.mc-surface a2ui-basic-column \{([^}]*)\}/.exec(css)![1];
    expect(grid).toMatch(/display: grid/);
    // auto-fit + min(100%, …): several columns on a wide board, exactly one on a phone.
    expect(grid).toMatch(/grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 360px\), 1fr\)\)/);
  });

  it('the board is as tall as its tiles: height auto, the stored height only a floor', () => {
    expect(app).toMatch(/height: room \? 'auto' : `\$\{h\}px`/);
    expect(app).toMatch(/el\.dataset\.kind = 'room'/);
  });

  it('a focused room board widens into the free width (more columns), never past ROOM_MAX_W; other boards only narrow', () => {
    expect(fitFocusedSize({ w: 1000, h: 680 }, { free: 1238, freeH: 700, phone: false, room: true })).toEqual({ w: 1238, h: 680 });
    expect(fitFocusedSize({ w: 1000, h: 680 }, { free: 2000, freeH: 700, phone: false, room: true })).toEqual({ w: ROOM_MAX_W, h: 680 });
    expect(fitFocusedSize({ w: 1000, h: 680 }, { free: 1238, freeH: 700, phone: false })).toBeNull();
    expect(fitFocusedSize({ w: 1000, h: 680 }, { free: 700, freeH: 700, phone: false, room: true })).toEqual({ w: 700, h: 680 });
  });

  it('focus shows the WHOLE board: 1:1 when it fits, zoomed out (never below 0.8) when it is taller', () => {
    const vp = { w: 1440, h: 900 };
    const insets = { top: 0, left: 0, right: 180, bottom: 92 };
    const fits = focusWholeBoard({ x: 0, y: 0, w: 1000, h: 680 }, vp, insets);
    expect(fits.z).toBe(1);
    const tall = { x: 0, y: 0, w: 1240, h: 900 };
    const cam = focusWholeBoard(tall, vp, insets);
    expect(cam.z).toBeLessThan(1);
    expect(cam.z).toBeGreaterThanOrEqual(ROOM_MIN_Z);
    // Screen = (world − camera) · z: the board's top and bottom are both on screen, above the bottom chrome.
    const top = (tall.y - cam.y) * cam.z, bottom = (tall.y + tall.h - cam.y) * cam.z;
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeLessThanOrEqual(vp.h - insets.bottom);
    // 56 px controls stay above the 44 px floor at the lowest zoom.
    expect(56 * ROOM_MIN_Z).toBeGreaterThanOrEqual(44);
    // Far too tall: held at the floor zoom and pinned to the top — the canvas scrolls, the board never does.
    const huge = focusWholeBoard({ x: 0, y: 0, w: 1000, h: 4000 }, vp, insets);
    expect(huge.z).toBe(ROOM_MIN_Z);
    expect((0 - huge.y) * huge.z).toBeCloseTo(16);
  });

  it('with no scroll of its own, the wheel and a touch drag on a room board move the canvas', () => {
    expect(app).toMatch(/closest\('\.mc-frame\.focused'\) && !target\.closest\('\.mc-frame\[data-kind="room"\]'\)\) return;/);
    expect(app).toMatch(/dragYOnly = phoneShell;/);
  });
});

describe('menu entry', () => {
  it('"Open AI activity in a new tab" sits next to "AI monitor", and the page is a build input', () => {
    const app = readFileSync('src/canvas/canvasApp.ts', 'utf8');
    expect(app).toMatch(/data-cmd="monitor" class="mc-btn">AI monitor<\/button>\s*<button data-cmd="activity" class="mc-btn">Open AI activity in a new tab<\/button>/);
    expect(app).toMatch(/window\.open\('\/activity\.html'/);
    expect(readFileSync('vite.config.ts', 'utf8')).toMatch(/activity: path\.join\(root, 'activity\.html'\)/);
    expect(readFileSync('activity.html', 'utf8')).toMatch(/src="\/src\/activity\/activityMain\.ts"/);
  });
});

describe('review round 1', () => {
  it('"lamp to 0 %" and off are a power-off on the real bulb, never a dim (which would turn it on at 10 %)', () => {
    expect(wizIntentFor({ deviceId: 'wiz-lamp-1', on: false, brightness: 0 })).toEqual({ kind: 'power', on: false });
    expect(wizIntentFor({ deviceId: 'wiz-lamp-1', brightness: 0 })).toEqual({ kind: 'power', on: false });
    expect(wizIntentFor({ deviceId: 'wiz-lamp-1', on: false, temp: 2700 })).toEqual({ kind: 'power', on: false });
    expect(pilotParamsForIntent(wizIntentFor({ deviceId: 'wiz-lamp-1', on: false, brightness: 0 }))).toEqual({ state: false });
    const spoken = parseDeviceCommands('set the desk lamp to 0%', devices)!.intents[0];
    expect(wizIntentFor(spoken)).toEqual({ kind: 'power', on: false });
  });

  it('a spoken percent is passed on as asked, so the store refuses > 100 % instead of quietly setting 100', async () => {
    const intent = parseDeviceCommands('set the desk lamp to 500%', devices)!.intents[0];
    expect(intent).toEqual({ deviceId: 'wiz-desk', on: true, brightness: 500 });
    const run = vi.fn(async () => ({}));
    const store = createDeviceStore({ 'wiz-desk': lamp() }, { run }, () => {}, () => null);
    expect(await store.act(intent)).toMatchObject({ brightness: 60, error: LAMP_RANGE_REFUSAL });
    expect(run).not.toHaveBeenCalled();
  });

  it('level sets are calmed per device: one in flight, at most one per 150 ms, the latest value wins', async () => {
    vi.useFakeTimers();
    try {
      const sent: number[] = [];
      let fail = false;
      const connector: DeviceConnector = { run: (i) => new Promise((res, rej) => setTimeout(() => { if (fail) rej(new Error('no')); else { sent.push(i.brightness!); res({ on: true, brightness: i.brightness }); } }, 300)) };
      const store = createDeviceStore({ d: lamp({ brightness: 50 }), e: lamp({ brightness: 20 }) }, connector, () => {}, () => null);
      const q = createActQueue(store);
      // A held arrow key's worth of presses: 51, 52, … 80 within 300 ms.
      for (let v = 51; v <= 80; v++) { q.act({ deviceId: 'd', on: true, brightness: v }); await vi.advanceTimersByTimeAsync(10); }
      q.act({ deviceId: 'e', on: true, brightness: 30 }); // another device is not held up
      await vi.advanceTimersByTimeAsync(2000);
      expect(sent.filter((v) => v !== 30)).toEqual([51, 80]); // the first, then only the latest
      expect(sent).toContain(30);
      expect(store.get('d').brightness).toBe(80);
      expect(q.pending('d')).toBe(false);
      // A failure rolls back to the last value that was really APPLIED (80), not to a stale one.
      fail = true;
      q.act({ deviceId: 'd', on: true, brightness: 90 });
      q.act({ deviceId: 'd', on: true, brightness: 95 });
      await vi.advanceTimersByTimeAsync(2000);
      expect(store.get('d')).toMatchObject({ brightness: 80, error: 'Lamp refused the change' });
    } finally { vi.useRealTimers(); }
  });

  it('presses that are not level sets go straight through, in order', () => {
    const seen: DeviceIntent[] = [];
    const q = createActQueue({ act: async (i) => { seen.push(i); return lamp(); } });
    q.act({ deviceId: 'd', on: false });
    q.act({ deviceId: 'd', next: true });
    q.act({ deviceId: 'd', on: true, sceneId: 3 });
    expect(seen).toHaveLength(3);
  });

  it('a held arrow key is one step: key auto-repeat is ignored', () => {
    const src = readFileSync('src/canvas/deviceTiles.ts', 'utf8');
    expect(src).toMatch(/function fineKey\(e: KeyboardEvent\)[^}]*if \(e\.repeat\) return 0;/s);
    expect(readFileSync('src/canvas/widgets.ts', 'utf8')).toMatch(/if \(e\.repeat\) return;/);
    expect(readFileSync('src/canvas/canvasApp.ts', 'utf8')).toMatch(/if \(intent\) actQueue\.act\(intent\);/);
  });

  it('a level control says its value in its name', () => {
    const el = renderTile('LampTile', { type: 'lamp', deviceId: 'wiz-lamp-2', label: 'Desk lamp' }, { 'wiz-lamp-2': lamp({ brightness: 70, temp: 4000 }) });
    const levels = all(el, (e) => 'data-level' in e.attrs);
    expect(levels.map((l) => l.attrs['aria-label'])).toEqual(['Brightness 70 %', 'White 4000 kelvin']);
  });

  it('edit mode: a drag on a zoomed-out board moves the tile by board px, not screen px', () => {
    const item = { style: {} as Record<string, string>, offsetWidth: 400, getBoundingClientRect: () => ({ width: 320 }) }; // shown at 80 %
    const mkHandle = () => {
      const fns: Record<string, Array<(e: { clientX: number; clientY: number }) => void>> = {};
      return { fns, addEventListener: (t: string, f: (e: { clientX: number; clientY: number }) => void) => { (fns[t] ??= []).push(f); }, removeEventListener: () => {} };
    };
    const move = mkHandle(); const resize = mkHandle();
    mountItemHandles(item as never, move as never, resize as never, { left: 100, top: 100, width: 400, height: 300 }, { getBounds: () => ({ left: 0, top: 0, width: 5000, height: 5000 }) });
    move.fns.pointerdown[0]({ clientX: 0, clientY: 0 });
    move.fns.pointermove[0]({ clientX: 80, clientY: 40 }); // 80 screen px at 0.8 = 100 board px
    expect(item.style.left).toBe('200px');
    expect(item.style.top).toBe('150px');
  });
});
