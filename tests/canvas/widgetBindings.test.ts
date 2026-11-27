// Visual and form widgets can drive devices through the same checked binding
// as a device tile: checked at coerce against the device's class, looked up
// in the APPROVED plan at press, resolved by bindingIntent. A table row's
// button still only speaks.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  coerceBinding, formIntents, NOT_CONNECTED_REFUSAL, planHasBindings, visualPress,
} from '../../src/canvas/controlSpec';
import { coerceSurfacePlan, expandPlan, tileComponentId, type DeviceState, type SurfacePlan } from '../../src/canvas/surfacePlan';
import { gateMessages } from '../../src/canvas/gate';
import { CATALOG_SCHEMAS } from '../../src/canvas/catalogApi';
import type { DeviceClass } from '../../src/canvas/deviceGuard';

const LAMP = 'wiz-lamp-1';
const SPEAKER = 'speaker-sim';
const classes: Record<string, DeviceClass> = { [LAMP]: 'lamp', [SPEAKER]: 'music' };
const clsOf = (id: string): DeviceClass | null => classes[id] ?? null;
const devices: Record<string, DeviceState> = {
  [LAMP]: { cls: 'lamp', on: true, brightness: 40 },
  [SPEAKER]: { cls: 'music', on: false, brightness: 0, playing: false, volume: 30 },
};
const get = (id: string) => devices[id];

const MARKUP = '<svg viewBox="0 0 10 10"><rect data-action="lamp-on" data-label="Lamp on" width="5" height="5"/><rect data-action="wave" data-label="Wave" x="5" width="5" height="5"/></svg>';
function visualPlan(actions: unknown, o: { clsOf?: typeof clsOf } = { clsOf }): SurfacePlan {
  const r = coerceSurfacePlan({ kind: 'room', title: 'Room', tiles: [{ type: 'visual', title: 'Room map', markup: MARKUP, actions }] }, o);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
const visualId = (p: SurfacePlan) => tileComponentId(p.tiles[0], [0]);

describe('visual actions', () => {
  it('a visual data-action key found in the approved actions runs its binding; an unknown key only speaks its label', () => {
    const plan = visualPlan({ 'lamp-on': { deviceId: LAMP, intent: { on: false } } });
    expect(planHasBindings(plan)).toBe(true);
    expect(visualPress(plan, visualId(plan), 'lamp-on', get)).toEqual({ intent: { deviceId: LAMP, on: false }, deviceId: LAMP });
    // Not bound in the approved plan: null, and the caller only speaks the label.
    expect(visualPress(plan, visualId(plan), 'wave', get)).toBeNull();
    expect(visualPress(plan, visualId(plan), 'constructor', get)).toBeNull();
    expect(visualPress(plan, 'visual-9', 'lamp-on', get)).toBeNull();
    // A device that went away is refused, never guessed.
    expect(visualPress(plan, visualId(plan), 'lamp-on', () => undefined)).toEqual({ refusal: NOT_CONNECTED_REFUSAL, deviceId: LAMP });
    // The rendered component carries no binding: the press reads the approved plan.
    const msgs = expandPlan(plan, 'f1', devices);
    expect(gateMessages(msgs, CATALOG_SCHEMAS).ok).toBe(true);
    expect(JSON.stringify(msgs)).not.toContain('"actions"');
    const app = readFileSync('src/canvas/canvasApp.ts', 'utf8');
    expect(app).toMatch(/const bound = visualPress\(surfaces\[fid\], a\.context\?\.visualId, action, deviceOrStand\);\s*if \(bound\) \{ applyPress\(bound\); return; \}\s*say\(label/);
  });

  it('a visual action whose intent is outside the device class is dropped at coerce', () => {
    const r = coerceSurfacePlan({ kind: 'room', title: 'Room', tiles: [{ type: 'visual', title: 'Room map', markup: MARKUP, actions: {
      'lamp-on': { deviceId: LAMP, intent: { on: true } },
      louder: { deviceId: LAMP, intent: { volume: 80 } }, // a lamp has no volume
      blast: { deviceId: LAMP, intent: { brightness: 500 } }, // out of range
      ghost: { deviceId: 'wiz-lamp-9', intent: { on: true } }, // not a device here
      'Bad Key': { deviceId: LAMP, intent: { on: true } },
    } }] }, { clsOf });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.value.tiles[0] as { actions?: Record<string, unknown> }).actions).toEqual({ 'lamp-on': { deviceId: LAMP, intent: { on: true } } });
    expect(r.notes).toEqual(["Dropped 4 visual actions a device can't do."]);
    expect(coerceBinding({ deviceId: SPEAKER, intent: { brightness: 50 } }, clsOf)).toBeNull();
    expect(coerceBinding({ deviceId: SPEAKER, intent: { volume: '$value' } }, clsOf)).toBeNull(); // a visual press has no level
    expect(coerceBinding({ deviceId: SPEAKER, intent: { playing: 'toggle' } }, clsOf)).toEqual({ deviceId: SPEAKER, intent: { playing: 'toggle' } });
    // At most 8 actions.
    const many = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`a${i}`, { deviceId: LAMP, intent: { on: true } }]));
    expect(Object.keys((visualPlan(many).tiles[0] as { actions: object }).actions)).toHaveLength(8);
  });
});

describe('form binds', () => {
  const form = (fields: unknown[]): SurfacePlan => {
    const r = coerceSurfacePlan({ kind: 'room', title: 'Room', tiles: [{ type: 'form', title: 'Evening', submitLabel: 'Set', fields }] }, { clsOf });
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  const formId = (p: SurfacePlan) => tileComponentId(p.tiles[0], [0]);

  it('form submit sends one intent per bound field and refuses an out-of-range value without sending the others', () => {
    const plan = form([
      { kind: 'toggle', id: 'power', label: 'Lamp', value: true, bind: { deviceId: LAMP, key: 'on' } },
      { kind: 'slider', id: 'level', label: 'Brightness', value: 60, min: 0, max: 500, bind: { deviceId: LAMP, key: 'brightness' } },
      { kind: 'slider', id: 'vol', label: 'Volume', value: 20, bind: { deviceId: SPEAKER, key: 'volume' } },
      { kind: 'choice', id: 'mood', label: 'Mood', options: ['Calm', 'Bright'] },
    ]);
    expect(formIntents(plan, formId(plan), { power: true, level: 70, vol: 25 }, get)).toEqual({ intents: [
      { deviceId: LAMP, on: true }, { deviceId: LAMP, brightness: 70 }, { deviceId: SPEAKER, volume: 25 },
    ] });
    // 450 % is out of range: nothing is sent, not even the fields before it.
    const r = formIntents(plan, formId(plan), { power: true, level: 450, vol: 25 }, get);
    expect(r && 'refusal' in r && r.refusal).toMatch(/Nothing changed\.$/);
    expect(r && 'intents' in r).toBe(false);
    // Power on first, then a brightness: checked in order, so the lamp being off now is no refusal.
    const offGet = (id: string) => (id === LAMP ? { ...devices[LAMP], on: false } : devices[id]);
    expect(formIntents(plan, formId(plan), { power: true, level: 50, vol: 10 }, offGet)).toEqual({ intents: [
      { deviceId: LAMP, on: true }, { deviceId: LAMP, brightness: 50 }, { deviceId: SPEAKER, volume: 10 },
    ] });
    // A form that binds nothing: null (the caller only says "Form submitted.").
    const plain = form([{ kind: 'toggle', id: 'x', label: 'X' }]);
    expect(formIntents(plain, formId(plain), { x: true }, get)).toBeNull();
    // The rendered form carries no bind (the gate's strict schema passes).
    const msgs = expandPlan(plan, 'f1', devices);
    expect(gateMessages(msgs, CATALOG_SCHEMAS).ok).toBe(true);
    expect(JSON.stringify(msgs)).not.toContain('"bind"');
  });

  it('a bind the device or the field cannot take is dropped at coerce', () => {
    const r = coerceSurfacePlan({ kind: 'room', title: 'Room', tiles: [{ type: 'form', title: 'F', submitLabel: 'Go', fields: [
      { kind: 'slider', id: 'a', label: 'A', bind: { deviceId: LAMP, key: 'volume' } }, // a lamp has no volume
      { kind: 'toggle', id: 'b', label: 'B', bind: { deviceId: LAMP, key: 'brightness' } }, // a toggle is on/off
      { kind: 'choice', id: 'c', label: 'C', options: ['x'], bind: { deviceId: LAMP, key: 'on' } }, // a choice drives nothing
      { kind: 'slider', id: 'd', label: 'D', bind: { deviceId: SPEAKER, key: 'volume' } },
    ] }] }, { clsOf });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const fields = (r.value.tiles[0] as { fields: { id: string; bind?: unknown }[] }).fields;
    expect(fields.map((f) => [f.id, !!f.bind])).toEqual([['a', false], ['b', false], ['c', false], ['d', true]]);
    expect(r.notes).toEqual(["Dropped 3 form links to a device that can't do that."]);
  });
});

describe('table rows', () => {
  it('table.rowAction still only speaks', () => {
    const app = readFileSync('src/canvas/canvasApp.ts', 'utf8');
    const at = app.indexOf("if (a.name === 'table.rowAction') {");
    const body = app.slice(at, app.indexOf('return;', at));
    expect(body).toContain('say(row ?');
    expect(body).not.toMatch(/act\(|applyPress|bindingIntent|formIntents|visualPress/);
  });
});
