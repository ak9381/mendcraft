import { describe, expect, it } from 'vitest';
import { hasFlag, loadFlags } from '../src/core/flags';

// Fake localStorage: just enough of the Storage interface for loadFlags.
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => { data.set(k, v); },
    data,
  };
}

describe('loadFlags', () => {
  it('defaults to no flags when nothing is set', () => {
    const flags = loadFlags({ location: { search: '' } });
    expect(flags.size).toBe(0);
  });

  it('reads flags from the ?flags= query param, comma-separated', () => {
    const flags = loadFlags({ location: { search: '?flags=studio,control' } });
    expect(flags.has('studio')).toBe(true);
    expect(flags.has('control')).toBe(true);
    expect(flags.has('music')).toBe(false);
  });

  it('trims whitespace and drops empty entries', () => {
    const flags = loadFlags({ location: { search: '?flags= studio , , remote ' } });
    expect([...flags].sort()).toEqual(['remote', 'studio']);
  });

  it('reads flags stored in localStorage under mc.flags', () => {
    const storage = fakeStorage({ 'mc.flags': 'judgesLegacy' });
    const flags = loadFlags({ location: { search: '' }, localStorage: storage });
    expect(flags.has('judgesLegacy')).toBe(true);
  });

  it('merges URL and storage flags', () => {
    const storage = fakeStorage({ 'mc.flags': 'studio' });
    const flags = loadFlags({ location: { search: '?flags=control' }, localStorage: storage });
    expect([...flags].sort()).toEqual(['control', 'studio']);
  });

  it('persists URL flags into localStorage so they survive a redirect with no query string', () => {
    const storage = fakeStorage();
    loadFlags({ location: { search: '?flags=studio' }, localStorage: storage });
    expect(storage.getItem('mc.flags')).toContain('studio');
    // A later load with no URL flags still sees it.
    const flags = loadFlags({ location: { search: '' }, localStorage: storage });
    expect(flags.has('studio')).toBe(true);
  });

  it('does not touch storage when the URL carries no flags', () => {
    const storage = fakeStorage();
    loadFlags({ location: { search: '' }, localStorage: storage });
    expect(storage.data.size).toBe(0);
  });

  it('works with no localStorage available (e.g. native shells without it)', () => {
    const flags = loadFlags({ location: { search: '?flags=studio' } });
    expect(flags.has('studio')).toBe(true);
  });
});

describe('hasFlag', () => {
  it('checks membership in an already-loaded flag set', () => {
    const flags = new Set(['studio']);
    expect(hasFlag('studio', flags)).toBe(true);
    expect(hasFlag('control', flags)).toBe(false);
  });
});
