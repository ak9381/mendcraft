import { describe, expect, it, vi } from 'vitest';
import { watchTracksForEnd } from '../src/input/presence';
import { CAMERA_LOST_REGISTER, CAMERA_LOST_TEACH } from '../src/canvas/failLines';

describe('watchTracksForEnd', () => {
  it('fires onLost only when the session is still live (not after we stopped)', () => {
    const listeners: Array<() => void> = [];
    const stream = { getTracks: () => [{ addEventListener: (_t: 'ended', fn: () => void) => { listeners.push(fn); } }] };
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

describe('camera-lost copy', () => {
  it('does not claim a re-registration or a saved gesture', () => {
    expect(CAMERA_LOST_REGISTER).toMatch(/aren.t re-registered/);
    expect(CAMERA_LOST_TEACH).toMatch(/nothing was saved/);
  });
});
