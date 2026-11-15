import { describe, expect, it } from 'vitest';
import { isPhoneRoute, isRemoteRoute, isControlRoute, isLandingRoute, isStudioRoute } from '../src/relay/protocol';

// The iPhone PWA's manifest start_url is /phone — boot.ts routes it to the
// remote page's compact "lamp & music" variant. These guard that the three
// relay routes stay disjoint so the right page mounts.
describe('isPhoneRoute (PWA start_url)', () => {
  it('matches the /phone path, with or without a trailing slash', () => {
    expect(isPhoneRoute('/phone', '')).toBe(true);
    expect(isPhoneRoute('/phone/', '')).toBe(true);
  });

  it('matches the ?view=phone query on any path', () => {
    expect(isPhoneRoute('/', '?view=phone')).toBe(true);
    expect(isPhoneRoute('/anything', '?foo=1&view=phone')).toBe(true);
  });

  it('does not match the editor, landing, /remote or /control', () => {
    expect(isPhoneRoute('/', '')).toBe(false);
    expect(isPhoneRoute('/studio', '')).toBe(false);
    expect(isPhoneRoute('/remote', '')).toBe(false);
    expect(isPhoneRoute('/control', '')).toBe(false);
    expect(isPhoneRoute('/phoney', '')).toBe(false);
    expect(isPhoneRoute('/', '?view=remote')).toBe(false);
  });

  it('is disjoint from the remote and control routes', () => {
    // A /phone URL must not also read as /remote or /control (and vice-versa),
    // or boot.ts would mount the wrong page.
    expect(isRemoteRoute('/phone', '')).toBe(false);
    expect(isControlRoute('/phone', '')).toBe(false);
    expect(isPhoneRoute('/remote', '')).toBe(false);
    expect(isPhoneRoute('/control', '')).toBe(false);
  });
});

describe('isLandingRoute / isStudioRoute', () => {
  it('treats exact / as the marketing landing', () => {
    expect(isLandingRoute('/', '')).toBe(true);
    expect(isStudioRoute('/', '')).toBe(false);
  });

  it('sends /studio and judge sim/play flags to the editor', () => {
    expect(isStudioRoute('/studio', '')).toBe(true);
    expect(isStudioRoute('/studio/', '')).toBe(true);
    expect(isStudioRoute('/', '?view=studio')).toBe(true);
    expect(isStudioRoute('/', '?sim=1')).toBe(true);
    expect(isStudioRoute('/', '?play=1')).toBe(true);
    expect(isStudioRoute('/', '?mode=part')).toBe(true);
    expect(isLandingRoute('/studio', '')).toBe(false);
    expect(isLandingRoute('/', '?sim=1')).toBe(false);
    expect(isLandingRoute('/', '?play=1')).toBe(false);
  });

  it('stays disjoint from phone, remote, control and judges', () => {
    expect(isLandingRoute('/', '?view=phone')).toBe(false);
    expect(isLandingRoute('/', '?view=remote')).toBe(false);
    expect(isLandingRoute('/', '?view=control')).toBe(false);
    expect(isLandingRoute('/', '?view=judges')).toBe(false);
    expect(isLandingRoute('/control', '')).toBe(false);
    expect(isLandingRoute('/judges', '')).toBe(false);
    expect(isStudioRoute('/control', '')).toBe(false);
    expect(isPhoneRoute('/studio', '')).toBe(false);
    expect(isControlRoute('/studio', '')).toBe(false);
  });
});
