import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GESTURE_MAP,
  coerceGestureMap,
  loadGestureMap,
  saveGestureMap,
  resetGestureMap,
  GESTURE_MAP_KEY,
  type StorageLike,
} from '../src/input/gestureMap';

function fakeStorage(seed: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
  };
}

describe('coerceGestureMap', () => {
  it('fills defaults and drops invalid actions', () => {
    const m = coerceGestureMap({ pinch: 'undo', fist: 'not-an-action', bogus: 'delete' });
    expect(m.pinch).toBe('undo');       // valid override kept
    expect(m.fist).toBe(DEFAULT_GESTURE_MAP.fist); // invalid value → default
    expect(m).not.toHaveProperty('bogus');
  });

  it('returns defaults for non-objects', () => {
    expect(coerceGestureMap(null)).toEqual(DEFAULT_GESTURE_MAP);
    expect(coerceGestureMap('x')).toEqual(DEFAULT_GESTURE_MAP);
  });
});

describe('persistence', () => {
  it('round-trips through storage', () => {
    const s = fakeStorage();
    const map = { ...DEFAULT_GESTURE_MAP, 'thumbs-up': 'delete' as const };
    expect(saveGestureMap(map, s)).toBe(true);
    expect(s.data[GESTURE_MAP_KEY]).toContain('delete');
    expect(loadGestureMap(s)['thumbs-up']).toBe('delete');
  });

  it('loads defaults when nothing stored', () => {
    expect(loadGestureMap(fakeStorage())).toEqual(DEFAULT_GESTURE_MAP);
  });

  it('loads defaults when stored JSON is corrupt', () => {
    expect(loadGestureMap(fakeStorage({ [GESTURE_MAP_KEY]: '{not json' }))).toEqual(DEFAULT_GESTURE_MAP);
  });

  it('reset returns a fresh defaults copy', () => {
    const r = resetGestureMap();
    expect(r).toEqual(DEFAULT_GESTURE_MAP);
    r.pinch = 'none';
    expect(DEFAULT_GESTURE_MAP.pinch).not.toBe('none'); // not aliased
  });

  it('save reports false when storage throws', () => {
    const throwing: StorageLike = {
      getItem: () => null,
      setItem: () => { throw new Error('blocked'); },
    };
    expect(saveGestureMap(DEFAULT_GESTURE_MAP, throwing)).toBe(false);
  });
});
