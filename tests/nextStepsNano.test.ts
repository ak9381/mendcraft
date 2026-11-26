import { afterEach, describe, expect, it } from 'vitest';
import { pickNextStepsOnDevice, setModelsForTest, type TextGenModel } from '../src/ai/hybrid';

const model = (text: string, inferenceSource?: string): TextGenModel => ({
  generateContent: async () => ({ response: { text: () => text, inferenceSource } }),
});

afterEach(() => setModelsForTest(null));

describe('pickNextStepsOnDevice (Nano only, never cloud)', () => {
  it('returns the raw on-device reply', async () => {
    setModelsForTest({ enabled: true, nextSteps: model('{"ids":["save","floorplan"]}', 'on_device'), deviceModel: 'ready' });
    expect(await pickNextStepsOnDevice('pick')).toBe('{"ids":["save","floorplan"]}');
  });
  it('discards a reply that resolved in the cloud', async () => {
    setModelsForTest({ enabled: true, nextSteps: model('{"ids":["save"]}', 'in_cloud'), deviceModel: 'ready' });
    expect(await pickNextStepsOnDevice('pick')).toBeNull();
  });
  it('null when Nano is not ready, missing, or slow', async () => {
    setModelsForTest({ enabled: true, nextSteps: model('{"ids":["save"]}', 'on_device'), deviceModel: 'downloadable' });
    expect(await pickNextStepsOnDevice('pick')).toBeNull();
    setModelsForTest({ enabled: true, deviceModel: 'ready' });
    expect(await pickNextStepsOnDevice('pick')).toBeNull();
    setModelsForTest({ enabled: true, nextSteps: { generateContent: () => new Promise(() => undefined) }, deviceModel: 'ready' });
    expect(await pickNextStepsOnDevice('pick', { timeoutMs: 10 })).toBeNull();
  });
});
