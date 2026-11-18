import { afterEach, describe, expect, it } from 'vitest';
import {
  CONDENSE_MIN_WORDS,
  coerceCondensed,
  condensePrompt,
  shouldCondense,
  wordCount,
} from '../src/ai/condense';
import { condenseUtterance, setModelsForTest, type TextGenModel } from '../src/ai/hybrid';

const model = (text: string, inferenceSource?: string): TextGenModel => ({
  generateContent: async () => ({ response: { text: () => text, inferenceSource } }),
});

const RAMBLE =
  'I was thinking you know the kitchen feels so cramped when I am rolling out chapatis and my ' +
  'wrists start hurting maybe if the counter near the window were a little wider it would help, ' +
  'and also the door into the kitchen is tight when I turn with a tray so could we make that wider too';

afterEach(() => setModelsForTest(null));

describe('shouldCondense', () => {
  it('triggers only at the word threshold', () => {
    expect(wordCount(RAMBLE)).toBeGreaterThanOrEqual(CONDENSE_MIN_WORDS);
    expect(shouldCondense(RAMBLE)).toBe(true);
    expect(shouldCondense('add a door on the south wall')).toBe(false);
    expect(shouldCondense('seventeen words ' + 'w '.repeat(15))).toBe(false);
    // Mid-length rambles (under 40 words) stay raw — the condenser did not
    // save end-to-end time on the 18-word gate (see scripts/measure-condense.mjs).
    expect(shouldCondense(RAMBLE.split(' ').slice(0, 30).join(' '))).toBe(false);
  });

  it('never condenses a command the rule parser already handles', () => {
    const longButExact = 'please ' + 'kindly '.repeat(39) + 'undo';
    expect(wordCount(longButExact)).toBeGreaterThanOrEqual(CONDENSE_MIN_WORDS);
    expect(shouldCondense(longButExact, () => true)).toBe(false);
    expect(shouldCondense(longButExact, () => false)).toBe(true);
  });
});

describe('coerceCondensed', () => {
  it('accepts a shorter command and normalises whitespace', () => {
    expect(coerceCondensed({ command: '  widen the   kitchen counter ' }, RAMBLE)).toBe(
      'widen the kitchen counter',
    );
  });

  it('rejects junk, empty, and not-actually-shorter output', () => {
    expect(coerceCondensed(null, RAMBLE)).toBeNull();
    expect(coerceCondensed({ command: '' }, RAMBLE)).toBeNull();
    expect(coerceCondensed({ command: RAMBLE + ' please' }, RAMBLE)).toBeNull();
    expect(coerceCondensed(42, RAMBLE)).toBeNull();
  });

  it('keeps her words inside the prompt verbatim', () => {
    expect(condensePrompt(RAMBLE)).toContain(JSON.stringify(RAMBLE));
  });
});

describe('condenseUtterance (Nano only, never cloud)', () => {
  it('returns the condensed text with honest word counts from an on-device reply', async () => {
    setModelsForTest({
      enabled: true,
      condense: model('{"command":"widen the counter near the kitchen window"}', 'on_device'),
      deviceModel: 'ready',
    });
    const r = await condenseUtterance(RAMBLE);
    expect(r?.text).toBe('widen the counter near the kitchen window');
    expect(r?.fromWords).toBe(wordCount(RAMBLE));
    expect(r?.toWords).toBe(7);
  });

  it('discards a reply that resolved in the cloud (the ramble must stay on device)', async () => {
    setModelsForTest({
      enabled: true,
      condense: model('{"command":"widen the counter"}', 'in_cloud'),
      deviceModel: 'ready',
    });
    expect(await condenseUtterance(RAMBLE)).toBeNull();
  });

  it('returns null when Nano is not ready or the call times out', async () => {
    setModelsForTest({
      enabled: true,
      condense: model('{"command":"widen the counter"}', 'on_device'),
      deviceModel: 'downloadable',
    });
    expect(await condenseUtterance(RAMBLE)).toBeNull();

    setModelsForTest({
      enabled: true,
      condense: { generateContent: () => new Promise(() => undefined) },
      deviceModel: 'ready',
    });
    expect(await condenseUtterance(RAMBLE, { timeoutMs: 10 })).toBeNull();
  });
});
