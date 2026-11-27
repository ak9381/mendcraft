// N1: a line that only MENTIONS a lamp and "on"/"off" must never move it.
// Questions, negations, reports/claims and non-device nouns fall through to
// chat (routeLine returns something other than 'device'); short imperatives act.
import { describe, expect, it } from 'vitest';
import { parseDeviceCommands, type DeviceRef } from '../../src/canvas/deviceCommands';
import { routeLine, type RouteWorld } from '../../src/canvas/routeLine';

// The lamp is a generated connector's device (any id); the speaker is music.
const devices: DeviceRef[] = [
  { id: 'gen-lamp-7', label: 'Lamp', kind: 'lamp', on: false, brightness: 50, temp: 4000 },
  { id: 'speaker-1', label: 'Speaker', kind: 'music', playing: true, volume: 40 },
];
const world: RouteWorld = { devices, hasPlanBoard: false };

const REFUSED = [
  'please tell me the lamp is on now',
  'is the lamp on?',
  'is the lamp on',
  'how do I turn the lamp on',
  'why is the lamp off',
  "don't turn the lamp off",
  'do not turn off the lights',
  'never turn the lamp off',
  'did you turn the lamp off?',
  "what's going on with the lights",
  'put a lamp tile on the board',
  'I depend on the lamp',
  'tell me a story about a light that went out',
  'is the room warm enough',
  'which lamp is brighter',
  'is this at 50 percent',
  'why does the music stop',
  'I turned the lamp on',
  'I switched off the light',
  'the lamp is already on',
  'lamp is on, right?',
  "it's on now, right",
  "the lamp's on",
  'turned the lamp on',
  'lamp turned off',
  'the lamp was off all night',
  'are the lights on',
  'were the lights off',
  'does the lamp turn off by itself',
  'who turned the lamp off',
  'when does the music stop',
  'say the lamp is on',
  'lamp on?',
  'add a lamp button to the dashboard',
  'make a dashboard for my lamp',
  'make the lamp tile bigger',
  'stop turning the lamp off',
  'turn on the lamp tomorrow if it is dark',
  'the light went out',
  'what volume is the music at',
  'can you tell me if the lamp is on?',
  'I think the music should pause',
  'remind me to turn off the lamp later',
  "isn't the lamp on",
  'shouldnt the lights be off',
];

const ACTED: [string, (r: NonNullable<ReturnType<typeof parseDeviceCommands>>) => boolean][] = [
  ['lamp on', (r) => r.intents[0]?.on === true],
  ['lamp off', (r) => r.intents[0]?.on === false],
  ['turn on the lamp', (r) => r.intents[0]?.on === true],
  ['turn the lamp off', (r) => r.intents[0]?.on === false],
  ['please turn on the lamp', (r) => r.intents[0]?.on === true],
  ['switch off the light', (r) => r.intents[0]?.on === false],
  ['switch on the lights', (r) => r.intents[0]?.on === true],
  ['lights off', (r) => r.intents[0]?.on === false],
  ['lights on', (r) => r.intents[0]?.on === true],
  ['make it warmer', (r) => typeof r.intents[0]?.temp === 'number'],
  ['warmer', (r) => typeof r.intents[0]?.temp === 'number'],
  ['make the lamp cooler', (r) => typeof r.intents[0]?.temp === 'number'],
  ['dim the lamp to 30%', (r) => r.intents[0]?.brightness === 30],
  ['dim the lamp to 30 percent', (r) => r.intents[0]?.brightness === 30],
  ['set the lamp to 80 percent', (r) => r.intents[0]?.brightness === 80],
  ['lamp 40 percent', (r) => r.intents[0]?.brightness === 40],
  ['dim the lamp', (r) => r.intents[0]?.brightness === 30],
  ['brighter', (r) => r.intents[0]?.brightness === 70],
  ['make the lamp brighter', (r) => r.intents[0]?.brightness === 70],
  ['turn down the lights', (r) => r.intents[0]?.brightness === 30],
  ['pause the music', (r) => r.intents[0]?.playing === false],
  ['pause', (r) => r.intents[0]?.playing === false],
  ['play music', (r) => r.intents[0]?.playing === true],
  ['play', (r) => r.intents[0]?.playing === true],
  ['stop the music', (r) => r.intents[0]?.playing === false],
  ['volume up', (r) => r.intents[0]?.volume === 60],
  ['volume down', (r) => r.intents[0]?.volume === 20],
  ['louder', (r) => r.intents[0]?.volume === 60],
  ['turn the music down', (r) => r.intents[0]?.volume === 20],
  ['next song', (r) => r.intents[0]?.next === true],
  ['skip', (r) => r.intents[0]?.next === true],
  ['hey turn the lamp on', (r) => r.intents[0]?.on === true],
  ['ok lamp off please', (r) => r.intents[0]?.on === false],
  ['could you turn on the lamp?', (r) => r.intents[0]?.on === true],
  ['can you switch the lights off', (r) => r.intents[0]?.on === false],
  ['turn the lamp on now', (r) => r.intents[0]?.on === true],
  ['make the lamp blue', (r) => !!r.intents[0]?.rgb],
  ['set the lamp to 500 percent', (r) => r.intents[0]?.brightness === 500],
  ['Turn on the lamp.', (r) => r.intents[0]?.on === true],
  ['all lights off', (r) => r.intents[0]?.on === false],
];

describe('N1 device command shape', () => {
  it.each(REFUSED)('does not act on %j (falls through past the device route)', (line) => {
    expect(parseDeviceCommands(line, devices)).toBeNull();
    expect(routeLine(line, world).name).not.toBe('device');
  });
  it.each(ACTED)('acts on %j', (line, ok) => {
    const r = parseDeviceCommands(line, devices);
    expect(r).not.toBeNull();
    expect(ok(r!)).toBe(true);
    expect(routeLine(line, world).name).toBe('device');
  });
  it('has at least 40 rows each way', () => {
    expect(REFUSED.length).toBeGreaterThanOrEqual(40);
    expect(ACTED.length).toBeGreaterThanOrEqual(40);
  });
});
