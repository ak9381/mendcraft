import { describe, expect, it } from 'vitest';
import { sameDeviceKey, lampConnectorKey } from '../../src/canvas/connectorTurn';
import { connectorKey } from '../../src/devices/connector';

describe('lamp connector: same device, other words', () => {
  it('a WiZ light written other ways is this lamp', () => {
    const want = sameDeviceKey(lampConnectorKey());
    for (const [b, k] of [['WiZ', 'light'], ['WiZ Connected', 'smart bulb'], ['Philips WiZ', 'Smart Light'], ['wiz', 'bulb']]) expect(sameDeviceKey(connectorKey(b, k)), `${b} ${k}`).toBe(want);
  });
  it('another brand or kind is still refused', () => {
    expect(sameDeviceKey(connectorKey('Hue', 'smart-bulb'))).not.toBe(sameDeviceKey(lampConnectorKey()));
    expect(sameDeviceKey(connectorKey('WiZ', 'plug'))).not.toBe(sameDeviceKey(lampConnectorKey()));
  });
});
