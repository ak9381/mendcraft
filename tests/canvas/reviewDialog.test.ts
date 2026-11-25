import { describe, expect, it, vi } from 'vitest';
import { createReviewReceipts, clampReviewSize, engineChipText, honestyLines, loadReviewSize, mountReviewDialog, reviewActionFor, reviewWindowStart, saveReviewSize, REVIEW_WINDOW_WIDTH } from '../../src/canvas/reviewDialog';

describe('reviewActionFor', () => {
  it('approve maps to keep', () => { expect(reviewActionFor('approve')).toBe('keep'); });
  it('reject maps to drop', () => { expect(reviewActionFor('reject')).toBe('drop'); });
  it('ask-else never keeps or drops', () => { expect(reviewActionFor('ask-else')).toBeNull(); });
});

/** Minimal hand-rolled fake DOM, in the same style the rest of this suite
 *  uses for DOM modules under Vitest's node environment (no jsdom). */
class FakeEl {
  tag: string;
  className = '';
  hidden = false;
  type = '';
  textContent = '';
  children: FakeEl[] = [];
  listeners: Record<string, Array<(e?: unknown) => void>> = {};
  focused = false;
  id = '';
  open = false;
  scrollTop = 0;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  classList = {
    toggle: (c: string, on?: boolean) => {
      const set = new Set(this.className.split(/\s+/).filter(Boolean));
      if (on ?? !set.has(c)) set.add(c); else set.delete(c);
      this.className = [...set].join(' ');
    },
    contains: (c: string) => this.className.split(/\s+/).includes(c),
    add: (c: string) => this.classList.toggle(c, true),
    remove: (c: string) => this.classList.toggle(c, false),
  };
  constructor(tag: string) { this.tag = tag; }
  set innerHTML(_: string) { this.children = []; }
  get innerHTML() { return ''; }
  append(...nodes: FakeEl[]) { this.children.push(...nodes); }
  remove() {}
  setAttribute() {}
  addEventListener(type: string, fn: (e?: unknown) => void) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener() {}
  fire(type: string, e?: unknown) { this.listeners[type]?.forEach((f) => f(e)); }
  click() { this.fire('click'); }
  focus() { this.focused = true; fakeDoc.activeElement = this as unknown as HTMLElement; }
  querySelector<T = FakeEl>(sel: string): T | null {
    const cls = sel.replace(/^\./, '');
    const walk = (el: FakeEl): FakeEl | null => {
      for (const c of el.children) {
        if (c.className.split(/\s+/).includes(cls)) return c;
        const found = walk(c); if (found) return found;
      }
      return null;
    };
    return (walk(this) as unknown as T) ?? null;
  }
}

const fakeDoc = { activeElement: null as unknown as HTMLElement, createElement: (tag: string) => new FakeEl(tag) };

function fakeCard() {
  const card = new FakeEl('div');
  const keep = new FakeEl('button'); keep.className = 'mc-proposal-keep';
  const drop = new FakeEl('button'); drop.className = 'mc-proposal-drop';
  let kept = false; let dropped = false;
  keep.addEventListener('click', () => { kept = true; });
  drop.addEventListener('click', () => { dropped = true; });
  card.append(keep, drop);
  return { card: card as unknown as HTMLElement, wasKept: () => kept, wasDropped: () => dropped };
}

function setup() {
  const root = new FakeEl('div') as unknown as HTMLElement;
  return { root };
}

describe('mountReviewDialog', () => {
  it('Approve clicks the card’s keep button', () => {
    const { root } = setup();
    const dialog = mountReviewDialog(root, {}, fakeDoc as unknown as Document);
    const { card, wasKept } = fakeCard();
    dialog.open({ title: 'Review', card });
    (root as unknown as FakeEl).querySelector('.mc-review-approve')!.click();
    expect(wasKept()).toBe(true);
  });

  it('Reject clicks the card’s drop button', () => {
    const { root } = setup();
    const dialog = mountReviewDialog(root, {}, fakeDoc as unknown as Document);
    const { card, wasDropped } = fakeCard();
    dialog.open({ title: 'Review', card });
    (root as unknown as FakeEl).querySelector('.mc-review-reject')!.click();
    expect(wasDropped()).toBe(true);
  });

  it('Ask for something else calls onAskElse, decides nothing, and closes', () => {
    const { root } = setup();
    const onAskElse = vi.fn();
    const dialog = mountReviewDialog(root, { onAskElse }, fakeDoc as unknown as Document);
    const { card, wasKept, wasDropped } = fakeCard();
    dialog.open({ title: 'Review', card });
    (root as unknown as FakeEl).querySelector('.mc-review-ask-else')!.click();
    expect(onAskElse).toHaveBeenCalledOnce();
    expect(wasKept()).toBe(false);
    expect(wasDropped()).toBe(false);
    expect(dialog.isOpen()).toBe(false);
  });

  it('Esc closes without deciding — the proposal stays waiting', () => {
    const { root } = setup();
    const dialog = mountReviewDialog(root, {}, fakeDoc as unknown as Document);
    const { card, wasKept, wasDropped } = fakeCard();
    dialog.open({ title: 'Review', card });
    const dialogEl = (root as unknown as FakeEl).children.find((c) => c.className === 'mc-review-dialog')!;
    dialogEl.fire('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
    expect(dialog.isOpen()).toBe(false);
    expect(wasKept()).toBe(false);
    expect(wasDropped()).toBe(false);
  });

  it('the ✕ close control dismisses without deciding — proposal stays waiting [A5-005]', () => {
    const { root } = setup();
    const dialog = mountReviewDialog(root, {}, fakeDoc as unknown as Document);
    const { card, wasKept, wasDropped } = fakeCard();
    dialog.open({ title: 'Review', card });
    const closeBtn = (root as unknown as FakeEl).querySelector('.mc-review-close');
    expect(closeBtn).not.toBeNull();
    closeBtn!.click();
    expect(dialog.isOpen()).toBe(false);
    expect(wasKept()).toBe(false);
    expect(wasDropped()).toBe(false);
  });

  it('the ✕ lives in the header, not the action row, so it can never cover Approve/Reject/Ask-else [A5-005]', () => {
    const { root } = setup();
    mountReviewDialog(root, {}, fakeDoc as unknown as Document);
    const closeBtn = (root as unknown as FakeEl).querySelector('.mc-review-close');
    expect(closeBtn).toBeTruthy();
    const actions = (root as unknown as FakeEl).querySelector('.mc-review-actions') as FakeEl | null;
    const inActions = actions?.querySelector('.mc-review-close') ?? null;
    expect(inActions).toBeNull();
    const head = (root as unknown as FakeEl).querySelector('.mc-review-head') as FakeEl | null;
    expect(head?.querySelector('.mc-review-close')).toBe(closeBtn);
  });

  it('is a ~560px window with a fist/mouse drag handle and a resize corner', () => {
    const { root } = setup();
    mountReviewDialog(root, {}, fakeDoc as unknown as Document);
    const dialogEl = (root as unknown as FakeEl).children.find((c) => c.className === 'mc-review-dialog')!;
    expect(REVIEW_WINDOW_WIDTH).toBe(560);
    expect((root as unknown as FakeEl).querySelector('.mc-review-resize')).toBeTruthy();
    const drag = (root as unknown as FakeEl).querySelector('.mc-review-drag') as FakeEl;
    expect(drag).toBeTruthy();
    // data-mc-drag-handle is set so fist-grab shares the mouse drag path.
    expect(dialogEl).toBeTruthy();
  });

  it('starts top-right inside the 24px safe zone and clear of the AI drawer', () => {
    const pos = reviewWindowStart({ width: 1960, height: 993 }, { barH: 80, aiW: 320, aiRight: 16 });
    expect(pos.top).toBe(104);
    expect(pos.right).toBe(24 + 320 + 16);
  });

  it('close() is a no-op when not open', () => {
    const { root } = setup();
    const dialog = mountReviewDialog(root, {}, fakeDoc as unknown as Document);
    expect(() => dialog.close()).not.toThrow();
    expect(dialog.isOpen()).toBe(false);
  });

  it('reads like a plan: + / ~ / − lines, engine chip, SIM tag, and the card kept only as a proxy', () => {
    const { root } = setup();
    const dialog = mountReviewDialog(root, {}, fakeDoc as unknown as Document);
    const { card, wasKept } = fakeCard();
    dialog.open({
      title: 'Better: grouped lights',
      card,
      changes: [
        { op: 'change', label: 'Title', detail: 'This room → Living room' },
        { op: 'add', label: 'Speaker', detail: 'music' },
        { op: 'remove', label: 'Fan' },
      ],
      facts: { engine: 'gemini', sim: true, youAsked: 'make it better', why: 'SIM · Grouping needs Deep', sentWhat: 'your words', bytes: 2048 },
    });
    const r = root as unknown as FakeEl;
    const list = r.querySelector('.mc-review-plan-list') as FakeEl;
    expect(list.children.map((li) => li.className)).toEqual(['mc-review-change is-change', 'mc-review-change is-add', 'mc-review-change is-remove']);
    expect(list.children.map((li) => li.children[0].textContent)).toEqual(['Rename', 'Add', 'Remove']);
    expect((r.querySelector('.mc-review-engine') as FakeEl).textContent).toBe('Gemini · cloud');
    expect((r.querySelector('.mc-review-sim') as FakeEl).hidden).toBe(false);
    expect((r.querySelector('.mc-review-asked') as FakeEl).textContent).toBe('You asked: “make it better”');
    expect((r.querySelector('.mc-review-why') as FakeEl).textContent).toBe('Why Gemini: Grouping needs Deep');
    const left = r.querySelector('.mc-review-left') as FakeEl;
    expect(left.children.map((c) => c.textContent).join('')).toBe('What left this device: your words · 2.0 KB');
    expect((left.querySelector('.mc-review-left-bytes') as FakeEl).textContent).toBe(' · 2.0 KB');
    expect((r.querySelector('.mc-review-card-host') as FakeEl).className).toContain('is-proxy-only');
    r.querySelector('.mc-review-approve')!.click();
    expect(wasKept()).toBe(true);
  });

  it('without a plan list the proposal card itself is shown (old behaviour)', () => {
    const { root } = setup();
    const dialog = mountReviewDialog(root, {}, fakeDoc as unknown as Document);
    dialog.open({ title: 'Review', card: fakeCard().card });
    const r = root as unknown as FakeEl;
    expect((r.querySelector('.mc-review-card-host') as FakeEl).className).not.toContain('is-proxy-only');
    expect((r.querySelector('.mc-review-plan-list') as FakeEl).hidden).toBe(true);
    expect((r.querySelector('.mc-review-honesty') as FakeEl).hidden).toBe(true);
  });

  it('the three decision buttons keep their data-i18n keys (Kannada labels)', () => {
    const { root } = setup();
    const attrs: Record<string, string> = {};
    const doc = {
      ...fakeDoc,
      createElement: (tag: string) => {
        const e = new FakeEl(tag);
        e.setAttribute = ((k: string, v: string) => { if (k === 'data-i18n') attrs[v] = v; }) as never;
        return e;
      },
    };
    mountReviewDialog(root, {}, doc as unknown as Document);
    expect(Object.keys(attrs).sort()).toEqual(['approve', 'askElse', 'reject']);
  });
});

describe('review window size', () => {
  it('clamps a corner-drag to 420×320 … 80vw×85vh', () => {
    const vp = { width: 1470, height: 800 };
    expect(clampReviewSize({ width: 100, height: 100 }, vp)).toEqual({ width: 420, height: 320 });
    expect(clampReviewSize({ width: 5000, height: 5000 }, vp)).toEqual({ width: 1176, height: 680 });
    expect(clampReviewSize({ width: 600, height: 500 }, vp)).toEqual({ width: 600, height: 500 });
  });

  it('remembers the size, and survives storage that throws', () => {
    const mem: Record<string, string> = {};
    const store = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v; } };
    saveReviewSize(store, { width: 640, height: 480 });
    expect(loadReviewSize(store)).toEqual({ width: 640, height: 480 });
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(() => saveReviewSize(broken, { width: 1, height: 1 })).not.toThrow();
    expect(loadReviewSize(broken)).toBeNull();
    expect(loadReviewSize({ getItem: () => '{nope', setItem: () => {} })).toBeNull();
  });
});

describe('honesty footer', () => {
  it('engine chip names where it ran', () => {
    expect(engineChipText({ engine: 'nano' })).toBe('Nano · on this device');
    expect(engineChipText({ engine: 'gemini' })).toBe('Gemini · cloud');
  });
  it('0 bytes reads “Nothing left this device.”', () => {
    expect(honestyLines({ engine: 'nano', why: 'Small edit. Done here.', sentWhat: null, bytes: 0 })).toMatchObject({ why: 'Why Nano: Small edit. Done here.', left: 'Nothing left this device.' });
  });
  it('the reason drops the chip’s own words and never repeats “nothing left”', () => {
    expect(honestyLines({ engine: 'nano', why: 'SIM · Nano · on device — nothing left this device', bytes: 0 }).why).toBe('Why Nano: a quick draft, made right here on this device');
    expect(honestyLines({ engine: 'gemini', why: 'Gemini · cloud — sent your words to improve the layout', sentWhat: 'your words.', bytes: 2400 })).toMatchObject({ why: 'Why Gemini: sent your words to improve the layout', left: 'What left this device: your words · 2.3 KB' });
  });
  it('unmeasured bytes never invent a number', () => {
    expect(honestyLines({ engine: 'gemini', sentWhat: 'the tile dump' }).left).toBe('What left this device: the tile dump');
  });
});

describe('per-turn review receipts (footer never borrows another turn)', () => {
  it('the Kannada review shows the Kannada turn’s bytes, not the previous dashboard’s', () => {
    const r = createReviewReceipts();
    const dashboard = { engine: 'gemini', sent: 'your words, 3 device names', routeLine: 'Gemini · cloud — improve the layout', sim: true };
    const kannada = { engine: 'gemini', sent: 'the key list and your request.', routeLine: 'SIM · Kannada sentence: Deep understands it better.', sim: true };
    r.record(dashboard, 2355);
    r.record(kannada, 385);
    const f = r.facts(kannada, { youAsked: 'add kannada' });
    expect(f.bytes).toBe(385);
    expect(honestyLines(f).left).toBe('What left this device: the key list and your request · 385 B');
    expect(honestyLines(f).why).toBe('Why Gemini: Kannada sentence: Deep understands it better.');
  });

  it('a change with no AI call (no token) shows no bytes and says so', () => {
    const r = createReviewReceipts();
    r.record({ engine: 'gemini', sent: 'x', routeLine: 'y', sim: false }, 999);
    const f = r.facts(null, { youAsked: 'make it blue' });
    expect(f.bytes).toBeUndefined();
    expect(f.noAiCall).toBe(true);
    expect(honestyLines(f)).toMatchObject({ why: null, left: 'No AI call for this change.' });
  });

  it('a retried send in the same turn sums, and an unrecorded turn claims no number', () => {
    const r = createReviewReceipts();
    const t = { engine: 'gemini', sent: 'one tile', routeLine: 'z', sim: false };
    r.record(t, 100); r.record(t, 50);
    expect(r.facts(t).bytes).toBe(150);
    expect(r.facts({ ...t }).bytes).toBeUndefined();
  });
});

describe('review window keyboard', () => {
  function withDocListeners() {
    const docListeners: Record<string, Array<(e: unknown) => void>> = {};
    const doc = {
      ...fakeDoc,
      createElement: (tag: string) => new FakeEl(tag),
      addEventListener: (type: string, fn: (e: unknown) => void) => { (docListeners[type] ??= []).push(fn); },
      removeEventListener: () => {},
    };
    return { doc, fireDoc: (type: string, e: unknown) => docListeners[type]?.forEach((f) => f(e)) };
  }
  const key = (k: string, extra: Record<string, unknown> = {}) => ({ key: k, preventDefault() {}, stopPropagation() {}, ...extra });

  it('Escape closes it wherever focus is, without deciding', () => {
    const { doc, fireDoc } = withDocListeners();
    const root = new FakeEl('div');
    const dialog = mountReviewDialog(root as unknown as HTMLElement, {}, doc as unknown as Document);
    const { card, wasKept, wasDropped } = fakeCard();
    dialog.open({ title: 'Review', card });
    fireDoc('keydown', key('Escape', { target: null }));
    expect(dialog.isOpen()).toBe(false);
    expect(wasKept()).toBe(false);
    expect(wasDropped()).toBe(false);
  });

  it('Tab wraps over every control in the window: grip, ✕, decisions and the resize corner', () => {
    const root = new FakeEl('div');
    const dialog = mountReviewDialog(root as unknown as HTMLElement, {}, fakeDoc as unknown as Document);
    dialog.open({ title: 'Review', card: fakeCard().card });
    const dialogEl = root.children.find((c) => c.className === 'mc-review-dialog')!;
    const drag = root.querySelector('.mc-review-drag') as FakeEl;
    const close = root.querySelector('.mc-review-close') as FakeEl;
    const resize = root.querySelector('.mc-review-resize') as FakeEl;
    resize.focus();
    dialogEl.fire('keydown', key('Tab'));
    expect(fakeDoc.activeElement).toBe(drag);
    dialogEl.fire('keydown', key('Tab', { shiftKey: true }));
    expect(fakeDoc.activeElement).toBe(resize);
    expect(close).toBeTruthy();
  });
});
