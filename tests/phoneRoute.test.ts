import { describe, expect, it } from 'vitest';
import { isPhoneRoute, isRemoteRoute, isControlRoute } from '../src/relay/protocol';

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

  it('does not match the editor, /remote or /control', () => {
    expect(isPhoneRoute('/', '')).toBe(false);
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
