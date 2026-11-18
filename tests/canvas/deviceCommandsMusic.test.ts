import { describe, expect, it } from 'vitest';
import { parseDeviceCommands, type DeviceRef } from '../../src/canvas/deviceCommands';

const devices: DeviceRef[] = [
  { id: 'wiz-desk', label: 'Desk lamp', kind: 'lamp', on: false, brightness: 40 },
  { id: 'speaker-1', label: 'Speaker', kind: 'music', playing: false, volume: 40 },
];

describe('device voice — music', () => {
  it('play / pause route to the music device', () => {
    expect(parseDeviceCommands('play', devices)!.intents).toEqual([{ deviceId: 'speaker-1', playing: true }]);
    expect(parseDeviceCommands('pause', devices)!.intents).toEqual([{ deviceId: 'speaker-1', playing: false }]);
  });

  it('"next song" skips the track', () => {
    expect(parseDeviceCommands('next song', devices)!.intents).toEqual([{ deviceId: 'speaker-1', next: true }]);
  });

  it('louder / softer step the volume relative to current', () => {
    expect(parseDeviceCommands('music louder', devices)!.intents).toEqual([{ deviceId: 'speaker-1', volume: 60 }]);
    expect(parseDeviceCommands('music softer', devices)!.intents).toEqual([{ deviceId: 'speaker-1', volume: 20 }]);
    expect(parseDeviceCommands('louder', devices)!.intents).toEqual([{ deviceId: 'speaker-1', volume: 60 }]);
  });

  it('music verbs do nothing when there is no music device', () => {
    expect(parseDeviceCommands('play', [devices[0]])).toBeNull();
  });

  it('lamp commands still target only lamps, not the speaker', () => {
    expect(parseDeviceCommands('lights off', devices)!.intents).toEqual([{ deviceId: 'wiz-desk', on: false }]);
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
