import { describe, expect, it, vi } from 'vitest';
import { CAMERA_MUTE_LOST_MS, watchTracksForEnd } from '../src/input/presence';
import { CAMERA_LOST_REGISTER, CAMERA_LOST_TEACH } from '../src/canvas/failLines';

describe('watchTracksForEnd', () => {
  it('fires onLost only when the session is still live (not after we stopped)', () => {
    const listeners: Array<() => void> = [];
    const stream = { getTracks: () => [{ addEventListener: (t: string, fn: () => void) => { if (t === 'ended') listeners.push(fn); } }] };
    const lost = vi.fn();
    let live = true;
    watchTracksForEnd(stream, lost, () => live);
    listeners.forEach((fn) => fn());
    expect(lost).toHaveBeenCalledTimes(1);
    live = false;
    listeners.forEach((fn) => fn());
    expect(lost).toHaveBeenCalledTimes(1);
  });
});

describe('watchTracksForEnd: a muted track (WebKit, camera taken by another capture)', () => {
  function track() {
    const on = new Map<string, () => void>();
    return { on, addEventListener: (t: string, fn: () => void) => { on.set(t, fn); } };
  }
  function timers() {
    const q = new Map<number, () => void>();
    let n = 0;
    return { q, set: (fn: () => void, ms: number) => { expect(ms).toBe(CAMERA_MUTE_LOST_MS); q.set(++n, fn); return n; }, clear: (id: unknown) => { q.delete(id as number); }, run: () => { for (const [k, f] of [...q]) { q.delete(k); f(); } } };
  }
  it('muted for 2 s → lost (once)', () => {
    const t = track(); const tm = timers(); const lost = vi.fn();
    watchTracksForEnd({ getTracks: () => [t] }, lost, () => true, tm);
    t.on.get('mute')!();
    expect(lost).not.toHaveBeenCalled();
    tm.run();
    expect(lost).toHaveBeenCalledTimes(1);
    t.on.get('ended')!();
    expect(lost).toHaveBeenCalledTimes(1);
  });
  it('unmuted in time → not lost', () => {
    const t = track(); const tm = timers(); const lost = vi.fn();
    watchTracksForEnd({ getTracks: () => [t] }, lost, () => true, tm);
    t.on.get('mute')!();
    t.on.get('unmute')!();
    tm.run();
    expect(lost).not.toHaveBeenCalled();
  });
  it('a mute after we stopped is ignored', () => {
    const t = track(); const tm = timers(); const lost = vi.fn();
    watchTracksForEnd({ getTracks: () => [t] }, lost, () => false, tm);
    t.on.get('mute')!();
    tm.run();
    expect(lost).not.toHaveBeenCalled();
  });
});

describe('camera-lost copy', () => {
  it('does not claim a re-registration or a saved gesture', () => {
    expect(CAMERA_LOST_REGISTER).toMatch(/aren.t re-registered/);
    expect(CAMERA_LOST_TEACH).toMatch(/nothing was saved/);
  });
});
