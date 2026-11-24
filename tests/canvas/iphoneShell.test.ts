import { describe, expect, it } from 'vitest';
import { isPhoneCanvasShell, PHONE_SHELL_MAX_WIDTH } from '../../src/canvas/iphoneShell';

const ios = { isNativePlatform: () => true, getPlatform: () => 'ios' };
const android = { isNativePlatform: () => true, getPlatform: () => 'android' };

describe('isPhoneCanvasShell', () => {
  it('is on for native iOS at any width', () => {
    expect(isPhoneCanvasShell({ capacitor: ios, viewportWidth: 430 })).toBe(true);
    expect(isPhoneCanvasShell({ capacitor: ios, viewportWidth: 1024 })).toBe(true);
  });

  it('is on for native Android at any width', () => {
    expect(isPhoneCanvasShell({ capacitor: android, viewportWidth: 412 })).toBe(true);
  });

  it('is on for a small web viewport and off for desktop', () => {
    expect(isPhoneCanvasShell({ viewportWidth: PHONE_SHELL_MAX_WIDTH - 1 })).toBe(true);
    expect(isPhoneCanvasShell({ viewportWidth: 1280 })).toBe(false);
    expect(isPhoneCanvasShell({ capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' }, viewportWidth: 1280 })).toBe(false);
  });
});
