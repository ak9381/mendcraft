import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyCloudFailure,
  extractJson,
  repairJson,
  safeResponseText,
} from '../src/ai/cloudJson';
import { askCopilot, draftClientEmail, getHybridStatus, setModelsForTest } from '../src/ai/hybrid';
import { parseHexColor } from '../src/cad/materials';

afterEach(() => {
  setModelsForTest(null);
  vi.useRealTimers();
});

describe('extractJson', () => {
  it('strips fences and takes the first balanced object', () => {
    expect(extractJson('```json\n{"answer":"hi"}\n```')).toEqual({ answer: 'hi' });
    expect(extractJson('Sure. {"answer":"ok","why":"x"} trailing')).toEqual({ answer: 'ok', why: 'x' });
  });

  it('repairs trailing commas and smart quotes', () => {
    expect(repairJson('{"a":1,}')).toBe('{"a":1}');
    expect(extractJson('{\n  "answer": "yes",\n}')).toEqual({ answer: 'yes' });
    expect(extractJson('{\u201Canswer\u201D:\u201Cyes\u201D}')).toEqual({ answer: 'yes' });
  });

  it('returns null for empty or non-JSON', () => {
    expect(extractJson('')).toBeNull();
    expect(extractJson('no object here')).toBeNull();
  });
});

describe('classifyCloudFailure', () => {
  it('detects 429, safety, timeout, empty and parse', () => {
    expect(classifyCloudFailure(new Error('HTTP 429 RESOURCE_EXHAUSTED'))).toBe('429');
    expect(classifyCloudFailure(new Error('prompt blocked: SAFETY'))).toBe('safety');
    expect(classifyCloudFailure(new Error('a11y explain timed out after 8000 ms'))).toBe('timeout');
    expect(classifyCloudFailure(null, '')).toBe('empty');
    expect(classifyCloudFailure(null, 'not json at all {')).toBe('parse');
  });
});

describe('safeResponseText', () => {
  it('reads text() when present', () => {
    expect(safeResponseText({ text: () => '{"ok":true}' }).text).toBe('{"ok":true}');
  });

  it('flags a safety block without throwing', () => {
    const r = safeResponseText({
      text: () => { throw new Error('blocked'); },
      promptFeedback: { blockReason: 'SAFETY' },
    });
    expect(r.failKind).toBe('safety');
    expect(r.text).toBe('');
  });
});

describe('parseHexColor', () => {
  it('accepts #rgb, #rrggbb, bare hex and rgb()', () => {
    expect(parseHexColor('#ABC')).toBe('#aabbcc');
    expect(parseHexColor('#ABCDEF')).toBe('#abcdef');
    expect(parseHexColor('ff00aa')).toBe('#ff00aa');
    expect(parseHexColor('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(parseHexColor('red')).toBeNull();
  });
});

describe('requestJson retry', () => {
  it('retries once when the first payload is invalid, then succeeds', async () => {
    let n = 0;
    setModelsForTest({
      enabled: true,
      copilotAnswer: {
        generateContent: async () => {
          n++;
          const text = n === 1 ? 'sorry, no json' : '{"answer":"The wall is 100 mm.","why":"plan","calls":[]}';
          return { response: { text: () => text, inferenceSource: 'in_cloud' } };
        },
      },
    });
    const res = await askCopilot('what is the wall thickness?', 'Wall 100 mm.', 'International');
    expect(n).toBe(2);
    expect(res?.source).toBe('cloud');
    expect(res?.answer).toMatch(/100 mm/);
    expect(getHybridStatus().lastFailKind).toBeNull();
  });

  it('retries a 500 high-demand error and then succeeds', async () => {
    vi.useFakeTimers();
    let n = 0;
    setModelsForTest({
      enabled: true,
      copilotAnswer: {
        generateContent: async () => {
          n++;
          if (n === 1) throw new Error('500 Internal Server Error: high demand');
          return { response: { text: () => '{"answer":"Typical door width is 800 mm.","why":"guide","calls":[]}', inferenceSource: 'in_cloud' } };
        },
      },
    });
    const promise = askCopilot('how wide should the door be?', 'one room', 'International');
    await vi.advanceTimersByTimeAsync(400);
    const res = await promise;
    vi.useRealTimers();
    expect(n).toBe(2);
    expect(res?.answer).toMatch(/800 mm/);
    expect(res?.model).toBeTruthy();
  });

  it('backs off on 429 and logs the kind when the retry also fails', async () => {
    vi.useFakeTimers();
    setModelsForTest({
      enabled: true,
      copilotEmail: {
        generateContent: async () => {
          throw new Error('429 Too Many Requests RESOURCE_EXHAUSTED');
        },
      },
    });
    const promise = draftClientEmail([{ question: 'Can this wall come down?' }], 'two bedroom plan');
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    const res = await promise;
    expect(res).toBeNull();
    expect(getHybridStatus().lastFailKind).toBe('429');
    expect(getHybridStatus().lastError).toMatch(/429/);
  });
});
