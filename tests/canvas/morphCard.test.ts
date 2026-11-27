import { describe, expect, it } from 'vitest';
import { mountMorphCard } from '../../src/canvas/morphCard';

/** Minimal hand-rolled fake DOM, in the same style the rest of this suite
 *  uses under Vitest's node environment (no jsdom) — see swarmDock.test.ts.
 *  Rich enough for morphCard.ts's actual DOM surface: innerHTML templates
 *  with nested tags/attrs, class-only querySelector, classList, a plain
 *  `style` property bag (morphCard.ts assigns `el.style.top = '...'`, not
 *  `style.setProperty`), hidden, textContent and click listeners. */
class El {
  tag: string;
  attrs: Record<string, string> = {};
  classSet = new Set<string>();
  children: El[] = [];
  parent: El | null = null;
  hidden = false;
  style: Record<string, string> = {};
  private html = '';
  private text = '';
  private listeners: { type: string; fn: (e: unknown) => void }[] = [];
  constructor(tag: string) { this.tag = tag; }
  set className(v: string) { this.classSet = new Set(v.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classSet].join(' '); }
  get classList() {
    const self = this;
    return {
      add: (c: string) => self.classSet.add(c),
      remove: (c: string) => self.classSet.delete(c),
      contains: (c: string) => self.classSet.has(c),
    };
  }
  set innerHTML(v: string) { this.html = v; this.children = parseHTML(v); this.children.forEach((c) => { c.parent = this; }); }
  get innerHTML() { return this.html; }
  set textContent(v: string) { this.text = v; this.html = ''; this.children = []; }
  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this.text;
  }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  appendChild(el: El) { el.parent = this; this.children.push(el); return el; }
  append(...els: El[]) { els.forEach((e) => this.appendChild(e)); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  addEventListener(type: string, fn: (e: unknown) => void) { this.listeners.push({ type, fn }); }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn));
  }
  click() { this.listeners.filter((l) => l.type === 'click').forEach((l) => l.fn({ target: this })); }
  querySelector(sel: string): El | null { return findAll(this, sel)[0] ?? null; }
}

/** Just enough HTML→El parsing for morphCard.ts's one static `innerHTML`
 *  template: nested tags with `class="..."`/other attrs and a bare boolean
 *  `hidden`. Text runs between tags are dropped on parse (not needed — the
 *  component re-sets textContent/innerHTML on the elements it queries back
 *  out before a test ever reads them). */
function parseHTML(html: string): El[] {
  const stack: El[] = [];
  const roots: El[] = [];
  const tokenRe = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^<>]*)?\/?>|[^<]+/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html))) {
    const token = m[0];
    if (token[0] !== '<') continue;
    if (token.startsWith('</')) { stack.pop(); continue; }
    const tagMatch = /^<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*)?)\/?>$/.exec(token)!;
    const el = new El(tagMatch[1]);
    const attrRe = /([a-zA-Z-]+)(?:="([^"]*)")?/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(tagMatch[2] ?? ''))) {
      const key = am[1]; const val = am[2] ?? '';
      if (key === 'class') el.className = val;
      else if (key === 'hidden') el.hidden = true;
      else el.attrs[key] = val;
    }
    if (stack.length) stack[stack.length - 1].appendChild(el); else roots.push(el);
    if (!token.endsWith('/>')) stack.push(el);
  }
  return roots;
}

function parsePart(part: string) {
  const m = /^([a-zA-Z0-9-]*)((?:\.[a-zA-Z0-9-]+)*)$/.exec(part.trim());
  if (!m) throw new Error(`bad fake selector part: ${part}`);
  return { tag: m[1] || null, classes: (m[2].match(/\.[a-zA-Z0-9-]+/g) ?? []).map((c) => c.slice(1)) };
}
function matchesPart(el: El, part: ReturnType<typeof parsePart>): boolean {
  if (part.tag && el.tag !== part.tag) return false;
  if (part.classes.some((c) => !el.classSet.has(c))) return false;
  return true;
}
function descendants(el: El): El[] {
  const out: El[] = [];
  for (const c of el.children) { out.push(c); out.push(...descendants(c)); }
  return out;
}
function findAll(root: El, selector: string): El[] {
  const part = parsePart(selector);
  return descendants(root).filter((el) => matchesPart(el, part));
}

class FakeDoc extends El {
  createElement(tag: string) { return new El(tag); }
}

function makeRoot() {
  const doc = new FakeDoc('#document');
  const root = new El('div');
  (root as unknown as { ownerDocument: unknown }).ownerDocument = doc as unknown as Document;
  return { doc, root };
}

function fakeTimers() {
  const pending: { id: number; cb: () => void; ms: number }[] = [];
  let nextId = 1;
  const setTimer = ((cb: () => void, ms?: number) => {
    const id = nextId++;
    pending.push({ id, cb, ms: ms ?? 0 });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  const clearTimer = ((id?: unknown) => {
    const i = pending.findIndex((p) => p.id === id);
    if (i >= 0) pending.splice(i, 1);
  }) as typeof clearTimeout;
  return {
    setTimer,
    clearTimer,
    pendingCount: () => pending.length,
    fireDueBy(ms: number) {
      // Fire (and remove) every pending timer scheduled at or before `ms`,
      // in the order they were scheduled.
      const due = pending.filter((p) => p.ms <= ms);
      for (const p of due) {
        const i = pending.indexOf(p);
        if (i >= 0) pending.splice(i, 1);
        p.cb();
      }
    },
  };
}

const RECT = { left: 100, top: 300, width: 200, height: 80 };

describe('mountMorphCard — open / listening wording', () => {
  it('open() shows the title with the label and the listening-on line', () => {
    const { root } = makeRoot();
    const card = mountMorphCard(root as unknown as HTMLElement, { onCancel: () => {}, onUndo: () => {} });
    card.open({ label: 'Desk lamp', rect: RECT, listening: true });
    expect(card.isOpen()).toBe(true);
    expect((card.el as unknown as El).hidden).toBe(false);
    const title = (card.el as unknown as El).querySelector('.mc-morph-card-title')!;
    expect(title.innerHTML).toContain('<strong>Desk lamp</strong>');
    expect(title.innerHTML).toContain('what do you want to do?');
    const line = (card.el as unknown as El).querySelector('.mc-morph-card-line')!;
    expect(line.innerHTML).toContain('Listening… say it, or Cancel.');
    expect(line.innerHTML).toContain('mc-morph-dot');
    expect(line.innerHTML).toContain('is-sage');
  });

  it('open() with listening:false shows the typed-fallback wording', () => {
    const { root } = makeRoot();
    const card = mountMorphCard(root as unknown as HTMLElement, { onCancel: () => {}, onUndo: () => {} });
    card.open({ label: 'Desk lamp', rect: RECT, listening: false });
    const line = (card.el as unknown as El).querySelector('.mc-morph-card-line')!;
    expect(line.innerHTML).toContain('Type it in the say box, or Cancel.');
  });

  it('setListening(false) after open swaps the wording', () => {
    const { root } = makeRoot();
    const card = mountMorphCard(root as unknown as HTMLElement, { onCancel: () => {}, onUndo: () => {} });
    card.open({ label: 'Desk lamp', rect: RECT, listening: true });
    card.setListening(false);
    const line = (card.el as unknown as El).querySelector('.mc-morph-card-line')!;
    expect(line.innerHTML).toContain('Type it in the say box, or Cancel.');
  });
});

describe('mountMorphCard — state transitions and timers', () => {
  it('showDone() shows "Changed.", reveals Undo, relabels Cancel to Close, and auto-closes at 6000ms', () => {
    const { root } = makeRoot();
    const timers = fakeTimers();
    let autoClosed = 0;
    const card = mountMorphCard(root as unknown as HTMLElement, {
      onCancel: () => {}, onUndo: () => {},
      onAutoClose: () => { autoClosed++; },
      setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    });
    card.open({ label: 'Desk lamp', rect: RECT, listening: true });
    card.showDone();
    const line = (card.el as unknown as El).querySelector('.mc-morph-card-line')!;
    expect(line.textContent).toBe('Changed.');
    const undo = (card.el as unknown as El).querySelector('.mc-morph-undo')!;
    const cancel = (card.el as unknown as El).querySelector('.mc-morph-cancel')!;
    expect(undo.hidden).toBe(false);
    expect(cancel.textContent).toBe('Close');
    expect(card.isOpen()).toBe(true);
    timers.fireDueBy(5999);
    expect(autoClosed).toBe(0);
    expect(card.isOpen()).toBe(true);
    timers.fireDueBy(6000);
    expect(autoClosed).toBe(1);
    expect(card.isOpen()).toBe(false);
    expect((card.el as unknown as El).hidden).toBe(true);
  });

  it('showEmpty() shows the didn\'t-hear line and auto-closes at 5000ms', () => {
    const { root } = makeRoot();
    const timers = fakeTimers();
    let autoClosed = 0;
    const card = mountMorphCard(root as unknown as HTMLElement, {
      onCancel: () => {}, onUndo: () => {},
      onAutoClose: () => { autoClosed++; },
      setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    });
    card.open({ label: 'Desk lamp', rect: RECT, listening: true });
    card.showEmpty();
    const line = (card.el as unknown as El).querySelector('.mc-morph-card-line')!;
    expect(line.textContent).toBe("Didn't hear anything — hold the board again, or press Talk.");
    timers.fireDueBy(5000);
    expect(autoClosed).toBe(1);
    expect(card.isOpen()).toBe(false);
  });

  it('showError(line) shows the given error text and auto-closes at 5000ms', () => {
    const { root } = makeRoot();
    const timers = fakeTimers();
    let autoClosed = 0;
    const card = mountMorphCard(root as unknown as HTMLElement, {
      onCancel: () => {}, onUndo: () => {},
      onAutoClose: () => { autoClosed++; },
      setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    });
    card.open({ label: 'Desk lamp', rect: RECT, listening: true });
    card.showError("Couldn't make that change.");
    const line = (card.el as unknown as El).querySelector('.mc-morph-card-line')!;
    expect(line.textContent).toBe("Couldn't make that change.");
    timers.fireDueBy(5000);
    expect(autoClosed).toBe(1);
  });

  it('showWorking(line) keeps the card open with an amber dot and the given line, no auto-close', () => {
    const { root } = makeRoot();
    const timers = fakeTimers();
    const card = mountMorphCard(root as unknown as HTMLElement, {
      onCancel: () => {}, onUndo: () => {},
      setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    });
    card.open({ label: 'Desk lamp', rect: RECT, listening: true });
    card.showWorking('Changing…');
    const line = (card.el as unknown as El).querySelector('.mc-morph-card-line')!;
    expect(line.innerHTML).toContain('is-amber');
    expect(line.innerHTML).toContain('Changing…');
    expect(timers.pendingCount()).toBe(0);
    expect(card.isOpen()).toBe(true);
  });
});

describe('mountMorphCard — chip clicks', () => {
  it('clicking the Cancel chip calls onCancel and closes the card', () => {
    const { root } = makeRoot();
    let cancelled = 0;
    const card = mountMorphCard(root as unknown as HTMLElement, { onCancel: () => { cancelled++; }, onUndo: () => {} });
    card.open({ label: 'Desk lamp', rect: RECT, listening: true });
    const cancel = (card.el as unknown as El).querySelector('.mc-morph-cancel')!;
    cancel.click();
    expect(cancelled).toBe(1);
    expect(card.isOpen()).toBe(false);
  });

  it('clicking the Undo chip in the done state calls onUndo and closes the card', () => {
    const { root } = makeRoot();
    let undone = 0;
    const timers = fakeTimers();
    const card = mountMorphCard(root as unknown as HTMLElement, {
      onCancel: () => {}, onUndo: () => { undone++; },
      setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    });
    card.open({ label: 'Desk lamp', rect: RECT, listening: true });
    card.showDone();
    const undo = (card.el as unknown as El).querySelector('.mc-morph-undo')!;
    undo.click();
    expect(undone).toBe(1);
    expect(card.isOpen()).toBe(false);
  });

  it('onUndo via chip click never fires onAutoClose, and clears the pending done timer', () => {
    const { root } = makeRoot();
    let autoClosed = 0;
    const timers = fakeTimers();
    const card = mountMorphCard(root as unknown as HTMLElement, {
      onCancel: () => {}, onUndo: () => {},
      onAutoClose: () => { autoClosed++; },
      setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    });
    card.open({ label: 'Desk lamp', rect: RECT, listening: true });
    card.showDone();
    const undo = (card.el as unknown as El).querySelector('.mc-morph-undo')!;
    undo.click();
    expect(timers.pendingCount()).toBe(0);
    timers.fireDueBy(10000);
    expect(autoClosed).toBe(0);
  });
});

describe('mountMorphCard — close() and isOpen()', () => {
  it('isOpen() reflects open()/close() transitions', () => {
    const { root } = makeRoot();
    const card = mountMorphCard(root as unknown as HTMLElement, { onCancel: () => {}, onUndo: () => {} });
    expect(card.isOpen()).toBe(false);
    card.open({ label: 'Desk lamp', rect: RECT, listening: true });
    expect(card.isOpen()).toBe(true);
    card.close();
    expect(card.isOpen()).toBe(false);
  });

  it('close() clears any pending auto-dismiss timer — no onAutoClose fires later', () => {
    const { root } = makeRoot();
    let autoClosed = 0;
    const timers = fakeTimers();
    const card = mountMorphCard(root as unknown as HTMLElement, {
      onCancel: () => {}, onUndo: () => {},
      onAutoClose: () => { autoClosed++; },
      setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    });
    card.open({ label: 'Desk lamp', rect: RECT, listening: true });
    card.showDone();
    expect(timers.pendingCount()).toBe(1);
    card.close();
    expect(timers.pendingCount()).toBe(0);
    timers.fireDueBy(10000);
    expect(autoClosed).toBe(0);
    expect(card.isOpen()).toBe(false);
  });

  it('destroy() removes the element from root', () => {
    const { root } = makeRoot();
    const card = mountMorphCard(root as unknown as HTMLElement, { onCancel: () => {}, onUndo: () => {} });
    expect((root as unknown as El).children).toContain(card.el as unknown as El);
    card.destroy();
    expect((root as unknown as El).children).not.toContain(card.el as unknown as El);
  });
});

describe('mountMorphCard — placement', () => {
  it('places the card above the rect (bottom-anchored) when rect.top >= 140', () => {
    const { root } = makeRoot();
    const card = mountMorphCard(root as unknown as HTMLElement, { onCancel: () => {}, onUndo: () => {} });
    card.open({ label: 'Desk lamp', rect: { left: 100, top: 300, width: 200, height: 80 }, listening: true });
    const style = (card.el as unknown as El).style;
    expect(style.top).toBe('');
    expect(style.bottom).not.toBe('');
  });

  it('flips to placing the card below the rect when rect.top < 140', () => {
    const { root } = makeRoot();
    const card = mountMorphCard(root as unknown as HTMLElement, { onCancel: () => {}, onUndo: () => {} });
    card.open({ label: 'Desk lamp', rect: { left: 100, top: 40, width: 200, height: 80 }, listening: true });
    const style = (card.el as unknown as El).style;
    expect(style.bottom).toBe('');
    expect(style.top).toBe('130px'); // 40 + 80 + 10
  });

  it('clamps left into the viewport even with no global innerWidth (falls back to 1280)', () => {
    const { root } = makeRoot();
    const card = mountMorphCard(root as unknown as HTMLElement, { onCancel: () => {}, onUndo: () => {} });
    card.open({ label: 'Desk lamp', rect: { left: -50, top: 300, width: 200, height: 80 }, listening: true });
    const style = (card.el as unknown as El).style;
    expect(style.left).toBe('8px');
  });
});
