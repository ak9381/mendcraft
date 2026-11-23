import { describe, expect, it } from 'vitest';
import { queueApplyBlocked } from '../src/offline/queueGate';

describe('B-195/B-214 queued job Apply vs an open review', () => {
  it('a queued plan change waits while a suggestion is pending', () => {
    expect(queueApplyBlocked('plan', 1)).toMatch(/Accept or reject it first/);
    expect(queueApplyBlocked('plan', 3)).toMatch(/^3 suggestions/);
  });
  it('goes ahead when nothing is waiting', () => expect(queueApplyBlocked('plan', 0)).toBeNull());
  it('accessibility explanations never wait (they only fill a panel)', () => expect(queueApplyBlocked('a11y', 2)).toBeNull());
});
