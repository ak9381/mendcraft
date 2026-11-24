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
