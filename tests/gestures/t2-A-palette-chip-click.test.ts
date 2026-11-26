// Round 2: A3-009 — the actual pinch-tap/click DISPATCH on the Tools chip
// (toolPalette.ts:87, chip.addEventListener('click', ...)), not just a call
// to palette.open()/toggle() directly. tests/canvas/toolPalette.test.ts
// already exercises the public open/close/toggle API; this fires the real
// click listener the way handPointer.ts's activate() -> el.click() would,
// confirming the chip's own wiring (not just the state machine behind it).
import { describe, expect, it } from 'vitest';
import { mountToolPalette } from '../../src/canvas/toolPalette';

function fakeEl() {
  const handlers: Record<string, (e?: unknown) => void> = {};
  const classes = new Set<string>();
  return {
    hidden: false, id: '', className: '', type: '', textContent: '',
    attrs: {} as Record<string, string>,
    isConnected: true,
    classList: {
      add: (...cs: string[]) => cs.forEach((c) => classes.add(c)),
      remove: (...cs: string[]) => cs.forEach((c) => classes.delete(c)),
      contains: (c: string) => classes.has(c),
      toggle: (c: string, on?: boolean) => { (on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c); },
    },
    setAttribute(k: string, v: string) { this.attrs[k] = v; },
    getAttribute(k: string) { return this.attrs[k] ?? null; },
    addEventListener(t: string, f: (e?: unknown) => void) { handlers[t] = f; },
    removeEventListener(t: string) { delete handlers[t]; },
    focus() { this.focused = true; },
    focused: false,
    remove() { this.removed = true; },
    removed: false,
    querySelector() { return null; },
    fire(t: string, e?: unknown) { handlers[t]?.(e); },
  } as any;
}

function setup(phoneMatches: boolean) {
  const tools = fakeEl();
  const firstControl = fakeEl();
  tools.querySelector = (sel: string) => (sel.includes('button') ? firstControl : null);

  const chip = fakeEl();
  const doc: any = { activeElement: null, createElement: () => chip, addEventListener: () => {}, removeEventListener: () => {} };

  const root: any = fakeEl();
  root.ownerDocument = doc;
  root.querySelector = (sel: string) => (sel === '.mc-bar-tools' ? tools : null);
  const appended: unknown[] = [];
  root.append = (...nodes: unknown[]) => appended.push(...nodes);

  const mq = { matches: phoneMatches, addEventListener: () => {}, removeEventListener: () => {} };
  const win: any = { matchMedia: () => mq, setTimeout: (fn: () => void) => { fn(); return 0; } };

  return { tools, chip, firstControl, root, win };
}

describe('A3-009 Tools chip: real click dispatch on the chip element toggles the palette', () => {
  it('firing the chip\'s own click listener opens the (closed) palette', () => {
    const { tools, chip, root, win } = setup(false);
    const palette = mountToolPalette(root, win);
    expect(palette.isOpen()).toBe(false);
    chip.fire('click');
    expect(palette.isOpen()).toBe(true);
    expect(tools.hidden).toBe(false);
    expect(chip.attrs['aria-expanded']).toBe('true');
  });

  it('firing it twice back-to-back only opens once — the real-clock debounce swallows the immediate repeat, same as a quick double pinch', () => {
    const { chip, root, win } = setup(false);
    const palette = mountToolPalette(root, win);
    chip.fire('click', {});
    expect(palette.isOpen()).toBe(true);
    chip.fire('click', {});
    expect(palette.isOpen()).toBe(true); // second tap landed inside the debounce gap, ignored
  });
});
