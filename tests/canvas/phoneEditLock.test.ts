import { describe, expect, it } from 'vitest';
import { LOOK_AWAY_LOCK_MS, LOOK_TO_EDIT_HINT, nextPhoneEditLock, readLookToEdit } from '../../src/canvas/phoneEditLock';

const on = { enabled: true, awaySince: null as number | null };

describe('nextPhoneEditLock', () => {
  it('never locks when look-to-edit is off, whatever the face does', () => {
    const r = nextPhoneEditLock({ unlocked: true, enabled: false, facing: false, faceSeen: true, now: 99999, awaySince: 0 });
    expect(r).toEqual({ unlocked: true, faceSeen: false, awaySince: null, hint: null });
  });

  it('stays unlocked with an unknown face signal (camera denied / absent)', () => {
    const r = nextPhoneEditLock({ unlocked: true, ...on, facing: null, faceSeen: false, now: 99999 });
    expect(r).toEqual({ unlocked: true, faceSeen: false, awaySince: null, hint: null });
  });

  it('does not lock if a face was never seen, even when facing reads false', () => {
    const r = nextPhoneEditLock({ unlocked: true, ...on, facing: false, faceSeen: false, now: 99999 });
    expect(r.unlocked).toBe(true);
    expect(r.hint).toBeNull();
  });

  it('does not re-lock for a brief look-away under 3 s', () => {
    const start = nextPhoneEditLock({ unlocked: true, ...on, facing: false, faceSeen: true, now: 1000 });
    expect(start).toEqual({ unlocked: true, faceSeen: true, awaySince: 1000, hint: null });
    const mid = nextPhoneEditLock({ unlocked: true, enabled: true, facing: false, faceSeen: true, now: 1000 + LOOK_AWAY_LOCK_MS - 1, awaySince: 1000 });
    expect(mid).toEqual({ unlocked: true, faceSeen: true, awaySince: 1000, hint: null });
  });

  it('locks with the hint after a seen face is gone for 3 s', () => {
    const r = nextPhoneEditLock({ unlocked: true, enabled: true, facing: false, faceSeen: true, now: 1000 + LOOK_AWAY_LOCK_MS, awaySince: 1000 });
    expect(r).toEqual({ unlocked: false, faceSeen: true, awaySince: null, hint: LOOK_TO_EDIT_HINT });
    expect(LOOK_TO_EDIT_HINT).toBe('Look at me to edit');
  });

  it('stays locked while absent, unlocks when the face is back', () => {
    const still = nextPhoneEditLock({ unlocked: false, ...on, facing: false, faceSeen: true, now: 9000 });
    expect(still.unlocked).toBe(false);
    expect(still.hint).toBe(LOOK_TO_EDIT_HINT);
    const back = nextPhoneEditLock({ unlocked: false, ...on, facing: true, faceSeen: true, now: 9100 });
    expect(back).toEqual({ unlocked: true, faceSeen: true, awaySince: null, hint: null });
  });

  it('unlocks if the signal turns unknown while locked', () => {
    const r = nextPhoneEditLock({ unlocked: false, ...on, facing: null, faceSeen: true, now: 9000 });
    expect(r.unlocked).toBe(true);
  });
});

describe('readLookToEdit', () => {
  it('is off by default and on only for "1"', () => {
    expect(readLookToEdit({ getItem: () => null })).toBe(false);
    expect(readLookToEdit({ getItem: () => '0' })).toBe(false);
    expect(readLookToEdit({ getItem: () => '1' })).toBe(true);
    expect(readLookToEdit({ getItem: () => { throw new Error('x'); } })).toBe(false);
  });
});
