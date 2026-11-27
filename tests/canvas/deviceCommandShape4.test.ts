// Final review 4: what worked on the deployed build still works.
import { describe, expect, it } from 'vitest';
import { parseDeviceCommands, type DeviceRef } from '../../src/canvas/deviceCommands';
import { routeLine } from '../../src/canvas/routeLine';

const lamps: DeviceRef[] = [
  { id: 'desk', label: 'Desk lamp', kind: 'lamp', on: false, brightness: 50 },
  { id: 'bed', label: 'Bedroom lamp', kind: 'lamp', on: true, brightness: 50 },
];
const withSpeaker: DeviceRef[] = [...lamps, { id: 'spk', label: 'Speaker', kind: 'music', playing: false, volume: 40 }];

describe('review 4 regressions', () => {
  it.each(['play some jazz', 'play jazz', 'play Take Five', 'play something relaxing', 'please play some old film songs'])('%j plays on the speaker without a Spotify search', (line) => {
    for (const sim of [true, false]) {
      const r = routeLine(line, { devices: withSpeaker, hasPlanBoard: false, sim });
      expect(r.name).toBe('device');
      if (r.name === 'device') expect(r.result.intents).toEqual([{ deviceId: 'spk', playing: true }]);
    }
  });
  it('with Spotify connected, "play some jazz" is still a search', () => {
    expect(routeLine('play some jazz', { devices: withSpeaker, hasPlanBoard: false, spotifyConnected: true }).name).toBe('musicSearch');
  });
  it.each(['play a game', 'play chess with me', 'play cards'])('%j is still talk', (line) => {
    expect(routeLine(line, { devices: withSpeaker, hasPlanBoard: false }).name).not.toBe('device');
  });
  // Final review 5: the not-music list applies to the Spotify search too.
  it.each(['play a game', 'play chess with me', 'play cards', 'play football', 'play with me', 'can you play hide and seek with me', 'play catch'])('Spotify connected: %j is talk, not a search', (line) => {
    const r = routeLine(line, { devices: withSpeaker, hasPlanBoard: false, spotifyConnected: true });
    expect(r.name).toBe('openEnded');
  });
  // Song titles with words a game list might hold are still searched.
  it.each(['play some jazz', 'play Take Five', 'play Safe and Sound', 'play Part of Your World', 'play Hide and Seek', 'play Play Dead', 'play Fair Game'])('Spotify connected: %j is still a search', (line) => {
    expect(routeLine(line, { devices: withSpeaker, hasPlanBoard: false, spotifyConnected: true }).name).toBe('musicSearch');
  });
  it.each([['desk lamp on now', true], ['lights on for me', true], ['lamp off again', false]] as [string, boolean][])('%j acts', (line, on) => {
    const r = parseDeviceCommands(line, lamps);
    expect(r).not.toBeNull();
    expect(r!.intents.every((i) => i.on === on)).toBe(true);
  });
});
