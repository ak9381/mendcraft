// A press resolves against the store's current state and the approved plan;
// a bad value, an off lamp or a missing device is refused, never clamped.
import { describe, expect, it } from 'vitest';
import { bindingIntent, controlAt, deviceClassOf, NOT_CONNECTED_REFUSAL, NOT_THIS_DEVICE_REFUSAL, pressIntent } from '../../src/canvas/controlSpec';
import { dropAbsentDevices } from '../../src/canvas/planTruth';
import { createWizAwareConnector, LAMP_CANT_DO_THAT, wizIntentFor } from '../../src/canvas/wizDevices';
import { LAMP_RANGE_REFUSAL } from '../../src/canvas/deviceGuard';
import { LAMP_OFF_REFUSAL } from '../../src/canvas/deviceActions';
import { coerceSurfacePlan, type DeviceState, type SurfacePlan } from '../../src/canvas/surfacePlan';

const lamp = (s: Partial<DeviceState> = {}): DeviceState => ({ on: true, brightness: 50, ...s });
const ID = 'wiz-lamp-1';

describe('bindingIntent', () => {
  it('toggle flips the current on state', () => {
    expect(bindingIntent('lamp', ID, { on: 'toggle' }, lamp({ on: false }))).toEqual({ intent: { deviceId: ID, on: true } });
    expect(bindingIntent('lamp', ID, { on: 'toggle' }, lamp({ on: true }))).toEqual({ intent: { deviceId: ID, on: false } });
    expect(bindingIntent('lamp', ID, { on: false }, lamp({ on: true }))).toEqual({ intent: { deviceId: ID, on: false } });
  });

  it('brightness step from 95 lands on 100, from 10 down stays 10', () => {
    expect(bindingIntent('lamp', ID, { brightness: { step: 1 } }, lamp({ brightness: 95 }))).toEqual({ intent: { deviceId: ID, brightness: 100 } });
    expect(bindingIntent('lamp', ID, { brightness: { step: -1 } }, lamp({ brightness: 10 }))).toEqual({ intent: { deviceId: ID, brightness: 10 } });
  });

  it('$value 55 on brightness gives brightness 55', () => {
    expect(bindingIntent('lamp', ID, { brightness: '$value' }, lamp(), 55)).toEqual({ intent: { deviceId: ID, brightness: 55 } });
  });

  it('bad press: $value NaN, "abc", 500 and undefined are refused, no intent', () => {
    for (const v of [NaN, 'abc', undefined, Infinity]) {
      const r = bindingIntent('lamp', ID, { brightness: '$value' }, lamp(), v);
      expect('refusal' in r && r.refusal).toMatch(/Nothing changed\.$/);
      expect('intent' in r).toBe(false);
    }
    expect(bindingIntent('lamp', ID, { brightness: '$value' }, lamp(), 500)).toEqual({ refusal: LAMP_RANGE_REFUSAL });
  });

  it('brightness on a lamp that is off is refused with LAMP_OFF_REFUSAL', () => {
    expect(bindingIntent('lamp', ID, { brightness: 80 }, lamp({ on: false }))).toEqual({ refusal: LAMP_OFF_REFUSAL });
    expect(bindingIntent('lamp', ID, { brightness: { step: 1 } }, lamp({ on: false }))).toEqual({ refusal: LAMP_OFF_REFUSAL });
  });

  it('absent device: cur undefined gives NOT_CONNECTED_REFUSAL', () => {
    expect(bindingIntent('lamp', ID, { on: 'toggle' }, undefined)).toEqual({ refusal: NOT_CONNECTED_REFUSAL });
    expect(bindingIntent('lamp', ID, { on: 'toggle' }, lamp({ unreachable: true }))).toEqual({ refusal: NOT_CONNECTED_REFUSAL });
    expect(NOT_CONNECTED_REFUSAL).toBe("That device isn't connected. Nothing changed.");
  });

  it('a key the class does not own is refused', () => {
    const r = bindingIntent('lamp', ID, { volume: 40 } as never, lamp());
    expect('refusal' in r).toBe(true);
  });

  it('a colour, a scene and a white light the lamp', () => {
    expect(bindingIntent('lamp', ID, { sceneId: 16 }, lamp({ on: false }))).toEqual({ intent: { deviceId: ID, on: true, sceneId: 16 } });
    expect(bindingIntent('lamp', ID, { rgb: { r: 0, g: 0, b: 255 } }, lamp())).toEqual({ intent: { deviceId: ID, on: true, rgb: { r: 0, g: 0, b: 255 } } });
    expect(bindingIntent('lamp', ID, { temp: { step: 1 } }, lamp({ temp: 6300 }))).toEqual({ intent: { deviceId: ID, on: true, temp: 6500 } });
  });

  it('music and gimbal resolve to their own paths', () => {
    expect(bindingIntent('music', 'speaker-a', { playing: 'toggle' }, { cls: 'music', on: false, brightness: 0, playing: true })).toEqual({ intent: { deviceId: 'speaker-a', playing: false } });
    expect(bindingIntent('music', 'speaker-a', { volume: { step: 1 } }, { cls: 'music', on: false, brightness: 0, volume: 95 })).toEqual({ intent: { deviceId: 'speaker-a', volume: 100 } });
    // The stand counts only as the paired iPhone reports it (gimbalBinding.test.ts).
    const stand = { cls: 'gimbal' as const, on: false, brightness: 0 };
    expect(bindingIntent('gimbal', 'gimbal', { gimbalMode: 'face' }, stand)).toEqual({ gimbal: { mode: 'face' } });
    expect(bindingIntent('gimbal', 'gimbal', { gimbalCue: 'yes' }, stand)).toEqual({ gimbal: { cue: 'yes' } });
    expect('refusal' in bindingIntent('gimbal', 'gimbal', { gimbalMode: 'face' }, undefined)).toBe(true);
  });
});

const PLAN: SurfacePlan = {
  kind: 'room', title: 'Desk', tiles: [{ type: 'card', title: 'Light', children: [{
    type: 'lamp', deviceId: ID, label: 'Lamp',
    controls: [
      { kind: 'toggle', label: 'Power', intent: { on: 'toggle' } },
      { kind: 'chips', label: 'Scenes', options: [{ label: 'Relax', intent: { sceneId: 16 } }] },
      { kind: 'slider', label: 'Brightness', key: 'brightness' },
    ],
  }] }],
};

describe('controlAt', () => {
  it('finds a control, a chip option and a slider by index in the approved plan', () => {
    expect(controlAt(PLAN, `lamp-${ID}`, 0)).toEqual({ cls: 'lamp', deviceId: ID, spec: { on: 'toggle' } });
    expect(controlAt(PLAN, `lamp-${ID}`, 1, 0)).toEqual({ cls: 'lamp', deviceId: ID, spec: { sceneId: 16 } });
    expect(controlAt(PLAN, `lamp-${ID}`, 2)).toEqual({ cls: 'lamp', deviceId: ID, spec: { slider: 'brightness' } });
  });

  it('controlAt returns null for an index past the approved controls or a tile id not in the plan', () => {
    expect(controlAt(PLAN, `lamp-${ID}`, 3)).toBeNull();
    expect(controlAt(PLAN, `lamp-${ID}`, -1)).toBeNull();
    expect(controlAt(PLAN, `lamp-${ID}`, 0.5)).toBeNull();
    expect(controlAt(PLAN, `lamp-${ID}`, 1, 1)).toBeNull();
    expect(controlAt(PLAN, `lamp-${ID}`, 1)).toBeNull();
    expect(controlAt(PLAN, 'lamp-wiz-lamp-9', 0)).toBeNull();
    expect(controlAt(PLAN, 'card-0', 0)).toBeNull();
  });

  it('a lamp with no controls is pressed through its standard controls', () => {
    const plain: SurfacePlan = { kind: 'room', title: 'r', tiles: [{ type: 'lamp', deviceId: ID, label: 'Lamp' }] };
    expect(controlAt(plain, `lamp-${ID}`, 0)).toEqual({ cls: 'lamp', deviceId: ID, spec: { on: 'toggle' } });
  });
});

describe('coerceSurfacePlan with controls', () => {
  it('coerceSurfacePlan keeps controls on a lamp leaf and drops bad ones with a note', () => {
    const r = coerceSurfacePlan({ kind: 'room', title: 'Desk', tiles: [{
      type: 'lamp', deviceId: ID, label: 'Lamp',
      controls: [
        { kind: 'toggle', label: 'Power', intent: { on: 'toggle' } },
        { kind: 'button', label: 'Max', intent: { brightness: 500 } },
        { kind: 'chips', label: 'Looks', options: [{ label: 'Relax', intent: { sceneId: 16 } }, { label: 'Blast', intent: { brightness: 500 } }] },
      ],
    }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tiles[0]).toEqual({ type: 'lamp', deviceId: ID, label: 'Lamp', controls: [
      { kind: 'toggle', label: 'Power', intent: { on: 'toggle' } },
      { kind: 'chips', label: 'Looks', options: [{ label: 'Relax', intent: { sceneId: 16 } }] },
    ] });
    expect(r.notes?.some((n) => /Dropped 2 controls/.test(n))).toBe(true);
  });

  it('a lamp leaf with no controls stays without them', () => {
    const r = coerceSurfacePlan({ kind: 'room', title: 'Desk', tiles: [{ type: 'lamp', deviceId: ID, label: 'Lamp' }] });
    expect(r.ok && r.value.tiles[0]).toEqual({ type: 'lamp', deviceId: ID, label: 'Lamp' });
  });

  it('music, switch and gimbal leaves keep their own class controls', () => {
    const r = coerceSurfacePlan({ kind: 'room', title: 'r', tiles: [
      { type: 'music', deviceId: 'speaker-a', label: 'Speaker', controls: [{ kind: 'button', label: 'Next', intent: { next: true } }, { kind: 'button', label: 'On', intent: { on: true } }] },
      { type: 'switch', deviceId: 'plug-a', label: 'Plug', controls: [{ kind: 'toggle', label: 'Power', intent: { on: 'toggle' } }] },
      { type: 'gimbal', controls: [{ kind: 'button', label: 'Nod', intent: { gimbalCue: 'yes' } }] },
    ] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tiles).toEqual([
      { type: 'music', deviceId: 'speaker-a', label: 'Speaker', controls: [{ kind: 'button', label: 'Next', intent: { next: true } }] },
      { type: 'switch', deviceId: 'plug-a', label: 'Plug', controls: [{ kind: 'toggle', label: 'Power', intent: { on: 'toggle' } }] },
      { type: 'gimbal', label: 'Gimbal', controls: [{ kind: 'button', label: 'Nod', intent: { gimbalCue: 'yes' } }] },
    ]);
  });
});

describe('a tile binds a device only as what it really is', () => {
  const MUSIC_ON_BULB: SurfacePlan = { kind: 'room', title: 'r', tiles: [{
    type: 'music', deviceId: ID, label: 'Speaker', controls: [{ kind: 'slider', label: 'Volume', key: 'volume' }, { kind: 'button', label: 'Next', intent: { next: true } }],
  }] };

  it('a music tile on a WiZ bulb is refused at press time, whatever control', () => {
    const bulb = { cls: 'lamp' as const, on: false, brightness: 50 };
    expect(pressIntent(MUSIC_ON_BULB, { tile: `music-${ID}`, control: 0, option: 1 }, () => bulb)).toEqual({ refusal: NOT_THIS_DEVICE_REFUSAL, deviceId: ID });
    expect(pressIntent(MUSIC_ON_BULB, { tile: `music-${ID}`, control: 1 }, () => bulb)).toEqual({ refusal: NOT_THIS_DEVICE_REFUSAL, deviceId: ID });
    // A wiz- id with no recorded class is still a lamp.
    expect(bindingIntent('music', ID, { next: true }, { on: false, brightness: 50 })).toEqual({ refusal: NOT_THIS_DEVICE_REFUSAL });
  });

  it('a device whose class nothing recorded binds no tile', () => {
    expect(bindingIntent('lamp', 'lamp-x', { on: 'toggle' }, { on: false, brightness: 50 })).toEqual({ refusal: NOT_THIS_DEVICE_REFUSAL });
    expect(bindingIntent('lamp', 'lamp-x', { on: 'toggle' }, { cls: 'lamp', on: false, brightness: 50 })).toEqual({ intent: { deviceId: 'lamp-x', on: true } });
    expect(deviceClassOf('speaker-a', { cls: 'music', on: false, brightness: 0 })).toBe('music');
    expect(deviceClassOf('wiz-lamp-2', { on: false, brightness: 0 })).toBe('lamp');
    expect(deviceClassOf('lamp-x', undefined)).toBeUndefined();
  });

  it('a proposal leaves out a tile whose device is another class, and one whose device is not here', () => {
    const plan: SurfacePlan = { kind: 'room', title: 'r', tiles: [
      { type: 'card', title: 'All', children: [
        { type: 'music', deviceId: ID, label: 'Speaker' },
        { type: 'lamp', deviceId: 'wiz-lamp-2', label: 'Lamp 2' },
      ] },
      { type: 'lamp', deviceId: ID, label: 'Lamp' },
      { type: 'switch', deviceId: 'plug-9', label: 'Plug' },
    ] };
    const store: Record<string, DeviceState> = { [ID]: { cls: 'lamp', on: false, brightness: 50 } };
    const r = dropAbsentDevices(plan, (id) => store[id]);
    expect(r.mismatched).toBe(1);
    expect(r.dropped).toBe(2);
    expect(r.plan.tiles).toEqual([{ type: 'lamp', deviceId: ID, label: 'Lamp' }]);
    const same = dropAbsentDevices({ kind: 'room', title: 'r', tiles: [{ type: 'lamp', deviceId: ID, label: 'Lamp' }] }, (id) => store[id]);
    expect(same.mismatched + same.dropped).toBe(0);
  });
});

describe('the WiZ connector never guesses', () => {
  it('wizIntentFor refuses an intent that holds nothing a lamp does', () => {
    expect(wizIntentFor({ deviceId: ID, volume: 40 })).toBeNull();
    expect(wizIntentFor({ deviceId: ID, next: true })).toBeNull();
    expect(wizIntentFor({ deviceId: ID, playing: true, on: true })).toBeNull();
    expect(wizIntentFor({ deviceId: ID })).toBeNull();
    expect(wizIntentFor({ deviceId: ID, on: true })).toEqual({ kind: 'power', on: true });
    expect(wizIntentFor({ deviceId: ID, brightness: 0 })).toEqual({ kind: 'power', on: false });
  });

  it('the connector refuses it before the bridge or the fallback is called', async () => {
    const calls: string[] = [];
    const conn = createWizAwareConnector({
      client: { setPilot: async () => { calls.push('bridge'); return null; } } as never,
      fallback: { run: async () => { calls.push('fallback'); return {}; } },
      status: { up: true },
    });
    await expect(conn.run({ deviceId: ID, volume: 40 })).rejects.toThrow(LAMP_CANT_DO_THAT);
    await expect(conn.run({ deviceId: ID, next: true })).rejects.toThrow(LAMP_CANT_DO_THAT);
    expect(calls).toEqual([]);
    await conn.run({ deviceId: ID, on: true });
    expect(calls).toEqual(['bridge']);
  });
});
