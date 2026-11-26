import { afterEach, describe, expect, it } from 'vitest';
import { setModelsForTest, streamCanvasPlan, type TextGenModel } from '../../src/ai/hybrid';

const PLAN = '{"kind":"room","title":"Living room","tiles":[{"type":"lamp","deviceId":"lamp-1","label":"Lamp"}]}';

const model = (text: string): TextGenModel => ({
  generateContent: async () => ({ response: { text: () => text } }),
});

afterEach(() => setModelsForTest(null));

describe('streamCanvasPlan', () => {
  it('sends a redacted prompt to Gemini and returns the plan JSON', async () => {
    let seen = '';
    const cloud: TextGenModel = {
      generateContent: async (prompt: string) => {
        seen = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
        return { response: { text: () => PLAN } };
      },
    };
    setModelsForTest({ enabled: true, appCheck: 'ready', canvasCloud: cloud });
    const text = await streamCanvasPlan(
      'Connect the lamp for my mother Lakshmi, call her at 9876543210',
    );
    expect(seen).toContain('[name]');
    expect(seen).toContain('[phone]');
    expect(seen).not.toContain('Lakshmi');
    expect(seen).not.toContain('9876543210');
    expect(text).toBeTruthy();
    const parsed = JSON.parse(text!);
    expect(parsed.kind).toBe('room');
    expect(parsed.tiles[0].type).toBe('lamp');
  });

  it('returns null when Firebase / App Check is unavailable', async () => {
    setModelsForTest({ enabled: false });
    expect(await streamCanvasPlan('connect everything in this room')).toBeNull();
  });

  it('returns null when the model reply is not JSON', async () => {
    setModelsForTest({ enabled: true, appCheck: 'ready', canvasCloud: model('sorry, I cannot') });
    expect(await streamCanvasPlan('connect everything in this room')).toBeNull();
  });
});
