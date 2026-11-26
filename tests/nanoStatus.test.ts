import { describe, expect, it } from 'vitest';
import { checkDeviceNano, hasUsableNano, isAndroidShell } from '../src/ai/nanoStatus';
import { ROUTE_PHONE_NO_NANO } from '../src/ai/privacyRouter';

describe('checkDeviceNano', () => {
  it('reports Prompt API on desktop Chrome', async () => {
    const r = await checkDeviceNano({ LanguageModel: {} });
    expect(r).toMatchObject({ status: 'available', source: 'prompt-api', isPhone: false });
    expect(hasUsableNano(r)).toBe(true);
  });

  it('on Android, uses ML Kit checkStatus and labels a miss clearly', async () => {
    const android = {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        Plugins: { MendcraftNano: { checkStatus: async () => ({ status: 0 }) } },
      },
    };
    expect(isAndroidShell(android)).toBe(true);
    const miss = await checkDeviceNano(android);
    expect(miss.status).toBe('unavailable');
    expect(miss.source).toBe('mlkit');
    expect(miss.label).toBe(ROUTE_PHONE_NO_NANO);
    expect(hasUsableNano(miss)).toBe(false);

    const hitW = {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        Plugins: { MendcraftNano: { checkStatus: async () => ({ status: 3 }) } },
      },
    };
    const hit = await checkDeviceNano(hitW);
    expect(hit.status).toBe('available');
    expect(hit.label).toBe('Nano on this phone');
    expect(hasUsableNano(hit)).toBe(true);
  });

  it('an iPhone (no plugin) shows no Nano on this phone', async () => {
    const r = await checkDeviceNano({
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} },
    });
    expect(r.label).toBe(ROUTE_PHONE_NO_NANO);
    expect(r.source).toBe('none');
    expect(hasUsableNano(r)).toBe(false);
  });

  it('an iPhone with Apple Intelligence available reports the Apple source', async () => {
    const r = await checkDeviceNano({
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        Plugins: { MendcraftAppleAI: { availability: async () => ({ status: 'available' }) } },
      },
    });
    expect(r.status).toBe('available');
    expect(r.source).toBe('apple');
    expect(r.label).toBe('Apple Intelligence on this phone');
    expect(hasUsableNano(r)).toBe(true);
  });

  it('an iPhone with Apple Intelligence off is unavailable, not a crash', async () => {
    const r = await checkDeviceNano({
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        Plugins: { MendcraftAppleAI: { availability: async () => ({ status: 'appleIntelligenceNotEnabled' }) } },
      },
    });
    expect(r.status).toBe('unavailable');
    expect(r.source).toBe('apple');
    expect(r.label).toBe('Gemini (no Apple Intelligence on this phone)');
    expect(hasUsableNano(r)).toBe(false);
  });

  it('an Apple plugin throw is treated as unavailable, not a crash', async () => {
    const r = await checkDeviceNano({
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        Plugins: { MendcraftAppleAI: { availability: async () => { throw new Error('denied'); } } },
      },
    });
    expect(r.status).toBe('unavailable');
    expect(r.source).toBe('apple');
  });

  it('a plugin throw is treated as unavailable, not a crash', async () => {
    const r = await checkDeviceNano({
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        Plugins: { MendcraftNano: { checkStatus: async () => { throw new Error('606'); } } },
      },
    });
    expect(r.status).toBe('unavailable');
    expect(r.label).toBe(ROUTE_PHONE_NO_NANO);
  });
});
