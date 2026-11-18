import { describe, expect, it } from 'vitest';
import { parseDeviceCommands, type DeviceRef } from '../../src/canvas/deviceCommands';

const devices: DeviceRef[] = [
  { id: 'wiz-desk', label: 'Desk lamp', on: false, brightness: 40 },
  { id: 'wiz-ceiling', label: 'Ceiling light', on: true, brightness: 70 },
];

describe('device voice commands', () => {
  it('turns one lamp on by label', () => {
    expect(parseDeviceCommands('turn on the desk lamp', devices)!.intents).toEqual([{ deviceId: 'wiz-desk', on: true }]);
  });

  it('turns one lamp off in any word order', () => {
    expect(parseDeviceCommands('turn the desk lamp off', devices)!.intents).toEqual([{ deviceId: 'wiz-desk', on: false }]);
    expect(parseDeviceCommands('desk lamp off', devices)!.intents).toEqual([{ deviceId: 'wiz-desk', on: false }]);
  });

  it('"lights off" turns every lamp off', () => {
    const r = parseDeviceCommands('lights off', devices)!;
    expect(r.intents).toEqual([{ deviceId: 'wiz-desk', on: false }, { deviceId: 'wiz-ceiling', on: false }]);
  });

  it('sets an absolute percentage and turns it on (or off at 0)', () => {
    expect(parseDeviceCommands('set desk lamp to 30 percent', devices)!.intents).toEqual([{ deviceId: 'wiz-desk', on: true, brightness: 30 }]);
    expect(parseDeviceCommands('set the ceiling light to 0%', devices)!.intents).toEqual([{ deviceId: 'wiz-ceiling', on: false, brightness: 0 }]);
  });

  it('dims and brightens relative to the current level', () => {
    expect(parseDeviceCommands('dim the ceiling light', devices)!.intents).toEqual([{ deviceId: 'wiz-ceiling', brightness: 50 }]);
    expect(parseDeviceCommands('make the ceiling light brighter', devices)!.intents).toEqual([{ deviceId: 'wiz-ceiling', on: true, brightness: 90 }]);
  });

  it('clamps brightness to 0..100', () => {
    expect(parseDeviceCommands('brighter desk lamp', [{ id: 'd', label: 'Desk lamp', brightness: 95 }])!.intents)
      .toEqual([{ deviceId: 'd', on: true, brightness: 100 }]);
  });

  it('maps "warmer" to a dimmer step and says so', () => {
    const r = parseDeviceCommands('warmer', devices)!;
    expect(r.intents).toEqual([{ deviceId: 'wiz-desk', brightness: 20 }, { deviceId: 'wiz-ceiling', brightness: 50 }]);
    expect(r.say.toLowerCase()).toContain('warm');
    expect(r.say.toLowerCase()).toContain('dim');
  });

  it('returns null when nothing device-like matches', () => {
    expect(parseDeviceCommands('turn on the toaster', devices)).toBeNull();
    expect(parseDeviceCommands('hello there', devices)).toBeNull();
    expect(parseDeviceCommands('', devices)).toBeNull();
  });
});
