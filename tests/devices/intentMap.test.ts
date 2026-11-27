import { describe, expect, it } from 'vitest';
import { actionsForIntent, argsRefusal, coerceIntentMap, coerceIntentMapNotes } from '../../src/devices/intentMap';
import { WIZ_INTENTS, wizConnector } from './wizSample';

describe('coerceIntentMap', () => {
  it('coerceIntentMap drops an entry whose action is not in the connector', () => {
    const m = coerceIntentMap({ ...WIZ_INTENTS, on: { action: 'reboot' } }, wizConnector());
    expect(m.on).toBeUndefined();
    expect(m.off).toEqual({ action: 'power-off' });
  });

  it('coerceIntentMap drops a param name the action does not declare', () => {
    const { map, dropped } = coerceIntentMapNotes({ brightness: { action: 'set-brightness', params: { dimming: 'brightness', speed: 'brightness' } } }, wizConnector());
    expect(map.brightness).toBeUndefined();
    expect(dropped.join(' ')).toMatch(/speed/);
  });

  it('drops an entry that leaves a declared param unfilled, or fills it from the wrong field', () => {
    const c = wizConnector();
    expect(coerceIntentMap({ brightness: { action: 'set-brightness' } }, c).brightness).toBeUndefined();
    expect(coerceIntentMap({ brightness: { action: 'set-brightness', params: { dimming: 'temp' } } }, c).brightness).toBeUndefined();
    expect(coerceIntentMap({ volume: { action: 'power-on' } }, c)).toEqual({});
    expect(coerceIntentMap('nope', c)).toEqual({});
  });
});

describe('actionsForIntent', () => {
  const m = () => coerceIntentMap(WIZ_INTENTS, wizConnector());

  it('actionsForIntent({ on: true, brightness: 60 }) gives the on action then the brightness action with dimming 60', () => {
    expect(actionsForIntent({ deviceId: 'wiz-lamp-1', on: true, brightness: 60 }, m())).toEqual([
      { action: 'power-on', args: {} },
      { action: 'set-brightness', args: { dimming: 60 } },
    ]);
  });

  it('off (or brightness 0) is the off action alone', () => {
    expect(actionsForIntent({ deviceId: 'l', on: false, brightness: 40 }, m())).toEqual([{ action: 'power-off', args: {} }]);
    expect(actionsForIntent({ deviceId: 'l', brightness: 0 }, m())).toEqual([{ action: 'power-off', args: {} }]);
  });

  it('is null when part of the intent has no entry, or is a speaker field', () => {
    expect(actionsForIntent({ deviceId: 'l', sceneId: 6 }, m())).toBeNull();
    expect(actionsForIntent({ deviceId: 'l', on: true, rgb: { r: 1, g: 2, b: 3 } }, m())).toBeNull();
    expect(actionsForIntent({ deviceId: 'l', volume: 40 }, m())).toBeNull();
    expect(actionsForIntent({ deviceId: 'l' }, m())).toBeNull();
  });
});

describe('argsRefusal', () => {
  it('refuses a value outside the declared range instead of clamping it', () => {
    const a = wizConnector().actions.find((x) => x.id === 'set-brightness')!;
    expect(argsRefusal(a, { dimming: 60 })).toBeNull();
    expect(argsRefusal(a, { dimming: 5 })).toMatch(/10 to 100/);
    expect(argsRefusal(a, { dimming: 150 })).toMatch(/10 to 100/);
    expect(argsRefusal(a, {})).toMatch(/whole number/);
  });
});
