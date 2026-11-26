import { describe, expect, it } from 'vitest';
import {
  appleStatusToDevice,
  appleStatusToNano,
  appleTextModel,
  checkAppleAvailability,
  generateAppleText,
  getAppleAIPlugin,
  parseAppleStatus,
  type AppleAIPlugin,
} from '../src/ai/appleAI';
import { badgeLabel } from '../src/ai/router';
import { compileCommand, setModelsForTest, checkDeviceAvailability, initDeviceModel, getDeviceModelStatus, getOnDeviceKind } from '../src/ai/hybrid';
import { setActiveMode } from '../src/core/modes';
import { afterEach, beforeEach } from 'vitest';
import { createLedger } from '../src/core/ledger';

beforeEach(() => setActiveMode('plan'));
afterEach(() => setModelsForTest(null));

function iosWindow(plugin?: AppleAIPlugin) {
  return {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      Plugins: plugin ? { MendcraftAppleAI: plugin } : {},
    },
  };
}

const available: AppleAIPlugin = {
  availability: async () => ({ status: 'available' }),
  generate: async ({ prompt, schema }) => ({
    text: schema?.includes('"op"') || prompt.includes('undo') ? '{"op":"undo"}' : '{"ok":true}',
    source: 'on_device',
  }),
  prewarm: async () => ({ ok: true, status: 'available' }),
};

describe('Apple availability mapping', () => {
  it('parses known statuses and maps to device / Nano status', () => {
    expect(parseAppleStatus('available')).toBe('available');
    expect(parseAppleStatus('deviceNotEligible')).toBe('deviceNotEligible');
    expect(parseAppleStatus('appleIntelligenceNotEnabled')).toBe('appleIntelligenceNotEnabled');
    expect(parseAppleStatus('modelNotReady')).toBe('modelNotReady');
    expect(parseAppleStatus('nope')).toBe('unavailable');
    expect(appleStatusToDevice('available')).toBe('ready');
    expect(appleStatusToDevice('modelNotReady')).toBe('downloading');
    expect(appleStatusToDevice('unsupported')).toBe('unsupported');
    expect(appleStatusToDevice('deviceNotEligible')).toBe('unavailable');
    expect(appleStatusToNano('available')).toBe('available');
    expect(appleStatusToNano('modelNotReady')).toBe('downloading');
    expect(appleStatusToNano('appleIntelligenceNotEnabled')).toBe('unavailable');
  });

  it('finds the plugin only in the iOS shell', () => {
    expect(getAppleAIPlugin(iosWindow(available))).toBe(available);
    expect(getAppleAIPlugin({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { MendcraftAppleAI: available } } })).toBeNull();
    expect(getAppleAIPlugin(iosWindow())).toBeNull();
  });

  it('checkAppleAvailability never throws', async () => {
    expect(await checkAppleAvailability(available)).toEqual({ status: 'available' });
    expect(await checkAppleAvailability({
      availability: async () => { throw new Error('boom'); },
      generate: async () => ({ text: '' }),
    })).toEqual({ status: 'unavailable' });
    expect(await checkAppleAvailability(null)).toBeNull();
  });
});

describe('Apple text model', () => {
  it('labels generate as on_device and sends the schema', async () => {
    let seen: { prompt: string; schema?: string } | undefined;
    const plugin: AppleAIPlugin = {
      availability: async () => ({ status: 'available' }),
      generate: async (opts) => {
        seen = opts;
        return { text: '{"op":"undo"}', source: 'on_device' };
      },
    };
    const model = appleTextModel({ type: 'object', properties: { op: { type: 'string' } } }, plugin);
    const { response } = await model.generateContent('take that back');
    expect(response.inferenceSource).toBe('on_device');
    expect(response.text()).toBe('{"op":"undo"}');
    expect(seen?.prompt).toBe('take that back');
    expect(seen?.schema).toContain('"op"');
  });

  it('throws when the plugin is missing, so the caller can fall back', async () => {
    const model = appleTextModel(undefined, null);
    await expect(model.generateContent('hello')).rejects.toThrow(/not available/);
  });

  it('generateAppleText calls onText once with the full reply', async () => {
    const chunks: string[] = [];
    const text = await generateAppleText('draft', (t) => chunks.push(t), available);
    expect(text).toBe('{"ok":true}');
    expect(chunks).toEqual(['{"ok":true}']);
  });
});

describe('hybrid routing with a mocked Apple plugin', () => {
  it('checkDeviceAvailability reports ready and Apple as the on-device kind', async () => {
    setModelsForTest({ enabled: true, appleAI: available });
    expect(await checkDeviceAvailability()).toBe('ready');
    expect(getDeviceModelStatus()).toBe('ready');
    expect(getOnDeviceKind()).toBe('apple');
  });

  it('maps Apple Intelligence off and not-eligible to unavailable', async () => {
    setModelsForTest({
      enabled: true,
      appleAI: { ...available, availability: async () => ({ status: 'appleIntelligenceNotEnabled' }) },
    });
    expect(await checkDeviceAvailability()).toBe('unavailable');
    setModelsForTest({
      enabled: true,
      appleAI: { ...available, availability: async () => ({ status: 'deviceNotEligible' }) },
    });
    expect(await checkDeviceAvailability()).toBe('unavailable');
  });

  it('maps modelNotReady to downloading', async () => {
    setModelsForTest({
      enabled: true,
      appleAI: { ...available, availability: async () => ({ status: 'modelNotReady' }) },
    });
    expect(await checkDeviceAvailability()).toBe('downloading');
  });

  it('does not require Firebase initializeDeviceModel when Apple is ready', async () => {
    setModelsForTest({
      enabled: true,
      appleAI: available,
      intent: { generateContent: async () => ({ response: { text: () => '{}' } }) },
    });
    expect(await initDeviceModel()).toBe(true);
    expect(getDeviceModelStatus()).toBe('ready');
  });

  it('compileCommand uses the Apple model and stays on-device', async () => {
    setModelsForTest({
      enabled: true,
      appleAI: available,
      intent: appleTextModel({ type: 'object' }, available),
    });
    const r = await compileCommand('take that back', '{}', null);
    expect(r.source).toBe('on-device');
    expect(r.result).toEqual({ op: 'undo' });
    expect(badgeLabel(r.source, 'private', 'apple')).toBe('Apple · on device · private');
  });

  it('a preferred Chrome LanguageModel override still wins over Apple', async () => {
    setModelsForTest({
      enabled: true,
      appleAI: available,
      languageModel: { availability: async () => 'downloadable' },
    });
    expect(await checkDeviceAvailability()).toBe('downloadable');
    expect(getOnDeviceKind()).toBe('nano');
  });
});

describe('ledger stays honest for Apple on-device answers', () => {
  it('counts an on-device event and stores nothing that left the device', () => {
    const ledger = createLedger();
    ledger.record({ source: 'on-device', job: 'fuse', reason: 'private' });
    expect(ledger.counts()).toMatchObject({ onDevice: 1, cloud: 0, private: 1, bytesSent: 0 });
    expect(ledger.calls()).toEqual([]);
  });
});
