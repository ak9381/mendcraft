import { describe, expect, it } from 'vitest';
import { deviceStateAnswer } from '../../src/canvas/deviceStateAnswer';
import { routeLine } from '../../src/canvas/routeLine';
import type { DeviceRef } from '../../src/canvas/deviceCommands';

const one: DeviceRef[] = [{ id: 'desk', label: 'Desk lamp', kind: 'lamp', on: true }];
const two: DeviceRef[] = [...one, { id: 'bed', label: 'Bedroom lamp', kind: 'lamp', on: false }, { id: 'spk', label: 'Speaker', kind: 'music', playing: true }];

describe('a state question is answered from the device store', () => {
  it('one lamp', () => {
    expect(deviceStateAnswer('is the lamp on?', one)).toBe('The desk lamp is on.');
    expect(deviceStateAnswer('Is the desk lamp off?', one)).toBe('The desk lamp is on.');
    expect(deviceStateAnswer('are the lights on', one)).toBe('The desk lamp is on.');
  });
  it('named, plural, music', () => {
    expect(deviceStateAnswer('is the bedroom lamp on?', two)).toBe('The bedroom lamp is off.');
    expect(deviceStateAnswer('are the lights on?', two)).toBe('The desk lamp is on and the bedroom lamp is off.');
    expect(deviceStateAnswer('is the music playing?', two)).toBe('The speaker is playing.');
  });
  it('a lamp that does not answer is not guessed', () => {
    expect(deviceStateAnswer('is the lamp on?', [{ ...one[0], unreachable: true }])).toBe("I don't know — the desk lamp isn't answering.");
  });
  it('not a state question, or no such device: null', () => {
    expect(deviceStateAnswer('turn the lamp on', one)).toBeNull();
    expect(deviceStateAnswer('is the oven on?', one)).toBeNull();
    expect(deviceStateAnswer('is the lamp on?', [])).toBeNull();
    expect(deviceStateAnswer('is the room warm enough', one)).toBeNull();
  });
  it('routes as deviceState, never chat or the device route', () => {
    const r = routeLine('is the lamp on?', { devices: one, hasPlanBoard: false });
    expect(r).toEqual({ name: 'deviceState', line: 'The desk lamp is on.' });
  });
  // Final review 4: never a guess.
  it('a speaker whose playing was never read: "I don\'t know"', () => {
    expect(deviceStateAnswer('is the music playing?', [{ id: 'spk', label: 'Speaker', kind: 'music', playing: false, unknown: true }]))
      .toBe("I don't know whether the speaker is playing.");
  });
  it('a lamp with no known state is not "off"', () => {
    expect(deviceStateAnswer('is the lamp on?', [{ id: 'l', label: 'Desk lamp', kind: 'lamp' }])).toBe("I don't know whether the desk lamp is on.");
  });
  it('before the first look for lamps: still looking', () => {
    expect(deviceStateAnswer('is the lamp on?', [{ ...one[0], looking: true }])).toBe("I'm still looking for the desk lamp.");
  });
  it('names keep their casing', () => {
    expect(deviceStateAnswer('is the lamp on?', [{ id: 'w', label: 'WiZ lamp', kind: 'lamp', on: false }])).toBe('The WiZ lamp is off.');
    expect(deviceStateAnswer('is the music playing?', [{ id: 'm', label: 'Marshall', kind: 'music', playing: true }])).toBe('The Marshall is playing.');
  });
});
