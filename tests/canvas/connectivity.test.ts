import { describe, expect, it } from 'vitest';
import { createConnectivity } from '../../src/canvas/connectivity';

describe('connectivity + later queue', () => {
  it('tracks online state', () => {
    const c = createConnectivity(true);
    expect(c.isOnline()).toBe(true);
    c.setOnline(false);
    expect(c.isOnline()).toBe(false);
  });

  it('queues later items while offline and drains them in order, once', () => {
    const c = createConnectivity<string>(false);
    c.queueLater('add kannada');
    c.queueLater('make it French');
    expect(c.laterCount()).toBe(2);
    expect(c.drainLater()).toEqual(['add kannada', 'make it French']);
    expect(c.laterCount()).toBe(0);
    expect(c.drainLater()).toEqual([]);
  });
});
