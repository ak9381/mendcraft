// Round-2 gesture coverage for the shared palette dock / trash / fullscreen
// widgets (src/core/palette.ts) — C8/C9 rows that round 1 left SKIPPED
// because the module is DOM-heavy. palette.ts only uses
// document.createElement/appendChild (no innerHTML+querySelector-back-in),
// so a small hand-rolled fake (no jsdom dependency) is enough to drive the
// REAL createPalette/createTrash/createFullscreenControl code.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFullscreenControl, createPalette, type PaletteItemSpec } from '../../src/core/palette';

class FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  hidden = false;
  disabled = false;
  title = '';
  textContent = '';
  innerHTML = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  private attrs: Record<string, string> = {};
  private _className = '';
  private listeners: Record<string, Array<(e: unknown) => void>> = {};
  rect = { left: 0, top: 0, right: 0, bottom: 0 };
  requestFullscreen = vi.fn().mockResolvedValue(undefined);

  constructor(tag: string) { this.tagName = tag.toUpperCase(); }

  get className() { return this._className; }
  set className(v: string) { this._className = v; }

  classList = {
    add: (c: string) => { const s = new Set(this._className.split(/\s+/).filter(Boolean)); s.add(c); this._className = [...s].join(' '); },
    remove: (c: string) => { this._className = this._className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
    contains: (c: string) => this._className.split(/\s+/).includes(c),
    toggle: (c: string, force?: boolean) => {
      const on = force ?? !this.classList.contains(c);
      if (on) this.classList.add(c); else this.classList.remove(c);
      return on;
    },
  };

  setAttribute(n: string, v: string) { this.attrs[n] = v; }
  getAttribute(n: string) { return this.attrs[n] ?? null; }
  appendChild(node: FakeElement) { node.parentElement = this; this.children.push(node); return node; }
  append(...nodes: FakeElement[]) { for (const n of nodes) this.appendChild(n); }
  addEventListener(type: string, fn: (e: unknown) => void) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  dispatchEvent(e: { type: string; [k: string]: unknown }) {
    (this.listeners[e.type] ?? []).slice().forEach((fn) => fn(e));
    return true;
  }
  getBoundingClientRect() { return this.rect; }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
    this.parentElement = null;
  }
}

function makeFakeWindow() {
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  return {
    addEventListener(type: string, fn: (e: unknown) => void) { (listeners[type] ??= []).push(fn); },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
    },
    dispatch(type: string, e: Record<string, unknown> = {}) {
      (listeners[type] ?? []).slice().forEach((fn) => fn({ type, ...e }));
    },
    getScreenDetails: undefined as unknown,
  };
}

let fakeWindow: ReturnType<typeof makeFakeWindow>;

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  const g = globalThis as Record<string, unknown>;
  g.document = {
    createElement: (tag: string) => new FakeElement(tag),
    fullscreenElement: null as unknown,
    exitFullscreen: vi.fn().mockResolvedValue(undefined),
  };
  fakeWindow = makeFakeWindow();
  g.window = fakeWindow;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function down(btn: FakeElement, x: number, y: number) {
  btn.dispatchEvent({ type: 'pointerdown', clientX: x, clientY: y, preventDefault: () => {} });
}

describe('C140 flyout sub-menu group — tap opens the flyout', () => {
  it('a pinch-release (pointerdown, no drag) on a group button reveals its flyout', () => {
    const host = new FakeElement('div');
    const items: PaletteItemSpec[] = [
      { toolId: 'components', label: 'Components', icon: 'C', shortcut: '', group: [
        { toolId: 'stairs', label: 'Stairs', icon: 'St', shortcut: '' },
      ] },
    ];
    createPalette(host, items, { onArm: vi.fn(), onPlaceStart: vi.fn() });
    const groupBtn = host.children[0].children.find((c) => c.className.includes('mc-palette-group'))!;
    const flyout = host.children[0].children.find((c) => c.className === 'mc-flyout')!;
    expect(flyout.hidden).toBe(true);
    down(groupBtn, 10, 10);
    expect(flyout.hidden).toBe(false);
  });
});

describe('C141 flyout sub-menu group — tap again closes it (toggle)', () => {
  it('a second pointerdown on the same group button collapses the flyout', () => {
    const host = new FakeElement('div');
    const items: PaletteItemSpec[] = [
      { toolId: 'components', label: 'Components', icon: 'C', shortcut: '', group: [
        { toolId: 'stairs', label: 'Stairs', icon: 'St', shortcut: '' },
      ] },
    ];
    createPalette(host, items, { onArm: vi.fn(), onPlaceStart: vi.fn() });
    const groupBtn = host.children[0].children.find((c) => c.className.includes('mc-palette-group'))!;
    const flyout = host.children[0].children.find((c) => c.className === 'mc-flyout')!;
    down(groupBtn, 10, 10);
    expect(flyout.hidden).toBe(false);
    down(groupBtn, 10, 10);
    expect(flyout.hidden).toBe(true);
  });
});

describe('C148 palette button — left vs right hand', () => {
  it('arming a tool does not depend on any hand-identity field on the pointer event', () => {
    const host = new FakeElement('div');
    const onArm = vi.fn();
    const items: PaletteItemSpec[] = [{ toolId: 'select', label: 'Select', icon: 'S', shortcut: 's' }];
    createPalette(host, items, { onArm, onPlaceStart: vi.fn() });
    const btn = host.children[0].children[0];
    // "left hand" press+release (no movement) — arbitrary extra fields are never read.
    btn.dispatchEvent({ type: 'pointerdown', clientX: 5, clientY: 5, preventDefault: () => {}, handedness: 'left' });
    fakeWindow.dispatch('pointerup', { handedness: 'left' });
    expect(onArm).toHaveBeenCalledWith('select');
    onArm.mockClear();
    // "right hand" press+release — identical outcome.
    btn.dispatchEvent({ type: 'pointerdown', clientX: 5, clientY: 5, preventDefault: () => {}, handedness: 'right' });
    fakeWindow.dispatch('pointerup', { handedness: 'right' });
    expect(onArm).toHaveBeenCalledWith('select');
  });
});

describe('C150 palette button — overlapping z-order with an open flyout', () => {
  it.fails('BUG: itemAt() should hit-test the visually topmost (open flyout) button, not the first-registered dock button, when their rects overlap — src/core/palette.ts:132-139 iterates `flat` in registration order with no z-order/visual-stacking check', () => {
    const host = new FakeElement('div');
    const dockItem: PaletteItemSpec = { toolId: 'select', label: 'Select', icon: 'S', shortcut: 's' };
    const flyoutItem: PaletteItemSpec = { toolId: 'stairs', label: 'Stairs', icon: 'St', shortcut: '', placeable: true };
    const items: PaletteItemSpec[] = [
      dockItem,
      { toolId: 'components', label: 'Components', icon: 'C', shortcut: '', group: [flyoutItem] },
    ];
    const palette = createPalette(host, items, { onArm: vi.fn(), onPlaceStart: vi.fn() });
    const dockBtn = host.children[0].children.find((c) => c.dataset.tool === 'select')!;
    const groupBtn = host.children[0].children.find((c) => c.className.includes('mc-palette-group'))!;
    const flyout = host.children[0].children.find((c) => c.className === 'mc-flyout')!;
    const stairsBtn = flyout.children.find((c) => c.dataset.tool === 'stairs')!;
    // Same on-screen rect: once the flyout opens it visually sits on top of the dock button beneath it.
    dockBtn.rect = { left: 0, top: 0, right: 50, bottom: 50 };
    stairsBtn.rect = { left: 0, top: 0, right: 50, bottom: 50 };
    down(groupBtn, 10, 10); // open the flyout
    expect(flyout.hidden).toBe(false);
    const hit = palette.itemAt(20, 20);
    expect(hit).toBe(flyoutItem); // actual: returns dockItem — click-through to the covered button
  });
});

describe('C151 fullscreen toggle button — tap enters fullscreen', () => {
  it('pinch-release (click) on the fullscreen button requests fullscreen on the target', async () => {
    const host = new FakeElement('div');
    const target = new FakeElement('div');
    createFullscreenControl(host, target as unknown as HTMLElement, vi.fn());
    const fsBtn = host.children[0].children[0];
    fsBtn.dispatchEvent({ type: 'click' });
    await flush();
    expect(target.requestFullscreen).toHaveBeenCalledTimes(1);
  });
});

describe('C153 fullscreen toggle — exit fullscreen', () => {
  it('tapping the same button while fullscreen calls document.exitFullscreen instead of re-requesting it', async () => {
    const host = new FakeElement('div');
    const target = new FakeElement('div');
    (globalThis as Record<string, unknown>).document = {
      ...(globalThis as Record<string, { document: unknown }>).document as object,
      fullscreenElement: target,
      exitFullscreen: vi.fn().mockResolvedValue(undefined),
    };
    createFullscreenControl(host, target as unknown as HTMLElement, vi.fn());
    const fsBtn = host.children[0].children[0];
    fsBtn.dispatchEvent({ type: 'click' });
    await flush();
    expect(target.requestFullscreen).not.toHaveBeenCalled();
    expect(((globalThis as Record<string, unknown>).document as { exitFullscreen: ReturnType<typeof vi.fn> }).exitFullscreen).toHaveBeenCalledTimes(1);
  });
});

describe('C154 move-to-screen button', () => {
  it('without the Window Management API, tapping it falls back to plain fullscreen and hints why', async () => {
    const host = new FakeElement('div');
    const target = new FakeElement('div');
    const onHint = vi.fn();
    createFullscreenControl(host, target as unknown as HTMLElement, onHint);
    const mvBtn = host.children[0].children[1];
    mvBtn.dispatchEvent({ type: 'click' });
    await flush();
    expect(target.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(onHint).toHaveBeenCalledWith(expect.stringContaining('Window Management API'));
  });

  it('with the API available, tapping it lists real screens and picking one moves fullscreen there', async () => {
    const host = new FakeElement('div');
    const target = new FakeElement('div');
    const screens = [{ label: 'Laptop', isPrimary: true }, { label: 'External' }];
    fakeWindow.getScreenDetails = vi.fn().mockResolvedValue({ screens });
    createFullscreenControl(host, target as unknown as HTMLElement, vi.fn());
    const mvBtn = host.children[0].children[1];
    const menu = host.children[0].children[2];
    mvBtn.dispatchEvent({ type: 'click' });
    await flush();
    expect(menu.hidden).toBe(false);
    expect(menu.children).toHaveLength(2);
    menu.children[1].dispatchEvent({ type: 'click' });
    await flush();
    expect(target.requestFullscreen).toHaveBeenCalledWith({ screen: screens[1] });
    expect(menu.hidden).toBe(true);
  });
});
