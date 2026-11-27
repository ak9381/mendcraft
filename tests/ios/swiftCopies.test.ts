// ios/plugins/*.swift are tracked copies of ios-src/*.swift. Mixing an old copy
// with a new one breaks the build (the old view controller calls
// requestSystemTrackingOff, which the new plugin no longer has), so every
// Swift file must be byte-identical in both places.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../../ios-src/', import.meta.url);
const COPY = new URL('../../ios/plugins/', import.meta.url);
const swift = (dir: URL) => readdirSync(dir).filter((f) => f.endsWith('.swift')).sort();

describe('ios/plugins mirrors ios-src', () => {
  it('has the same Swift files', () => {
    expect(swift(COPY)).toEqual(swift(SRC));
  });
  it.each(swift(SRC))('%s is byte-identical', (f) => {
    expect(readFileSync(new URL(f, COPY), 'utf8')).toBe(readFileSync(new URL(f, SRC), 'utf8'));
  });
  it('no copy still forces DockKit tracking off', () => {
    for (const f of swift(SRC)) {
      expect(readFileSync(new URL(f, SRC), 'utf8')).not.toMatch(/requestSystemTrackingOff/);
    }
  });
});

describe('final review I10: the iPhone app builds from this checkout', () => {
  const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  it('the scene roots the window in MendcraftViewController, which registers every Mendcraft plugin', () => {
    expect(read('ios-src/SceneDelegate.swift')).toMatch(/rootViewController = MendcraftViewController\(\)/);
    const vc = read('ios-src/MendcraftViewController.swift');
    for (const p of ['MendcraftLanPlugin', 'MendcraftGimbalPlugin', 'MendcraftAppleAIPlugin']) expect(vc).toContain(`registerPluginInstance(${p}())`);
  });
  it('Info.plist additions carry every permission string the app asks for', () => {
    const plist = read('ios-src/Info.plist.additions.xml');
    for (const k of ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription', 'NSLocalNetworkUsageDescription', 'NSBonjourServices', 'UIApplicationSceneManifest']) expect(plist).toContain(`<key>${k}</key>`);
  });
  it('npm run ios:setup is the one documented path, and the generated project stays out of git', () => {
    expect(JSON.parse(read('package.json')).scripts['ios:setup']).toBe('node scripts/ios-setup.mjs');
    expect(read('ios/README.md')).toContain('npm run ios:setup');
    expect(read('.gitignore')).toMatch(/^ios\/App\/$/m);
  });
});
