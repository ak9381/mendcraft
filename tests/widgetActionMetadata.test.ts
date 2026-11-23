import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateMetadata } from '@a2ui/web_core';

// A2UI only allows `metadata.extensions`; a bare {action,label} threw on every
// visual-tile click (and table row / form submit) so the action never arrived.
describe('live widget action metadata', () => {
  it('the shape the widgets send passes A2UI validation; the old shape does not', () => {
    expect(() => validateMetadata({ extensions: { action: 'zone-living', label: 'Living' } })).not.toThrow();
    expect(() => validateMetadata({ action: 'zone-living', label: 'Living' })).toThrow(/only "extensions"/);
  });
  it('widgets.ts sends every per-click payload under metadata.extensions', () => {
    const src = readFileSync(new URL('../src/canvas/widgets.ts', import.meta.url), 'utf8');
    const sends = [...src.matchAll(/metadata: \{ ([a-z]+)/g)].map((m) => m[1]);
    expect(sends.length).toBeGreaterThanOrEqual(3);
    expect(new Set(sends)).toEqual(new Set(['extensions']));
  });
});
