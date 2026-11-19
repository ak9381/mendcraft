import { describe, expect, it } from 'vitest';
import { matchPaletteCommand, mountToolPalette } from '../../src/canvas/toolPalette';

describe('matchPaletteCommand (voice parsing)', () => {
  it('opens on "show tools", "tools" and "menu"', () => {
    expect(matchPaletteCommand('show tools')).toBe('open');
    expect(matchPaletteCommand('tools')).toBe('open');
    expect(matchPaletteCommand('menu')).toBe('open');
  });
  it('is case- and whitespace-insensitive', () => {
    expect(matchPaletteCommand('  SHOW TOOLS  ')).toBe('open');
    expect(matchPaletteCommand('Menu')).toBe('open');
  });
  it('closes on "hide tools"', () => {
    expect(matchPaletteCommand('hide tools')).toBe('close');
    expect(matchPaletteCommand('Hide Tools')).toBe('close');
  });
  it('does not match a phrase embedded in a longer sentence', () => {
    expect(matchPaletteCommand('please show tools now')).toBeNull();
  });
  it('returns null for unrelated or empty text', () => {
    expect(matchPaletteCommand('connect everything')).toBeNull();
    expect(matchPaletteCommand('')).toBeNull();
  });
});

function fakeEl() {
  const handlers: Record<string, (e?: unknown) => void> = {};
  return {
    hidden: false, id: '', className: '', type: '', textContent: '',
    attrs: {} as Record<string, string>,
    isConnected: true,
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

/** Builds the minimal fake `.mc-bar-tools` + root + document + window
 *  mountToolPalette touches, in the same hand-rolled-fake style the rest of
 *  this suite uses for DOM modules (no jsdom). */
function setup(phoneMatches: boolean) {
  const tools = fakeEl();
  const firstControl = fakeEl();
  tools.querySelector = (sel: string) => (sel.includes('button') ? firstControl : null);

  const chip = fakeEl();
  const doc: any = {
    activeElement: null,
    createElement: () => fakeEl(),
    addEventListener: (fakeEl() as any).addEventListener,
  };
  const keydownHandlers: Array<(e: unknown) => void> = [];
  doc.addEventListener = (t: string, f: (e: unknown) => void) => { if (t === 'keydown') keydownHandlers.push(f); };
  doc.removeEventListener = () => {};
  doc.createElement = () => chip;

  const root: any = fakeEl();
  root.ownerDocument = doc;
  root.querySelector = (sel: string) => (sel === '.mc-bar-tools' ? tools : null);
  const appended: unknown[] = [];
  root.append = (...nodes: unknown[]) => appended.push(...nodes);

  const mq = { matches: phoneMatches, addEventListener: () => {}, removeEventListener: () => {} };
  const win: any = { matchMedia: () => mq, setTimeout: (fn: () => void) => { fn(); return 0; } };

  return { tools, chip, firstControl, doc, root, mq, win, fireEscape: () => keydownHandlers.forEach((f) => f({ key: 'Escape', preventDefault() {} })) };
}

describe('mountToolPalette', () => {
  it('starts closed on desktop — no fixed chrome', () => {
    const { tools, chip, root, win } = setup(false);
    const palette = mountToolPalette(root, win);
    expect(palette.isOpen()).toBe(false);
    expect(tools.hidden).toBe(true);
    expect(chip.attrs['aria-expanded']).toBe('false');
  });

  it('open() shows the tools and focuses the first control; close() hides it again', () => {
    const { tools, root, win, firstControl, chip } = setup(false);
    const palette = mountToolPalette(root, win);
    palette.open();
    expect(palette.isOpen()).toBe(true);
    expect(tools.hidden).toBe(false);
    expect(chip.attrs['aria-expanded']).toBe('true');
    expect(firstControl.focused).toBe(true);

    palette.close();
    expect(palette.isOpen()).toBe(false);
    expect(tools.hidden).toBe(true);
    expect(chip.attrs['aria-expanded']).toBe('false');
  });

  it('toggle() flips open/closed', () => {
    const { root, win } = setup(false);
    const palette = mountToolPalette(root, win);
    palette.toggle();
    expect(palette.isOpen()).toBe(true);
    palette.toggle();
    expect(palette.isOpen()).toBe(false);
  });

  it('Esc closes the open palette', () => {
    const { root, win, fireEscape } = setup(false);
    const palette = mountToolPalette(root, win);
    palette.open();
    fireEscape();
    expect(palette.isOpen()).toBe(false);
  });

  it('closes itself once a tool button runs (data-cmd click)', () => {
    const { root, win, tools } = setup(false);
    const palette = mountToolPalette(root, win);
    palette.open();
    const btn = fakeEl(); btn.attrs['data-cmd'] = 'save';
    tools.fire('click', { target: { closest: (sel: string) => (sel === '[data-cmd]' ? btn : null) } });
    expect(palette.isOpen()).toBe(false);
  });

  it('on phones, tools stay visible and the chip hides — this module defers to phoneMenu', () => {
    const { tools, chip, root, win } = setup(true);
    const palette = mountToolPalette(root, win);
    expect(tools.hidden).toBe(false);
    expect(chip.hidden).toBe(true);
    // open()/close() are desktop-only concerns on a phone layout.
    palette.open();
    expect(palette.isOpen()).toBe(false);
  });
});
