// Round-2 gesture gap tests for the shared tool palette (src/core/palette.ts).
// Drives the real createPalette() DOM widget with a minimal hand-rolled fake
// document/window (same technique as browser-panel-hand-path.test.ts) since
// this repo's vitest runs in the `node` environment (no jsdom). A pinch-tap
// is modeled as the exact DOM events the real pinch→pointer translation
// layer dispatches: pointerdown on the button, then pointerup on `window`
// (palette.ts only listens for pointerup on window, not on the button).
import { describe, expect, it } from 'vitest';
import { createPalette, type PaletteItemSpec } from '../../src/core/palette';

class FakeNode {
  tagName: string;
  children: FakeNode[] = [];
  hidden = false;
  dataset: Record<string, string> = {};
  private _className = '';
  private attrs: Record<string, string> = {};
  private listeners: Record<string, Array<(e: Record<string, unknown>) => void>> = {};
  private rect = { left: 0, top: 0, right: 40, bottom: 40 };
  innerHTML = '';
  title = '';
  type = '';

  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  get className() { return this._className; }
  set className(v: string) { this._className = v; }
  classList = {
    add: (c: string) => { const s = new Set(this._className.split(/\s+/).filter(Boolean)); s.add(c); this._className = [...s].join(' '); },
    remove: (c: string) => { this._className = this._className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
    contains: (c: string) => this._className.split(/\s+/).includes(c),
    toggle: (c: string, on: boolean) => { if (on) this.classList.add(c); else this.classList.remove(c); },
  };
  setAttribute(n: string, v: string) { this.attrs[n] = v; }
  getAttribute(n: string) { return this.attrs[n] ?? null; }
  append(...nodes: FakeNode[]) { this.children.push(...nodes); }
  appendChild(n: FakeNode) { this.children.push(n); return n; }
  addEventListener(type: string, fn: (e: Record<string, unknown>) => void) { (this.listeners[type] ??= []).push(fn); }
  dispatchEvent(e: Record<string, unknown> & { type: string }) {
    (this.listeners[e.type] ?? []).slice().forEach((fn) => fn(e));
  }
  remove() {}
  getBoundingClientRect() { return this.rect; }
  setRect(r: { left: number; top: number; right: number; bottom: number }) { this.rect = r; }
}

function installFakeDom() {
  const g = globalThis as Record<string, unknown>;
  g.document = { createElement: (tag: string) => new FakeNode(tag) };
  const winListeners: Record<string, Array<(e: Record<string, unknown>) => void>> = {};
  g.window = {
    addEventListener: (type: string, fn: (e: Record<string, unknown>) => void) => { (winListeners[type] ??= []).push(fn); },
    removeEventListener: (type: string, fn: (e: Record<string, unknown>) => void) => {
      winListeners[type] = (winListeners[type] ?? []).filter((f) => f !== fn);
    },
    dispatchEvent: (e: Record<string, unknown> & { type: string }) => {
      (winListeners[e.type] ?? []).slice().forEach((fn) => fn(e));
    },
  };
}

function down(btn: FakeNode, x: number, y: number) {
  btn.dispatchEvent({ type: 'pointerdown', clientX: x, clientY: y, preventDefault() {} });
}
function winMove(x: number, y: number) {
  (globalThis as Record<string, unknown>).window &&
    (globalThis as unknown as { window: { dispatchEvent: Function } }).window.dispatchEvent({ type: 'pointermove', clientX: x, clientY: y });
}
function winUp() {
  (globalThis as unknown as { window: { dispatchEvent: Function } }).window.dispatchEvent({ type: 'pointerup' });
}

const wallItem: PaletteItemSpec = { toolId: 'wall', label: 'Wall', icon: '─', shortcut: 'w' }; // not placeable
const doorItem: PaletteItemSpec = { toolId: 'door', label: 'Door', icon: '◧', shortcut: 'd', placeable: true };
const groupItem: PaletteItemSpec = {
  toolId: 'furniture', label: 'Furniture', icon: 'F', shortcut: '',
  group: [{ toolId: 'chair', label: 'Chair', icon: 'C', shortcut: '' }],
};

describe('B-001 palette pinch-tap arms a tool, identical to a mouse click', () => {
  it('pinch-equivalent pointerdown+window-pointerup on the button calls onArm, not onPlaceStart', () => {
    installFakeDom();
    const host = new FakeNode('div') as unknown as HTMLElement;
    const armed: string[] = [];
    const placed: string[] = [];
    const handle = createPalette(host, [wallItem], { onArm: (id) => armed.push(id), onPlaceStart: (id) => placed.push(id) });
    const btn = handle.element.children[0] as unknown as FakeNode;
    down(btn, 10, 10);
    winUp(); // no move at all — a clean tap
    expect(armed).toEqual(['wall']);
    expect(placed).toEqual([]);
  });
});

describe('B-002 drag a placeable item off the palette arms pick-and-place', () => {
  it('press + move > 6px on a placeable item calls onPlaceStart, never onArm', () => {
    installFakeDom();
    const host = new FakeNode('div') as unknown as HTMLElement;
    const armed: string[] = [];
    const placed: Array<{ id: string; x: number; y: number }> = [];
    const handle = createPalette(host, [doorItem], {
      onArm: (id) => armed.push(id),
      onPlaceStart: (id, x, y) => placed.push({ id, x, y }),
    });
    const btn = handle.element.children[0] as unknown as FakeNode;
    down(btn, 10, 10);
    winMove(10, 40); // 30px drift, well past the 6px threshold
    winUp();
    expect(placed).toEqual([{ id: 'door', x: 10, y: 40 }]);
    expect(armed).toEqual([]); // dragging off never also arms on release
  });
});

describe('B-023 BUG: dragging a non-placeable tool (e.g. Wall) off the palette arms nothing at all', () => {
  it('FIXED: wall is not placeable; a >6px drift before release should still at least arm the tool on release, but it does not — BUG: src/core/palette.ts:51-61 onWinMove nulls `press` unconditionally on any >6px drift (even for non-placeable items), and onWinUp (palette.ts:62-68) only arms `if (press)`, so a hand tremor that drifts >6px while pressing a non-placeable tool like Wall silently drops the interaction: neither onArm nor onPlaceStart ever fires', () => {
    installFakeDom();
    const host = new FakeNode('div') as unknown as HTMLElement;
    const armed: string[] = [];
    const placed: string[] = [];
    const handle = createPalette(host, [wallItem], { onArm: (id) => armed.push(id), onPlaceStart: (id) => placed.push(id) });
    const btn = handle.element.children[0] as unknown as FakeNode;
    down(btn, 10, 10);
    winMove(10, 20); // 10px of tremor drift while pressing — plausible for a hand/pinch, not a deliberate drag
    winUp();
    // A person who meant to tap "Wall" (it's not drag-to-place) still expects the tool to arm.
    expect(armed).toEqual(['wall']);
  });
});

describe('B-004/B-005 furniture flyout group: tap to open, then tap a sub-item', () => {
  it('pinch-tap the group button opens the flyout; pinch-tap a sub-item arms it and the flyout stays open (closeFlyouts only runs on press-start)', () => {
    installFakeDom();
    const host = new FakeNode('div') as unknown as HTMLElement;
    const armed: string[] = [];
    const handle = createPalette(host, [groupItem], { onArm: (id) => armed.push(id), onPlaceStart: () => {} });
    const groupBtn = handle.element.children[0] as unknown as FakeNode;
    const flyout = handle.element.children[1] as unknown as FakeNode;
    expect(flyout.hidden).toBe(true);
    down(groupBtn, 5, 5);
    winUp();
    expect(flyout.hidden).toBe(false); // B-004: open on tap
    const subBtn = flyout.children[0] as unknown as FakeNode;
    down(subBtn, 6, 6);
    winUp();
    expect(armed).toEqual(['chair']); // B-005: sub-item tap arms it, same generic path
  });
});

describe('B-007 accidental-touch is not filtered: any clean press+release arms the tool', () => {
  it('a sub-6px flicker pinch (no deliberate hold time, no distance threshold check) still arms — confirms the documented gap, no debounce exists', () => {
    installFakeDom();
    const host = new FakeNode('div') as unknown as HTMLElement;
    const armed: string[] = [];
    const handle = createPalette(host, [wallItem], { onArm: (id) => armed.push(id), onPlaceStart: () => {} });
    const btn = handle.element.children[0] as unknown as FakeNode;
    down(btn, 10, 10);
    winUp(); // immediate release, zero hold time simulated
    expect(armed).toEqual(['wall']);
  });
});

describe('B-008 left hand vs right hand: tool activation is hand-agnostic', () => {
  it('arming only depends on which button received pointerdown, never on handedness/position of the press', () => {
    installFakeDom();
    const host = new FakeNode('div') as unknown as HTMLElement;
    const armed: string[] = [];
    const handle = createPalette(host, [wallItem], { onArm: (id) => armed.push(id), onPlaceStart: () => {} });
    const btn = handle.element.children[0] as unknown as FakeNode;
    // "left hand" press at one screen region
    down(btn, 5, 5);
    winUp();
    // "right hand" press at a very different screen region, same button
    down(btn, 900, 700);
    winUp();
    expect(armed).toEqual(['wall', 'wall']);
  });
});

describe('B-009 (fixed): hand lost mid-press leaves the palette stuck "armed" with no cancel path', () => {
  it('FIXED: no pointercancel listener exists at all; if the pointer stream ends without a window pointerup (hand drops out of frame), `press` is left set — BUG: src/core/palette.ts only registers window "pointermove"/"pointerup" (palette.ts:69-70), never "pointercancel", so a resumed/unrelated pointermove far later is misread as the drag threshold for the stale press', () => {
    installFakeDom();
    const host = new FakeNode('div') as unknown as HTMLElement;
    const armed: string[] = [];
    const placed: Array<{ id: string }> = [];
    const handle = createPalette(host, [doorItem], { onArm: (id) => armed.push(id), onPlaceStart: (id) => placed.push({ id }) });
    const btn = handle.element.children[0] as unknown as FakeNode;
    down(btn, 10, 10); // hand begins pressing Door
    // hand leaves the camera frame here — no pointerup, no pointercancel ever fires
    // ... much later, tracking resumes with the hand somewhere unrelated:
    // A real browser reports buttons: 0 on a move with nothing pressed.
    (globalThis as unknown as { window: { dispatchEvent: Function } }).window.dispatchEvent({ type: 'pointermove', clientX: 500, clientY: 500, buttons: 0 });
    // Expectation: the stale press from before tracking was lost should NOT
    // resurrect itself as a place-start once tracking resumes.
    expect(placed).toEqual([]);
  });
});

describe('B-011 gesture conflict near the palette: palette.ts has no gesture-type awareness', () => {
  it('any dispatched pointerdown arms a button regardless of which hand gesture produced it (pinch vs fist vs open-palm are indistinguishable here)', () => {
    installFakeDom();
    const host = new FakeNode('div') as unknown as HTMLElement;
    const armed: string[] = [];
    const handle = createPalette(host, [wallItem], { onArm: (id) => armed.push(id), onPlaceStart: () => {} });
    const btn = handle.element.children[0] as unknown as FakeNode;
    // Nothing in palette.ts reads a gesture-kind field; an open-palm "pan" that
    // the translation layer mistakenly turns into a pointerdown would still arm.
    down(btn, 10, 10);
    winUp();
    expect(armed).toEqual(['wall']);
  });
});

describe('B-013 slow deliberate hold vs fast tap are read identically (only the 6px threshold matters, never time)', () => {
  it('a very slow pinch-and-hold with no drift still arms on release, same as an instant tap', () => {
    installFakeDom();
    const host = new FakeNode('div') as unknown as HTMLElement;
    const armed: string[] = [];
    const placed: string[] = [];
    const handle = createPalette(host, [wallItem], { onArm: (id) => armed.push(id), onPlaceStart: (id) => placed.push(id) });
    const btn = handle.element.children[0] as unknown as FakeNode;
    down(btn, 10, 10);
    // many small moves under the 6px threshold, simulating a long, slightly
    // trembling hold with no deliberate drag intent
    for (let i = 0; i < 20; i++) winMove(10 + (i % 2), 10 + (i % 2));
    winUp();
    expect(armed).toEqual(['wall']);
    expect(placed).toEqual([]);
  });
});

describe('B-015 z-order: an open flyout sub-item occupies its own rect independent of canvas z-order', () => {
  it('itemAt() resolves to the visible flyout sub-item at its coordinates once the flyout is open, and to null once closed', () => {
    installFakeDom();
    const host = new FakeNode('div') as unknown as HTMLElement;
    const handle = createPalette(host, [groupItem], { onArm: () => {}, onPlaceStart: () => {} });
    const groupBtn = handle.element.children[0] as unknown as FakeNode;
    const flyout = handle.element.children[1] as unknown as FakeNode;
    const subBtn = flyout.children[0] as unknown as FakeNode;
    subBtn.setRect({ left: 100, top: 100, right: 140, bottom: 140 });
    expect(handle.itemAt(110, 110)).toBeNull(); // flyout closed: sub-item not hit-testable
    down(groupBtn, 5, 5);
    winUp(); // opens the flyout
    expect(handle.itemAt(110, 110)?.toolId).toBe('chair');
  });
});

describe('B-009 pointercancel ends a press without arming or placing', () => {
  it('pointercancel mid-press then a later held move/up does nothing', () => {
    installFakeDom();
    const host = new FakeNode('div') as unknown as HTMLElement;
    const armed: string[] = [];
    const placed: string[] = [];
    const handle = createPalette(host, [doorItem], { onArm: (id) => armed.push(id), onPlaceStart: (id) => placed.push(id) });
    const btn = handle.element.children[0] as unknown as FakeNode;
    down(btn, 10, 10);
    (globalThis as unknown as { window: { dispatchEvent: Function } }).window.dispatchEvent({ type: 'pointercancel' });
    winMove(300, 300);
    winUp();
    expect(placed).toEqual([]);
    expect(armed).toEqual([]);
  });
});
