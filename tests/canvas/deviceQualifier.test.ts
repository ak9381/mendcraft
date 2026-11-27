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
