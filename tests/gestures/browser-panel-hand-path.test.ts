// C3 Browser panel: hand-path tests against the real createReferencePanel().
// referencePanel.ts never uses runtime `instanceof HTML*` (unlike
// onscreenKeyboard.ts), so a plain hand-rolled fake element — same style the
// rest of this suite uses — is enough; no special classes needed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReferencePanel, type ReferencePanel } from '../../src/ui/referencePanel';

class FakeNode {
  tagName: string;
  children: FakeNode[] = [];
  parentElement: FakeNode | null = null;
  hidden = false;
  type = '';
  value = '';
  src = '';
  title = '';
  placeholder = '';
  autocomplete = '';
  href = '';
  target = '';
  rel = '';
  private _className = '';
  private _text = '';
  private _html = '';
  style: Record<string, string> = {};
  private attrs: Record<string, string> = {};
  private listeners: Record<string, Array<(e: unknown) => void>> = {};
  private rect = { left: 0, top: 0, right: 500, bottom: 400 };

  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  get className() { return this._className; }
  set className(v: string) { this._className = v; }
  get textContent() { return this._text; }
  set textContent(v: string) { this._text = v; }
  get innerHTML() { return this._html; }
  set innerHTML(v: string) { this._html = v; if (v === '') this.children = []; }

  classList = {
    add: (c: string) => { const s = new Set(this._className.split(/\s+/).filter(Boolean)); s.add(c); this._className = [...s].join(' '); },
    remove: (c: string) => { this._className = this._className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
    contains: (c: string) => this._className.split(/\s+/).includes(c),
  };

  setAttribute(n: string, v: string) { this.attrs[n] = v; }
  getAttribute(n: string) { return this.attrs[n] ?? null; }
  append(...nodes: FakeNode[]) { nodes.forEach((n) => { n.parentElement = this; this.children.push(n); }); }
  appendChild(n: FakeNode) { this.append(n); return n; }
  addEventListener(type: string, fn: (e: unknown) => void) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  dispatchEvent(e: Record<string, unknown> & { type: string }) {
    (this.listeners[e.type] ?? []).slice().forEach((fn) => fn(e));
    return true;
  }
  click() { this.dispatchEvent({ type: 'click' }); }
  focus() { this.focused = true; }
  focused = false;
  remove() { /* no-op */ }
  setPointerCapture() { /* no-op */ }
  releasePointerCapture() { /* no-op */ }
  getBoundingClientRect() { return this.rect; }
  setRect(r: { left: number; top: number; right: number; bottom: number }) { this.rect = r; }
}

function installFakeDom() {
  const g = globalThis as Record<string, unknown>;
  g.document = { createElement: (tag: string) => new FakeNode(tag) };
  g.window = globalThis;
}

function panelParts(panel: ReferencePanel) {
  const root = panel.element as unknown as FakeNode;
  const head = root.children.find((c) => c.className === 'mc-ref-head')!;
  const closeBtn = head.children.find((c) => c.className === 'mc-ref-x')!;
  const bar = root.children.find((c) => c.className === 'mc-ref-bar')!;
  const input = bar.children.find((c) => c.className === 'mc-ref-url')!;
  const goBtn = bar.children.find((c) => c.className === 'mc-ref-go')!;
  const main = root.children.find((c) => c.className === 'mc-ref-main')!;
  const body = main.children.find((c) => c.className === 'mc-ref-body')!;
  const frame = body.children.find((c) => c.className === 'mc-ref-frame')!;
  const status = body.children.find((c) => c.className === 'mc-ref-status')!;
  const resizer = root.children.find((c) => c.className === 'mc-ref-resize')!;
  return { root, head, closeBtn, bar, input, goBtn, frame, status, resizer };
}

describe('browser reference panel hand path', () => {
  beforeEach(() => installFakeDom());
  afterEach(() => vi.useRealTimers());

  it('C034 pinch-release (click) on the close button closes the panel', () => {
    const panel = createReferencePanel();
    const { closeBtn } = panelParts(panel);
    panel.open();
    expect(panel.isOpen()).toBe(true);
    closeBtn.click(); // generic click-synthesis, same as handPointer.ts's activate()
    expect(panel.isOpen()).toBe(false);
  });

  it('C035 a pinch-drag on the header moves the panel (real pointerdown/move, clamped at 0)', () => {
    const panel = createReferencePanel();
    const { root, head } = panelParts(panel);
    panel.open();
    root.setRect({ left: 80, top: 96, right: 500, bottom: 130 });
    head.dispatchEvent({ type: 'pointerdown', target: {}, clientX: 90, clientY: 100, pointerId: 1, preventDefault() {} });
    head.dispatchEvent({ type: 'pointermove', clientX: 140, clientY: 160 });
    // dragDX = 90-80=10, dragDY = 100-96=4 → new left = 140-10=130, top = 160-4=156
    expect(root.style.left).toBe('130px');
    expect(root.style.top).toBe('156px');
    // Dragging toward negative coordinates clamps at 0, never drifts off-screen.
    head.dispatchEvent({ type: 'pointermove', clientX: -50, clientY: -50 });
    expect(root.style.left).toBe('0px');
    expect(root.style.top).toBe('0px');
  });

  it('C036 a pointercancel mid-drag ends the drag — further pointermoves are ignored', () => {
    const panel = createReferencePanel();
    const { root, head } = panelParts(panel);
    panel.open();
    root.setRect({ left: 80, top: 96, right: 500, bottom: 130 });
    head.dispatchEvent({ type: 'pointerdown', clientX: 90, clientY: 100, pointerId: 1, preventDefault() {} });
    head.dispatchEvent({ type: 'pointermove', clientX: 140, clientY: 160 });
    const movedLeft = root.style.left;
    head.dispatchEvent({ type: 'pointercancel', pointerId: 1 });
    head.dispatchEvent({ type: 'pointermove', clientX: 999, clientY: 999 }); // should be a no-op now
    expect(root.style.left).toBe(movedLeft);
  });

  it('C037 opening the panel focuses the address bar, same generic text-field path any hand user gets', () => {
    const panel = createReferencePanel();
    const { input } = panelParts(panel);
    panel.open();
    expect(input.focused).toBe(true);
    expect(input.type).toBe('text'); // qualifies for the same generic pinch-focus/auto-keyboard path as C026
  });

  it('C038 pinch-release on "Go" navigates via the address bar\'s real submit handler', () => {
    const panel = createReferencePanel();
    const { bar, input, frame } = panelParts(panel);
    panel.open();
    input.value = 'example.com';
    // Clicking a type=submit button inside a form fires the form's submit —
    // native browser behaviour, not app code; we drive the real submit
    // listener referencePanel.ts itself registers (`bar.ts:92-95`).
    bar.dispatchEvent({ type: 'submit', preventDefault() {} });
    expect(frame.src).toBe('https://example.com/');
  });

  it('C047 submitting the same URL twice in a row (a stray double pinch) does not corrupt navigation state', () => {
    const panel = createReferencePanel();
    const { bar, input, frame } = panelParts(panel);
    panel.open();
    input.value = 'example.com';
    bar.dispatchEvent({ type: 'submit', preventDefault() {} });
    bar.dispatchEvent({ type: 'submit', preventDefault() {} });
    expect(frame.src).toBe('https://example.com/'); // idempotent, not doubled/garbled
  });

  it('C048 a load that never arrives (offline or refused) shows the same generic "did not load" message — no offline-specific state exists', () => {
    vi.useFakeTimers();
    const panel = createReferencePanel();
    const { status } = panelParts(panel);
    panel.open('https://example.com');
    vi.advanceTimersByTime(4000); // FRAME_LOAD_TIMEOUT_MS
    expect(status.hidden).toBe(false);
    expect(status.children[0].textContent).toMatch(/did not load here/);
    // Same message would show for a genuinely offline network — the app has
    // no navigator.onLine check or distinct offline copy for this panel.
  });
});
