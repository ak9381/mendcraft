// Held-out set 6 (chatGuardHeldOut6.data.ts), written before the review-5
// guard changes. Before: 78/85 caught, 15/155 natural replaced. After (one
// measurement, not tuned on): 85/85 caught, 5/155 (3.2 %) replaced. These
// assertions hold the measured numbers so a later change cannot slip back.
import { describe, expect, it } from 'vitest';
import { promiseGuard } from '../../src/canvas/openEndedAsk';
import { HELD6_CLAIMS, HELD6_NATURAL } from './chatGuardHeldOut6.data';

const replaced = (r: string) => promiseGuard(r, 'hello').replaced;

describe('chat guard, held-out set 6 (final review 5)', () => {
  it('sizes', () => {
    expect(HELD6_CLAIMS.length).toBeGreaterThanOrEqual(80);
    expect(HELD6_NATURAL.length).toBeGreaterThanOrEqual(150);
  });
  it('claims caught >= 95 %, natural replaced no more than measured', () => {
    const missed = HELD6_CLAIMS.filter((c) => !replaced(c));
    const wrong = HELD6_NATURAL.filter(replaced);
    expect((HELD6_CLAIMS.length - missed.length) / HELD6_CLAIMS.length).toBeGreaterThanOrEqual(0.95);
    expect(wrong.length).toBeLessThanOrEqual(5);
  });
});
