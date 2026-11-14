import { describe, it, expect } from 'vitest';
import {
  TOUR_STEPS,
  resolveTourSteps,
  clampStep,
  stepForward,
  stepBack,
  atFirst,
  atLast,
  stepCounter,
  tourDismissed,
  markTourDismissed,
  TOUR_SEEN_KEY,
  type TourStepDef,
} from '../src/ui/tour';
import { createSimPlayback } from '../src/sim';
import { isJudgesRoute } from '../src/relay/protocol';

const DEFS: TourStepDef[] = [
  { id: 'a', selector: '#a', title: 'A', body: '' },
  { id: 'b', selector: '#b', title: 'B', body: '' },
  { id: 'c', selector: '#c', title: 'C', body: '' },
];

describe('resolveTourSteps', () => {
  it('keeps only present steps, in order', () => {
    const present = new Set(['#a', '#c']);
    const steps = resolveTourSteps(DEFS, (s) => present.has(s));
    expect(steps.map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('skips a missing element in the middle without reordering', () => {
    const present = new Set(['#a', '#b', '#c']);
    present.delete('#b');
    const steps = resolveTourSteps(DEFS, (s) => present.has(s));
    expect(steps.map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('returns an empty list when nothing is present', () => {
    expect(resolveTourSteps(DEFS, () => false)).toEqual([]);
  });

  it('the real TOUR_STEPS all have unique ids and selectors', () => {
    const ids = new Set(TOUR_STEPS.map((s) => s.id));
    const sels = new Set(TOUR_STEPS.map((s) => s.selector));
    expect(ids.size).toBe(TOUR_STEPS.length);
    expect(sels.size).toBe(TOUR_STEPS.length);
    expect(TOUR_STEPS.length).toBeGreaterThan(3);
  });
});

describe('step bounds', () => {
  it('clampStep stays within range', () => {
    expect(clampStep(-2, 3)).toBe(0);
    expect(clampStep(5, 3)).toBe(2);
    expect(clampStep(1, 3)).toBe(1);
    expect(clampStep(0, 0)).toBe(0);
  });

  it('forward never passes the last index', () => {
    expect(stepForward(0, 3)).toBe(1);
    expect(stepForward(2, 3)).toBe(2);
  });

  it('back never goes below zero', () => {
    expect(stepBack(1, 3)).toBe(0);
    expect(stepBack(0, 3)).toBe(0);
  });

  it('atFirst / atLast flag the ends', () => {
    expect(atFirst(0)).toBe(true);
    expect(atFirst(1)).toBe(false);
    expect(atLast(2, 3)).toBe(true);
    expect(atLast(1, 3)).toBe(false);
  });

  it('stepCounter is 1-based and clamped', () => {
    expect(stepCounter(0, 3)).toBe('1 of 3');
    expect(stepCounter(2, 3)).toBe('3 of 3');
    expect(stepCounter(9, 3)).toBe('3 of 3');
    expect(stepCounter(0, 0)).toBe('0 of 0');
  });
});

describe('tour persistence', () => {
  function fakeStore(): Storage & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    } as Storage & { map: Map<string, string> };
  }

  it('is not dismissed before marking', () => {
    const s = fakeStore();
    expect(tourDismissed(s)).toBe(false);
  });

  it('remembers dismissal', () => {
    const s = fakeStore();
    markTourDismissed(s);
    expect(s.map.get(TOUR_SEEN_KEY)).toBe('1');
    expect(tourDismissed(s)).toBe(true);
  });

  it('survives a storage that throws (private mode)', () => {
    const throwing = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    } as unknown as Storage;
    expect(() => markTourDismissed(throwing)).not.toThrow();
    expect(tourDismissed(throwing)).toBe(false);
  });
});

describe('createSimPlayback', () => {
  it('starts unpaused, not aborted, no pending next', () => {
    const p = createSimPlayback();
    expect(p.isPaused()).toBe(false);
    expect(p.isAborted()).toBe(false);
    expect(p.consumeNext()).toBe(false);
  });

  it('pause/resume/toggle track state and fire onChange', () => {
    let changes = 0;
    const p = createSimPlayback(() => changes++);
    p.pause();
    expect(p.isPaused()).toBe(true);
    p.pause(); // idempotent — no extra change
    p.resume();
    expect(p.isPaused()).toBe(false);
    expect(p.toggle()).toBe(true);
    expect(p.toggle()).toBe(false);
    expect(changes).toBe(4); // pause, resume, toggle, toggle
  });

  it('requestNext is consumed exactly once', () => {
    const p = createSimPlayback();
    p.requestNext();
    expect(p.consumeNext()).toBe(true);
    expect(p.consumeNext()).toBe(false);
  });

  it('skip aborts and clears pause', () => {
    const p = createSimPlayback();
    p.pause();
    p.skip();
    expect(p.isAborted()).toBe(true);
    expect(p.isPaused()).toBe(false);
  });

  it('reset returns to a clean run', () => {
    const p = createSimPlayback();
    p.pause();
    p.requestNext();
    p.skip();
    p.reset();
    expect(p.isPaused()).toBe(false);
    expect(p.isAborted()).toBe(false);
    expect(p.consumeNext()).toBe(false);
  });
});

describe('isJudgesRoute', () => {
  it('matches /judges and ?view=judges', () => {
    expect(isJudgesRoute('/judges', '')).toBe(true);
    expect(isJudgesRoute('/judges/', '')).toBe(true);
    expect(isJudgesRoute('/', '?view=judges')).toBe(true);
  });
  it('does not match the editor or other pages', () => {
    expect(isJudgesRoute('/', '')).toBe(false);
    expect(isJudgesRoute('/control', '')).toBe(false);
    expect(isJudgesRoute('/judge', '')).toBe(false);
  });
});
