import { describe, expect, it } from 'vitest';
import {
  POINT_UNSURE_MESSAGE,
  pointConnectFromIdentity,
  SIM_POINT_IDENTITY,
  mapKindToTile,
} from '../../src/canvas/connectTurns';
import { coerceSurfacePlan } from '../../src/canvas/surfacePlan';
import { createCanvasLedger } from '../../src/canvas/ledger';
import type { DeviceIdentity } from '../../src/devices/identify';

const id = (o: Partial<DeviceIdentity>): DeviceIdentity => ({ kind: 'lamp', brand: '', model: '', label: 'Lamp', confidence: 0.9, ...o });
const wiz = id({ kind: 'smart-bulb', brand: 'WiZ', label: 'WiZ bulb' });
const devices = [
  { id: 'wiz-desk', label: 'Desk lamp', kind: 'lamp' },
  { id: 'speaker-1', label: 'Speaker', kind: 'music' },
];

describe('pointConnectFromIdentity: identity → tile', () => {
  it('a WiZ bulb seen on device proposes a lamp tile, 0 bytes left', () => {
    const out = pointConnectFromIdentity({ identity: wiz, source: 'on-device' }, { sim: false });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.turn.plan.tiles).toHaveLength(1);
    expect(out.turn.plan.tiles[0].type).toBe('lamp');
    expect(out.turn.sent.engine).toBe('nano');
    expect(out.turn.sent.sent).toBeNull();
    expect(out.turn.sent.routeLine).toMatch(/^Nano · on device/);
    expect(out.turn.sent.sim).toBe(false);
    expect(out.extraBytes).toBe(0);
    expect(coerceSurfacePlan(JSON.parse(out.turn.json)).ok).toBe(true);
  });

  it('lands on the real lamp already on the canvas instead of minting a dead id', () => {
    const out = pointConnectFromIdentity({ identity: wiz, source: 'on-device' }, { sim: false, devices });
    expect(out.ok && out.turn.plan.tiles[0]).toMatchObject({ type: 'lamp', deviceId: 'wiz-desk' });
  });

  it('a speaker proposes a music tile', () => {
    const out = pointConnectFromIdentity({ identity: id({ kind: 'speaker', label: 'Marshall speaker' }), source: 'on-device' }, { sim: false, devices });
    expect(out.ok && out.turn.plan.tiles[0]).toMatchObject({ type: 'music', deviceId: 'speaker-1' });
  });

  it('a plain lamp, and a WiZ of unknown kind, are lamps', () => {
    const lamp = pointConnectFromIdentity({ identity: id({ kind: 'lamp', label: 'Floor lamp' }), source: 'cloud' }, { sim: false, cropBytes: 10 });
    expect(lamp.ok && lamp.turn.plan.tiles[0].type).toBe('lamp');
    const other = pointConnectFromIdentity({ identity: id({ kind: 'other', brand: 'WiZ', label: 'WiZ light' }), source: 'on-device' }, { sim: false });
    expect(other.ok && other.turn.plan.tiles[0].type).toBe('lamp');
  });

  it('a fan / plug becomes a switch — never a speaker', () => {
    const out = pointConnectFromIdentity({ identity: id({ kind: 'fan', label: 'Fan' }), source: 'on-device' }, { sim: false, devices });
    expect(out.ok && out.turn.plan.tiles[0].type).toBe('switch');
  });

  it('a cloud answer records the real crop bytes and says so', () => {
    const out = pointConnectFromIdentity({ identity: wiz, source: 'cloud' }, { sim: false, cropBytes: 12_345 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.turn.sent.engine).toBe('gemini');
    expect(out.turn.sent.sent).toMatch(/photo crop/);
    expect(out.turn.sent.sent).toContain('12.1 KB');
    expect(out.turn.sent.routeLine).toMatch(/^Gemini · cloud/);
    expect(out.extraBytes).toBe(12_345);
  });
});

describe('pointConnectFromIdentity: unsure → say so, no proposal', () => {
  it('null (no model / nothing seen)', () => {
    expect(pointConnectFromIdentity(null, { sim: false })).toEqual({ ok: false, message: POINT_UNSURE_MESSAGE });
  });
  it('confidence below 0.5', () => {
    const out = pointConnectFromIdentity({ identity: id({ kind: 'speaker', confidence: 0.4 }), source: 'cloud' }, { sim: false, cropBytes: 900 });
    expect(out).toEqual({ ok: false, message: POINT_UNSURE_MESSAGE });
  });
  it('an unknown kind is not guessed into a tile', () => {
    const out = pointConnectFromIdentity({ identity: id({ kind: 'other', label: 'Kettle' }), source: 'on-device' }, { sim: false });
    expect(out.ok).toBe(false);
  });
  it('the message asks her to name it', () => {
    expect(POINT_UNSURE_MESSAGE).toBe('I couldn’t tell what you’re pointing at — try naming it.');
  });
});

describe('sim point', () => {
  it('the scripted identity is a lamp, and the turn is labelled SIM', () => {
    expect(SIM_POINT_IDENTITY.kind).not.toBe('speaker');
    const out = pointConnectFromIdentity({ identity: SIM_POINT_IDENTITY, source: 'on-device' }, { sim: true });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.turn.plan.tiles[0].type).toBe('lamp');
    expect(out.turn.sent.sim).toBe(true);
    expect(out.turn.sent.routeLine).toMatch(/^SIM · /);
    expect(out.extraBytes).toBe(0);
  });
});

describe('mapKindToTile', () => {
  it('speaker → music; bulb/lamp → lamp; plug → switch', () => {
    expect(mapKindToTile('speaker', 'S').type).toBe('music');
    expect(mapKindToTile('smart-bulb', 'B').type).toBe('lamp');
    expect(mapKindToTile('plug', 'P').type).toBe('switch');
  });
});

describe('ledger: photo bytes', () => {
  it('cloud entries add the photo bytes; Nano stays 0', () => {
    const l = createCanvasLedger();
    expect(l.record({ engine: 'gemini', sentText: 'ab', extraBytes: 100 }).bytes).toBe(102);
    expect(l.record({ engine: 'nano', sentText: 'ab', extraBytes: 100 }).bytes).toBe(0);
  });
});
