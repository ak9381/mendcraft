import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cloudBudgetMs,
  CLOUD_FIRST_TIMEOUT_MS,
  CLOUD_GENERATE_TIMEOUT_MS,
  explainAccessibility,
  generateWithBudget,
  setModelsForTest,
  warmCloud,
} from '../src/ai/hybrid';

afterEach(() => {
  setModelsForTest(null);
  vi.useRealTimers();
});

describe('cloud budgets', () => {
  it('gives the first call a longer budget, then the warm budget', async () => {
    setModelsForTest({ enabled: true });
    expect(cloudBudgetMs('short')).toBe(12_000);
    expect(cloudBudgetMs('long')).toBe(CLOUD_FIRST_TIMEOUT_MS);
    await generateWithBudget(
      { generateContent: async () => ({ response: { text: () => '{"ok":true}', inferenceSource: 'in_cloud' } }) },
      'ping',
      1000,
      'test',
    );
    expect(cloudBudgetMs('short')).toBe(CLOUD_GENERATE_TIMEOUT_MS);
    expect(cloudBudgetMs('long')).toBe(CLOUD_GENERATE_TIMEOUT_MS * 2);
  });

  it('warmCloud is a no-op under test overrides', async () => {
    setModelsForTest({ enabled: true });
    expect(await warmCloud()).toBe(false);
  });
});

describe('streaming timeout keeps partial JSON', () => {
  it('returns parseable stream output instead of failing the call', async () => {
    vi.useFakeTimers();
    const partial = '{"items":[{"id":"door-bath","explanation":"Too narrow for a wheelchair."}]}';
    const model = {
      generateContent: () => new Promise<{ response: { text: () => string } }>(() => {}),
      generateContentStream: async () => ({
        stream: (async function* () {
          yield { text: () => partial, inferenceSource: 'in_cloud' };
          await new Promise(() => {});
        })(),
        response: new Promise<{ text: () => string }>(() => {}),
      }),
    };
    const promise = generateWithBudget(model, 'explain', 2000, 'stream-test');
    await vi.advanceTimersByTimeAsync(2000);
    const { response } = await promise;
    expect(response.text()).toBe(partial);
    expect(response.inferenceSource).toBe('in_cloud');
  });

  it('explainAccessibility uses a streamed partial and stays on the cloud path', async () => {
    vi.useFakeTimers();
    const partial = '{"items":[{"id":"door-bath","explanation":"A 700 mm door is too narrow."}]}';
    setModelsForTest({
      enabled: true,
      a11yExplain: {
        generateContent: () => new Promise(() => {}),
        generateContentStream: async () => ({
          stream: (async function* () {
            yield { text: () => partial, inferenceSource: 'in_cloud' };
            await new Promise(() => {});
          })(),
          response: new Promise(() => {}),
        }),
      },
    });
    const promise = explainAccessibility(
      [{ id: 'door-bath', rule: 'door-width', message: 'Bathroom door is 700 mm.', citation: 'ISO 21542' }],
      'two bedroom plan',
    );
    await vi.advanceTimersByTimeAsync(CLOUD_FIRST_TIMEOUT_MS);
    const res = await promise;
    expect(res.source).toBe('cloud');
    expect(res.items[0]?.id).toBe('door-bath');
    expect(res.items[0]?.explanation).toMatch(/700|narrow/i);
  });

  it('returns as soon as the stream has complete JSON, without waiting for the final response', async () => {
    const json = '{"items":[{"id":"door-bath","explanation":"Too narrow for a wheelchair."}]}';
    const model = {
      generateContent: () => new Promise<{ response: { text: () => string } }>(() => {}),
      generateContentStream: async () => ({
        stream: (async function* () {
          yield { text: () => json, inferenceSource: 'in_cloud' };
          await new Promise(() => {});
        })(),
        response: new Promise<{ text: () => string }>(() => {}),
      }),
    };
    const { response } = await generateWithBudget(model, 'explain', 20_000, 'early-json');
    expect(response.text()).toBe(json);
    expect(response.inferenceSource).toBe('in_cloud');
  });

  it('falls back to rules when a hung call has no usable JSON', async () => {
    vi.useFakeTimers();
    setModelsForTest({
      enabled: true,
      a11yExplain: { generateContent: () => new Promise(() => {}) },
    });
    const promise = explainAccessibility(
      [{ id: 'door-bath', rule: 'door-width', message: 'Bathroom door is 700 mm.', citation: 'ISO 21542' }],
      'two bedroom plan',
    );
    await vi.advanceTimersByTimeAsync(CLOUD_FIRST_TIMEOUT_MS * 3);
    const res = await promise;
    expect(res.source).toBe('rules');
    expect(res.items).toEqual([]);
  });
});
