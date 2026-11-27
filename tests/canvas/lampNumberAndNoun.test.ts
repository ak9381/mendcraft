import { describe, expect, it } from 'vitest';
import { parseDeviceCommands, type DeviceRef } from '../../src/canvas/deviceCommands';
import { routeLine } from '../../src/canvas/routeLine';

// Review sim-4 §3: a lamp number that matches no lamp, a number said as a
// word, words before "light" that are not a lamp, and a speaker / music /
// stand noun that must never resolve to a lamp.
const speaker: DeviceRef = { id: 'spk', label: 'Speaker', kind: 'music', playing: false, volume: 40 };
const one: DeviceRef[] = [{ id: 'l1', label: 'Lamp', kind: 'lamp', on: false, brightness: 60 }];
const oneSpk: DeviceRef[] = [...one, speaker];
const two: DeviceRef[] = [
  { id: 'l1', label: 'Lamp', kind: 'lamp', on: true, brightness: 60 },
  { id: 'l2', label: 'Lamp 2', kind: 'lamp', on: true, brightness: 60 },
];

describe('a lamp number', () => {
  it.each(['turn off lamp 3', 'lamp 3 off', 'turn off lamp three', 'set lamp 3 to 40 percent'])('%s with Lamp + Lamp 2: refused aloud, naming the lamps', (line) => {
    const r = parseDeviceCommands(line, two)!;
    expect(r.intents).toEqual([]);
    expect(r.say).toContain('lamp 3');
    expect(r.say).toContain('Lamp and Lamp 2');
    expect(routeLine(line, { devices: two }).name).toBe('device');
  });

  it('"lamp 2 off" with one lamp is refused, never the lamp called "Lamp"', () => {
    const r = parseDeviceCommands('lamp 2 off', one)!;
    expect(r.intents).toEqual([]);
    expect(r.say).toMatch(/no lamp 2 here — your lamp is Lamp\./);
  });

  it.each([['turn on lamp two', 'l2'], ['lamp two off', 'l2'], ['dim lamp two', 'l2'], ['turn on lamp one', 'l1'], ['turn on lamp 1', 'l1']])('%s → that lamp only', (line, id) => {
    const r = parseDeviceCommands(line, two)!;
    expect(r.intents.map((x) => x.deviceId)).toEqual([id]);
    expect(routeLine(line, { devices: two }).name).toBe('device');
  });

  it('a level is not a lamp number', () => {
    expect(parseDeviceCommands('lamp 40 percent', two)?.intents).toEqual([{ deviceId: 'l1', on: true, brightness: 40 }]);
    expect(parseDeviceCommands('set lamp 2 to 40 percent', two)?.intents).toEqual([{ deviceId: 'l2', on: true, brightness: 40 }]);
    expect(parseDeviceCommands('lamp 2 off', two)?.intents).toEqual([{ deviceId: 'l2', on: false }]);
    expect(parseDeviceCommands('turn off the lamp', two)?.intents).toEqual([{ deviceId: 'l1', on: false }]);
  });
});

describe('words that are not a lamp', () => {
  it.each(['turn on the flash light', 'street lights on', 'moon light on', 'turn on the torch light'])('%s with one lamp never switches it', (line) => {
    for (const ds of [one, oneSpk]) {
      const r = parseDeviceCommands(line, ds);
      expect(r?.intents ?? []).toEqual([]);
    }
  });
  it.each(['torch on', 'turn on the torch', 'turn on the flashlight'])('%s is not a lamp order', (line) => {
    expect(parseDeviceCommands(line, one)?.intents ?? []).toEqual([]);
  });
  it.each(['music lamp on', 'turn on the speaker lamp', 'stand light on', 'turn on the speaker light'])('%s never resolves to a lamp', (line) => {
    for (const ds of [one, oneSpk, two]) expect(parseDeviceCommands(line, ds)?.intents ?? []).toEqual([]);
  });
  it.each(['kitchen speaker on', 'turn on the speaker', 'speaker on', 'turn on the kitchen speaker'])('%s with no speaker: an honest line, nothing acts', (line) => {
    const r = parseDeviceCommands(line, one)!;
    expect(r.intents).toEqual([]);
    expect(r.say).toMatch(/no .*speaker/i);
    expect(routeLine(line, { devices: one }).name).toBe('device');
  });
  it('"kitchen speaker on" with a speaker never touches the lamp', () => {
    expect((parseDeviceCommands('kitchen speaker on', oneSpk)?.intents ?? []).some((x) => x.deviceId === 'l1')).toBe(false);
  });
  it('the refusal keeps "room"', () => {
    expect(parseDeviceCommands('dim the living room lamp', two)!.say).toContain('no living room lamp here');
  });
});
