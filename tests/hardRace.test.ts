import { describe, expect, it, vi } from 'vitest';
import { NANO_ROUTE_TIMEOUT_MS, raceHardQuestion, type NanoPick } from '../src/cad/hardRace';

const nanoTool = (tool: string, ms = 10): NanoPick => ({
  call: { tool, args: {} }, confidence: 0.9, source: 'on-device', ms,
});

describe('raceHardQuestion', () => {
  it('starts the cloud immediately and does not wait for a late Nano on a judgement question', async () => {
    const order: string[] = [];
    const res = await raceHardQuestion({
      judgement: true,
      hard: true,
      online: true,
      deviceReady: true,
      nanoTimeoutMs: 200,
      pickNano: () => new Promise((resolve) => setTimeout(() => { order.push('nano'); resolve(nanoTool('delete')); }, 80)),
      askCloud: () => new Promise((resolve) => { order.push('cloud-start'); setTimeout(() => resolve({ answer: 'Check if it is load-bearing.', calls: [], why: '', source: 'cloud', ms: 20, model: 'gemini-3.5-flash-lite' }), 15); }),
    });
    expect(order[0]).toBe('cloud-start');
    expect(res.kind).toBe('cloud');
    if (res.kind === 'cloud') expect(res.cloud.answer).toMatch(/load-bearing/);
  });

  it('lets a timely Nano tool win routing on a non-judgement question', async () => {
    const res = await raceHardQuestion({
      judgement: false,
      hard: true,
      online: true,
      deviceReady: true,
      nanoTimeoutMs: 100,
      pickNano: async () => nanoTool('add_door'),
      askCloud: () => new Promise((resolve) => setTimeout(() => resolve({ answer: 'cloud', calls: [], why: '', source: 'cloud', ms: 80 }), 80)),
    });
    expect(res.kind).toBe('nano-tool');
    if (res.kind === 'nano-tool') expect(res.pick.call.tool).toBe('add_door');
  });

  it('lets the cloud win when Nano is late', async () => {
    vi.useFakeTimers();
    const p = raceHardQuestion({
      judgement: false,
      hard: true,
      online: true,
      deviceReady: true,
      nanoTimeoutMs: NANO_ROUTE_TIMEOUT_MS,
      pickNano: () => new Promise((resolve) => setTimeout(() => resolve(nanoTool('add_door')), 15000)),
      askCloud: () => new Promise((resolve) => setTimeout(() => resolve({ answer: 'from cloud', calls: [], why: '', source: 'cloud', ms: 30 }), 30)),
    });
    await vi.advanceTimersByTimeAsync(NANO_ROUTE_TIMEOUT_MS);
    const res = await p;
    vi.useRealTimers();
    expect(res.kind).toBe('cloud');
    if (res.kind === 'cloud') expect(res.cloud.answer).toBe('from cloud');
  });

  it('saves an offline hard question unless a timely Nano tool is a real command', async () => {
    const offline = await raceHardQuestion({
      judgement: true, hard: true, online: false, deviceReady: true,
      pickNano: async () => nanoTool('delete'),
    });
    expect(offline.kind).toBe('offline');

    const tool = await raceHardQuestion({
      judgement: false, hard: true, online: false, deviceReady: true,
      nanoTimeoutMs: 50,
      pickNano: async () => nanoTool('view_3d'),
    });
    expect(tool.kind).toBe('nano-tool');
  });

  it('ignores a Nano delete on a judgement question even if it is fast', async () => {
    const res = await raceHardQuestion({
      judgement: true, hard: true, online: true, deviceReady: true,
      pickNano: async () => nanoTool('delete'),
      askCloud: async () => ({ answer: 'Advice only.', calls: [], why: '', source: 'cloud', ms: 5 }),
    });
    expect(res.kind).toBe('cloud');
  });
});
