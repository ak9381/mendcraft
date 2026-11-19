import { describe, expect, it } from 'vitest';
import {
  ROUTE_ASK_FIRST,
  ROUTE_DIRECT_UNCLEANED,
  ROUTE_LOCAL_CLEAN,
  ROUTE_PHONE_NO_NANO,
  ROUTE_PHONE_NANO,
  ROUTE_VIA_HUB,
  decidePrivacyRoute,
  labelNanoStatus,
  looksSensitive,
  mapMlKitStatus,
  runHubPrivacyJob,
  runLocalPrivacyJob,
  validatePrivacyAsk,
  validatePrivacyReply,
} from '../src/ai/privacyRouter';
import type { Person } from '../src/privacy/directory';

const priya: Person = {
  id: 'p1',
  name: 'Priya Rao',
  role: 'client',
  token: '[Client A]',
  notes: [],
  createdAt: 0,
};

describe('looksSensitive', () => {
  it('flags a known directory name and a leftover phone number', () => {
    expect(looksSensitive('email Priya Rao about the kitchen', [priya])).toBe(true);
    expect(looksSensitive('call me at 9876543210 later')).toBe(true);
    expect(looksSensitive('dim the desk lamp a bit', [priya])).toBe(false);
  });
});

describe('decidePrivacyRoute', () => {
  it('uses local Nano when this device has it', () => {
    const d = decidePrivacyRoute('email Priya Rao', { hasLocalNano: true, hubReachable: true, isPhone: false }, [priya]);
    expect(d).toEqual({ action: 'local', routeLine: ROUTE_LOCAL_CLEAN, cleaned: true });
    const phone = decidePrivacyRoute('email Priya Rao', { hasLocalNano: true, hubReachable: false, isPhone: true }, [priya]);
    expect(phone.routeLine).toBe(ROUTE_PHONE_NANO);
  });

  it('routes a phone without Nano through the Mac hub', () => {
    const d = decidePrivacyRoute('email Priya Rao', { hasLocalNano: false, hubReachable: true, isPhone: true }, [priya]);
    expect(d).toEqual({ action: 'hub', routeLine: ROUTE_VIA_HUB, cleaned: true });
  });

  it('asks first when the text looks sensitive and no hub is here', () => {
    const d = decidePrivacyRoute('email Priya Rao', { hasLocalNano: false, hubReachable: false, isPhone: true }, [priya]);
    expect(d).toEqual({ action: 'ask', routeLine: ROUTE_ASK_FIRST, cleaned: false });
  });

  it('falls back to a labelled uncleaned Gemini call only when there is no directory to protect', () => {
    const plain = decidePrivacyRoute('dim the lamp', { hasLocalNano: false, hubReachable: false, isPhone: true }, []);
    expect(plain).toEqual({ action: 'direct-uncleaned', routeLine: ROUTE_DIRECT_UNCLEANED, cleaned: false });
    const forced = decidePrivacyRoute('email Priya Rao', { hasLocalNano: false, hubReachable: false, askIfSensitive: false }, [priya]);
    expect(forced.action).toBe('direct-uncleaned');
    expect(forced.routeLine).toBe(ROUTE_DIRECT_UNCLEANED);
  });

  it('asks before a raw cloud call whenever a directory exists, even if the text looks plain — a bare first name ("Tell Priya I\'m late") would not trip the full-name regex', () => {
    const plain = decidePrivacyRoute('dim the lamp', { hasLocalNano: false, hubReachable: false, isPhone: true }, [priya]);
    expect(plain).toEqual({ action: 'ask', routeLine: ROUTE_ASK_FIRST, cleaned: false });
    const bareFirstName = decidePrivacyRoute("Tell Priya I'm late", { hasLocalNano: false, hubReachable: false }, [priya]);
    expect(bareFirstName.action).toBe('ask');
  });
});

describe('labelNanoStatus / mapMlKitStatus', () => {
  it('maps ML Kit FeatureStatus codes', () => {
    expect(mapMlKitStatus(3)).toBe('available');
    expect(mapMlKitStatus(1)).toBe('downloadable');
    expect(mapMlKitStatus(2)).toBe('downloading');
    expect(mapMlKitStatus(0)).toBe('unavailable');
    expect(mapMlKitStatus(99)).toBe('unknown');
  });

  it('shows the requested phone label when Nano is missing', () => {
    expect(labelNanoStatus('unavailable', true)).toBe(ROUTE_PHONE_NO_NANO);
    expect(labelNanoStatus('available', true)).toBe('Nano on this phone');
  });
});

describe('validatePrivacyAsk / Reply', () => {
  it('accepts a well-formed ask and reply, and rejects junk', () => {
    expect(validatePrivacyAsk({ jobId: 'pv-1', text: 'email Priya' })).toEqual({ jobId: 'pv-1', text: 'email Priya' });
    expect(validatePrivacyAsk({ jobId: 'pv-1', text: '' })).toBeNull();
    expect(validatePrivacyAsk({ jobId: 'pv-1' })).toBeNull();
    const reply = validatePrivacyReply({
      jobId: 'pv-1', text: 'hi Priya Rao', routeLine: ROUTE_VIA_HUB, sentBytes: 12, cleaned: true,
    });
    expect(reply?.cleaned).toBe(true);
    expect(validatePrivacyReply({ jobId: 'pv-1', text: 'x', routeLine: 'r', sentBytes: -1, cleaned: true })).toBeNull();
  });
});

describe('runHubPrivacyJob', () => {
  it('sends only the redacted prompt to Gemini and puts the real name back', async () => {
    const seen: string[] = [];
    const reply = await runHubPrivacyJob(
      { jobId: 'pv-1', text: 'Write a short email to Priya Rao about the kitchen.' },
      [priya],
      async (redacted) => {
        seen.push(redacted);
        expect(redacted).toContain('[Client A]');
        expect(redacted).not.toContain('Priya');
        return `Draft for ${redacted.includes('[Client A]') ? '[Client A]' : 'someone'}.`;
      },
    );
    expect(reply.cleaned).toBe(true);
    expect(reply.routeLine).toBe(ROUTE_VIA_HUB);
    expect(reply.text).toContain('Priya Rao');
    expect(reply.text).not.toContain('[Client A]');
    expect(seen).toHaveLength(1);
    expect(reply.sentBytes).toBeGreaterThan(0);
    expect(reply.sentBytes).toBe(new TextEncoder().encode(seen[0]!).length);
  });

  it('runs Nano first, then rules, so a missed name still cannot leave the hub', async () => {
    const seen: string[] = [];
    await runHubPrivacyJob(
      { jobId: 'pv-2', text: 'Write to Priya Rao' },
      [priya],
      async (redacted) => { seen.push(redacted); return 'ok [Client A]'; },
      { nanoClean: async () => 'Write to Priya Rao please' },
    );
    expect(seen[0]).not.toContain('Priya');
    expect(seen[0]).toContain('[Client A]');
  });
});

describe('runLocalPrivacyJob', () => {
  it('cleans on a phone that has Nano, then fills the name back', async () => {
    const reply = await runLocalPrivacyJob(
      'Write to Priya Rao',
      [priya],
      async (redacted) => {
        expect(redacted).toContain('[Client A]');
        return 'Noted for [Client A].';
      },
      { isPhone: true },
    );
    expect(reply.routeLine).toBe(ROUTE_PHONE_NANO);
    expect(reply.text).toBe('Noted for Priya Rao.');
    expect(reply.cleaned).toBe(true);
  });
});
