// iPhone sensing (phoneSensor.ts): docking never starts the camera; the Track
// pill shows what really runs, and a tap while it runs turns sensing off for
// the session (it wins over 'docked'); a new follow/point ask may start it.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createPhoneSensor, SENSOR_LOST_LINE } from '../../src/canvas/phoneSensor';
import type { PhoneCamera, PhoneCameraStatus, PhoneCameraUse } from '../../src/canvas/phoneCamera';

function fakeCamera() {
  const uses = new Set<PhoneCameraUse>();
  let status: PhoneCameraStatus = 'off';
  const statusSubs = new Set<(s: PhoneCameraStatus) => void>();
  const camera: PhoneCamera = {
    setUse: vi.fn(async (use: PhoneCameraUse, on: boolean) => {
      if (on) uses.add(use); else uses.delete(use);
      status = uses.size ? 'live' : 'off';
      for (const cb of statusSubs) cb(status);
    }),
    uses: () => [...uses],
    onFrame: () => () => undefined,
    onStatus: (cb) => { statusSubs.add(cb); return () => { statusSubs.delete(cb); }; },
    status: () => status,
    lastError: () => null,
    intervalMs: () => 100,
    destroy: () => undefined,
  };
  return camera;
}
function mem() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}

describe('phoneSensor: explicit asks only, honest pill', () => {
  it('canvasApp never starts sensing just because the stand docked', () => {
    const app = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
    expect(app).not.toMatch(/request\('docked'/);
  });

  it('a tap while sensing runs (for a follow request) turns it OFF — not just the pill reason', async () => {
    const camera = fakeCamera();
    const onUserStop = vi.fn();
    const s = createPhoneSensor({ camera, onHands: () => undefined, pill: false, storage: mem(), onUserStop });
    await s.request('follow', true);
    expect(s.running()).toBe(true);
    await s.tap();
    expect(s.running()).toBe(false);
    expect(s.reasons()).toEqual([]);
    expect(camera.status()).toBe('off');
    expect(onUserStop).toHaveBeenCalledTimes(1);
  });

  it('after the user turned it off, an automatic docked reason is ignored; a new explicit ask works', async () => {
    const camera = fakeCamera();
    const s = createPhoneSensor({ camera, onHands: () => undefined, pill: false, storage: mem() });
    await s.request('pill', true);
    await s.tap();
    await s.request('docked', true);
    expect(s.running()).toBe(false);
    await s.request('point', true);
    expect(s.running()).toBe(true);
  });

  it('a tap while off turns Track on (persisted)', async () => {
    const camera = fakeCamera();
    const storage = mem();
    const s = createPhoneSensor({ camera, onHands: () => undefined, pill: false, storage });
    await s.tap();
    expect(s.reasons()).toEqual(['pill']);
    expect(storage.m.get('mc.phoneSensor')).toBe('1');
    await s.tap();
    expect(storage.m.has('mc.phoneSensor')).toBe(false);
  });

  it('a camera lost for good (e.g. a muted track) says so plainly', async () => {
    const camera = fakeCamera();
    let emit: ((s: 'error') => void) | null = null;
    camera.onStatus = (cb) => { emit = cb as (s: 'error') => void; return () => undefined; };
    const say = vi.fn();
    const s = createPhoneSensor({ camera, onHands: () => undefined, pill: false, storage: mem(), say });
    await s.request('point', true);
    emit!('error');
    expect(say).toHaveBeenCalledWith(SENSOR_LOST_LINE);
  });
});
