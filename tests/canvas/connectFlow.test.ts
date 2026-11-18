import { describe, expect, it } from 'vitest';
import { MAX_TILES, type SurfacePlan } from '../../src/canvas/surfacePlan';
import {
  addTilesToPlan,
  deviceSpecToTile,
  parseConnectName,
  POINTED_SPEAKER_SPEC,
  scannedDeviceSpecs,
} from '../../src/canvas/connectFlow';

describe('parseConnectName', () => {
  it('names a bulb, a speaker and a switch, with safe ids', () => {
    expect(parseConnectName('WiZ bulb')).toEqual({ kind: 'lamp', label: 'WiZ bulb', deviceId: 'wiz-bulb' });
    expect(parseConnectName('Marshall speaker')).toEqual({ kind: 'music', label: 'Marshall speaker', deviceId: 'marshall-speaker' });
    expect(parseConnectName('a ceiling fan')).toEqual({ kind: 'switch', label: 'a ceiling fan', deviceId: 'a-ceiling-fan' });
  });

  it('returns null when nothing device-like is named', () => {
    expect(parseConnectName('hello there')).toBeNull();
    expect(parseConnectName('')).toBeNull();
  });
});

describe('deviceSpecToTile', () => {
  it('maps each kind to its tile', () => {
    expect(deviceSpecToTile({ kind: 'lamp', label: 'Lamp', deviceId: 'd1' })).toEqual({ type: 'lamp', deviceId: 'd1', label: 'Lamp' });
    expect(deviceSpecToTile({ kind: 'music', label: 'Spk', deviceId: 'd2' })).toEqual({ type: 'music', deviceId: 'd2', label: 'Spk' });
    expect(deviceSpecToTile({ kind: 'switch', label: 'Fan', deviceId: 'd3' })).toEqual({ type: 'switch', deviceId: 'd3', label: 'Fan' });
  });
});

describe('addTilesToPlan', () => {
  const base: SurfacePlan = { kind: 'room', title: 'Living room', tiles: [
    { type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' },
    { type: 'connect', label: 'Connect a device' },
  ] };

  it('appends a new device tile before the connect tile and keeps connect last', () => {
    const next = addTilesToPlan(base, [POINTED_SPEAKER_SPEC].map(deviceSpecToTile));
    expect(next.tiles.map((t) => t.type)).toEqual(['lamp', 'music', 'connect']);
    expect(next).not.toBe(base); // pure: new object
    expect(base.tiles).toHaveLength(2); // original untouched
  });

  it('does not duplicate a device that is already a tile', () => {
    const next = addTilesToPlan(base, [{ type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' }]);
    expect(next.tiles.filter((t) => t.type === 'lamp')).toHaveLength(1);
  });

  it('never exceeds MAX_TILES', () => {
    const many = Array.from({ length: MAX_TILES + 3 }, (_, i) => deviceSpecToTile({ kind: 'lamp', label: `L${i}`, deviceId: `lamp-${i}` }));
    expect(addTilesToPlan(base, many).tiles.length).toBeLessThanOrEqual(MAX_TILES);
  });
});

describe('scannedDeviceSpecs', () => {
  it('proposes a lamp and a speaker', () => {
    const specs = scannedDeviceSpecs();
    expect(specs.map((s) => s.kind).sort()).toEqual(['lamp', 'music']);
  });
});
