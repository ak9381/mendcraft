// C2 Say box / text command field: hand-path tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandPointer, type HandPointer } from '../../src/canvas/handPointer';
import { synthHand as synthHandAt } from '../helpers/synthHands';
import type { Pt } from '../../src/input/handLogic';
import { wireSayBar } from '../../src/canvas/mobile/components/sayBar';
import { MIC_IDLE_LABEL, MIC_LISTENING_LABEL } from '../../src/canvas/micFab';
import { mountToolPalette } from '../../src/canvas/toolPalette';

const W = 1000;
const H = 800;

/** Open pointing hand whose PALM CENTRE (the cursor anchor) maps exactly to
 *  screen (px, py) — the shared builder handPointerPipeline.test.ts uses. */
function synthHand(px: number, py: number, pinched: boolean): Pt[] {
  return synthHandAt(px, py, pinched, W, H);
}

function fakeSayInput(rect: { left: number; top: number; width: number; height: number }) {
  return {
    tagName: 'INPUT',
    rect,
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    getAttribute: () => null,
    closest: () => null,
    // Matches the generic text-input selector (handPointer.ts:311) but not
    // the range-slider check (:338) — this is a plain text input, not a <input type=range>.
    matches: (sel: string) => sel !== 'input[type=range]' && sel.split(',').some((s) => s.trim().startsWith('input')),
    getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }),
    getRootNode: () => ({ host: null }),
    parentElement: null,
    focus: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}
function fakeOverlayEl() {
  return { className: '', hidden: true, style: {} as Record<string, string>, classList: { toggle: () => {}, add: () => {}, remove: () => {} }, setAttribute: () => {}, remove: () => {} };
}
function fakeDoc(input: ReturnType<typeof fakeSayInput>) {
  return {
    createElement: () => fakeOverlayEl(),
    body: { append: () => {} },
    querySelectorAll: (sel: string) => (sel.split(',').some((s) => s.trim().startsWith('input')) ? [input] : []),
    elementFromPoint: (x: number, y: number) => {
      const r = input.rect;
      return x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height ? input : null;
    },
  } as unknown as Document;
}

describe('C026 a dwell-click on the say input focuses it, same generic path as any control', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).innerWidth = W;
    (globalThis as Record<string, unknown>).innerHeight = H;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).innerWidth;
    delete (globalThis as Record<string, unknown>).innerHeight;
  });

  it('a dwell on the say box calls activate() -> focus(), not click()', () => {
    const input = fakeSayInput({ left: 100, top: 30, width: 200, height: 40 });
    const hp: HandPointer = createHandPointer(fakeDoc(input), {});
    let t = 0;
    const feed = (px: number, py: number, frames: number) => {
      for (let i = 0; i < frames; i++) { t += 33; hp.update([synthHand(px, py, false)], t); }
    };
    feed(500, 400, 5);
    feed(160, 50, 115); // settle + a long rest (one click per visit) on the say box
    expect(hp.target).toBe(input);
    expect(input.focus).toHaveBeenCalledTimes(1);
    hp.destroy();
  });
});

function fakeTalkBtn() {
  const handlers: Record<string, Array<(e?: unknown) => void>> = {};
  const classes = new Set<string>();
  return {
    attrs: {} as Record<string, string>,
    textContent: '',
    hidden: false,
    focused: false,
    classList: {
      add: (...cs: string[]) => cs.forEach((c) => classes.add(c)),
      remove: (...cs: string[]) => cs.forEach((c) => classes.delete(c)),
      contains: (c: string) => classes.has(c),
      toggle: (c: string, on?: boolean) => { (on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c); },
    },
    setAttribute(k: string, v: string) { this.attrs[k] = v; },
    getAttribute(k: string) { return this.attrs[k] ?? null; },
    addEventListener(t: string, f: (e?: unknown) => void) { (handlers[t] ??= []).push(f); },
    fire(t: string, e?: unknown) { handlers[t]?.forEach((f) => f(e)); },
    focus() { this.focused = true; },
    querySelector: () => null,
  } as any;
}

function setupSayBar() {
  const form = fakeTalkBtn();
  const input = fakeTalkBtn();
  const talk = fakeTalkBtn();
  const label = fakeTalkBtn();
  talk.querySelector = (sel: string) => (sel === '.mc-m-talk-label' ? label : null);
  label.textContent = MIC_IDLE_LABEL; // sayBarHtml()'s own template already renders this
  const host: any = {
    querySelector: (sel: string) => {
      if (sel === '.mc-m-saybar') return form;
      if (sel === '.mc-m-say-in') return input;
      if (sel === '.mc-m-talk') return talk;
      return null;
    },
  };
  wireSayBar(host, () => {});
  return { talk, label };
}

describe('C029 pinch-release on the mic toggle button toggles listening, via the generic click path', () => {
  it('one pinch-release (click) starts listening', () => {
    const { talk, label } = setupSayBar();
    expect(label.textContent).toBe(MIC_IDLE_LABEL);
    talk.fire('click');
    expect(talk.attrs['aria-pressed']).toBe('true');
    expect(label.textContent).toBe(MIC_LISTENING_LABEL);
  });
});

describe('C030 double-tap the mic toggle returns it to idle, same as two mouse clicks', () => {
  it('two pinch-releases toggle twice back to idle', () => {
    const { talk, label } = setupSayBar();
    talk.fire('click');
    talk.fire('click');
    expect(talk.attrs['aria-pressed']).toBe('false');
    expect(label.textContent).toBe(MIC_IDLE_LABEL);
  });
});

function setupPalette() {
  const sayInput = fakeTalkBtn();
  const tools = fakeTalkBtn();
  tools.querySelector = (sel: string) => (sel === '#mc-say-in' ? sayInput : sel.includes('button') ? fakeTalkBtn() : null);
  const chip = fakeTalkBtn();
  const keydownHandlers: Array<(e: unknown) => void> = [];
  const doc: any = { activeElement: null, createElement: () => chip, addEventListener: (t: string, f: (e: unknown) => void) => { if (t === 'keydown') keydownHandlers.push(f); }, removeEventListener: () => {} };
  const root: any = fakeTalkBtn();
  root.ownerDocument = doc;
  root.querySelector = (sel: string) => (sel === '.mc-bar-tools' ? tools : null);
  root.append = () => {};
  const win: any = { matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }), setTimeout: (fn: () => void) => { fn(); return 0; } };
  return { tools, sayInput, root, win, fireEscape: () => keydownHandlers.forEach((f) => f({ key: 'Escape', preventDefault() {} })) };
}

describe('C032 Escape cannot back out of a mere say-box "peek" (only a full Tools open)', () => {
  it('peekSay(true) focuses the say box, but Escape leaves the peek open — no cancel path', () => {
    const { tools, sayInput, root, win, fireEscape } = setupPalette();
    const palette = mountToolPalette(root, win);
    palette.peekSay(true);
    expect(sayInput.focused).toBe(true);
    expect(tools.hidden).toBe(false);
    fireEscape();
    // Desired: Escape should back out of the peek like it does a full open().
    // Actual: toolPalette.ts's keydown handler only checks `openState`
    // (set by open()), never the separate `peek` flag peekSay() sets —
    // Escape is silently swallowed while only peeking.
    expect(tools.hidden).toBe(false); // still showing; nothing closed it
  });
});
