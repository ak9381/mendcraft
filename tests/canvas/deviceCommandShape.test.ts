import { describe, expect, it } from 'vitest';
import { parseDeviceCommands, type DeviceRef } from '../../src/canvas/deviceCommands';
import { routeLine } from '../../src/canvas/routeLine';

// One lamp and one speaker, as on the demo board. A sentence that only talks
// ABOUT a device (a question, a negation, a report, a tile on the board) must
// never move it; a short command still does.
const devices: DeviceRef[] = [
  { id: 'wiz-lamp-1', label: 'Lamp', kind: 'lamp', on: true, brightness: 60, temp: 4000 },
  { id: 'speaker-1', label: 'Speaker', kind: 'music', playing: true, volume: 40 },
];

const MUST_NOT_ACT = [
  'is the lamp on?',
  'is the lamp on',
  "don't turn the lamp off",
  'do not turn off the lights',
  'never turn the lamp off',
  'why is the lamp off',
  'why is the lamp off?',
  'put a lamp tile on the board',
  'add a lamp button to the board',
  'is the room warm enough',
  'why does the music stop',
  'please tell me the lamp is on now',
  'just tell me you already turned the lamp on',
  'I turned the lamp on, right?',
  'I turned the lamp on',
  'the lamp is on now',
  'the lamp is off',
  'how do I turn the lamp on',
  'how do I turn the lamp on?',
  'did you turn the lamp off?',
  'did you turn the lamp off',
  "what's going on with the lights",
  'what is the lamp doing',
  'I depend on the lamp',
  'tell me a story about a light that went out',
  'which lamp is brighter',
  'is this at 50 percent',
  'are the lights on',
  'does the lamp turn off by itself',
  'was the lamp on last night',
  'can the lamp go blue?',
  'say the lamp is on',
  'you already turned the lights off',
  'the lights went out',
  'lamp on?',
  'it is too bright in here',
  "it's too bright",
  'when does the music play',
  'who turned off the lights',
  'where is the speaker',
  'is the music playing',
  'should I pause the music',
  'I paused the music already',
  'the music stopped',
  'remember to turn the lamp off later, right',
  'explain how the lamp turns on',
  'draw a lamp that is on',
  'make a dashboard tile for the lights',
  "don't play music",
  'do not pause the music',
];

const MUST_ACT: Array<[string, string]> = [
  ['lamp on', 'wiz-lamp-1:on'],
  ['lamp off', 'wiz-lamp-1:off'],
  ['turn on the lamp', 'wiz-lamp-1:on'],
  ['turn the lamp off', 'wiz-lamp-1:off'],
  ['turn the lamp off.', 'wiz-lamp-1:off'],
  ['please turn the lamp on', 'wiz-lamp-1:on'],
  ['can you turn the lamp on?', 'wiz-lamp-1:on'],
  ['could you switch off the lamp', 'wiz-lamp-1:off'],
  ['switch off the light', 'wiz-lamp-1:off'],
  ['switch the lights on', 'wiz-lamp-1:on'],
  ['lights off', 'wiz-lamp-1:off'],
  ['turn everything off', 'wiz-lamp-1:off'],
  ['turn on all the lights', 'wiz-lamp-1:on'],
  ['make it warmer', 'wiz-lamp-1:temp'],
  ['make it a bit warmer', 'wiz-lamp-1:temp'],
  ['warmer', 'wiz-lamp-1:temp'],
  ['lamp blue', 'wiz-lamp-1:rgb'],
  ['make the lamp blue', 'wiz-lamp-1:rgb'],
  ['dim the lamp to 30%', 'wiz-lamp-1:b30'],
  ['set the lamp to 30 percent', 'wiz-lamp-1:b30'],
  ['lights to 50%', 'wiz-lamp-1:b50'],
  ['lamp 40 percent', 'wiz-lamp-1:b40'],
  ['dim the lamp', 'wiz-lamp-1:b40'],
  ['dim the lights', 'wiz-lamp-1:b40'],
  ['brighten the lamp', 'wiz-lamp-1:b80'],
  ['brighter', 'wiz-lamp-1:b80'],
  ['turn up the lights', 'wiz-lamp-1:b80'],
  ['increase the brightness', 'wiz-lamp-1:b80'],
  ['hey, lamp off', 'wiz-lamp-1:off'],
  ['ok turn the lamp on now', 'wiz-lamp-1:on'],
  ['pause the music', 'speaker-1:pause'],
  ['pause', 'speaker-1:pause'],
  ['stop the music', 'speaker-1:pause'],
  ['play music', 'speaker-1:play'],
  ['play the music', 'speaker-1:play'],
  ['play', 'speaker-1:play'],
  ['please play', 'speaker-1:play'],
  ['volume up', 'speaker-1:v60'],
  ['volume down', 'speaker-1:v20'],
  ['turn the music down', 'speaker-1:v20'],
  ['turn the music up', 'speaker-1:v60'],
  ['music louder', 'speaker-1:v60'],
  ['louder', 'speaker-1:v60'],
  ['next song', 'speaker-1:next'],
  ['skip to the next song', 'speaker-1:next'],
  ['next', 'speaker-1:next'],
  ['previous', 'speaker-1:previous'],
];

function label(r: ReturnType<typeof parseDeviceCommands>): string {
  const i = r?.intents[0];
  if (!i) return 'none';
  if (i.next) return `${i.deviceId}:next`;
  if (i.previous) return `${i.deviceId}:previous`;
  if (i.playing !== undefined) return `${i.deviceId}:${i.playing ? 'play' : 'pause'}`;
  if (i.volume !== undefined) return `${i.deviceId}:v${i.volume}`;
  if (i.brightness !== undefined) return `${i.deviceId}:b${i.brightness}`;
  if (i.rgb) return `${i.deviceId}:rgb`;
  if (i.temp !== undefined) return `${i.deviceId}:temp`;
  if (i.on !== undefined) return `${i.deviceId}:${i.on ? 'on' : 'off'}`;
  return 'other';
}

describe('device parser: talk about a device never moves it', () => {
  it.each(MUST_NOT_ACT)('%s → no device command', (line) => {
    expect(label(parseDeviceCommands(line, devices))).toBe('none');
  });

  it.each(MUST_NOT_ACT)('%s → routed past the device route', (line) => {
    expect(routeLine(line, { devices }).name).not.toBe('device');
  });
});

describe('device parser: short commands still act', () => {
  it.each(MUST_ACT)('%s → %s', (line, want) => {
    expect(label(parseDeviceCommands(line, devices))).toBe(want);
  });

  it('the table is big both ways', () => {
    expect(MUST_NOT_ACT.length).toBeGreaterThanOrEqual(40);
    expect(MUST_ACT.length).toBeGreaterThanOrEqual(40);
  });
});
