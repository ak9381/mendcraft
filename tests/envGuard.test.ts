import { describe, expect, it } from 'vitest';
import {
  PLACEHOLDER_RE,
  assertFirebaseBuildEnv,
  isUsableFirebaseApiKey,
  isUsableRecaptchaSiteKey,
  FIREBASE_BUILD_GUARD_MSG,
  RECAPTCHA_BUILD_GUARD_MSG,
} from '../src/firebase/envGuard';

describe('Firebase production env guard', () => {
  it('rejects placeholder-shaped keys and accepts a real-looking key', () => {
    expect(isUsableFirebaseApiKey('')).toBe(false);
    expect(isUsableFirebaseApiKey('your-placeholder-key')).toBe(false);
    expect(isUsableRecaptchaSiteKey('your-placeholder-site')).toBe(false);
    expect(PLACEHOLDER_RE.test('changeme')).toBe(true);
    expect(isUsableFirebaseApiKey('AIzaSyDummyTestValue000000000000000000')).toBe(true);
    expect(isUsableRecaptchaSiteKey('6LDummyTestValue00000000000000000000')).toBe(true);
  });

  it('fails a production build env when either key is a placeholder, without needing the values in the message', () => {
    expect(() => assertFirebaseBuildEnv({
      VITE_FIREBASE_API_KEY: 'your-placeholder-key',
      VITE_RECAPTCHA_SITE_KEY: '6LDummyTestValue00000000000000000000',
    })).toThrow(FIREBASE_BUILD_GUARD_MSG);
    expect(() => assertFirebaseBuildEnv({
      VITE_FIREBASE_API_KEY: 'AIzaSyDummyTestValue000000000000000000',
      VITE_RECAPTCHA_SITE_KEY: 'your-placeholder-site',
    })).toThrow(RECAPTCHA_BUILD_GUARD_MSG);
    expect(() => assertFirebaseBuildEnv({
      VITE_FIREBASE_API_KEY: 'AIzaSyDummyTestValue000000000000000000',
      VITE_RECAPTCHA_SITE_KEY: '6LDummyTestValue00000000000000000000',
    })).not.toThrow();
  });
});
