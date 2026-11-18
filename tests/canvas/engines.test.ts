import { describe, expect, it } from 'vitest';
import { planEngines, PHONE_NANO_NOTE } from '../../src/canvas/engines';

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
    expect(p.nano.routeNote).toBe(PHONE_NANO_NOTE);
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
