import { describe, expect, it, vi } from 'vitest';
import { reduceA2uiMessages, renderNodeToDom, type FallbackAction, type RenderNode } from '../../src/canvas/fallbackRenderer';
import { coerceSurfacePlan, expandPlan } from '../../src/canvas/surfacePlan';

interface FakeEl {
  tagName: string;
  className: string;
  textContent: string;
  style: Record<string, string>;
  dataset: Record<string, string>;
  hidden: boolean;
  disabled: boolean;
  attrs: Record<string, string>;
  children: FakeEl[];
  listeners: Record<string, Array<(e: unknown) => void>>;
  classList: { toggle(c: string, on?: boolean): void; add(c: string): void; contains(c: string): boolean; _set: Set<string> };
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
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
      dataset: {},
      hidden: false,
      disabled: false,
      attrs: {} as Record<string, string>,
      children: [] as FakeEl[],
      listeners: {} as Record<string, Array<(e: unknown) => void>>,
      classList: {
        _set: new Set<string>(),
        toggle(c: string, on?: boolean) { if (on === false) this._set.delete(c); else if (on === true) this._set.add(c); else (this._set.has(c) ? this._set.delete(c) : this._set.add(c)); },
        add(c: string) { this._set.add(c); },
        contains(c: string) { return this._set.has(c); },
      },
      setAttribute(name: string, value: string) {
        el.attrs[name] = value;
        if (name === 'class') el.className = value; // real DOM keeps these in sync
      },
      getAttribute(name: string) { return name in el.attrs ? el.attrs[name] : null; },
      appendChild(c: FakeEl) { el.children.push(c); return c; },
      addEventListener(type: string, fn: (e: unknown) => void) { (el.listeners[type] ??= []).push(fn); },
      fire(type: string, ev?: unknown) { (el.listeners[type] ?? []).forEach((fn) => fn(ev ?? {})); },
    } as unknown as FakeEl;
    let text = '';
    Object.defineProperty(el, 'textContent', {
      get: () => text,
      // Real DOM: assigning textContent removes every existing child first.
      set: (v: string) => { text = v; el.children.length = 0; },
    });
    return el;
  };
  return {
    createElement: (tag: string) => create(tag),
    createElementNS: (_ns: string, tag: string) => create(tag),
    createTextNode: (text: string) => ({ nodeType: 3, textContent: text }),
  };
}

function findOne(el: FakeEl, pred: (e: FakeEl) => boolean): FakeEl | null {
  if (pred(el)) return el;
  for (const c of el.children) {
    const found = findOne(c, pred);
    if (found) return found;
  }
  return null;
}
function findAll(el: FakeEl, pred: (e: FakeEl) => boolean): FakeEl[] {
  const out: FakeEl[] = [];
  if (pred(el)) out.push(el);
  for (const c of el.children) out.push(...findAll(c, pred));
  return out;
}

function expandOne(tile: unknown) {
  const plan = coerceSurfacePlan({ kind: 'room', title: 'x', tiles: [tile] });
  if (!plan.ok) throw new Error(plan.error);
  const msgs = expandPlan(plan.value, 's1', {});
  const { trees } = reduceA2uiMessages(undefined, msgs);
  return trees.s1;
}

describe('fallback rendering: nested layouts', () => {
  it('Row renders a flex row wrapping its children', () => {
    const tree = expandOne({ type: 'row', children: [{ type: 'stat', label: 'A', value: '1' }, { type: 'stat', label: 'B', value: '2' }] });
    const node = Object.values(tree.nodesById).find((n) => n.component === 'Row')!;
    const doc = makeFakeDoc();
    const el = renderNodeToDom(node, doc as never, undefined) as unknown as FakeEl;
    expect(el.className).toContain('mc-fb-row');
    expect(el.style.display).toBe('flex');
    expect(findAll(el, (e) => e.className.includes('stat')).length).toBe(2);
  });

  it('Grid renders the configured column count', () => {
    const tree = expandOne({ type: 'grid', columns: 3, children: [{ type: 'stat', label: 'A', value: '1' }] });
    const node = Object.values(tree.nodesById).find((n) => n.component === 'Grid')!;
    const doc = makeFakeDoc();
    const el = renderNodeToDom(node, doc as never, undefined) as unknown as FakeEl;
    expect(el.className).toContain('mc-fb-grid-3');
    expect(el.style.gridTemplateColumns).toBe('repeat(3, 1fr)');
  });

  it('Card renders a title and wraps its children', () => {
    const tree = expandOne({ type: 'card', title: 'Thermostat', children: [{ type: 'stat', label: 'Temp', value: '70' }] });
    const node = Object.values(tree.nodesById).find((n) => n.component === 'Card')!;
    const doc = makeFakeDoc();
    const el = renderNodeToDom(node, doc as never, undefined) as unknown as FakeEl;
    const title = findOne(el, (e) => e.className === 'mc-fb-card-title');
    expect(title?.textContent).toBe('Thermostat');
  });

  it('Tabs renders real tab buttons; only the active panel is visible, switching hides/shows on click', () => {
    const tree = expandOne({
      type: 'tabs',
      tabs: [
        { label: 'Overview', children: [{ type: 'stat', label: 'A', value: '1' }] },
        { label: 'Settings', children: [{ type: 'stat', label: 'B', value: '2' }] },
      ],
    });
    const node = Object.values(tree.nodesById).find((n) => n.component === 'Tabs')!;
    const doc = makeFakeDoc();
    const el = renderNodeToDom(node, doc as never, undefined) as unknown as FakeEl;
    const buttons = findAll(el, (e) => e.tagName === 'BUTTON');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].attrs.role).toBe('tab');
    const panels = findAll(el, (e) => e.className === 'mc-fb-tab-panel');
    expect(panels).toHaveLength(2);
    expect(panels[0].hidden).toBe(false);
    expect(panels[1].hidden).toBe(true);

    buttons[1].fire('click');
    expect(panels[0].hidden).toBe(true);
    expect(panels[1].hidden).toBe(false);
    expect(buttons[1].attrs['aria-selected']).toBe('true');
  });

  it('Split places the right children in each pane', () => {
    const tree = expandOne({
      type: 'split',
      direction: 'row',
      first: [{ type: 'stat', label: 'Left', value: '1' }],
      second: [{ type: 'stat', label: 'Right', value: '2' }, { type: 'stat', label: 'Right2', value: '3' }],
    });
    const node = Object.values(tree.nodesById).find((n) => n.component === 'Split')!;
    const doc = makeFakeDoc();
    const el = renderNodeToDom(node, doc as never, undefined) as unknown as FakeEl;
    const panes = el.children.filter((c) => c.className.includes('mc-fb-split-pane'));
    expect(panes).toHaveLength(2);
    expect(findAll(panes[0], (e) => e.className.includes('stat'))).toHaveLength(1);
    expect(findAll(panes[1], (e) => e.className.includes('stat'))).toHaveLength(2);
  });
});

describe('fallback rendering: new widgets', () => {
  it('StatTile shows label/value/delta and a sparkline when given points', () => {
    const tree = expandOne({ type: 'stat', label: 'Power', value: '1.2 kW', delta: '+4%', trend: 'up', spark: [1, 2, 1, 3] });
    const node = Object.values(tree.nodesById).find((n) => n.component === 'StatTile')!;
    const doc = makeFakeDoc();
    const el = renderNodeToDom(node, doc as never, undefined) as unknown as FakeEl;
    expect(findOne(el, (e) => e.className === 'label')?.textContent).toBe('Power');
    expect(findOne(el, (e) => e.className === 'value')?.textContent).toBe('1.2 kW');
    expect(findOne(el, (e) => e.className === 'delta')?.textContent).toContain('+4%');
    expect(findOne(el, (e) => e.className === 'sparkline')).toBeTruthy();
  });

  it('ChartTile renders one bar per series point with an accessible label', () => {
    const tree = expandOne({ type: 'chart', title: 'Usage', chartType: 'bar', series: [{ label: 'Mon', value: 3 }, { label: 'Tue', value: 5 }] });
    const node = Object.values(tree.nodesById).find((n) => n.component === 'ChartTile')!;
    const doc = makeFakeDoc();
    const el = renderNodeToDom(node, doc as never, undefined) as unknown as FakeEl;
    const rects = findAll(el, (e) => e.tagName === 'RECT');
    expect(rects).toHaveLength(2);
    const svg = findOne(el, (e) => e.tagName === 'SVG');
    expect(svg?.attrs['aria-label']).toContain('Mon: 3');
  });

  it('TableTile sort button reorders rows; row action button dispatches with the row', () => {
    const onAction = vi.fn();
    const tree = expandOne({ type: 'table', title: 'Devices', columns: ['Name', 'Status'], rows: [['Lamp', 'On'], ['Fan', 'Off']], sortable: true, rowActionLabel: 'Open' });
    const node = Object.values(tree.nodesById).find((n) => n.component === 'TableTile')!;
    const doc = makeFakeDoc();
    const el = renderNodeToDom(node, doc as never, onAction) as unknown as FakeEl;

    const sortBtn = findOne(el, (e) => e.className === 'mc-fb-sort-btn');
    expect(sortBtn).toBeTruthy();
    let rows = findAll(el, (e) => e.tagName === 'TR').filter((r) => findAll(r, (c) => c.tagName === 'TD').length > 0);
    expect(rows[0].children[0].textContent).toBe('Lamp');
    sortBtn!.fire('click');
    rows = findAll(el, (e) => e.tagName === 'TR').filter((r) => findAll(r, (c) => c.tagName === 'TD').length > 0);
    expect(rows[0].children[0].textContent).toBe('Fan'); // 'Fan' < 'Lamp' ascending

    const actionBtns = findAll(el, (e) => e.tagName === 'BUTTON' && e.textContent === 'Open');
    expect(actionBtns.length).toBeGreaterThan(0);
    actionBtns[0].fire('click');
    expect(onAction).toHaveBeenCalledTimes(1);
    const call = onAction.mock.calls[0][0] as FallbackAction;
    expect(call.name).toBe('table.rowAction');
    expect(call.context?.row).toBeTruthy();
  });

  it('FormTile renders a real checkbox, a discrete level control (no slider) and choice buttons, and submits current values', () => {
    const onAction = vi.fn();
    const tree = expandOne({
      type: 'form',
      title: 'Settings',
      submitLabel: 'Apply',
      fields: [
        { kind: 'toggle', id: 'eco', label: 'Eco mode', value: false },
        { kind: 'slider', id: 'temp', label: 'Temp', value: 70, min: 60, max: 80 },
        { kind: 'choice', id: 'mode', label: 'Mode', options: ['Auto', 'Manual'], value: 'Auto' },
      ],
    });
    const node = Object.values(tree.nodesById).find((n) => n.component === 'FormTile')!;
    const doc = makeFakeDoc();
    const el = renderNodeToDom(node, doc as never, onAction) as unknown as FakeEl;

    const checkbox = findOne(el, (e) => e.attrs.type === 'checkbox');
    expect(checkbox).toBeTruthy();
    expect(findOne(el, (e) => e.attrs.type === 'range')).toBeFalsy();
    const level = findOne(el, (e) => e.attrs['data-level'] === 'value');
    expect(level?.attrs['aria-valuemin']).toBe('60');
    expect(level?.attrs['aria-valuemax']).toBe('80');
    const presets = findAll(level!, (e) => e.className === 'mc-fb-preset');
    expect(presets.map((b) => b.textContent)).toEqual(['60', '65', '70', '75', '80']);
    const choiceBtns = findAll(el, (e) => e.className.includes('mc-fb-choice'));
    expect(choiceBtns).toHaveLength(2);

    checkbox!.fire('change', { target: { checked: true } });
    presets[3].fire('click');
    choiceBtns[1].fire('click');

    const submitBtn = findOne(el, (e) => e.className === 'primary');
    submitBtn!.fire('click');
    expect(onAction).toHaveBeenCalledTimes(1);
    const call = onAction.mock.calls[0][0] as FallbackAction;
    expect(call.name).toBe('form.submit');
    expect(call.context?.values).toMatchObject({ eco: true, temp: 75, mode: 'Manual' });
  });

  it('VisualTile mounts sanitized markup and wires a data-action element to the action bus', () => {
    const onAction = vi.fn();
    const tree = expandOne({
      type: 'visual',
      title: 'Room map',
      markup: '<svg><script>evil()</script><rect data-action="toggle-lamp" data-label="Toggle the lamp" width="10" height="10"/></svg>',
    });
    const node = Object.values(tree.nodesById).find((n) => n.component === 'VisualTile')!;
    const doc = makeFakeDoc();
    const el = renderNodeToDom(node, doc as never, onAction) as unknown as FakeEl;

    expect(findOne(el, (e) => e.tagName === 'SCRIPT')).toBeNull();
    const rect = findOne(el, (e) => e.tagName === 'RECT');
    expect(rect?.attrs.role).toBe('button');
    expect(rect?.attrs['aria-label']).toBe('Toggle the lamp');

    rect!.fire('click');
    expect(onAction).toHaveBeenCalledTimes(1);
    const call = onAction.mock.calls[0][0] as FallbackAction;
    expect(call.name).toBe('visual.action');
    expect(call.context?.action).toBe('toggle-lamp');
    expect(call.context?.label).toBe('Toggle the lamp');
  });
});
