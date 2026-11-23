import { describe, expect, it, vi } from 'vitest';
import { mountReviewDialog, reviewActionFor } from '../../src/canvas/reviewDialog';

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

  it('the ✕ lives outside the action row so it can never cover Approve/Reject/Ask-else [A5-005]', () => {
    const { root } = setup();
    mountReviewDialog(root, {}, fakeDoc as unknown as Document);
    const dialogEl = (root as unknown as FakeEl).children.find((c) => c.className === 'mc-review-dialog')!;
    // Direct child of the dialog (sibling of the body), not nested in the actions.
    const closeBtn = dialogEl.children.find((c) => c.className.includes('mc-review-close'));
    expect(closeBtn).toBeTruthy();
    const actions = (root as unknown as FakeEl).querySelector('.mc-review-actions') as FakeEl | null;
    const inActions = actions?.querySelector('.mc-review-close') ?? null;
    expect(inActions).toBeNull();
  });

  it('close() is a no-op when not open', () => {
    const { root } = setup();
    const dialog = mountReviewDialog(root, {}, fakeDoc as unknown as Document);
    expect(() => dialog.close()).not.toThrow();
    expect(dialog.isOpen()).toBe(false);
  });
});
