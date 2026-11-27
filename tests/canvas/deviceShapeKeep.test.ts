import { describe, expect, it } from 'vitest';
import { parseDeviceCommands, type DeviceRef } from '../../src/canvas/deviceCommands';
import { routeLine } from '../../src/canvas/routeLine';
import { SCRIPTED_KN_PACK, coerceLanguagePack, routePackPhrase } from '../../src/canvas/languagePack';

// Orders the stricter shape gate must keep acting (main's gate sent them to chat).
const devices: DeviceRef[] = [
  { id: 'desk', label: 'Desk lamp', kind: 'lamp', on: false, brightness: 60 },
  { id: 'spk', label: 'Speaker', kind: 'music', playing: false, volume: 40 },
];

describe('orders that still act', () => {
  it.each(['play some jazz', 'play something relaxing', 'play some music', 'play a song'])('%s → plays (search or play), never chat', (line) => {
    for (const sim of [true, false]) {
      const r = routeLine(line, { devices, sim, spotifyConnected: true });
      expect(r.name, `${line} sim=${sim}`).not.toBe('openEnded');
      if (r.name === 'device') expect(r.result.intents.some((i) => i.playing === true)).toBe(true);
    }
  });

  it.each([['lamp on now', true], ['lights on for me', true], ['lights off for me', false], ['turn the lamp on for me please', true]] as const)(
    '%s acts', (line, on) => {
      expect(parseDeviceCommands(line, devices)?.intents[0]).toMatchObject({ deviceId: 'desk', on });
    });
});

describe('Kannada polite and plain imperatives are the same order', () => {
  const pack = (() => {
    const r = coerceLanguagePack({ lang: 'kn', strings: { ...SCRIPTED_KN_PACK.strings }, phrases: SCRIPTED_KN_PACK.phrases });
    if (!r.ok) throw new Error(r.error);
    return r.value;
  })();
  it('ಮಾಡು and ಮಾಡಿ both act', () => {
    expect(routePackPhrase('ದೀಪ ಆನ್ ಮಾಡು', pack)).toBe('lampOn');
    expect(routePackPhrase('ದೀಪ ಆನ್ ಮಾಡಿ', pack)).toBe('lampOn');
    expect(routePackPhrase('ದೀಪ ಆಫ್ ಮಾಡಿ', pack)).toBe('lampOff');
    expect(routePackPhrase('ದೀಪ ಆನ್ ಮಾಡಿ?', pack)).toBeNull();
  });
});
