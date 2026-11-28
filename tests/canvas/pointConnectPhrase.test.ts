import { describe, expect, it } from 'vitest';
import { isPointConnectAsk } from '../../src/canvas/routeLine';

describe('point-to-connect phrase', () => {
  it('matches what speech recognition really hears', () => {
    for (const t of ["connect what I'm pointing at", 'Connect to what I am pointing.', "connect to what I'm pointing at", 'connect what I am pointing to', "connect the thing I'm pointing at", 'connect whatever I point at', 'add what I am pointing at', 'connect this', 'connect what I’m pointing towards']) {
      expect(isPointConnectAsk(t), t).toBe(true);
    }
    for (const t of ['connect the lamp', 'connect my phones', 'what am I pointing at', 'build the dashboard']) expect(isPointConnectAsk(t), t).toBe(false);
  });
});
