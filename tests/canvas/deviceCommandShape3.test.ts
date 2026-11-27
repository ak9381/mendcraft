// Final review 3 §1: talk that only sounds like a device order never acts;
// a volume percent goes to the speaker; two clauses do two things.
import { describe, expect, it } from 'vitest';
import { parseDeviceCommands, type DeviceRef } from '../../src/canvas/deviceCommands';
import { routeLine } from '../../src/canvas/routeLine';

const lamps: DeviceRef[] = [
  { id: 'desk', label: 'Desk lamp', kind: 'lamp', on: false, brightness: 50, temp: 4000 },
  { id: 'bed', label: 'Bedroom lamp', kind: 'lamp', on: true, brightness: 50, temp: 4000 },
];
const withSpeaker: DeviceRef[] = [...lamps, { id: 'spk', label: 'Speaker', kind: 'music', playing: false, volume: 40 }];

const REFUSED = [
  'cool', 'Cool!', 'cool, thanks', 'ok cool', 'so cool', 'cool idea', 'warm welcome', 'warm up the room', 'cool down',
  'the lamps on', 'the lamp on my desk broke', 'lamp on fire', 'lamp on means yes', 'my lamp turns on by itself',
  'room on the left', 'everything on the list',
  'make the text lighter', 'lighter text', 'make the background darker', 'darker theme', 'make the plan brighter',
  'make the kitchen lighter', 'lower your voice', 'lower the blinds', 'dim sum',
  'put the lights on the plan', 'set the lights on the east wall',
  'turn off the lamp no wait', 'turn the lamp on or off', 'turn on the lamp in an hour', 'turn on the lamp at 9',
  'lamp off maadi beda', 'lights off beda',
  'turn the desk lamp on then off',
];
const REFUSED_SPEAKER = ['next step', 'skip this step', 'play a game', 'play chess with me', 'louder voice please'];

describe('N1 wave 3: not an order', () => {
  it.each(REFUSED)('does not act on %j', (line) => {
    expect(parseDeviceCommands(line, lamps)).toBeNull();
    expect(parseDeviceCommands(line, withSpeaker)).toBeNull();
    expect(routeLine(line, { devices: withSpeaker, hasPlanBoard: false }).name).not.toBe('device');
  });
  it.each(REFUSED_SPEAKER)('does not act on %j with a speaker', (line) => {
    expect(parseDeviceCommands(line, withSpeaker)).toBeNull();
  });
  it.each([
    ['make it warmer', (r) => r.intents.length === 2 && r.intents.every((i) => typeof i.temp === 'number')],
    ['warmer', (r) => r.intents.every((i) => typeof i.temp === 'number')],
    ['cooler light', (r) => r.intents.every((i) => typeof i.temp === 'number')],
    ['make it warm', (r) => r.intents.every((i) => typeof i.temp === 'number')],
    ['make the desk lamp cooler', (r) => r.intents.length === 1 && r.intents[0].deviceId === 'desk'],
    ['brighter', (r) => r.intents.length === 2],
    ['dim the lamp a bit', (r) => r.intents.length === 2],
    ['desk lamp on', (r) => r.intents.length === 1 && r.intents[0].on === true],
    ['the desk lamp off please', (r) => r.intents.length === 1 && r.intents[0].on === false],
    ['set the desk lamp to 40%', (r) => r.intents[0].brightness === 40],
    ['make the bedroom lamp blue', (r) => !!r.intents[0].rgb && r.intents[0].deviceId === 'bed'],
  ] as [string, (r: NonNullable<ReturnType<typeof parseDeviceCommands>>) => boolean][])('still acts on %j', (line, ok) => {
    const r = parseDeviceCommands(line, withSpeaker);
    expect(r).not.toBeNull();
    expect(ok(r!)).toBe(true);
  });
});

describe('volume percent is the speaker, never the lamps', () => {
  it.each(['set the volume to 40 percent', 'volume 40 percent', 'speaker 40 percent', 'music at 40 percent', 'set the volume to 40%'])('%j', (line) => {
    const r = parseDeviceCommands(line, withSpeaker)!;
    expect(r.intents).toEqual([{ deviceId: 'spk', volume: 40 }]);
  });
  it('with no speaker connected, the lamps are never touched', () => {
    expect(parseDeviceCommands('set the volume to 40 percent', lamps)).toBeNull();
  });
  it('percent is read whole', () => {
    expect(parseDeviceCommands('desk lamp to 1000 percent', lamps)!.intents[0].brightness).toBe(1000);
    expect(parseDeviceCommands('dim the desk lamp to -20 percent', lamps)!.intents[0].brightness).toBe(-20);
    expect(parseDeviceCommands('desk lamp 12.50 percent', lamps)!.intents[0].brightness).toBe(12.5);
  });
});

describe('two clauses, two lamps', () => {
  it('turn the desk lamp on and the bedroom lamp off', () => {
    const r = parseDeviceCommands('turn the desk lamp on and the bedroom lamp off', lamps)!;
    expect(r.intents).toEqual([{ deviceId: 'desk', on: true }, { deviceId: 'bed', on: false }]);
  });
  it('turn on the lamp and play music does both', () => {
    const r = parseDeviceCommands('turn on the desk lamp and play music', withSpeaker)!;
    expect(r.intents).toEqual([{ deviceId: 'desk', on: true }, { deviceId: 'spk', playing: true }]);
  });
  it('an "and" between two lamps is one clause', () => {
    const r = parseDeviceCommands('turn off the desk lamp and the bedroom lamp', lamps)!;
    expect(r.intents.map((i) => i.on)).toEqual([false, false]);
  });
});
