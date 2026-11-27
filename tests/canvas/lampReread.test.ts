// Final review 5: "is the lamp on?" reads a reachable lamp first (bounded),
// else answers from the last state it had, saying so.
import { describe, expect, it } from 'vitest';
import { rereadLamps, LAMP_REREAD_MS } from '../../src/canvas/lampReread';
import { deviceStateAnswer } from '../../src/canvas/deviceStateAnswer';
import type { DeviceRef } from '../../src/canvas/deviceCommands';

describe('re-reading the lamps before a state answer', () => {
  it('is bounded at 1.5 s', () => expect(LAMP_REREAD_MS).toBe(1500));
  it('applies what each lamp answers; a lamp that throws or is too slow is stale', async () => {
    const applied: Record<string, boolean> = {};
    const t0 = Date.now();
    const stale = await rereadLamps(['a', 'b', 'c'], async (id) => {
      if (id === 'a') return { on: true, dimming: 40 };
      if (id === 'b') throw new Error('no answer');
      return new Promise((r) => setTimeout(() => r({ on: false }), 500));
    }, (id, s) => { applied[id] = s.on; }, 60);
    expect(Date.now() - t0).toBeLessThan(400);
    expect(applied).toEqual({ a: true });
    expect([...stale].sort()).toEqual(['b', 'c']);
  });
  it('no lamps: nothing read, nothing stale', async () => {
    expect((await rereadLamps([], async () => ({ on: true }), () => {}, 10)).size).toBe(0);
  });
});

describe('a lamp read before the answer could not be read', () => {
  const desk: DeviceRef = { id: 'desk', label: 'Desk lamp', kind: 'lamp', on: true };
  it('says "last I heard"', () => {
    expect(deviceStateAnswer('is the lamp on?', [{ ...desk, stale: true }])).toBe('Last I heard, the desk lamp was on.');
    expect(deviceStateAnswer('is the lamp on?', [{ ...desk, on: false, stale: true }])).toBe('Last I heard, the desk lamp was off.');
  });
  it('a fresh read is said plainly', () => {
    expect(deviceStateAnswer('is the lamp on?', [desk])).toBe('The desk lamp is on.');
  });
  it('one stale of two', () => {
    const bed: DeviceRef = { id: 'bed', label: 'Bedroom lamp', kind: 'lamp', on: false };
    expect(deviceStateAnswer('are the lights on?', [{ ...desk, stale: true }, bed])).toBe('Last I heard, the desk lamp was on, and the bedroom lamp is off.');
  });
});
