import { describe, expect, it, vi } from 'vitest';
import { classifyCloudFailure, mergeStreamText, safeStreamChunk } from '../src/ai/cloudJson';
import { HEDGE_AFTER_MS, HEDGE_CLOUD_MODEL, PRIMARY_CLOUD_MODEL, raceHedged } from '../src/ai/hedge';

describe('classifyCloudFailure high-demand', () => {
  it('detects 500, 503 and high-demand wording', () => {
    expect(classifyCloudFailure(new Error('500 Internal Server Error high demand'))).toBe('high-demand');
    expect(classifyCloudFailure(new Error('HTTP 503 Service Unavailable'))).toBe('high-demand');
    expect(classifyCloudFailure(new Error('The model is overloaded. Please try again later.'))).toBe('high-demand');
    expect(classifyCloudFailure(new Error('429 Too Many Requests'))).toBe('429');
  });
});

describe('mergeStreamText', () => {
  it('keeps cumulative chunks and appends deltas', () => {
    expect(mergeStreamText('', '{"a"')).toBe('{"a"');
    expect(mergeStreamText('{"ans"', '{"ans":1}')).toBe('{"ans":1}');
    expect(mergeStreamText('{"an', 'swer":1}')).toBe('{"answer":1}');
  });
});

describe('safeStreamChunk', () => {
  it('does not treat a text() throw on an empty chunk as a safety block', () => {
    const r = safeStreamChunk({ text: () => { throw new Error('no text on this chunk'); } });
    expect(r.failKind).toBeNull();
    expect(r.text).toBe('');
  });
  it('still flags a real safety block', () => {
    expect(safeStreamChunk({ promptFeedback: { blockReason: 'SAFETY' }, text: () => { throw new Error('blocked'); } }).failKind).toBe('safety');
  });
});

describe('raceHedged', () => {
  it('returns the primary when it answers before the hedge window', async () => {
    const res = await raceHedged({
      primary: async () => 'p',
      backup: async () => 'b',
      hedgeAfterMs: 50,
      primaryModel: PRIMARY_CLOUD_MODEL,
      backupModel: HEDGE_CLOUD_MODEL,
    });
    expect(res?.winner).toBe('primary');
    expect(res?.value).toBe('p');
    expect(res?.model).toBe(PRIMARY_CLOUD_MODEL);
  });

  it('starts the backup after the hedge window and takes the first valid value', async () => {
    vi.useFakeTimers();
    const resP = raceHedged({
      primary: () => new Promise((resolve) => setTimeout(() => resolve('late-primary'), 5000)),
      backup: async () => 'backup-fast',
      hedgeAfterMs: HEDGE_AFTER_MS,
    });
    await vi.advanceTimersByTimeAsync(HEDGE_AFTER_MS);
    const res = await resP;
    vi.useRealTimers();
    expect(res?.winner).toBe('backup');
    expect(res?.value).toBe('backup-fast');
    expect(res?.model).toBe(HEDGE_CLOUD_MODEL);
  });

  it('ignores a later primary after the backup has already won', async () => {
    vi.useFakeTimers();
    let primaryResolved = false;
    const resP = raceHedged({
      primary: () => new Promise((resolve) => setTimeout(() => { primaryResolved = true; resolve('too-late'); }, 4000)),
      backup: async () => 'first',
      hedgeAfterMs: 200,
    });
    await vi.advanceTimersByTimeAsync(200);
    const res = await resP;
    await vi.advanceTimersByTimeAsync(4000);
    vi.useRealTimers();
    expect(res?.value).toBe('first');
    expect(primaryResolved).toBe(true);
  });

  it('returns null when both legs fail', async () => {
    const res = await raceHedged({
      primary: async () => null,
      backup: async () => null,
      hedgeAfterMs: 5,
    });
    expect(res).toBeNull();
  });
});
