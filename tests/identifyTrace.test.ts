import { afterEach, describe, expect, it } from 'vitest';
import { identifyDevice, setModelsForTest, type MultimodalGenModel, type VisionTrace } from '../src/ai/hybrid';

// The point-to-connect ledger counts the crop once per cloud send, so the
// vision call must report every send — including ones with no usable answer.
describe('identifyDevice trace: cloud sends', () => {
  afterEach(() => setModelsForTest(null));
  const mm = (text: string, src?: string): MultimodalGenModel => ({ generateContent: async () => ({ response: { text: () => text, inferenceSource: src } }) });
  const boom: MultimodalGenModel = { generateContent: async () => { throw new Error('failed'); } };
  const img = { mimeType: 'image/jpeg', dataBase64: 'abc' };
  const lamp = '{"kind":"smart-bulb","brand":"WiZ","label":"Lamp","confidence":0.8}';

  it('Nano answers on device → 0 sends', async () => {
    setModelsForTest({ deviceSee: mm(lamp, 'on_device'), deviceSeeCloud: mm(lamp) });
    const t: VisionTrace = { cloudSends: 0 };
    expect((await identifyDevice(img, undefined, t))?.source).toBe('on-device');
    expect(t).toEqual({ cloudSends: 0 });
  });

  it('hybrid routed to cloud and answered → 1 send, answered', async () => {
    setModelsForTest({ deviceSee: mm(lamp, 'in_cloud') });
    const t: VisionTrace = { cloudSends: 0 };
    expect((await identifyDevice(img, undefined, t))?.source).toBe('cloud');
    expect(t).toEqual({ cloudSends: 1, cloudAnswered: true });
  });

  it('Nano not ready: hybrid (to cloud) fails, then the twin → 2 sends', async () => {
    setModelsForTest({ deviceSee: boom, deviceSeeCloud: mm(lamp) });
    const t: VisionTrace = { cloudSends: 0 };
    expect((await identifyDevice(img, undefined, t))?.source).toBe('cloud');
    expect(t).toEqual({ cloudSends: 2, cloudAnswered: true });
  });

  it('both fail → sends counted, no answer, null result', async () => {
    setModelsForTest({ deviceSee: boom, deviceSeeCloud: boom });
    const t: VisionTrace = { cloudSends: 0 };
    expect(await identifyDevice(img, undefined, t)).toBeNull();
    expect(t.cloudSends).toBe(2);
    expect(t.cloudAnswered).toBeFalsy();
  });

  it('a cloud answer of "none" is null but still counted as sent and answered', async () => {
    setModelsForTest({ deviceSeeCloud: mm('{"kind":"none","label":"","confidence":0.1}') });
    const t: VisionTrace = { cloudSends: 0 };
    expect(await identifyDevice(img, undefined, t)).toBeNull();
    expect(t).toEqual({ cloudSends: 1, cloudAnswered: true });
  });
});
