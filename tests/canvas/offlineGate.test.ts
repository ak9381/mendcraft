import { describe, expect, it, vi } from 'vitest';
import type { SurfaceEngine } from '../../src/canvas/aiTurn';
import { openEndedAsk } from '../../src/canvas/openEndedAsk';
import { OfflineError, chatEngines, offlineEngine } from '../../src/canvas/offlineGate';

const eng = (id: 'nano' | 'gemini', reply: string, extra: Partial<SurfaceEngine> = {}) => {
  const stream = vi.fn(async () => reply);
  return { e: { id, sim: false, stream, ...extra } as SurfaceEngine, stream };
};

describe('offline gate for chat (final review sim-1 A2)', () => {
  it('online: the engines pass unchanged', () => {
    const n = eng('nano', 'hi'); const g = eng('gemini', 'hi');
    expect(chatEngines(true, n.e, g.e)).toEqual({ nano: n.e, gemini: g.e });
  });

  it('offline with no on-device model (the Nano slot is Gemini): no chat, nothing sent', () => {
    const n = eng('gemini', 'hi from the cloud'); const g = eng('gemini', 'hi');
    expect(chatEngines(false, n.e, g.e)).toBeNull();
    expect(n.stream).not.toHaveBeenCalled();
  });

  it('offline with Nano: Nano answers; when Nano fails, the cloud is never called', async () => {
    const cloud = eng('gemini', 'cloud');
    const okNano = eng('nano', 'Hi there.', { handoff: cloud.e });
    const gated = chatEngines(false, okNano.e, cloud.e)!;
    expect(gated.nano.handoff).toBeUndefined();
    expect((await openEndedAsk('hi', gated.nano, gated.gemini)).reply).toBe('Hi there.');

    const badNano: SurfaceEngine = { id: 'nano', sim: false, stream: async () => { throw new Error('no model'); }, fallback: cloud.e, handoff: cloud.e };
    const g2 = chatEngines(false, badNano, cloud.e)!;
    await expect(openEndedAsk('hi', g2.nano, g2.gemini)).rejects.toBeInstanceOf(OfflineError);
    expect(cloud.stream).not.toHaveBeenCalled();
  });

  it('the offline engine fails at once and never sends', async () => {
    const onCloudSend = vi.fn();
    await expect(offlineEngine('gemini').stream('x', () => {}, { onCloudSend })).rejects.toBeInstanceOf(OfflineError);
    expect(onCloudSend).not.toHaveBeenCalled();
  });
});
