import { describe, expect, it } from 'vitest';
import { detectPlatform, TABLET_MIN_WIDTH } from '../../src/canvas/mobile/platform';

describe('detectPlatform', () => {
  it('defaults to web, phone, non-native with no override and no Capacitor', () => {
    const p = detectPlatform({ search: '', capacitor: null, viewportWidth: 393 });
    expect(p).toEqual({ os: 'web', isNative: false, isTablet: false, isPhone: true });
  });

  it('?platform= override wins over Capacitor', () => {
    const p = detectPlatform({
      search: '?platform=ios',
      capacitor: { getPlatform: () => 'android', isNativePlatform: () => true },
      viewportWidth: 393,
    });
    expect(p.os).toBe('ios');
    // isNative reflects the real Capacitor shell, independent of the style override.
    expect(p.isNative).toBe(true);
  });

  it('ignores an unknown ?platform= value and falls back to Capacitor', () => {
    const p = detectPlatform({
      search: '?platform=windows',
      capacitor: { getPlatform: () => 'android' },
      viewportWidth: 393,
    });
    expect(p.os).toBe('android');
  });

  it('reads the OS from Capacitor when there is no override', () => {
    const ios = detectPlatform({ search: '', capacitor: { getPlatform: () => 'ios' }, viewportWidth: 393 });
    expect(ios.os).toBe('ios');
    const android = detectPlatform({ search: '', capacitor: { getPlatform: () => 'android' }, viewportWidth: 412 });
    expect(android.os).toBe('android');
  });

  it('isTablet flips at the 744px breakpoint regardless of OS', () => {
    expect(detectPlatform({ search: '', viewportWidth: TABLET_MIN_WIDTH - 1 }).isTablet).toBe(false);
    expect(detectPlatform({ search: '', viewportWidth: TABLET_MIN_WIDTH }).isTablet).toBe(true);
    const ipad = detectPlatform({ search: '?platform=ios', viewportWidth: 820 });
    expect(ipad).toEqual({ os: 'ios', isNative: false, isTablet: true, isPhone: false });
  });
});
