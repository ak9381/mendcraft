// Round 2: A2 widget-tile hand-path tests. Same fake-doc + renderNodeToDom
// technique as fallback-tile-buttons.test.ts, extended to FormTile's
// checkbox/slider/choice/submit controls, TableTile's sort/row-action
// buttons, and Tabs — the generic synthetic click/input/change dispatch
// (handPointer.ts) reaches the exact same listeners wired here.
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
  hidden: boolean;
  classList: { add(c: string): void; remove(c: string): void; toggle(c: string, on?: boolean): void; contains(c: string): boolean };
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  appendChild(c: FakeEl): FakeEl;
  addEventListener(type: string, fn: (e: unknown) => void): void;
  fire(type: string, ev?: unknown): void;
}

function makeFakeDoc() {
  const create = (tag: string): FakeEl => {
    const classes = new Set<string>();
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      style: {},
      children: [] as FakeEl[],
      listeners: {} as Record<string, Array<(e: unknown) => void>>,
      attrs: {} as Record<string, string>,
      hidden: false,
      classList: {
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
        toggle: (c: string, on?: boolean) => { (on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c); },
        contains: (c: string) => classes.has(c),
      },
      setAttribute(name: string, value: string) { el.attrs[name] = value; },
      getAttribute(name: string) { return el.attrs[name] ?? null; },
      appendChild(c: FakeEl) { el.children.push(c); return c; },
      addEventListener(type: string, fn: (e: unknown) => void) { (el.listeners[type] ??= []).push(fn); },
      fire(type: string, ev?: unknown) { (el.listeners[type] ?? []).forEach((fn) => fn(ev ?? {})); },
    } as unknown as FakeEl;
    let text = '';
    // Real DOM: setting textContent removes all existing child nodes too.
    Object.defineProperty(el, 'textContent', { get: () => text, set: (v: string) => { text = v; el.children.length = 0; } });
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
function tag(el: FakeEl, t: string): FakeEl[] {
  return findAll(el, (e) => e.tagName === t.toUpperCase());
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

describe('A2-017 FormTile checkbox: pinch-tap-equivalent change event flips the value', () => {
  it('firing a change event with target.checked updates the submitted value (the path handPointer.ts click->native-change produces)', () => {
    const onAction = vi.fn();
    const el = renderTile('FormTile', {
      type: 'form', title: 'Prefs', submitLabel: 'Save',
      fields: [{ kind: 'toggle', id: 'notify', label: 'Notify me', value: false }],
    }, onAction);
    const checkbox = tag(el, 'input').find((i) => i.attrs.type === 'checkbox')!;
    expect(checkbox).toBeTruthy();
    checkbox.fire('change', { target: { checked: true } });
    button(el, 'Save').fire('click');
    expect(onAction).toHaveBeenCalledTimes(1);
    const call = onAction.mock.calls[0][0] as FallbackAction;
    expect(call.context?.values).toEqual({ notify: true });
  });
});

describe('A2-018 FormTile level field: no slider — step buttons and preset chips set the value', () => {
  it('one press on a step button or a preset chip updates the submitted value', () => {
    const onAction = vi.fn();
    const el = renderTile('FormTile', {
      type: 'form', title: 'Prefs', submitLabel: 'Save',
      fields: [{ kind: 'slider', id: 'vol', label: 'Volume', value: 10, min: 0, max: 100 }],
    }, onAction);
    // A hand cannot drag a slider: there is no range input any more.
    expect(tag(el, 'input').find((i) => i.attrs.type === 'range')).toBeUndefined();
    const level = findAll(el, (e) => e.attrs['data-level'] === 'value')[0];
    expect(level.attrs['aria-valuenow']).toBe('10');
    findAll(level, (e) => 'data-level-inc' in e.attrs)[0].fire('click'); // 10 → 20
    expect(level.attrs['aria-valuenow']).toBe('20');
    expect(findAll(level, (e) => 'data-level-readout' in e.attrs)[0].textContent).toBe('20');
    button(el, '75').fire('click'); // a preset chip
    button(el, 'Save').fire('click');
    const call = onAction.mock.calls[0][0] as FallbackAction;
    expect(call.context?.values).toEqual({ vol: 75 });
  });
});

describe('A2-021 FormTile choice buttons: pinch-tap selects an option', () => {
  it('clicking a choice button updates the submitted value to that option', () => {
    const onAction = vi.fn();
    const el = renderTile('FormTile', {
      type: 'form', title: 'Prefs', submitLabel: 'Save',
      fields: [{ kind: 'choice', id: 'size', label: 'Size', options: ['S', 'M', 'L'], value: 'S' }],
    }, onAction);
    button(el, 'L').fire('click');
    button(el, 'Save').fire('click');
    const call = onAction.mock.calls[0][0] as FallbackAction;
    expect(call.context?.values).toEqual({ size: 'L' });
  });
});

describe('A2-022 FormTile submit button: pinch-tap submits current values', () => {
  it('clicking Submit fires onSubmit with the current (default) values even with no edits', () => {
    const onAction = vi.fn();
    const el = renderTile('FormTile', {
      type: 'form', title: 'Prefs', submitLabel: 'Submit',
      fields: [{ kind: 'toggle', id: 'a', label: 'A', value: true }],
    }, onAction);
    button(el, 'Submit').fire('click');
    expect(onAction).toHaveBeenCalledTimes(1);
    expect((onAction.mock.calls[0][0] as FallbackAction).context?.values).toEqual({ a: true });
  });
});

describe('A2-023 TableTile sort header: pinch-tap re-sorts the rows in place', () => {
  it('clicking a sortable column header button re-sorts the rendered rows ascending then descending', () => {
    const onAction = vi.fn();
    const el = renderTile('TableTile', {
      type: 'table', title: 'People', columns: ['Name'], rows: [['Zed'], ['Amy'], ['Mia']], sortable: true,
    }, onAction);
    const sortBtn = findAll(el, (e) => e.tagName === 'BUTTON' && e.textContent === 'Name')[0];
    expect(sortBtn).toBeTruthy();
    sortBtn.fire('click');
    const table = tag(el, 'table')[0];
    const bodyRows = () => tag(table, 'tbody')[0].children;
    const firstCellText = () => tag(bodyRows()[0], 'td')[0].textContent;
    expect(firstCellText()).toBe('Amy');
    sortBtn.fire('click');
    expect(firstCellText()).toBe('Zed');
  });
});

describe('A2-024 TableTile row action button: pinch-tap fires the row action with that row', () => {
  it('clicking a row action button calls onRowAction with the correct row payload', () => {
    const onAction = vi.fn();
    const el = renderTile('TableTile', {
      type: 'table', title: 'People', columns: ['Name'], rows: [['Zed'], ['Amy']], rowActionLabel: 'Remove',
    }, onAction);
    const removeButtons = findAll(el, (e) => e.tagName === 'BUTTON' && e.textContent === 'Remove');
    expect(removeButtons.length).toBe(2);
    removeButtons[1].fire('click');
    expect(onAction).toHaveBeenCalledTimes(1);
    const call = onAction.mock.calls[0][0] as FallbackAction;
    expect(call.context?.rowIndex).toBe(1);
    expect(call.context?.row).toEqual(['Amy']);
  });
});

describe('A2-026 Tabs tile: pinch-tap on a tab button switches the active panel', () => {
  it('clicking the second tab hides the first panel and shows the second, flipping aria-selected', () => {
    const onAction = vi.fn();
    const el = renderTile('Tabs', {
      type: 'tabs',
      tabs: [
        { label: 'One', children: [{ type: 'stat', label: 'A', value: '1' }] },
        { label: 'Two', children: [{ type: 'stat', label: 'B', value: '2' }] },
      ],
    }, onAction);
    const tabButtons = findAll(el, (e) => e.tagName === 'BUTTON' && e.getAttribute('role') === 'tab');
    expect(tabButtons.map((b) => b.textContent)).toEqual(['One', 'Two']);
    const panels = findAll(el, (e) => e.className === 'mc-fb-tab-panel');
    expect(panels[0].hidden).toBe(false);
    expect(panels[1].hidden).toBe(true);

    tabButtons[1].fire('click');

    expect(panels[0].hidden).toBe(true);
    expect(panels[1].hidden).toBe(false);
    expect(tabButtons[0].getAttribute('aria-selected')).toBe('false');
    expect(tabButtons[1].getAttribute('aria-selected')).toBe('true');
  });
});
