// The gimbal tile is a generated DeviceTile: its controls go through the same
// checked binding as the lamp and the speaker, its status line is only what
// the iPhone reported, and a press with no iPhone (or no stand) is refused.
import { describe, expect, it } from 'vitest';
import {
  bindingIntent, coerceControls, GIMBAL_DEVICE_ID, GIMBAL_NO_PHONE_REFUSAL, GIMBAL_NO_STAND_REFUSAL, pressIntent,
} from '../../src/canvas/controlSpec';
import { GIMBAL_NO_PHONE, gimbalPress, gimbalTileState } from '../../src/canvas/gimbalTile';
import { coerceSurfacePlan, expandPlan, type DeviceState, type SurfacePlan } from '../../src/canvas/surfacePlan';
import { gateMessages } from '../../src/canvas/gate';
import { CATALOG_SCHEMAS } from '../../src/canvas/catalogApi';
import { dropAbsentDevices } from '../../src/canvas/planTruth';

const docked: DeviceState = { cls: 'gimbal', on: false, brightness: 0 };
const noStand: DeviceState = { ...docked, unreachable: true };

const board = (controls?: unknown): SurfacePlan => {
  const r = coerceSurfacePlan({ kind: 'room', title: 'Desk', tiles: [{ type: 'gimbal', label: 'Stand', ...(controls ? { controls } : {}) }] });
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const components = (plan: SurfacePlan, gimbal = gimbalTileState(null, { paired: false })) => {
  const msgs = expandPlan(plan, 's1', {}, { gimbal });
  return { msgs, comps: (msgs[1] as { updateComponents: { components: Record<string, unknown>[] } }).updateComponents.components };
};

describe('gimbal tile through the validated binding', () => {
  it('a gimbalMode button gives { gimbal: { mode: "hands" } }', () => {
    expect(bindingIntent('gimbal', GIMBAL_DEVICE_ID, { gimbalMode: 'hands' }, docked)).toEqual({ gimbal: { mode: 'hands' } });
    const plan = board([{ kind: 'button', label: 'Follow my hands', intent: { gimbalMode: 'hands' } }]);
    const r = pressIntent(plan, { tile: 'gimbal-tile', control: 0 }, (id) => (id === GIMBAL_DEVICE_ID ? docked : undefined));
    expect(r).toMatchObject({ gimbal: { mode: 'hands' } });
    // A cue rides the same path; the wake-up is an allowed cue too (spec 5.5).
    expect(bindingIntent('gimbal', GIMBAL_DEVICE_ID, { gimbalCue: 'wakeup' }, docked)).toEqual({ gimbal: { cue: 'wakeup' } });
    expect(gimbalPress('gimbal.cue', 'wakeup')).toEqual({ cue: 'wakeup' });
  });

  it('a gimbalCue of "spin" is dropped at coerce', () => {
    const r = coerceControls([
      { kind: 'button', label: 'Spin', intent: { gimbalCue: 'spin' } },
      { kind: 'button', label: 'Nod', intent: { gimbalCue: 'yes' } },
    ], 'gimbal');
    expect(r.dropped).toBe(1);
    expect(r.controls).toEqual([{ kind: 'button', label: 'Nod', intent: { gimbalCue: 'yes' } }]);
    const plan = coerceSurfacePlan({ kind: 'room', title: 'r', tiles: [{ type: 'gimbal', controls: [{ kind: 'button', label: 'Spin', intent: { gimbalCue: 'spin' } }] }] });
    expect(plan.ok && plan.notes).toContain("Dropped 1 control the stand can't use.");
    // Nothing valid left: the standard set, footnoted.
    expect(plan.ok && plan.value.tiles[0]).toEqual({ type: 'gimbal', label: 'Gimbal' });
  });

  it('a second gimbal leaf on one board is dropped with a note', () => {
    const plan = coerceSurfacePlan({ kind: 'room', title: 'r', tiles: [{ type: 'gimbal', label: 'One' }, { type: 'row', children: [{ type: 'gimbal', label: 'Two' }, { type: 'stat', label: 'T', value: '1' }] }] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(JSON.stringify(plan.value.tiles).match(/"type":"gimbal"/g)).toHaveLength(1);
    expect(plan.value.tiles[0]).toEqual({ type: 'gimbal', label: 'One' });
    expect(plan.notes).toContain('Dropped a second gimbal tile: there is one stand.');
  });

  it('with no iPhone paired the tile status is GIMBAL_NO_PHONE and a press is refused', () => {
    const plan = board();
    const { msgs, comps } = components(plan);
    expect(gateMessages(msgs, CATALOG_SCHEMAS).ok).toBe(true);
    const tile = comps.find((c) => c.id === 'gimbal-tile')!;
    expect(tile).toMatchObject({ component: 'DeviceTile', cls: 'gimbal', standard: true, status: { path: '/gimbal/status' } });
    expect(tile.deviceId).toBeUndefined();
    expect(msgs.at(-1)).toMatchObject({ updateDataModel: { path: '/gimbal', value: { docked: false, status: GIMBAL_NO_PHONE } } });
    // No iPhone: nothing reports the stand, so the getter has nothing.
    const none = pressIntent(plan, { tile: 'gimbal-tile', control: 0, option: 1 }, () => undefined);
    expect(none).toMatchObject({ refusal: GIMBAL_NO_PHONE_REFUSAL });
    expect(GIMBAL_NO_PHONE_REFUSAL).toMatch(/Nothing changed\.$/);
    // Paired, but no stand docked: refused too, never handed to the relay.
    const bare = pressIntent(plan, { tile: 'gimbal-tile', control: 1, option: 0 }, () => noStand);
    expect(bare).toMatchObject({ refusal: GIMBAL_NO_STAND_REFUSAL });
    expect(GIMBAL_NO_STAND_REFUSAL).toBe('No gimbal is docked. Nothing changed.');
    // A device of another class answering to the stand's id is not a stand.
    expect('refusal' in bindingIntent('gimbal', GIMBAL_DEVICE_ID, { gimbalMode: 'face' }, { cls: 'lamp', on: true, brightness: 50 })).toBe(true);
  });

  it('the tile status text comes only from the iPhone report', () => {
    // A model-written status (or any other field) never reaches the tile.
    const raw = coerceSurfacePlan({ kind: 'room', title: 'r', tiles: [{ type: 'gimbal', label: 'Stand', status: 'Tracking you', docked: true }] });
    expect(raw.ok && raw.value.tiles[0]).toEqual({ type: 'gimbal', label: 'Stand' });
    const plan = board();
    const tracking = gimbalTileState({ gimbal: 'tracking', sensor: false, hands: false, canPoint: true });
    const { msgs, comps } = components(plan, tracking);
    const tile = comps.find((c) => c.id === 'gimbal-tile')!;
    // Bound to the data model, never a literal.
    expect(tile.status).toEqual({ path: '/gimbal/status' });
    expect(tile.mode).toEqual({ path: '/gimbal/mode' });
    expect(msgs.at(-1)).toMatchObject({ updateDataModel: { path: '/gimbal', value: { docked: true, mode: 'face', status: 'Tracking you' } } });
    // With no report at all the tile says so; it never claims a state.
    const unknown = expandPlan(plan, 's1', {});
    expect(unknown.at(-1)).toMatchObject({ updateDataModel: { path: '/gimbal', value: { docked: false, status: 'No stand docked' } } });
  });

  it('a proposed gimbal tile with no iPhone paired is left out at review', () => {
    const plan = board();
    expect(dropAbsentDevices(plan, () => undefined).dropped).toBe(1);
    expect(dropAbsentDevices(plan, (id) => (id === GIMBAL_DEVICE_ID ? noStand : undefined)).dropped).toBe(0);
  });

  it('a switch leaf renders as a DeviceTile with cls "switch"', () => {
    const r = coerceSurfacePlan({ kind: 'room', title: 'r', tiles: [{ type: 'switch', deviceId: 'plug-1', label: 'Fan' }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const msgs = expandPlan(r.value, 's1', { 'plug-1': { cls: 'switch', on: true, brightness: 0 } });
    expect(gateMessages(msgs, CATALOG_SCHEMAS).ok).toBe(true);
    const comps = (msgs[1] as { updateComponents: { components: Record<string, unknown>[] } }).updateComponents.components;
    expect(comps.find((c) => c.id === 'switch-plug-1')).toMatchObject({ component: 'DeviceTile', cls: 'switch', deviceId: 'plug-1', standard: true, on: { path: '/devices/plug-1/on' } });
    expect(bindingIntent('switch', 'plug-1', { on: 'toggle' }, { cls: 'switch', on: true, brightness: 0 })).toEqual({ intent: { deviceId: 'plug-1', on: false } });
  });
});
