import { describe, expect, it } from 'vitest';
import { buildStayedLocalStrip, handoffReason } from '../../src/canvas/modelPanels';
import type { Person } from '../../src/privacy/directory';

describe('handoffReason', () => {
  it('formats a Nano → Gemini handoff with its reason', () => {
    expect(handoffReason('nano', 'gemini', 'too complex for on-device')).toBe(
      'Nano → Gemini: too complex for on-device',
    );
  });
  it('formats a Gemini → Nano handoff', () => {
    expect(handoffReason('gemini', 'nano', 'apply 42 label swaps locally')).toBe(
      'Gemini → Nano: apply 42 label swaps locally',
    );
  });
});

const sharma: Person = { id: 'p1', name: 'Sharma', role: 'client', token: '[Client A]', notes: [], createdAt: 0 };

describe('buildStayedLocalStrip', () => {
  it('shows the real name kept locally next to the token sent to the cloud', () => {
    const strip = buildStayedLocalStrip({
      used: [{ token: '[Client A]', personId: 'p1' }],
      people: [sharma],
      bytesSent: 240,
      engine: 'gemini',
      routeLine: 'routed via Mac: Nano cleaned, then Gemini',
    });
    expect(strip.keptLocalLines).toEqual(['[Client A] = Sharma, never left']);
    expect(strip.sentToCloudLines).toEqual(['Gemini saw: [Client A]']);
    expect(strip.bytesLabel).toMatch(/Gemini/);
    expect(strip.routeLabel).toBe('routed via Mac: Nano cleaned, then Gemini');
  });

  it('falls back to honest placeholders when no names were in the turn', () => {
    const strip = buildStayedLocalStrip({
      used: [],
      people: [sharma],
      bytesSent: 0,
      engine: 'nano',
      routeLine: 'cleaned on this device: Nano + rules, then Gemini',
    });
    expect(strip.keptLocalLines).toEqual(['No names in this turn.']);
    expect(strip.sentToCloudLines).toEqual(['Nothing identifying left this device.']);
  });

  it('still names the token when the person record is missing', () => {
    const strip = buildStayedLocalStrip({
      used: [{ token: '[Client B]', personId: 'missing' }],
      people: [sharma],
      bytesSent: 10,
      engine: 'gemini',
      routeLine: 'x',
    });
    expect(strip.keptLocalLines).toEqual(['[Client B], never left']);
  });
});
