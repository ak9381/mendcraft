// C1 on-screen pinch keyboard: hand-path tests (pressAt/hoverAt/dwell) driven
// through the REAL createOnScreenKeyboard() component, not just the pure
// keyboardLogic.pressKey() math (already covered by keyboardLogic.test.ts).
//
// onscreenKeyboard.ts is the one DOM module in this codebase that uses real
// runtime `instanceof HTMLElement/HTMLButtonElement/HTMLInputElement` checks
// (most others avoid this for testability — see handPointer.ts's type casts
// instead of instanceof). So unlike the hand-rolled plain-object fakes used
// elsewhere in this suite, we need real classes installed as the globals so
// `instanceof` resolves correctly. No jsdom dependency is added — this is a
// minimal, purpose-built stand-in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOnScreenKeyboard, type OnScreenKeyboard } from '../../src/ui/onscreenKeyboard';

class FakeNode {
  tagName: string;
  children: FakeNode[] = [];
  parentElement: FakeNode | null = null;
  hidden = false;
  private _className = '';
  private _text = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  private attrs: Record<string, string> = {};
  private listeners: Record<string, Array<(e: unknown) => void>> = {};
  private rect = { left: 0, top: 0, right: 1000, bottom: 1000 };

  constructor(tag: string) { this.tagName = tag.toUpperCase(); }

  get className() { return this._className; }
  set className(v: string) { this._className = v; }
  get textContent() { return this._text; }
  set textContent(v: string) { this._text = v; }

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
  appendChild(node: FakeNode) { node.parentElement = this; this.children.push(node); return node; }
  addEventListener(type: string, fn: (e: unknown) => void) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  dispatchEvent(e: { type: string }) {
    (this.listeners[e.type] ?? []).slice().forEach((fn) => fn(e));
    return true;
  }
  click() { this.dispatchEvent({ type: 'click' }); }
  focus() { /* no-op */ }
  contains(other: FakeNode): boolean {
    if (other === this) return true;
    return this.children.some((c) => c.contains(other));
  }
  closest(sel: string): FakeNode | null {
    const cls = sel.replace(/^\./, '');
    let cur: FakeNode | null = this;
    while (cur) {
      if (cur.classList.contains(cls)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  getBoundingClientRect() { return this.rect; }
  setRect(r: { left: number; top: number; right: number; bottom: number }) { this.rect = r; }
}
class FakeButtonEl extends FakeNode {}
class FakeInputEl extends FakeNode {
  value = '';
  selectionStart = 0;
  selectionEnd = 0;
  type = 'text';
  form: { requestSubmit: () => void } | null = null;
  setSelectionRange(s: number, e: number) { this.selectionStart = s; this.selectionEnd = e; }
}
class FakeTextAreaEl extends FakeNode {}

function installFakeDom() {
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = FakeNode;
  g.HTMLButtonElement = FakeButtonEl;
  g.HTMLInputElement = FakeInputEl;
  g.HTMLTextAreaElement = FakeTextAreaEl;
  g.InputEvent = class { type: string; bubbles?: boolean; data?: string; constructor(t: string, init?: { bubbles?: boolean; data?: string }) { this.type = t; this.bubbles = init?.bubbles; this.data = init?.data; } };
  g.KeyboardEvent = class { type: string; bubbles?: boolean; key?: string; constructor(t: string, init?: { bubbles?: boolean; key?: string }) { this.type = t; this.bubbles = init?.bubbles; this.key = init?.key; } };

  let elementFromPointResult: FakeNode | null = null;
  const focusinListeners: Array<(e: unknown) => void> = [];
  const doc = {
    createElement: (tag: string) => (tag === 'button' ? new FakeButtonEl(tag) : new FakeNode(tag)),
    elementFromPoint: () => elementFromPointResult,
    addEventListener: (type: string, fn: (e: unknown) => void) => { if (type === 'focusin') focusinListeners.push(fn); },
    removeEventListener: () => { /* not exercised here */ },
    dispatchEvent: (e: { type: string; target: unknown }) => {
      if (e.type === 'focusin') focusinListeners.forEach((fn) => fn(e));
    },
    activeElement: null as FakeNode | null,
  };
  g.document = doc;
  g.window = globalThis;
  return { setHit: (el: FakeNode | null) => { elementFromPointResult = el; } };
}

/** Find the key button carrying `dataset.key === key` anywhere under root. */
function search(node: FakeNode, key: string): FakeButtonEl | null {
  for (const c of node.children) {
    if (c.dataset.key === key) return c as FakeButtonEl;
    const found = search(c, key);
    if (found) return found;
  }
  return null;
}
function findKey(root: FakeNode, key: string): FakeButtonEl {
  const found = search(root, key);
  if (!found) throw new Error(`no key button for ${key}`);
  return found;
}

describe('on-screen keyboard hand path (pressAt / hoverAt)', () => {
  let dom: ReturnType<typeof installFakeDom>;
  let kb: OnScreenKeyboard;
  let field: FakeInputEl;

  beforeEach(() => {
    dom = installFakeDom();
    kb = createOnScreenKeyboard();
    field = new FakeInputEl('input');
    kb.open(field as unknown as HTMLInputElement);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('C001 pinch-release on a letter key inserts its character', () => {
    dom.setHit(findKey(kb.element as unknown as FakeNode, 'a'));
    const consumed = kb.pressAt(10, 10);
    expect(consumed).toBe(true);
    expect(field.value).toBe('a');
  });

  it('C002 holding the dwell timer over a key presses it, like pinch-release', () => {
    vi.useFakeTimers();
    dom.setHit(findKey(kb.element as unknown as FakeNode, 'b'));
    kb.hoverAt(10, 10);
    expect(field.value).toBe(''); // not yet — still dwelling
    vi.advanceTimersByTime(600);
    expect(field.value).toBe('b');
  });

  it('C003 two separate pinch-release cycles on the same key type it twice', () => {
    const btn = findKey(kb.element as unknown as FakeNode, 'a');
    dom.setHit(btn);
    kb.pressAt(10, 10);
    kb.pressAt(10, 10);
    expect(field.value).toBe('aa');
  });

  it('C004 pressAt itself never debounces — one call always presses once (hysteresis lives upstream in handFeel, see handFeel.test.ts)', () => {
    dom.setHit(findKey(kb.element as unknown as FakeNode, 'a'));
    kb.pressAt(10, 10);
    kb.pressAt(10, 10); // a second, distinct release
    expect(field.value).toBe('aa'); // both counted — no built-in suppression here
  });

  it('C005 pressAt/hoverAt take no hand identity — either hand\'s coordinates press the same key', () => {
    const btn = findKey(kb.element as unknown as FakeNode, 'a');
    dom.setHit(btn);
    kb.pressAt(10, 10); // "left hand" at some point
    dom.setHit(btn);
    kb.pressAt(900, 900); // "right hand" at a different point, same button
    expect(field.value).toBe('aa');
  });

  // BUG: the dwell timer started by hoverAt is a bare setTimeout with no
  // cancel hook reachable from outside (main.ts's 'lost' case resets the
  // cursor/hover class but never touches the keyboard — see main.ts's
  // `case 'lost':` block). Once dwell starts, losing the hand cannot stop it.
  it.fails('C006 losing the hand mid-dwell should not fire the key', () => {
    vi.useFakeTimers();
    dom.setHit(findKey(kb.element as unknown as FakeNode, 'c'));
    kb.hoverAt(10, 10); // dwell starts
    // hand lost here — nothing in this module's public API lets a caller
    // cancel the pending dwell (no onLost/cancelDwell on OnScreenKeyboard).
    vi.advanceTimersByTime(600);
    expect(field.value).toBe(''); // desired: the key should not have fired
  });

  it('C008 hoverAt (a "point", not a pinch) never presses immediately — only a completed dwell or pressAt do', () => {
    dom.setHit(findKey(kb.element as unknown as FakeNode, 'a'));
    kb.hoverAt(10, 10);
    expect(field.value).toBe('');
  });

  // BUG: DWELL_MS is a hardcoded module constant (onscreenKeyboard.ts:27);
  // there is no API to raise it for the 'assist' hand profile (900ms per
  // handProfile.ts) or lower it for 'precise' (600ms, coincidentally the
  // same as the hardcoded value) — every profile gets exactly 600ms here.
  it('C009 the keyboard\'s dwell time is fixed at 600ms regardless of hand profile (not profile-tunable)', () => {
    vi.useFakeTimers();
    dom.setHit(findKey(kb.element as unknown as FakeNode, 'd'));
    kb.hoverAt(10, 10);
    vi.advanceTimersByTime(599);
    expect(field.value).toBe(''); // not yet
    vi.advanceTimersByTime(1);
    expect(field.value).toBe('d'); // fires at exactly 600ms — an assist-profile
    // user who needs the documented 900ms gets no extra time on this control.
    expect((kb as unknown as Record<string, unknown>).setDwellMs).toBeUndefined();
  });

  it('C010 a very slow, deliberate dwell still registers exactly once', () => {
    vi.useFakeTimers();
    dom.setHit(findKey(kb.element as unknown as FakeNode, 'e'));
    kb.hoverAt(10, 10);
    vi.advanceTimersByTime(60_000); // absurdly slow — no upper bound exists
    expect(field.value).toBe('e');
  });

  it('C011 fast successive taps on two different keys both register (no cross-key refractory in this module)', () => {
    dom.setHit(findKey(kb.element as unknown as FakeNode, 'a'));
    kb.pressAt(10, 10);
    dom.setHit(findKey(kb.element as unknown as FakeNode, 'b'));
    kb.pressAt(11, 11); // immediately after, zero elapsed time
    expect(field.value).toBe('ab');
  });

  it('C012 a key at the very bottom edge of the keyboard rect is just as reachable as any other', () => {
    (kb.element as unknown as FakeNode).setRect({ left: 0, top: 700, right: 1000, bottom: 800 });
    const btn = findKey(kb.element as unknown as FakeNode, 'z'); // bottom row
    dom.setHit(btn);
    const consumed = kb.pressAt(500, 800); // clientY === rect.bottom exactly
    expect(consumed).toBe(true);
    expect(field.value).toBe('z');
  });

  it('C014 pinch-release on Shift through the hand path capitalizes the next letter', () => {
    dom.setHit(findKey(kb.element as unknown as FakeNode, 'Shift'));
    kb.pressAt(1, 1);
    dom.setHit(findKey(kb.element as unknown as FakeNode, 'a'));
    kb.pressAt(2, 2);
    expect(field.value).toBe('A');
  });

  it('C021 pinch-release on Close dismisses the keyboard', () => {
    expect(kb.isOpen()).toBe(true);
    dom.setHit(findKey(kb.element as unknown as FakeNode, 'Close'));
    kb.pressAt(1, 1);
    expect(kb.isOpen()).toBe(false);
  });

  it('C025 focusing an editable field auto-opens the keyboard when autoOpen is on, not when it is off', () => {
    kb.close();
    kb.setAutoOpen(false);
    const other = new FakeInputEl('input');
    (globalThis as unknown as { document: { dispatchEvent: (e: unknown) => void } }).document.dispatchEvent({ type: 'focusin', target: other });
    expect(kb.isOpen()).toBe(false);

    kb.setAutoOpen(true);
    (globalThis as unknown as { document: { dispatchEvent: (e: unknown) => void } }).document.dispatchEvent({ type: 'focusin', target: other });
    expect(kb.isOpen()).toBe(true);
  });
});
