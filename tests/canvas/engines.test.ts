import { describe, expect, it } from 'vitest';
import { createEngines, planEngines, NO_NANO_NOTE, PHONE_NANO_NOTE } from '../../src/canvas/engines';

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
  it('attaches a scripted fallback to a real cloud engine', () => {
    const engines = createEngines({
      cloud: async (prompt, onText) => { onText('{"kind":"room","title":"X","tiles":[]}'); return '{"kind":"room","title":"X","tiles":[]}'; },
      sim: false,
    });
    const gemini = engines.gemini!('{"kind":"room","title":"Draft","tiles":[]}');
    expect(gemini.sim).toBe(false);
    expect(gemini.fallback?.sim).toBe(true);
  });

  it('?sim=1 stays scripted with no fallback hop', () => {
    const engines = createEngines({ cloud: async () => '', sim: true });
    const gemini = engines.gemini!('{"kind":"room","title":"Draft","tiles":[]}');
    expect(gemini.sim).toBe(true);
    expect(gemini.fallback).toBeUndefined();
  });
});
