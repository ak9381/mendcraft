import { describe, expect, it, vi } from 'vitest';
import { applyGuestSnapshot, phoneRouteBadge } from '../../src/canvas/phoneCanvasRuntime';
import type { SurfacePlan } from '../../src/canvas/surfacePlan';

const board: SurfacePlan = { kind: 'room', title: 'Living room', tiles: [] };

describe('phoneRouteBadge', () => {
  it('prefers Apple when it is ready; a scripted iOS shell never names Apple', () => {
    expect(phoneRouteBadge({ appleReady: true, ios: true, sim: false, cloud: true })).toBe('Apple · on device');
    expect(phoneRouteBadge({ appleReady: false, ios: true, sim: true, cloud: true })).toBe('SIM · scripted');
  });

  it('a scripted run (?sim=1, or no cloud model) is labelled SIM, never a bare real route', () => {
    expect(phoneRouteBadge({ appleReady: false, ios: false, sim: true, cloud: true })).toBe('SIM · Gemini · cloud');
    expect(phoneRouteBadge({ appleReady: false, ios: false, sim: false, cloud: false })).toBe('SIM · Gemini · cloud');
    expect(phoneRouteBadge({ appleReady: false, ios: true, sim: false, cloud: false })).toBe('SIM · scripted');
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
    expect(show).toHaveBeenCalledWith(board, {});
  });
  it('a board sent to one phone shows only on that phone', () => {
    const ios = vi.fn();
    const android = vi.fn();
    expect(applyGuestSnapshot({ board, boardFor: 'ios' }, ios, 'ios')).toBe(true);
    expect(applyGuestSnapshot({ board, boardFor: 'ios' }, android, 'android')).toBe(false);
    expect(ios).toHaveBeenCalledWith(board, {});
    expect(android).not.toHaveBeenCalled();
    // An untargeted board still mirrors to every phone.
    expect(applyGuestSnapshot({ board }, android, 'android')).toBe(true);
  });
});

describe('phoneRouteBadge — why Apple is not on device', () => {
  const base = { appleReady: false, ios: true, sim: false, cloud: true };
  it('says Apple Intelligence is off', () => {
    expect(phoneRouteBadge({ ...base, appleReason: 'appleIntelligenceNotEnabled' })).toBe('Gemini · cloud · Apple Intelligence is off');
  });
  it('says the Apple model is still downloading', () => {
    expect(phoneRouteBadge({ ...base, appleReason: 'modelNotReady' })).toBe('Gemini · cloud · Apple model downloading');
  });
  it('says the device is not eligible', () => {
    expect(phoneRouteBadge({ ...base, appleReason: 'deviceNotEligible' })).toBe('Gemini · cloud · this iPhone has no Apple model');
  });
  it('stays plain when ready or no reason is known', () => {
    expect(phoneRouteBadge({ ...base, appleReady: true, appleReason: 'available' })).toBe('Apple · on device');
    expect(phoneRouteBadge(base)).toBe('Gemini · cloud');
  });
});
