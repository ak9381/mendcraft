import { describe, it, expect } from 'vitest';
import { deviceSplit, splitSummary } from '../src/canvas/deviceSplit';

describe('deviceSplit', () => {
  it('iPhone with Apple AI keeps quick/intent/redaction on device', () => {
    const s = deviceSplit('ios', true);
    expect(s.badge).toBe('Apple · on device');
    expect(s.onDevice).toBe(true);
    expect(s.stays).toEqual(expect.arrayContaining(['Quick edits', 'Intent parsing', 'Redaction']));
    expect(s.goes.join(' ')).toMatch(/Big boards/);
  });

  it('Nothing phone (no model) routes edits to Gemini cloud', () => {
    const s = deviceSplit('android', false);
    expect(s.badge).toBe('Gemini · cloud');
    expect(s.onDevice).toBe(false);
    expect(s.goes.join(' ')).toMatch(/Gemini/);
  });

  it('gaze frames, pin, rules and WiZ LAN always stay local', () => {
    for (const s of [deviceSplit('ios', true), deviceSplit('android', false), deviceSplit('ios', false)]) {
      expect(s.stays).toEqual(expect.arrayContaining(['Gaze camera frames', 'Pin state', 'Local rules', 'WiZ lamp (LAN)']));
      // Never claims gaze frames go to the cloud.
      expect(s.goes.join(' ')).not.toMatch(/[Gg]aze|frame|landmark/);
    }
  });

  it('iPhone without the Apple model falls back to cloud', () => {
    expect(deviceSplit('ios', false).badge).toBe('Gemini · cloud');
  });

  it('summary line matches the on-device flag', () => {
    expect(splitSummary(deviceSplit('ios', true))).toMatch(/stay on this phone/);
    expect(splitSummary(deviceSplit('android', false))).toMatch(/Gemini cloud/);
  });
});
