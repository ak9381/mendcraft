import { describe, expect, it } from 'vitest';
import { LOOK_AWAY_LOCK_MS, LOOK_TO_EDIT_HINT, nextPhoneEditLock } from '../../src/canvas/phoneEditLock';

describe('nextPhoneEditLock', () => {
  it('stays locked with the look-to-edit hint until he is facing the phone', () => {
    const locked = nextPhoneEditLock({ unlocked: false, facing: false, now: 0, awaySince: null });
    expect(locked).toEqual({ unlocked: false, awaySince: null, hint: LOOK_TO_EDIT_HINT });
    expect(LOOK_TO_EDIT_HINT).toBe('Look at me to edit');
  });

  it('unlocks the moment look-to-sync reports facing', () => {
    const r = nextPhoneEditLock({ unlocked: false, facing: true, now: 100, awaySince: null });
    expect(r).toEqual({ unlocked: true, awaySince: null, hint: null });
  });

  it('stays unlocked while he is still facing', () => {
    const r = nextPhoneEditLock({ unlocked: true, facing: true, now: 500, awaySince: 200 });
    expect(r).toEqual({ unlocked: true, awaySince: null, hint: null });
  });

  it('does not re-lock for a brief look-away under 3 s', () => {
    const start = nextPhoneEditLock({ unlocked: true, facing: false, now: 1000, awaySince: null });
    expect(start.unlocked).toBe(true);
    expect(start.awaySince).toBe(1000);
    const mid = nextPhoneEditLock({ unlocked: true, facing: false, now: 1000 + LOOK_AWAY_LOCK_MS - 1, awaySince: start.awaySince });
    expect(mid).toEqual({ unlocked: true, awaySince: 1000, hint: null });
  });

  it('re-locks after looking away for 3 s', () => {
    const r = nextPhoneEditLock({ unlocked: true, facing: false, now: 1000 + LOOK_AWAY_LOCK_MS, awaySince: 1000 });
    expect(r).toEqual({ unlocked: false, awaySince: null, hint: LOOK_TO_EDIT_HINT });
  });
});
