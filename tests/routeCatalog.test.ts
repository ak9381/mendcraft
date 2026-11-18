import { describe, expect, it } from 'vitest';
import { catalogRoute, formatWhatWasSent } from '../src/ux/routeCatalog';
import { FILLED_ON_DEVICE_SUFFIX } from '../src/ux/wording';

describe('catalogRoute filled-on-device', () => {
  it('keeps tokens in What was sent and suffixes the route line', () => {
    const r = catalogRoute({
      route: { tier: 'gemini', engine: 'gemini', reason: 'hard question', filledOnDevice: true },
      kind: 'hard',
      sent: 'Does this bedroom work for [Mother]?',
      filledOnDevice: true,
    });
    expect(r.routeLine).toContain(FILLED_ON_DEVICE_SUFFIX);
    expect(formatWhatWasSent(r)).toContain('[Mother]');
    expect(formatWhatWasSent(r)).not.toContain('Lakshmi');
  });
});
