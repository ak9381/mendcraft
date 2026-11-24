import { describe, expect, it, vi } from 'vitest';
import { applyGuestSnapshot, phoneRouteBadge } from '../../src/canvas/phoneCanvasRuntime';
import type { SurfacePlan } from '../../src/canvas/surfacePlan';

const board: SurfacePlan = { kind: 'room', title: 'Living room', tiles: [] };

describe('phoneRouteBadge', () => {
  it('prefers Apple on a ready or simulated iOS shell', () => {
    expect(phoneRouteBadge({ appleReady: true, ios: true, sim: false, cloud: true })).toBe('Apple · on device');
    expect(phoneRouteBadge({ appleReady: false, ios: true, sim: true, cloud: true })).toBe('Apple · on device');
  });

  it('shows Gemini cloud when that is the live route', () => {
    expect(phoneRouteBadge({ appleReady: false, ios: false, sim: false, cloud: true })).toBe('Gemini · cloud');
  });
});

describe('applyGuestSnapshot', () => {
  it('applies a Relay board snapshot and ignores empty ones', () => {
    const show = vi.fn();
    expect(applyGuestSnapshot({}, show)).toBe(false);
    expect(show).not.toHaveBeenCalled();
    expect(applyGuestSnapshot({ board }, show)).toBe(true);
    expect(show).toHaveBeenCalledWith(board);
  });
});
