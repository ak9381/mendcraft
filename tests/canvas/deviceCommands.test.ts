import { describe, expect, it } from 'vitest';
import { parseDeviceCommands, resolvePointedDevice, type DeviceRef } from '../../src/canvas/deviceCommands';

const devices: DeviceRef[] = [
  { id: 'lamp-a', label: 'Desk lamp', on: false, brightness: 40 },
  { id: 'lamp-b', label: 'Ceiling light', on: true, brightness: 70 },
];

describe('device voice commands', () => {
  it('turns one lamp on by label', () => {
    expect(parseDeviceCommands('turn on the desk lamp', devices)!.intents).toEqual([{ deviceId: 'lamp-a', on: true }]);
  });

  it('turns one lamp off in any word order', () => {
    expect(parseDeviceCommands('turn the desk lamp off', devices)!.intents).toEqual([{ deviceId: 'lamp-a', on: false }]);
    expect(parseDeviceCommands('desk lamp off', devices)!.intents).toEqual([{ deviceId: 'lamp-a', on: false }]);
  });

  it('"lights off" turns every lamp off', () => {
    const r = parseDeviceCommands('lights off', devices)!;
    expect(r.intents).toEqual([{ deviceId: 'lamp-a', on: false }, { deviceId: 'lamp-b', on: false }]);
  });

  it('sets an absolute percentage and turns it on (or off at 0)', () => {
    expect(parseDeviceCommands('set desk lamp to 30 percent', devices)!.intents).toEqual([{ deviceId: 'lamp-a', on: true, brightness: 30 }]);
    expect(parseDeviceCommands('set the ceiling light to 0%', devices)!.intents).toEqual([{ deviceId: 'lamp-b', on: false, brightness: 0 }]);
  });

  it('dims and brightens relative to the current level', () => {
    expect(parseDeviceCommands('dim the ceiling light', devices)!.intents).toEqual([{ deviceId: 'lamp-b', brightness: 50 }]);
    expect(parseDeviceCommands('make the ceiling light brighter', devices)!.intents).toEqual([{ deviceId: 'lamp-b', on: true, brightness: 90 }]);
  });

  it('clamps brightness to 0..100', () => {
    expect(parseDeviceCommands('brighter desk lamp', [{ id: 'd', label: 'Desk lamp', brightness: 95 }])!.intents)
      .toEqual([{ deviceId: 'd', on: true, brightness: 100 }]);
  });

  it('maps "warmer" / "cooler" to a white-temperature step (never a brightness change)', () => {
    const r = parseDeviceCommands('warmer', devices)!;
    expect(r.intents).toEqual([{ deviceId: 'lamp-a', on: true, temp: 3500 }, { deviceId: 'lamp-b', on: true, temp: 3500 }]);
    expect(r.say.toLowerCase()).toContain('warm');
    const c = parseDeviceCommands('make the desk lamp cooler', [{ ...devices[0], temp: 6300 }, devices[1]])!;
    expect(c.intents).toEqual([{ deviceId: 'lamp-a', on: true, temp: 6500 }]); // stays inside 2200–6500 K
  });

  it('returns null when nothing device-like matches', () => {
    expect(parseDeviceCommands('turn on the toaster', devices)).toBeNull();
    expect(parseDeviceCommands('hello there', devices)).toBeNull();
    expect(parseDeviceCommands('', devices)).toBeNull();
  });

  it('resolves "that" / "this" / "it" to the pointed (focused) tile', () => {
    const pointed = devices[0];
    expect(parseDeviceCommands('turn that off', devices, { pointed })!.intents)
      .toEqual([{ deviceId: 'lamp-a', on: false }]);
    expect(parseDeviceCommands('dim this', devices, { pointed })!.intents)
      .toEqual([{ deviceId: 'lamp-a', brightness: 20 }]);
    expect(parseDeviceCommands('turn it on', devices, { pointed })!.intents)
      .toEqual([{ deviceId: 'lamp-a', on: true }]);
    // Without a focused tile, a bare "that" is not a command.
    expect(parseDeviceCommands('turn that off', devices)).toBeNull();
  });

  it('resolvePointedDevice maps a focused tile element to a device by id or label', () => {
    const el = {
      getAttribute: (n: string) => (n === 'data-device' ? 'lamp-b' : null),
      parentElement: null,
      textContent: '',
      innerText: '',
    } as unknown as Element;
    expect(resolvePointedDevice(el, devices)?.id).toBe('lamp-b');
    const labelled = {
      getAttribute: (n: string) => (n === 'aria-label' ? 'Move Desk lamp' : null),
      parentElement: null,
      textContent: '',
      innerText: '',
    } as unknown as Element;
    expect(resolvePointedDevice(labelled, devices)?.id).toBe('lamp-a');
    expect(resolvePointedDevice(null, devices)).toBeNull();
  });
});

describe('natural phrasing the 20-phrase eval covers', () => {
  it('turns brightness down or up without "dim" / "brighter"', () => {
    expect(parseDeviceCommands('turn down the lights', devices)!.intents)
      .toEqual([{ deviceId: 'lamp-a', brightness: 20 }, { deviceId: 'lamp-b', brightness: 50 }]);
    expect(parseDeviceCommands('turn up the lights', devices)!.intents)
      .toEqual([{ deviceId: 'lamp-a', on: true, brightness: 60 }, { deviceId: 'lamp-b', on: true, brightness: 90 }]);
    expect(parseDeviceCommands('increase the brightness', devices)!.intents)
      .toEqual([{ deviceId: 'lamp-a', on: true, brightness: 60 }, { deviceId: 'lamp-b', on: true, brightness: 90 }]);
  });

  it('keeps filler words like "a bit" from breaking a dim', () => {
    expect(parseDeviceCommands('dim the lamp a bit', devices)!.intents)
      .toEqual([{ deviceId: 'lamp-a', brightness: 20 }, { deviceId: 'lamp-b', brightness: 50 }]);
  });
});
