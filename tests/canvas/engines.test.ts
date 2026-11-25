import { describe, expect, it } from 'vitest';
import { createEngines, planEngines, NO_NANO_NOTE, PHONE_NANO_NOTE, APPLE_ON_DEVICE_NOTE } from '../../src/canvas/engines';
import { ROUTE_VIA_HUB } from '../../src/ai/privacyRouter';

describe('engine selection (honest labels)', () => {
  it('uses real Nano on device when the Prompt API is present and it is not a phone', () => {
    const p = planEngines({ hasLanguageModel: true, isPhone: false, hasCloud: true, sim: false });
    expect(p.nano).toEqual({ engine: 'nano', sim: false });
    expect(p.gemini).toEqual({ engine: 'gemini', sim: false });
  });

  it('on a phone, the Nano step routes to Gemini with an honest note', () => {
    const p = planEngines({ hasLanguageModel: false, isPhone: true, hasCloud: true, sim: false });
    expect(p.nano.engine).toBe('gemini');
    expect(p.nano.routeNote).toBe(PHONE_NANO_NOTE);
    expect(p.nano.sim).toBe(false);
  });

  it('with no Prompt API (desktop) the Nano step also falls to Gemini', () => {
    const p = planEngines({ hasLanguageModel: false, isPhone: false, hasCloud: true, sim: false });
    expect(p.nano.engine).toBe('gemini');
    expect(p.nano.routeNote).toBe(NO_NANO_NOTE);
    expect(p.nano.sim).toBe(false);
  });

  it('without a cloud model the Gemini slot is scripted (SIM)', () => {
    const p = planEngines({ hasLanguageModel: true, isPhone: false, hasCloud: false, sim: false });
    expect(p.gemini).toEqual({ engine: 'gemini', sim: true });
  });

  it('sim forces scripted for both', () => {
    const p = planEngines({ hasLanguageModel: true, isPhone: false, hasCloud: true, sim: true });
    expect(p.nano.sim).toBe(true);
    expect(p.gemini.sim).toBe(true);
  });
});

describe('createEngines', () => {
  it('a real cloud engine carries no scripted stand-in (a live failure says why instead)', () => {
    const engines = createEngines({
      cloud: async (prompt, onText) => { onText('{"kind":"room","title":"X","tiles":[]}'); return '{"kind":"room","title":"X","tiles":[]}'; },
      sim: false,
    });
    const gemini = engines.gemini!('{"kind":"room","title":"Draft","tiles":[]}');
    expect(gemini.sim).toBe(false);
    expect(gemini.fallback).toBeUndefined();
  });

  it('?sim=1 stays scripted with no fallback hop', () => {
    const engines = createEngines({ cloud: async () => '', sim: true });
    const gemini = engines.gemini!('{"kind":"room","title":"Draft","tiles":[]}');
    expect(gemini.sim).toBe(true);
    expect(gemini.fallback).toBeUndefined();
  });
});

describe('engine selection — Android Nano and hub', () => {
  it('uses on-device Nano when ML Kit checkStatus is AVAILABLE, even on a phone', () => {
    const p = planEngines({ hasLanguageModel: false, isPhone: true, hasCloud: true, sim: false, androidNano: true });
    expect(p.nano).toEqual({ engine: 'nano', sim: false });
  });

  it('on a phone without Nano, a reachable hub is labelled as cleaned on the Mac', () => {
    const p = planEngines({ hasLanguageModel: false, isPhone: true, hasCloud: true, sim: false, hubReachable: true });
    expect(p.nano.engine).toBe('gemini');
    expect(p.nano.routeNote).toBe(ROUTE_VIA_HUB);
  });

  it('on a phone without Nano or hub, the label is Gemini (no Nano on this phone)', () => {
    const p = planEngines({ hasLanguageModel: false, isPhone: true, hasCloud: true, sim: false, hubReachable: false });
    expect(p.nano.routeNote).toBe(PHONE_NANO_NOTE);
    expect(PHONE_NANO_NOTE).toBe('Gemini (no Nano on this phone)');
  });
});

describe('engine selection — Apple on-device', () => {
  it('uses the on-device Apple path on an iPhone when the plugin is available', () => {
    const p = planEngines({ hasLanguageModel: false, isPhone: true, hasCloud: true, sim: false, appleOnDevice: true });
    expect(p.nano).toEqual({ engine: 'nano', sim: false, routeNote: APPLE_ON_DEVICE_NOTE });
    expect(APPLE_ON_DEVICE_NOTE).toBe('Apple · on device — nothing left this device');
  });

  it('runs the Apple generate function instead of the cloud when Apple is ready', async () => {
    let used = '';
    const engines = createEngines({
      isPhone: true,
      appleOnDevice: true,
      cloud: async () => { used = 'cloud'; return '{"kind":"room","title":"Cloud","tiles":[]}'; },
      onDeviceGenerate: async (_prompt, onText) => {
        used = 'apple';
        const text = '{"kind":"room","title":"Apple","tiles":[]}';
        onText(text);
        return text;
      },
    });
    const nano = engines.nano!('{"kind":"room","title":"Draft","tiles":[]}');
    expect(nano.id).toBe('nano');
    expect(nano.sim).toBe(false);
    expect(nano.routeLine).toBe(APPLE_ON_DEVICE_NOTE);
    const text = await nano.stream('hello', () => undefined);
    expect(used).toBe('apple');
    expect(text).toContain('Apple');
  });
});

describe('createEngines — late Apple plugin', () => {
  it('uses onDeviceGenerate on the next turn after appleOnDevice becomes true', async () => {
    const calls: string[] = [];
    const rt = {
      isPhone: true,
      hasCloud: true,
      sim: false,
      appleOnDevice: false,
      onDeviceGenerate: async (prompt: string, onText: (t: string) => void) => {
        calls.push(prompt);
        onText('{"kind":"room","title":"On device","tiles":[]}');
        return '{"kind":"room","title":"On device","tiles":[]}';
      },
      cloud: async () => '{"kind":"room","title":"Cloud","tiles":[]}',
    };
    const engines = createEngines(rt);
    const first = engines.nano!('{"kind":"room","title":"Draft","tiles":[]}');
    expect(first.id).toBe('gemini');
    rt.appleOnDevice = true;
    const second = engines.nano!('{"kind":"room","title":"Draft","tiles":[]}');
    expect(second.id).toBe('nano');
    await second.stream('make a board', () => undefined);
    expect(calls).toEqual(['make a board']);
  });
});
