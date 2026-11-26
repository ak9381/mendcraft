// The generated device tile: one DeviceTile per lamp leaf, drawn from its
// approved controls; a press carries only indexes, and the intent is read
// from the approved plan.
import { describe, expect, it } from 'vitest';
import { reduceA2uiMessages, renderNodeToDom, type FallbackAction, type RenderNode } from '../../src/canvas/fallbackRenderer';
import { CATALOG_SCHEMAS } from '../../src/canvas/catalogApi';
import { gateMessages } from '../../src/canvas/gate';
import { expandPlan, type DeviceState, type SurfacePlan } from '../../src/canvas/surfacePlan';
import { NOT_CONNECTED_REFUSAL, pressIntent, standardControls } from '../../src/canvas/controlSpec';
import { levelStyles } from '../../src/canvas/widgets';

interface FakeEl {
  tagName: string; className: string; textContent: string; style: Record<string, string> & { setProperty?: unknown };
  children: FakeEl[]; attrs: Record<string, string>; listeners: Record<string, Array<(e: unknown) => void>>;
  setAttribute(n: string, v: string): void; appendChild(c: FakeEl): FakeEl; addEventListener(t: string, f: (e: unknown) => void): void;
  fire(t: string): void;
}
function fakeDoc(): Document {
  const create = (tag: string): FakeEl => {
    let text = '';
    const el = {
      tagName: tag.toUpperCase(), className: '', style: {}, children: [] as FakeEl[], attrs: {} as Record<string, string>, listeners: {} as FakeEl['listeners'],
      setAttribute(n: string, v: string) { el.attrs[n] = v; },
      appendChild(c: FakeEl) { el.children.push(c); return c; },
      addEventListener(t: string, f: (e: unknown) => void) { (el.listeners[t] ??= []).push(f); },
      fire(t: string) { (el.listeners[t] ?? []).forEach((f) => f({})); },
    } as unknown as FakeEl;
    Object.defineProperty(el, 'textContent', { get: () => text, set: (v: string) => { text = v; } });
    return el;
  };
  return { createElement: create } as unknown as Document;
}
const all = (el: FakeEl, pred: (e: FakeEl) => boolean): FakeEl[] => [...(pred(el) ? [el] : []), ...el.children.flatMap((c) => all(c, pred))];
const textOf = (el: FakeEl): string => [el.textContent, ...el.children.map(textOf)].join(' ');

const ID = 'wiz-lamp-1';
const TILE = `lamp-${ID}`;
const GEN: SurfacePlan = {
  kind: 'room', title: 'Desk', tiles: [{
    type: 'lamp', deviceId: ID, label: 'Lamp', controls: [
      { kind: 'toggle', label: 'Power', intent: { on: 'toggle' } },
      { kind: 'slider', label: 'Brightness', key: 'brightness' },
      { kind: 'chips', label: 'Scenes', options: [{ label: 'Relax', intent: { sceneId: 16 } }, { label: 'Focus', intent: { sceneId: 15 } }, { label: 'Cozy', intent: { sceneId: 6 } }] },
    ],
  }],
};
const ON: Record<string, DeviceState> = { [ID]: { on: true, brightness: 50, sim: true, unreachable: false } };

function tileNode(plan: SurfacePlan, devices: Record<string, DeviceState>): RenderNode {
  const { trees } = reduceA2uiMessages(undefined, expandPlan(plan, 'f1', devices, { heading: false }) as never);
  return Object.values(trees.f1.nodesById).find((n) => n.component === 'DeviceTile')!;
}

describe('DeviceTile', () => {
  it('expandPlan emits one DeviceTile for a lamp leaf and the gate accepts it', () => {
    const msgs = expandPlan(GEN, 'f1', ON);
    const comps = (msgs[1] as { updateComponents: { components: { component: string }[] } }).updateComponents.components;
    expect(comps.filter((c) => c.component === 'DeviceTile')).toHaveLength(1);
    expect(comps.some((c) => c.component === 'LampTile')).toBe(false);
    const g = gateMessages(msgs, CATALOG_SCHEMAS);
    expect(g.ok).toBe(true);
    expect(comps.find((c) => c.component === 'DeviceTile')).toMatchObject({ cls: 'lamp', deviceId: ID, standard: false, controls: GEN.tiles[0].type === 'lamp' ? GEN.tiles[0].controls : [] });
  });

  it('a lamp leaf with no controls expands with standardControls and standard: true', () => {
    const plain: SurfacePlan = { kind: 'room', title: 'r', tiles: [{ type: 'lamp', deviceId: ID, label: 'Lamp' }] };
    const msgs = expandPlan(plain, 'f1', ON);
    expect(gateMessages(msgs, CATALOG_SCHEMAS).ok).toBe(true);
    const node = tileNode(plain, ON);
    expect(node.props.standard).toBe(true);
    expect(node.props.controls).toEqual(standardControls('lamp'));
    const el = renderNodeToDom(node, fakeDoc()) as unknown as FakeEl;
    expect(textOf(el)).toContain('Standard controls');
  });

  it('the gate refuses a DeviceTile with a control outside the schema', () => {
    const msgs = expandPlan(GEN, 'f1', ON) as Array<Record<string, unknown>>;
    const uc = msgs[1].updateComponents as { components: Array<Record<string, unknown>> };
    const tile = uc.components.find((c) => c.component === 'DeviceTile')!;
    tile.controls = [{ kind: 'slider', label: 'Brightness', key: 'brightness', min: 0, max: 900 }];
    expect(gateMessages(msgs as never, CATALOG_SCHEMAS).ok).toBe(false);
  });

  it('fallback renderer draws a button per control and fires device.act with tile and control indexes only', () => {
    const fired: FallbackAction[] = [];
    const el = renderNodeToDom(tileNode(GEN, ON), fakeDoc(), (a) => fired.push(a)) as unknown as FakeEl;
    const buttons = all(el, (e) => e.tagName === 'BUTTON');
    // toggle (1) + slider − / + (2) + three chips (3)
    expect(buttons).toHaveLength(6);
    for (const b of buttons) b.fire('click');
    expect(fired.every((a) => a.name === 'device.act')).toBe(true);
    expect(fired.map((a) => a.context)).toEqual([
      { deviceId: ID, tile: TILE, control: 0 },
      { deviceId: ID, tile: TILE, control: 1, option: 0 },
      { deviceId: ID, tile: TILE, control: 1, option: 1 },
      { deviceId: ID, tile: TILE, control: 2, option: 0 },
      { deviceId: ID, tile: TILE, control: 2, option: 1 },
      { deviceId: ID, tile: TILE, control: 2, option: 2 },
    ]);
    // No intent ever rides in the event.
    expect(JSON.stringify(fired)).not.toMatch(/intent|sceneId|brightness/);
    // The slider keeps the level-control contract the gesture code clicks.
    expect(all(el, (e) => e.attrs['data-level'] === 'brightness')).toHaveLength(1);
    expect(all(el, (e) => 'data-level-inc' in e.attrs)).toHaveLength(1);
  });

  it('the handler reads the intent from the approved plan, not from the event', () => {
    const get = (id: string) => ON[id];
    const forged = { deviceId: 'wiz-lamp-9', tile: TILE, control: 2, option: 0, intent: { brightness: 100 }, sceneId: 4 };
    expect(pressIntent(GEN, forged, get)).toEqual({ intent: { deviceId: ID, on: true, sceneId: 16 }, deviceId: ID });
    // A chip index past the approved options, or a control that is not there: refused.
    expect('refusal' in pressIntent(GEN, { tile: TILE, control: 2, option: 3 }, get)).toBe(true);
    expect('refusal' in pressIntent(GEN, { tile: TILE, control: 9 }, get)).toBe(true);
    expect('refusal' in pressIntent(GEN, { tile: TILE, control: '0' }, get)).toBe(true);
    // A slider press: + is one step, a level set must be a finite number.
    expect(pressIntent(GEN, { tile: TILE, control: 1, option: 1 }, get)).toEqual({ intent: { deviceId: ID, brightness: 60 }, deviceId: ID });
    expect('refusal' in pressIntent(GEN, { tile: TILE, control: 1, value: Number.NaN }, get)).toBe(true);
  });

  it('an unreachable lamp shows "Not connected" and its press is refused', () => {
    const away: Record<string, DeviceState> = { [ID]: { on: false, brightness: 50, unreachable: true } };
    for (const devices of [away, {}]) {
      const el = renderNodeToDom(tileNode(GEN, devices), fakeDoc()) as unknown as FakeEl;
      expect(textOf(el)).toContain('Not connected');
      expect(pressIntent(GEN, { tile: TILE, control: 0 }, (id) => devices[id])).toEqual({ refusal: NOT_CONNECTED_REFUSAL, deviceId: ID });
    }
  });

  it('controls are hand-sized: every button is at least 56 px tall', () => {
    expect(levelStyles.cssText).toMatch(/button \{[^}]*min-height: 56px/);
  });
});
