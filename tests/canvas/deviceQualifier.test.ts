// sim-main review: one real lamp whose label is just "Lamp" (a generated
// connector's id) — "turn on the desk lamp" acts on it, as the deployed build
// did. With several lamps and no match, a line names them; never chat.
import { describe, expect, it } from 'vitest';
import { parseDeviceCommands, type DeviceRef } from '../../src/canvas/deviceCommands';
import { routeLine } from '../../src/canvas/routeLine';
import { impossibleAttempt } from '../../src/canvas/tryToBreak';

const one: DeviceRef[] = [{ id: 'gen-lamp-7', label: 'Lamp', kind: 'lamp', on: false, brightness: 50 }];
const two: DeviceRef[] = [
  { id: 'desk', label: 'Desk lamp', kind: 'lamp', on: false, brightness: 50 },
  { id: 'bed', label: 'Bedroom lamp', kind: 'lamp', on: true, brightness: 50 },
];

describe('a lamp named by a word its label does not have', () => {
  it.each([['turn on the desk lamp', true], ['desk lamp off', false], ['turn on the bedroom light', true], ['switch the kitchen lamp off', false]] as [string, boolean][])(
    'one lamp called "Lamp": %j acts on it', (line, on) => {
      const r = parseDeviceCommands(line, one)!;
      expect(r.intents).toEqual([{ deviceId: 'gen-lamp-7', on }]);
      expect(routeLine(line, { devices: one, hasPlanBoard: false }).name).toBe('device');
    });
  it('"set the desk lamp to 500%" is still refused, not clamped', () => {
    expect(parseDeviceCommands('set the desk lamp to 500%', one)!.intents[0].brightness).toBe(500);
    expect(impossibleAttempt('set the desk lamp to 500%', one)).not.toBeNull();
  });
  it('two lamps, the named one acts', () => {
    expect(parseDeviceCommands('turn on the desk lamp', two)!.intents).toEqual([{ deviceId: 'desk', on: true }]);
  });
  it('two lamps, none called that: a line naming them, nothing acts', () => {
    const r = parseDeviceCommands('turn on the kitchen lamp', two)!;
    expect(r.intents).toEqual([]);
    expect(r.say).toBe("There's no kitchen lamp here — there's the Desk lamp and the Bedroom lamp. Say which one.");
    expect(routeLine('turn on the kitchen lamp', { devices: two, hasPlanBoard: false }).name).toBe('device');
  });
  it('talk is still talk', () => {
    for (const l of ['make the text lighter', 'lamp on fire', 'the lamp on my desk broke', 'lower your voice']) expect(parseDeviceCommands(l, one)).toBeNull();
  });
});

// Final review 5: a speaker / music / stand noun never resolves to a lamp, whatever devices there are.
describe('device-kind nouns against the devices there are', () => {
  const lamp = (id: string, label: string): DeviceRef => ({ id, label, kind: 'lamp', on: false, brightness: 50 });
  const spk: DeviceRef = { id: 'm', label: 'Marshall', kind: 'music', playing: false, volume: 40 };
  const sets: Record<string, DeviceRef[]> = {
    'one lamp': [lamp('l', 'Lamp')], 'two lamps': [lamp('d', 'Desk lamp'), lamp('b', 'Bedroom lamp')],
    'a lamp and a speaker': [lamp('l', 'Lamp'), spk], 'a speaker only': [spk],
  };
  const lampIds = (devs: DeviceRef[]) => new Set(devs.filter((d) => d.kind !== 'music').map((d) => d.id));
  const speakerLines = ['kitchen speaker on', 'turn up the kitchen speaker', 'turn on the kitchen speaker', 'kitchen speaker off', 'turn off the kitchen speakers',
    'turn on the speaker', 'speaker off', 'turn the speaker up', 'dim the kitchen speaker', 'make the kitchen speaker blue', 'set the kitchen speaker to 40 percent'];
  const standLines = ['turn on the stand', 'stand on', 'turn on the kitchen stand', 'kitchen stand off'];
  const musicLines = ['music on', 'turn off the music', 'turn on the kitchen music'];
  for (const [name, devs] of Object.entries(sets)) {
    it.each([...speakerLines, ...standLines, ...musicLines])(`${name}: %j never touches a lamp`, (line) => {
      const r = parseDeviceCommands(line, devs);
      for (const i of r?.intents ?? []) expect(lampIds(devs).has(i.deviceId)).toBe(false);
    });
  }
  it.each(speakerLines)('no speaker at all: %j says so honestly', (line) => {
    for (const devs of [sets['one lamp'], sets['two lamps']]) {
      const r = parseDeviceCommands(line, devs)!;
      expect(r.intents).toEqual([]);
      expect(r.say).toMatch(/^There's no (?:kitchen )?speaker here/);
      expect(routeLine(line, { devices: devs, hasPlanBoard: false }).name).toBe('device');
    }
  });
  it('with a speaker: "turn up the kitchen speaker" is the speaker, louder', () => {
    expect(parseDeviceCommands('turn up the kitchen speaker', sets['a lamp and a speaker'])!.intents).toEqual([{ deviceId: 'm', volume: 60 }]);
  });
  it.each(['kitchen lamp on', 'kitchen light on', 'turn on the kitchen bulb', 'dim the kitchen light', 'kitchen bulb off'])('one lamp: lamp/light/bulb word %j acts on it', (line) => {
    for (const devs of [sets['one lamp'], sets['a lamp and a speaker']]) {
      const r = parseDeviceCommands(line, devs)!;
      expect(r.intents.map((i) => i.deviceId)).toEqual(['l']);
    }
  });
  it.each(['kitchen lamp on', 'turn on the kitchen bulb'])('two lamps: %j names them, nothing acts', (line) => {
    const r = parseDeviceCommands(line, sets['two lamps'])!;
    expect(r.intents).toEqual([]);
    expect(r.say).toMatch(/^There's no kitchen lamp here/);
  });
  it.each(['kitchen lamp on', 'turn on the speaker', 'kitchen speaker on'])('a speaker only: %j never acts', (line) => {
    expect(parseDeviceCommands(line, sets['a speaker only'])?.intents ?? []).toEqual([]);
  });
});
