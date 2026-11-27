// A generated-style WiZ connector (cloud source) and its intent map, for tests.
import { coerceConnector, type Connector } from '../../src/devices/connector';

export const RAW_WIZ = {
  deviceKind: 'smart-bulb', brand: 'WiZ', protocol: 'WiZ JSON over UDP 38899',
  discovery: { method: 'wiz-udp-broadcast', port: 38899 },
  actions: [
    { id: 'power-on', label: 'Turn on', params: [], request: { transport: 'udp', port: 38899, payload: { method: 'setPilot', params: { state: true } } } },
    { id: 'power-off', label: 'Turn off', params: [], request: { transport: 'udp', port: 38899, payload: { method: 'setPilot', params: { state: false } } } },
    { id: 'set-brightness', label: 'Brightness', params: [{ name: 'dimming', type: 'number', min: 10, max: 100, default: 80 }],
      request: { transport: 'udp', port: 38899, payload: { method: 'setPilot', params: { dimming: '{{dimming}}' } } } },
    { id: 'set-white', label: 'White', params: [{ name: 'kelvin', type: 'number', min: 2200, max: 6500, default: 2700 }],
      request: { transport: 'udp', port: 38899, payload: { method: 'setPilot', params: { temp: '{{kelvin}}' } } } },
  ],
  test: { action: 'power-on', prepare: 'power-off' },
};

export const WIZ_INTENTS = {
  on: { action: 'power-on' },
  off: { action: 'power-off' },
  brightness: { action: 'set-brightness', params: { dimming: 'brightness' } },
  temp: { action: 'set-white', params: { kelvin: 'temp' } },
};

export function wizConnector(): Connector {
  const c = coerceConnector(RAW_WIZ, 'cloud', 1);
  if (!c) throw new Error('sample connector failed');
  return c;
}
