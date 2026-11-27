import { describe, expect, it } from 'vitest';
import { parseDeviceCommands, type DeviceRef } from '../../src/canvas/deviceCommands';
import { routeLine } from '../../src/canvas/routeLine';

// Review sim-3 §3: a real bulb's tile says "Lamp". She names it as she
// thinks of it ("the desk lamp"): with one lamp that IS the lamp; with several
// and no match it is refused aloud, naming the lamps — never chat.
const speaker: DeviceRef = { id: 'spk', label: 'Speaker', kind: 'music', playing: false, volume: 40 };
const one: DeviceRef[] = [{ id: 'wiz-lamp-1', label: 'Lamp', kind: 'lamp', on: false, brightness: 60 }, speaker];
const two: DeviceRef[] = [
  { id: 'wiz-lamp-1', label: 'Lamp', kind: 'lamp', on: true, brightness: 60 },
  { id: 'wiz-lamp-2', label: 'Lamp 2', kind: 'lamp', on: true, brightness: 60 },
];

describe('one lamp labelled "Lamp"', () => {
  it.each([
    ['turn on the desk lamp', { on: true }], ['desk lamp off', { on: false }], ['turn on the bedroom light', { on: true }],
    ['turn off the ceiling light', { on: false }], ['switch on the table lamp', { on: true }], ['dim the living room lamp', { brightness: 40 }],
    ['turn on the lamp', { on: true }],
  ] as const)('%s acts on it', (line, want) => {
    const r = parseDeviceCommands(line, one);
    expect(r?.intents).toEqual([{ deviceId: 'wiz-lamp-1', ...want }]);
    expect(routeLine(line, { devices: one }).name).toBe('device');
  });

  it('"set the desk lamp to 500%" is still refused (a device line, not an act)', () => {
    expect(routeLine('set the desk lamp to 500%', { devices: one }).name).toBe('device');
  });

  it('a name next to something that is not a lamp still is not an order', () => {
    for (const line of ['put the lights on the plan', 'lower your voice', 'make the text lighter', 'lamp on fire']) {
      expect(parseDeviceCommands(line, one)).toBeNull();
    }
  });
});

describe('two lamps, "Lamp" and "Lamp 2"', () => {
  it.each(['turn on the desk lamp', 'desk lamp off', 'turn off the ceiling light'])('%s is refused aloud, naming the lamps', (line) => {
    const r = parseDeviceCommands(line, two)!;
    expect(r.intents).toEqual([]);
    expect(r.say).toMatch(/desk|ceiling/);
    expect(r.say).toContain('Lamp and Lamp 2');
    expect(routeLine(line, { devices: two }).name).toBe('device');
  });

  it('a named lamp that exists still acts; "the lamps" are all of them', () => {
    expect(parseDeviceCommands('turn off lamp 2', two)?.intents).toEqual([{ deviceId: 'wiz-lamp-2', on: false }]);
    expect(parseDeviceCommands('lights off', two)?.intents.length).toBe(2);
  });

  it('"set the desk lamp to 500%" is still refused as a level', () => {
    expect(routeLine('set the desk lamp to 500%', { devices: two }).name).toBe('device');
  });
});
