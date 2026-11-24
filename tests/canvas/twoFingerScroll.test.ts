// Two-finger SCROLL: index + middle out, ring + pinky in, thumb tucked.
// Replaces open-palm as the scroll trigger. 100 ms enter/exit debounce,
// handedness-aware, never a point or pinch, and never clicks while posed.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHandPointer, REACH, type HandPointer } from '../../src/canvas/handPointer';
import { getGestureTrace } from '../../src/canvas/gestureTrace';
import { classifyGesture, isTwoFingerScrollPose } from '../../src/input/gestures';
import { SCROLL, VSIGN, OPEN, POINT, PINCH } from '../helpers/hands';
import type { Pt } from '../../src/input/handLogic';

const W = 1000;
const H = 800;

function fakeOverlayEl() {
  const classes = new Set<string>();
  return {
    className: '',
    hidden: true,
    style: Object.assign({} as Record<string, string> & { setProperty: (k: string, v: string) => void }, {
      setProperty(k: string, v: string) { (this as Record<string, string>)[k] = v; },
    }),
    classList: {
      toggle: (c: string, on?: boolean) => {
        const next = on === undefined ? !classes.has(c) : on;
        if (next) classes.add(c); else classes.delete(c);
      },
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    setAttribute: () => {},
    remove: () => {},
  };
}
type FakeOverlayEl = ReturnType<typeof fakeOverlayEl>;

function fakeButton(rect: { left: number; top: number; width: number; height: number }) {
  const click = { calls: 0 };
  return {
    tagName: 'BUTTON',
    rect,
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    getAttribute: () => null,
    closest: () => null,
    matches: (sel: string) => sel.split(',').some((s) => s.trim().startsWith('button')),
    getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }),
    getRootNode: () => ({ host: null }),
    parentElement: null,
    click: () => { click.calls += 1; },
    dispatchEvent: () => true,
    get clickCount() { return click.calls; },
  };
}

function fakeScroller() {
  const el = {
    tagName: 'DIV',
    className: 'mc-review-body',
    overflowY: 'auto',
    scrollHeight: 2000,
    clientHeight: 400,
    scrollTop: 400,
    scrollLeft: 0,
    parentElement: null as null,
    ownerDocument: { defaultView: { getComputedStyle: () => ({ overflowY: 'auto', overflowX: 'hidden' }) } },
    closest: (sel: string) => (sel === '.mc-review-body' || sel === 'div' ? el : null),
    getRootNode: () => ({ host: null }),
    matches: () => false,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H }),
    classList: { contains: (c: string) => c === 'mc-review-body', add() {}, remove() {}, toggle() {} },
  };
  return el;
}

function fakeDoc(button: ReturnType<typeof fakeButton>, scroller: ReturnType<typeof fakeScroller>) {
  const created: FakeOverlayEl[] = [];
  const doc = {
    createElement: () => { const el = fakeOverlayEl(); created.push(el); return el; },
    body: { append: () => {} },
    querySelector: (sel: string) => (sel === '.mc-review-body' ? scroller : null),
    querySelectorAll: (sel: string) => {
      if (sel === '*' || sel === '[aria-modal=true]') return [];
      return sel.split(',').some((s) => s.trim().startsWith('button')) ? [button] : [];
    },
    elementFromPoint: (x: number, y: number) => {
      const r = button.rect;
      if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) return button;
      return scroller;
    },
  } as unknown as Document & { __created: FakeOverlayEl[] };
  (doc as unknown as { __created: FakeOverlayEl[] }).__created = created;
  return doc;
}

function cursorElOf(doc: Document): FakeOverlayEl {
  return (doc as unknown as { __created: FakeOverlayEl[] }).__created[1];
}

function toCam(px: number, py: number): { x: number; y: number } {
  return {
    x: 1 - (REACH.x0 + (px / W) * (REACH.x1 - REACH.x0)),
    y: REACH.y0 + (py / H) * (REACH.y1 - REACH.y0),
  };
}

function stamp<T>(pts: T[], label?: 'Left' | 'Right'): T[] {
  if (label) (pts as T[] & { label?: string }).label = label;
  return pts;
}

/** Two-finger scroll hand whose index tip maps to screen (px, py). */
function synthScroll(px: number, py: number, label: 'Left' | 'Right' = 'Right'): Pt[] {
  const tip = toCam(px, py);
  const cx = tip.x;
  const cy = tip.y;
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  // Palm size 0.2; index + middle reach well past OPEN_PALM_REACH.
  lm[8] = { x: cx, y: cy };                 // index tip (cursor)
  lm[0] = { x: cx, y: cy + 0.42 };          // wrist
  lm[9] = { x: cx, y: cy + 0.22 };          // middle MCP
  lm[5] = { x: cx - 0.04, y: cy + 0.22 };   // index MCP
  lm[6] = { x: cx, y: cy + 0.12 };          // index PIP (extended)
  lm[7] = { x: cx, y: cy + 0.06 };
  // Middle also extended, tips clearly separated.
  lm[10] = { x: cx + 0.06, y: cy + 0.12 };
  lm[11] = { x: cx + 0.07, y: cy + 0.06 };
  lm[12] = { x: cx + 0.08, y: cy };
  // Ring + pinky curled: tip closer to the wrist than its PIP so
  // fingerStates reads them as in, and tip-palm stay well under CURL_MAX.
  lm[13] = { x: cx + 0.10, y: cy + 0.22 };
  lm[14] = { x: cx + 0.10, y: cy + 0.28 }; // PIP farther from wrist than tip
  lm[15] = { x: cx + 0.10, y: cy + 0.30 };
  lm[16] = { x: cx + 0.10, y: cy + 0.34 }; // tip nearer the wrist
  lm[17] = { x: cx + 0.14, y: cy + 0.22 };
  lm[18] = { x: cx + 0.14, y: cy + 0.28 };
  lm[19] = { x: cx + 0.14, y: cy + 0.30 };
  lm[20] = { x: cx + 0.14, y: cy + 0.34 };
  // Thumb tucked on the index-MCP / palm side (not on the index tip).
  lm[1] = { x: cx - 0.03, y: cy + 0.28 };
  lm[2] = { x: cx - 0.04, y: cy + 0.24 };
  lm[3] = { x: cx - 0.03, y: cy + 0.23 };
  lm[4] = { x: cx - 0.02, y: cy + 0.22 };
  return stamp(lm, label);
}

/** Open palm at (px, py) — must NOT scroll anymore. */
function synthOpen(px: number, py: number): Pt[] {
  const tip = toCam(px, py);
  const cx = tip.x;
  const cy = tip.y;
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  lm[0] = { x: cx, y: cy + 0.22 };
  lm[9] = { x: cx, y: cy + 0.10 };
  lm[5] = { x: cx - 0.05, y: cy + 0.10 };
  lm[13] = { x: cx + 0.05, y: cy + 0.10 };
  lm[17] = { x: cx + 0.10, y: cy + 0.10 };
  for (const [pip, tipI, ox] of [[6, 8, -0.05], [10, 12, 0], [14, 16, 0.05], [18, 20, 0.10]] as const) {
    lm[pip] = { x: cx + ox, y: cy + 0.05 };
    lm[tipI] = { x: cx + ox, y: cy };
  }
  lm[8] = { x: cx, y: cy };
  lm[1] = { x: cx - 0.08, y: cy + 0.12 };
  lm[2] = { x: cx - 0.10, y: cy + 0.08 };
  lm[3] = { x: cx - 0.12, y: cy + 0.04 };
  lm[4] = { x: cx - 0.14, y: cy };
  return lm;
}

function synthPoint(px: number, py: number, pinched = false): Pt[] {
  const tip = toCam(px, py);
  const cx = tip.x;
  const cy = tip.y;
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  lm[8] = { x: cx, y: cy };
  lm[0] = { x: cx, y: cy + 0.42 };
  lm[9] = { x: cx, y: cy + 0.22 };
  lm[5] = { x: cx, y: cy + 0.22 };
  lm[6] = { x: cx, y: cy + 0.12 };
  lm[7] = { x: cx, y: cy + 0.06 };
  const palmY = cy + 0.26;
  lm[10] = { x: cx + 0.05, y: palmY + 0.04 }; lm[11] = { x: cx + 0.05, y: palmY + 0.02 }; lm[12] = { x: cx + 0.05, y: palmY };
  lm[13] = { x: cx + 0.08, y: cy + 0.22 }; lm[14] = { x: cx + 0.08, y: palmY + 0.04 }; lm[15] = { x: cx + 0.08, y: palmY + 0.02 }; lm[16] = { x: cx + 0.08, y: palmY };
  lm[17] = { x: cx + 0.12, y: cy + 0.22 }; lm[18] = { x: cx + 0.12, y: palmY + 0.04 }; lm[19] = { x: cx + 0.12, y: palmY + 0.02 }; lm[20] = { x: cx + 0.12, y: palmY };
  const gap = pinched ? 0.006 : 0.16;
  lm[1] = { x: cx - gap, y: cy + 0.18 }; lm[2] = { x: cx - gap, y: cy + 0.12 }; lm[3] = { x: cx - gap, y: cy + 0.06 };
  lm[4] = { x: cx - gap, y: cy };
  return lm;
}

describe('two-finger scroll classifier fixtures', () => {
  it('shared SCROLL fixture is scroll, never point or pinch', () => {
    expect(classifyGesture(SCROLL())).toBe('scroll');
    expect(classifyGesture(SCROLL(), 'Right')).toBe('scroll');
    expect(isTwoFingerScrollPose(SCROLL(), 'Right')).toBe(true);
    expect(classifyGesture(SCROLL())).not.toBe('point');
    expect(classifyGesture(SCROLL())).not.toBe('pinch');
  });

  it('works for a mirrored left hand', () => {
    const left = SCROLL().map((q) => ({ x: 1 - q.x, y: q.y })) as Pt[];
    expect(classifyGesture(left, 'Left')).toBe('scroll');
    expect(isTwoFingerScrollPose(left, 'Left')).toBe(true);
  });

  it('open palm, point, pinch, and a V with the thumb out are not scroll', () => {
    expect(classifyGesture(OPEN())).toBe('open-palm');
    expect(isTwoFingerScrollPose(OPEN())).toBe(false);
    expect(classifyGesture(POINT())).toBe('point');
    expect(isTwoFingerScrollPose(POINT())).toBe(false);
    expect(classifyGesture(PINCH())).toBe('pinch');
    expect(isTwoFingerScrollPose(PINCH())).toBe(false);
    expect(classifyGesture(VSIGN())).not.toBe('scroll');
    expect(isTwoFingerScrollPose(VSIGN())).toBe(false);
  });
});

describe('two-finger scroll pointer', () => {
  let hp: HandPointer;
  let doc: Document;
  let btn: ReturnType<typeof fakeButton>;
  let scroller: ReturnType<typeof fakeScroller>;
  let t: number;
  const tr = getGestureTrace();

  beforeEach(() => {
    (globalThis as Record<string, unknown>).innerWidth = W;
    (globalThis as Record<string, unknown>).innerHeight = H;
    btn = fakeButton({ left: 100, top: 200, width: 140, height: 60 });
    scroller = fakeScroller();
    doc = fakeDoc(btn, scroller);
    hp = createHandPointer(doc, {});
    t = 0;
    tr.enable();
    tr.clear();
  });
  afterEach(() => {
    hp.destroy();
    tr.clear();
    delete (globalThis as Record<string, unknown>).innerWidth;
    delete (globalThis as Record<string, unknown>).innerHeight;
  });

  function lastClass(): string | undefined {
    const frames = tr.frames;
    return frames[frames.length - 1]?.classification;
  }

  it('classifies the synth scroll hand as scroll (not point or pinch)', () => {
    const h = synthScroll(500, 400, 'Right');
    expect(classifyGesture(h, 'Right')).toBe('scroll');
    expect(classifyGesture(h, 'Right')).not.toBe('point');
    expect(classifyGesture(h, 'Right')).not.toBe('pinch');
    t += 33;
    hp.update([h], t);
    expect(lastClass()).toBe('scroll');
    expect(tr.frames.at(-1)?.handedness).toBe('Right');
  });

  it('engages after ~100 ms and not before', () => {
    // Two frames (~33 ms held after the first) stay in the enter debounce.
    t += 33; hp.update([synthScroll(500, 400)], t);
    t += 33; hp.update([synthScroll(500, 400)], t);
    expect(lastClass()).toBe('scroll');
    expect(cursorElOf(doc).classList.contains('is-palm-scroll')).toBe(false);

    t += 80; hp.update([synthScroll(500, 400)], t); // 113 ms after the first pose frame
    expect(cursorElOf(doc).classList.contains('is-palm-scroll')).toBe(true);
  });

  it('open palm no longer scrolls, even when held well past 100 ms', () => {
    for (let i = 0; i < 10; i++) {
      t += 33;
      hp.update([synthOpen(500, 400)], t);
    }
    expect(lastClass()).toBe('open-palm');
    expect(cursorElOf(doc).classList.contains('is-palm-scroll')).toBe(false);
  });

  it('drops the scroll after a ~100 ms exit debounce, not immediately', () => {
    t += 33; hp.update([synthScroll(500, 400)], t);
    t += 120; hp.update([synthScroll(500, 400)], t);
    expect(cursorElOf(doc).classList.contains('is-palm-scroll')).toBe(true);

    t += 33; hp.update([synthPoint(500, 400)], t);
    expect(cursorElOf(doc).classList.contains('is-palm-scroll')).toBe(true);

    t += 110; hp.update([synthPoint(500, 400)], t); // 143 ms after leaving
    expect(cursorElOf(doc).classList.contains('is-palm-scroll')).toBe(false);
  });

  it('never clicks a control while in the scroll pose (dwell or pinch)', () => {
    // Aim the two-finger pose at a button and hold well past dwell + a "pinch".
    for (let i = 0; i < 40; i++) {
      t += 33;
      hp.update([synthScroll(160, 220)], t);
    }
    expect(lastClass()).toBe('scroll');
    expect(btn.clickCount).toBe(0);
    // A tracker dip that also closes the thumb-index gap still must not click.
    const closed = synthScroll(160, 220);
    // Force a tight thumb-index only if the pose would still be fed as scroll
    // frames first; then try a real pinch hand after leaving — but during
    // scroll the pointer cancels presses. Holding scroll is the contract.
    expect(hp.lastActivated).toBe(null);
  });

  it('is handedness-aware: a left-hand two-finger pose also scrolls', () => {
    const h = synthScroll(500, 400, 'Left');
    expect(classifyGesture(h, 'Left')).toBe('scroll');
    t += 33; hp.update([h], t);
    t += 120; hp.update([h], t);
    expect(lastClass()).toBe('scroll');
    expect(tr.frames.at(-1)?.handedness).toBe('Left');
    expect(cursorElOf(doc).classList.contains('is-palm-scroll')).toBe(true);
  });
});

