import { describe, expect, it } from 'vitest';
import {
  choosePrivacyLabel,
  PRIVACY_LABEL_NO_NANO,
  PRIVACY_LABEL_ON_DEVICE,
  PRIVACY_LABEL_ROUTED_VIA_HUB,
} from '../../src/canvas/mobile/privacyLabel';

describe('choosePrivacyLabel', () => {
  it('a phone with on-device Nano always says so, even if it also went via the hub', () => {
    expect(choosePrivacyLabel({ isPhone: true, hasNanoOnThisPhone: true, wasRoutedViaHub: true })).toBe(
      PRIVACY_LABEL_ON_DEVICE,
    );
  });

  it('a phone without Nano that the hub cleaned reads "routed via Mac"', () => {
    expect(choosePrivacyLabel({ isPhone: true, hasNanoOnThisPhone: false, wasRoutedViaHub: true })).toBe(
      PRIVACY_LABEL_ROUTED_VIA_HUB,
    );
  });

  it('a phone without Nano and without a hub reads "no Nano on this phone"', () => {
    expect(choosePrivacyLabel({ isPhone: true, hasNanoOnThisPhone: false, wasRoutedViaHub: false })).toBe(
      PRIVACY_LABEL_NO_NANO,
    );
  });

  it('the hub itself is always "on this device"', () => {
    expect(choosePrivacyLabel({ isPhone: false, hasNanoOnThisPhone: false, wasRoutedViaHub: true })).toBe(
      PRIVACY_LABEL_ON_DEVICE,
    );
  });
});
