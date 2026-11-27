import { describe, expect, it } from 'vitest';
import { parseDeviceCommands, volumeStepNoop, VOLUME_AT_MAX_LINE, VOLUME_AT_MIN_LINE, type DeviceRef } from '../../src/canvas/deviceCommands';

const devices: DeviceRef[] = [
  { id: 'lamp-a', label: 'Desk lamp', kind: 'lamp', on: false, brightness: 40 },
  { id: 'speaker-a', label: 'Speaker', kind: 'music', playing: false, volume: 40 },
];

describe('device voice — music', () => {
  it('play / pause route to the music device', () => {
    expect(parseDeviceCommands('play', devices)!.intents).toEqual([{ deviceId: 'speaker-a', playing: true }]);
    expect(parseDeviceCommands('pause', devices)!.intents).toEqual([{ deviceId: 'speaker-a', playing: false }]);
  });

  it('"next song" skips the track', () => {
    expect(parseDeviceCommands('next song', devices)!.intents).toEqual([{ deviceId: 'speaker-a', next: true }]);
  });

  it('louder / softer step the volume relative to current', () => {
    expect(parseDeviceCommands('music louder', devices)!.intents).toEqual([{ deviceId: 'speaker-a', volume: 60 }]);
    expect(parseDeviceCommands('music softer', devices)!.intents).toEqual([{ deviceId: 'speaker-a', volume: 20 }]);
    expect(parseDeviceCommands('louder', devices)!.intents).toEqual([{ deviceId: 'speaker-a', volume: 60 }]);
  });

  it('music verbs do nothing when there is no music device', () => {
    expect(parseDeviceCommands('play', [devices[0]])).toBeNull();
  });

  it('lamp commands still target only lamps, not the speaker', () => {
    expect(parseDeviceCommands('lights off', devices)!.intents).toEqual([{ deviceId: 'lamp-a', on: false }]);
  });
});

describe('statusKey (for localized status lines)', () => {
  it('each command carries the status key its confirmation maps to', () => {
    expect(parseDeviceCommands('lights off', devices)!.statusKey).toBe('lightsOff');
    expect(parseDeviceCommands('lights on', devices)!.statusKey).toBe('lightsOn');
    expect(parseDeviceCommands('brighter', devices)!.statusKey).toBe('brighter');
    expect(parseDeviceCommands('dim the lights', devices)!.statusKey).toBe('dimmer');
    expect(parseDeviceCommands('play', devices)!.statusKey).toBe('playing');
    expect(parseDeviceCommands('pause', devices)!.statusKey).toBe('paused');
    expect(parseDeviceCommands('next song', devices)!.statusKey).toBe('nextSong');
    expect(parseDeviceCommands('louder', devices)!.statusKey).toBe('louder');
    expect(parseDeviceCommands('music softer', devices)!.statusKey).toBe('softer');
  });
});

describe('natural music phrasing', () => {
  it('stops playback and steps volume with "up" / "down"', () => {
    expect(parseDeviceCommands('stop the music', devices)!.intents)
      .toEqual([{ deviceId: 'speaker-a', playing: false }]);
    expect(parseDeviceCommands('turn the music down', devices)!.intents)
      .toEqual([{ deviceId: 'speaker-a', volume: 20 }]);
    expect(parseDeviceCommands('turn the music up', devices)!.intents)
      .toEqual([{ deviceId: 'speaker-a', volume: 60 }]);
  });

  it('does not treat "turn down the lights" as a volume change', () => {
    expect(parseDeviceCommands('turn down the lights', devices)!.intents)
      .toEqual([{ deviceId: 'lamp-a', brightness: 20 }]);
  });
});

describe('music words inside other sentences are just words (live misparse: "next to" skipped the song)', () => {
  const notMusic = [
    'add a study next to bedroom 2',
    'put the sofa next to the window',
    'add a play area for the kids',
    'make the room next door bigger',
    'move the previous wall left',
  ];
  for (const s of notMusic) {
    it(`"${s}" never touches the speaker`, () => {
      const r = parseDeviceCommands(s, devices);
      expect(r?.intents.some((i) => i.deviceId === 'speaker-a') ?? false).toBe(false);
    });
  }
  it('commands that ARE music still work', () => {
    expect(parseDeviceCommands('next', devices)!.intents).toEqual([{ deviceId: 'speaker-a', next: true }]);
    expect(parseDeviceCommands('skip', devices)!.intents).toEqual([{ deviceId: 'speaker-a', next: true }]);
    expect(parseDeviceCommands('please play', devices)!.intents).toEqual([{ deviceId: 'speaker-a', playing: true }]);
    expect(parseDeviceCommands('play the next song', devices)!.intents).toEqual([{ deviceId: 'speaker-a', next: true }]);
    expect(parseDeviceCommands('previous', devices)!.intents).toEqual([{ deviceId: 'speaker-a', previous: true }]);
  });
});

describe('final review M8: a volume step that changes nothing says so', () => {
  const at = (volume: number): DeviceRef[] => [{ id: 'speaker-a', label: 'Speaker', kind: 'music', playing: true, volume }];
  it('"louder" at 100 and "softer" at 0 are a no-op with an honest line', () => {
    expect(volumeStepNoop(parseDeviceCommands('louder', at(100))!, () => 100)).toBe(VOLUME_AT_MAX_LINE);
    expect(volumeStepNoop(parseDeviceCommands('softer', at(0))!, () => 0)).toBe(VOLUME_AT_MIN_LINE);
  });
  it('a step that moves the volume, an unknown volume, or another command is not a no-op', () => {
    expect(volumeStepNoop(parseDeviceCommands('louder', at(90))!, () => 90)).toBeNull();
    expect(volumeStepNoop(parseDeviceCommands('louder', at(100))!, () => undefined)).toBeNull();
    expect(volumeStepNoop(parseDeviceCommands('play', at(100))!, () => 100)).toBeNull();
  });
  it('the canvas says the line instead of "Louder."', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
    expect(src).toContain('const noop = volumeStepNoop(dc, (id) => store.get(id)?.volume);');
  });
});
