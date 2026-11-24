import { describe, expect, it } from 'vitest';
import {
  POINT_UNSURE_MESSAGE,
  pickPointChoice,
  pointConnectFromIdentity,
  pointFailureReceipt,
  SIM_POINT_IDENTITY,
  mapKindToTile,
} from '../../src/canvas/connectTurns';
import { coerceSurfacePlan } from '../../src/canvas/surfacePlan';
import { createCanvasLedger } from '../../src/canvas/ledger';
import type { DeviceIdentity } from '../../src/devices/identify';

const id = (o: Partial<DeviceIdentity>): DeviceIdentity => ({ kind: 'lamp', brand: '', model: '', label: 'Lamp', confidence: 0.9, ...o });
const wiz = id({ kind: 'smart-bulb', brand: 'WiZ', label: 'WiZ bulb' });
const desk = { id: 'wiz-desk', label: 'Desk lamp', kind: 'lamp' };
const ceiling = { id: 'wiz-ceiling', label: 'Ceiling light', kind: 'lamp' };
const speaker = { id: 'speaker-1', label: 'Speaker', kind: 'music' };
const fanPlug = { id: 'plug-1', label: 'Fan plug', kind: 'switch' };
const devices = [desk, speaker];

describe('pointConnectFromIdentity: identity → tile on a connected device', () => {
  it('a WiZ bulb seen on device binds the WiZ lamp, 0 bytes left', () => {
    const out = pointConnectFromIdentity({ identity: wiz, source: 'on-device' }, { sim: false, devices });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.turn.plan.tiles).toEqual([{ type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' }]);
    expect(out.turn.sent.engine).toBe('nano');
    expect(out.turn.sent.sent).toBeNull();
    expect(out.turn.sent.routeLine).toMatch(/^Nano · on device/);
    expect(out.turn.sent.sim).toBe(false);
    expect(out.extraBytes).toBe(0);
    expect(coerceSurfacePlan(JSON.parse(out.turn.json)).ok).toBe(true);
  });

  it('a speaker proposes a music tile on the connected speaker', () => {
    const out = pointConnectFromIdentity({ identity: id({ kind: 'speaker', label: 'Marshall speaker' }), source: 'on-device' }, { sim: false, devices });
    expect(out.ok && out.turn.plan.tiles[0]).toMatchObject({ type: 'music', deviceId: 'speaker-1' });
  });

  it('a fan binds a connected switch — never a speaker', () => {
    const out = pointConnectFromIdentity({ identity: id({ kind: 'fan', label: 'Fan' }), source: 'on-device' }, { sim: false, devices: [...devices, fanPlug] });
    expect(out.ok && out.turn.plan.tiles[0]).toMatchObject({ type: 'switch', deviceId: 'plug-1' });
  });

  it('a WiZ of unknown kind is a lamp', () => {
    const out = pointConnectFromIdentity({ identity: id({ kind: 'other', brand: 'WiZ', label: 'WiZ light' }), source: 'on-device' }, { sim: false, devices });
    expect(out.ok && out.turn.plan.tiles[0].type).toBe('lamp');
  });

  it('a cloud answer records crop × sends and says sent', () => {
    const one = pointConnectFromIdentity({ identity: wiz, source: 'cloud' }, { sim: false, devices, cropBytes: 12_345, cloudSends: 1 });
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    expect(one.turn.sent.engine).toBe('gemini');
    expect(one.turn.sent.sent).toMatch(/photo crop/);
    expect(one.turn.sent.sent).toContain('12.1 KB');
    expect(one.turn.sent.routeLine).toMatch(/^Gemini · cloud/);
    expect(one.extraBytes).toBe(12_345);
    // Nano not ready: the hybrid call went to the cloud, then the twin did too.
    const two = pointConnectFromIdentity({ identity: wiz, source: 'cloud' }, { sim: false, devices, cropBytes: 1000, cloudSends: 2 });
    expect(two.ok && two.extraBytes).toBe(2000);
    expect(two.ok && two.turn.sent.sent).toMatch(/2×/);
  });
});

describe('pointConnectFromIdentity: no control it does not have', () => {
  it('nothing of that kind connected → says so, no proposal', () => {
    const out = pointConnectFromIdentity({ identity: id({ kind: 'fan', label: 'Fan' }), source: 'on-device' }, { sim: false, devices });
    expect(out).toEqual({ ok: false, message: 'I see a fan, but it isn’t connected here yet — try adding it as a device.' });
  });
  it('a non-WiZ lamp never binds the WiZ lamp', () => {
    const out = pointConnectFromIdentity({ identity: id({ kind: 'lamp', label: 'Floor lamp' }), source: 'on-device' }, { sim: false, devices });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toMatch(/isn’t connected here yet/);
  });
  it('a non-WiZ lamp whose label names the device binds it', () => {
    const out = pointConnectFromIdentity({ identity: id({ kind: 'lamp', label: 'desk lamp' }), source: 'on-device' }, { sim: false, devices });
    expect(out.ok && out.turn.plan.tiles[0]).toMatchObject({ deviceId: 'wiz-desk' });
  });
  it('no devices at all → not connected', () => {
    const out = pointConnectFromIdentity({ identity: wiz, source: 'on-device' }, { sim: false });
    expect(out.ok).toBe(false);
  });
});

describe('several candidates → one clarifying question', () => {
  const both = [desk, ceiling, speaker];
  it('asks which one, then binds the one she names', () => {
    const out = pointConnectFromIdentity({ identity: wiz, source: 'on-device' }, { sim: false, devices: both });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toBe('Which one — Desk lamp or Ceiling light?');
    expect(out.choices?.map((c) => c.id)).toEqual(['wiz-desk', 'wiz-ceiling']);
    const pick = pickPointChoice('the ceiling one', out.choices!);
    expect(pick?.id).toBe('wiz-ceiling');
    const again = pointConnectFromIdentity({ identity: wiz, source: 'on-device' }, { sim: false, devices: both, chosenId: pick!.id });
    expect(again.ok && again.turn.plan.tiles[0]).toMatchObject({ deviceId: 'wiz-ceiling' });
  });
  it('one already on the board → the other, no question', () => {
    const out = pointConnectFromIdentity({ identity: wiz, source: 'on-device' }, { sim: false, devices: both, onBoard: ['wiz-desk'] });
    expect(out.ok && out.turn.plan.tiles[0]).toMatchObject({ deviceId: 'wiz-ceiling' });
  });
  it('pickPointChoice: full label, distinctive word, or nothing', () => {
    expect(pickPointChoice('Desk lamp', [desk, ceiling])?.id).toBe('wiz-desk');
    expect(pickPointChoice('desk', [desk, ceiling])?.id).toBe('wiz-desk');
    expect(pickPointChoice('the lamp', [desk, ceiling])).toBeNull();
    expect(pickPointChoice('what is the weather', [desk, ceiling])).toBeNull();
  });
});

describe('pointConnectFromIdentity: unsure → say so, no proposal', () => {
  it('null (no model / nothing seen)', () => {
    expect(pointConnectFromIdentity(null, { sim: false, devices })).toEqual({ ok: false, message: POINT_UNSURE_MESSAGE });
  });
  it('confidence below 0.5', () => {
    const out = pointConnectFromIdentity({ identity: id({ kind: 'speaker', confidence: 0.4 }), source: 'cloud' }, { sim: false, cropBytes: 900, devices });
    expect(out).toEqual({ ok: false, message: POINT_UNSURE_MESSAGE });
  });
  it('an unknown kind is not guessed into a tile', () => {
    const out = pointConnectFromIdentity({ identity: id({ kind: 'other', label: 'Kettle' }), source: 'on-device' }, { sim: false, devices });
    expect(out.ok).toBe(false);
  });
  it('the message asks her to name it', () => {
    expect(POINT_UNSURE_MESSAGE).toBe('I couldn’t tell what you’re pointing at — try naming it.');
  });
});

describe('pointFailureReceipt', () => {
  it('no sends → nothing left', () => {
    expect(pointFailureReceipt({ cropBytes: 5000, cloudSends: 0 })).toEqual({ bytes: 0, line: 'Nano · on device — nothing left this device' });
  });
  it('sent with no answer → bytes recorded, "may have reached"', () => {
    const r = pointFailureReceipt({ cropBytes: 2048, cloudSends: 2, cloudAnswered: false });
    expect(r.bytes).toBe(4096);
    expect(r.line).toMatch(/may have reached Gemini — no answer came back/);
    expect(r.line).not.toMatch(/\bsent\b/);
  });
  it('a cloud answer (unusable) → firm "sent"', () => {
    const r = pointFailureReceipt({ cropBytes: 2048, cloudSends: 1, cloudAnswered: true });
    expect(r.bytes).toBe(2048);
    expect(r.line).toMatch(/2\.0 KB\) sent/);
  });
});

describe('sim point', () => {
  it('the scripted identity is a lamp that names the desk lamp, labelled SIM', () => {
    expect(SIM_POINT_IDENTITY.kind).not.toBe('speaker');
    const out = pointConnectFromIdentity({ identity: SIM_POINT_IDENTITY, source: 'on-device' }, { sim: true, devices: [desk, ceiling, speaker] });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.turn.plan.tiles[0]).toMatchObject({ type: 'lamp', deviceId: 'wiz-desk' });
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
