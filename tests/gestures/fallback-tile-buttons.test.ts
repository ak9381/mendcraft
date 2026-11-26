// A2 tile catalog: hand-path tests for the fallback-render buttons (lamp,
// music, switch, scene, connect) — generic synthetic click reaches these
// exact listeners (handPointer.ts:293-320). Same fake-doc technique
// richWidgets.test.ts already uses for Table/Form/Visual tiles; those cover
// the Lit (widgets.ts) components separately, which need a real
// customElements/shadow-DOM host this suite's node environment doesn't have.
import { describe, expect, it, vi } from 'vitest';
import { reduceA2uiMessages, renderNodeToDom, type FallbackAction } from '../../src/canvas/fallbackRenderer';
import { coerceSurfacePlan, expandPlan } from '../../src/canvas/surfacePlan';

interface FakeEl {
  tagName: string;
  className: string;
  textContent: string;
  style: Record<string, string>;
  children: FakeEl[];
  listeners: Record<string, Array<(e: unknown) => void>>;
  attrs: Record<string, string>;
  setAttribute(name: string, value: string): void;
  appendChild(c: FakeEl): FakeEl;
  addEventListener(type: string, fn: (e: unknown) => void): void;
  fire(type: string, ev?: unknown): void;
}

function makeFakeDoc() {
  const create = (tag: string): FakeEl => {
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      style: {},
      children: [] as FakeEl[],
      listeners: {} as Record<string, Array<(e: unknown) => void>>,
      attrs: {} as Record<string, string>,
      setAttribute(name: string, value: string) { el.attrs[name] = value; },
      appendChild(c: FakeEl) { el.children.push(c); return c; },
      addEventListener(type: string, fn: (e: unknown) => void) { (el.listeners[type] ??= []).push(fn); },
      fire(type: string, ev?: unknown) { (el.listeners[type] ?? []).forEach((fn) => fn(ev ?? {})); },
    } as unknown as FakeEl;
    let text = '';
    Object.defineProperty(el, 'textContent', { get: () => text, set: (v: string) => { text = v; } });
    return el;
  };
  return { createElement: (tag: string) => create(tag) };
}

function findAll(el: FakeEl, pred: (e: FakeEl) => boolean): FakeEl[] {
  const out: FakeEl[] = [];
  if (pred(el)) out.push(el);
  for (const c of el.children) out.push(...findAll(c, pred));
  return out;
}
function button(el: FakeEl, text: string): FakeEl {
  return findAll(el, (e) => e.tagName === 'BUTTON' && e.textContent === text)[0];
}

/** A level control's − / + step button (the contract the gesture code clicks). */
function stepButton(el: FakeEl, level: string, dir: 'inc' | 'dec'): FakeEl {
  const control = findAll(el, (e) => e.attrs['data-level'] === level)[0];
  return findAll(control, (e) => e.tagName === 'BUTTON' && `data-level-${dir}` in e.attrs)[0];
}

function expandOne(tile: unknown) {
  const plan = coerceSurfacePlan({ kind: 'room', title: 'x', tiles: [tile] });
  if (!plan.ok) throw new Error(plan.error);
  const msgs = expandPlan(plan.value, 's1', {});
  const { trees } = reduceA2uiMessages(undefined, msgs);
  return trees.s1;
}
function renderTile(component: string, tile: unknown, onAction: (a: FallbackAction) => void) {
  const tree = expandOne(tile);
  const node = Object.values(tree.nodesById).find((n) => n.component === component)!;
  return renderNodeToDom(node, makeFakeDoc() as never, onAction) as unknown as FakeEl;
}

describe('fallback tile buttons: hand path (generic click dispatch)', () => {
  it('A2-001 pinch-tap on the lamp toggle fires lamp.toggle with its deviceId', () => {
    const onAction = vi.fn();
    const el = renderTile('LampTile', { type: 'lamp', deviceId: 'lamp-1', label: 'Desk Lamp' }, onAction);
    button(el, 'Turn on').fire('click');
    expect(onAction).toHaveBeenCalledTimes(1);
    const call = onAction.mock.calls[0][0] as FallbackAction;
    expect(call.name).toBe('lamp.toggle');
    expect(call.context?.deviceId).toBe('lamp-1');
  });

  it('A2-003 pinch-tap on Dimmer fires lamp.dimmer', () => {
    const onAction = vi.fn();
    const el = renderTile('LampTile', { type: 'lamp', deviceId: 'lamp-1', label: 'Desk Lamp' }, onAction);
    stepButton(el, 'brightness', 'dec').fire('click');
    expect((onAction.mock.calls[0][0] as FallbackAction).name).toBe('lamp.dimmer');
  });

  it('A2-004 pinch-tap on Brighter fires lamp.brighter', () => {
    const onAction = vi.fn();
    const el = renderTile('LampTile', { type: 'lamp', deviceId: 'lamp-1', label: 'Desk Lamp' }, onAction);
    stepButton(el, 'brightness', 'inc').fire('click');
    expect((onAction.mock.calls[0][0] as FallbackAction).name).toBe('lamp.brighter');
  });

  it('A2-002 two pinch-taps on the toggle in a row flip it twice (no debounce beyond the generic click path, but no stuck/garbled state either)', () => {
    const onAction = vi.fn();
    const el = renderTile('LampTile', { type: 'lamp', deviceId: 'lamp-1', label: 'Desk Lamp' }, onAction);
    const toggle = button(el, 'Turn on');
    toggle.fire('click');
    toggle.fire('click');
    expect(onAction).toHaveBeenCalledTimes(2);
    expect((onAction.mock.calls[0][0] as FallbackAction).name).toBe('lamp.toggle');
    expect((onAction.mock.calls[1][0] as FallbackAction).name).toBe('lamp.toggle');
  });

  it('A2-007 pinch-tap on play/pause fires music.playPause', () => {
    const onAction = vi.fn();
    const el = renderTile('MusicTile', { type: 'music', deviceId: 'music-1', label: 'HiFi' }, onAction);
    button(el, 'Play').fire('click');
    expect((onAction.mock.calls[0][0] as FallbackAction).name).toBe('music.playPause');
  });

  it('A2-008 pinch-tap on Softer fires music.softer', () => {
    const onAction = vi.fn();
    const el = renderTile('MusicTile', { type: 'music', deviceId: 'music-1', label: 'HiFi' }, onAction);
    stepButton(el, 'volume', 'dec').fire('click');
    expect((onAction.mock.calls[0][0] as FallbackAction).name).toBe('music.softer');
  });

  it('A2-009 pinch-tap on Louder fires music.louder', () => {
    const onAction = vi.fn();
    const el = renderTile('MusicTile', { type: 'music', deviceId: 'music-1', label: 'HiFi' }, onAction);
    stepButton(el, 'volume', 'inc').fire('click');
    expect((onAction.mock.calls[0][0] as FallbackAction).name).toBe('music.louder');
  });

  it('A2-010 pinch-tap on Next fires music.next', () => {
    const onAction = vi.fn();
    const el = renderTile('MusicTile', { type: 'music', deviceId: 'music-1', label: 'HiFi' }, onAction);
    button(el, 'Next').fire('click');
    expect((onAction.mock.calls[0][0] as FallbackAction).name).toBe('music.next');
  });

  it('A2-015 pinch-tap on the switch toggle fires switch.toggle', () => {
    const onAction = vi.fn();
    const el = renderTile('SwitchTile', { type: 'switch', deviceId: 'switch-1', label: 'Power Bar' }, onAction);
    button(el, 'Turn on').fire('click');
    expect((onAction.mock.calls[0][0] as FallbackAction).name).toBe('switch.toggle');
  });

  it('A2-016 pinch-tap on Activate fires scene.activate', () => {
    const onAction = vi.fn();
    const el = renderTile('SceneTile', { type: 'scene', sceneId: 'scene-1', label: 'Evening Relax' }, onAction);
    button(el, 'Activate').fire('click');
    const call = onAction.mock.calls[0][0] as FallbackAction;
    expect(call.name).toBe('scene.activate');
  });

  it('A2-014 pinch-tap on the connect tile fires its connect action', () => {
    const onAction = vi.fn();
    const el = renderTile('ConnectTile', { type: 'connect' }, onAction);
    button(el, 'Connect a device').fire('click');
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
