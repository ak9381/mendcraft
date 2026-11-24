// REAL-BEHAVIOUR pipeline test: synthetic 21-landmark frames pushed through
// the actual createHandPointer().update() path — One-Euro smoothing, dead
// zone, sticky target, edge guard, dwell-click, two-fist board move — on a
// faked document. The ONLY ways to activate anything are (1) resting the
// cursor still for ~3s (HAND_FEEL.dwellMs) on a control or a board, and (2)
// both hands fisted with both cursors over the SAME board, which drags it by
// the fists' midpoint. There is no pinch-click, pinch-drag, two-hand
// pinch-zoom, one-fist drag, or two-finger scroll in this pipeline.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandPointer, REACH, type HandPointer } from '../../src/canvas/handPointer';
import { getGestureTrace } from '../../src/canvas/gestureTrace';
import type { Pt } from '../../src/input/handLogic';

const W = 1000;
const H = 800;

interface FakeBtn {
  tagName: string;
  rect: { left: number; top: number; width: number; height: number };
  classList: { add: () => void; remove: () => void; toggle: () => void };
  getAttribute: () => null;
  closest: () => null;
  matches: (sel: string) => boolean;
  getBoundingClientRect: () => { left: number; top: number; width: number; height: number; right: number; bottom: number };
  getRootNode: () => unknown;
  parentElement: null;
  click: ReturnType<typeof vi.fn>;
  dispatchEvent: ReturnType<typeof vi.fn>;
  shadowRoot?: undefined;
  hidden?: boolean;
}

function fakeButton(rect: { left: number; top: number; width: number; height: number }): FakeBtn {
  return {
    tagName: 'BUTTON',
    rect,
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    getAttribute: () => null,
    closest: () => null,
    matches: (sel: string) => sel.split(',').some((s) => s.trim().startsWith('button')),
    getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }),
    getRootNode: () => ({ host: null }),
    parentElement: null,
    click: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

interface FakeFrame {
  tagName: string;
  rect: { left: number; top: number; width: number; height: number };
  dataset: { frame: string };
  classList: { add: () => void; remove: () => void; toggle: () => void };
  getAttribute: () => null;
  matches: () => boolean;
  getBoundingClientRect: () => { left: number; top: number; width: number; height: number; right: number; bottom: number };
  getRootNode: () => unknown;
  parentElement: null;
  closest: (sel: string) => FakeFrame | null;
  click: ReturnType<typeof vi.fn>;
  dispatchEvent: ReturnType<typeof vi.fn>;
}

/** A `.mc-frame` board stub: no controls inside, just a dwell/grab target. */
function fakeFrame(rect: { left: number; top: number; width: number; height: number }, id: string): FakeFrame {
  const el: FakeFrame = {
    tagName: 'SECTION',
    rect,
    dataset: { frame: id },
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    getAttribute: () => null,
    matches: () => false,
    getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }),
    getRootNode: () => ({ host: null }),
    parentElement: null,
    closest: (sel: string) => (sel === '.mc-frame' ? el : null),
    click: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  return el;
}

/** Real-enough fake classList so tests can read what paint() decided, not
 *  just that it didn't throw. */
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

function fakeDoc(buttons: FakeBtn[], frames: FakeFrame[] = []) {
  const created: FakeOverlayEl[] = [];
  const doc = {
    createElement: () => { const el = fakeOverlayEl(); created.push(el); return el; },
    body: { append: () => {} },
    querySelectorAll: (sel: string) => {
      if (sel === '*' || sel === '[aria-modal=true]') return [];
      return sel.split(',').some((s) => s.trim().startsWith('button')) ? buttons : [];
    },
    elementFromPoint: (x: number, y: number) =>
      buttons.find((b) => {
        const r = b.rect;
        return x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
      })
      ?? frames.find((f) => {
        const r = f.rect;
        return x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
      })
      ?? null,
  } as unknown as Document & { __created: FakeOverlayEl[] };
  (doc as unknown as { __created: FakeOverlayEl[] }).__created = created;
  return doc;
}
/** handPointer.ts creates the target frame first, then the cursor. */
function cursorElOf(doc: Document): FakeOverlayEl {
  return (doc as unknown as { __created: FakeOverlayEl[] }).__created[1];
}
function cursorsOf(d: Document): FakeOverlayEl[] {
  const all = (d as unknown as { __created: FakeOverlayEl[] }).__created;
  // Each slot creates a frame, a cursor, then a dwell ring.
  return all.filter((el) => String(el.className).includes('mc-hand-cursor'));
}
function cursorPos(c: FakeOverlayEl): { x: number; y: number } {
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(c.style.transform);
  expect(m).not.toBeNull();
  return { x: Number(m![1]), y: Number(m![2]) };
}

/** Camera-space hand whose INDEX_TIP (landmark 8 — the cursor's hotspot)
 *  maps exactly to screen (px, py). Middle/ring/pinky are built curled (not
 *  extended) and the index extended, so classifyGesture() never reads this
 *  as a fist — it reads as 'point' (open) or 'pinch' (closed), same as a
 *  real pointing/pinching hand. Neither pose clicks in this pipeline; only
 *  dwell (holding still) does. */
function synthHand(px: number, py: number, pinched: boolean, opts?: { middle?: { x: number; y: number } }): Pt[] {
  // Invert mapToScreen (mirror on x).
  const cx = 1 - (REACH.x0 + (px / W) * (REACH.x1 - REACH.x0));
  const cy = REACH.y0 + (py / H) * (REACH.y1 - REACH.y0);
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));

  lm[8] = { x: cx, y: cy }; // INDEX_TIP: the pointer's hotspot, exactly on target
  lm[0] = { x: cx, y: cy + 0.42 }; // wrist
  lm[9] = { x: cx, y: cy + 0.22 }; // middle MCP
  lm[5] = { x: cx, y: cy + 0.22 }; // index MCP
  lm[6] = { x: cx, y: cy + 0.12 }; // index PIP — nearer the wrist than the tip: extended
  lm[7] = { x: cx, y: cy + 0.06 }; // index DIP
  // Middle/ring/pinky curled in at the palm (not extended).
  const palmY = cy + 0.26;
  lm[10] = { x: cx + 0.05, y: palmY + 0.04 }; lm[11] = { x: cx + 0.05, y: palmY + 0.02 }; lm[12] = { x: cx + 0.05, y: palmY };
  lm[13] = { x: cx + 0.08, y: cy + 0.22 }; lm[14] = { x: cx + 0.08, y: palmY + 0.04 }; lm[15] = { x: cx + 0.08, y: palmY + 0.02 }; lm[16] = { x: cx + 0.08, y: palmY };
  lm[17] = { x: cx + 0.12, y: cy + 0.22 }; lm[18] = { x: cx + 0.12, y: palmY + 0.04 }; lm[19] = { x: cx + 0.12, y: palmY + 0.02 }; lm[20] = { x: cx + 0.12, y: palmY };

  const gap = pinched ? 0.006 : 0.16;
  lm[1] = { x: cx - gap, y: cy + 0.18 }; lm[2] = { x: cx - gap, y: cy + 0.12 }; lm[3] = { x: cx - gap, y: cy + 0.06 };
  lm[4] = { x: cx - gap, y: cy };
  const toCam = (sx: number, sy: number) => ({
    x: 1 - (REACH.x0 + (sx / W) * (REACH.x1 - REACH.x0)),
    y: REACH.y0 + (sy / H) * (REACH.y1 - REACH.y0),
  });
  if (opts?.middle) lm[12] = toCam(opts.middle.x, opts.middle.y);
  return lm;
}

/** A genuine FIST at (px, py): every finger (including the index) curled —
 *  tip nearer the wrist than its own PIP — so classifyGesture() reads
 *  'fist', not 'point'/'pinch'. landmark 8 (the cursor hotspot) still sits
 *  exactly on the target. */
function synthFist(px: number, py: number): Pt[] {
  const cx = 1 - (REACH.x0 + (px / W) * (REACH.x1 - REACH.x0));
  const cy = REACH.y0 + (py / H) * (REACH.y1 - REACH.y0);
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  const wrist = { x: cx, y: cy + 0.2 };
  lm[0] = wrist;
  lm[9] = { x: cx, y: cy }; // middle MCP: hand scale (wrist->mid-MCP) = 0.2
  lm[8] = { x: cx, y: cy }; // INDEX_TIP: still exactly on the target
  lm[6] = { x: wrist.x + (lm[8].x - wrist.x) * 1.5, y: wrist.y + (lm[8].y - wrist.y) * 1.5 };
  const curl = (pip: number, tip: number, ox: number) => {
    lm[pip] = { x: wrist.x + ox, y: wrist.y - 0.3 };
    lm[tip] = { x: wrist.x + ox, y: wrist.y - 0.03 };
  };
  curl(10, 12, 0.05); // middle
  curl(14, 16, 0.1); // ring
  curl(18, 20, 0.15); // pinky
  lm[1] = wrist; lm[2] = wrist; lm[3] = wrist; lm[4] = wrist; // thumb: irrelevant to 'fist'
  return lm;
}

describe('hand pointer real pipeline (synthetic frames)', () => {
  let btn: FakeBtn;
  let other: FakeBtn;
  let hp: HandPointer;
  let doc: ReturnType<typeof fakeDoc>;
  let t: number;

  const feed = (px: number, py: number, frames = 1) => {
    for (let i = 0; i < frames; i++) {
      t += 33;
      hp.update([synthHand(px, py, false)], t);
    }
  };
  beforeEach(() => {
    (globalThis as Record<string, unknown>).innerWidth = W;
    (globalThis as Record<string, unknown>).innerHeight = H;
    // The top toolbar region: two neighbouring controls near the top edge.
    btn = fakeButton({ left: 100, top: 30, width: 120, height: 40 });
    other = fakeButton({ left: 240, top: 30, width: 120, height: 40 });
    doc = fakeDoc([btn, other]);
    hp = createHandPointer(doc, {});
    t = 0;
  });
  afterEach(() => {
    hp.destroy();
    delete (globalThis as Record<string, unknown>).innerWidth;
    delete (globalThis as Record<string, unknown>).innerHeight;
  });

  it('resting the cursor still on a control for ~3s fills the dwell ring then clicks exactly once', () => {
    feed(500, 400, 5); // enter mid-screen
    feed(160, 50, 15); // move to the control and settle
    expect(hp.target).toBe(btn);
    const cursor = cursorElOf(doc);
    expect(cursor.hidden).toBe(false);
    feed(160, 50, 60); // still well under 3s (≈2s total on the button so far)
    expect(btn.click).not.toHaveBeenCalled();
    feed(160, 50, 40); // now past 3s
    expect(btn.click).toHaveBeenCalledTimes(1);
    expect(other.click).not.toHaveBeenCalled();
    feed(160, 50, 20); // keep resting: no second click
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('moving beyond the dwell slop resets the ring — the full 3s starts over', () => {
    feed(160, 50, 15);
    feed(160, 50, 60); // ~2s dwelling
    // Jitter beyond dwellSlopPx (12px) onto the same button — the ring resets.
    feed(205, 50, 60); // another ~2s, still inside btn's rect, but reset by the jump
    expect(btn.click).not.toHaveBeenCalled();
    feed(205, 50, 40); // finish the fresh 3s window
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('leaving the control before 3s does not click', () => {
    feed(160, 50, 60); // ~2s, under the dwell window
    feed(500, 400, 10); // leaves before completing
    expect(btn.click).not.toHaveBeenCalled();
    expect(other.click).not.toHaveBeenCalled();
  });

  it('dwelling on a board with no more specific control under the cursor selects/focuses it', () => {
    const board = fakeFrame({ left: 400, top: 150, width: 400, height: 200 }, 'f1');
    const d2 = fakeDoc([], [board]);
    const hp2 = createHandPointer(d2, {});
    let t2 = 0;
    try {
      for (let i = 0; i < 10; i++) { t2 += 33; hp2.update([synthHand(600, 250, false)], t2); }
      expect(hp2.target).toBe(board);
      for (let i = 0; i < 95; i++) { t2 += 33; hp2.update([synthHand(600, 250, false)], t2); }
      expect(board.click).toHaveBeenCalledTimes(1);
    } finally {
      hp2.destroy();
    }
  });

  it('pinch does not click — only dwell (resting still) does, whatever the hand shape', () => {
    feed(160, 50, 8); // settle onto the control
    const cursor = cursorElOf(doc);
    feed(160, 50, 5); // close into a pinch pose
    expect(cursor.classList.contains('is-pinched')).toBe(false); // live pinch is never tracked as a click gesture
    for (let i = 0; i < 4; i++) { t += 33; hp.update([synthHand(160, 50, true)], t); }
    for (let i = 0; i < 3; i++) { t += 33; hp.update([synthHand(160, 50, false)], t); } // "release" — far under 3s
    expect(btn.click).not.toHaveBeenCalled(); // a quick pinch-and-release never clicked
    // Resting in that same (pinched) hand shape long enough still dwell-clicks —
    // the trigger is stillness, not the pose.
    for (let i = 0; i < 90; i++) { t += 33; hp.update([synthHand(160, 50, true)], t); }
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('no one-fist drag: a fist over a drag handle never dispatches pointerdown or clicks', () => {
    const rect = { left: 100, top: 30, width: 120, height: 40, right: 220, bottom: 70 };
    const listeners: Record<string, Array<(e: unknown) => void>> = {};
    const handle = {
      tagName: 'BUTTON',
      rect,
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      getAttribute: () => null,
      closest: () => null,
      matches: (sel: string) => sel.split(',').some((s) => s.trim().startsWith('button') || s.trim() === '[data-mc-drag-handle]' || s.trim() === '[data-mc-resize-handle]'),
      getBoundingClientRect: () => rect,
      getRootNode: () => ({ host: null }),
      parentElement: null,
      addEventListener(ev: string, f: (e: unknown) => void) { (listeners[ev] ??= []).push(f); },
      dispatchEvent(e: { type: string }) { (listeners[e.type] ?? []).forEach((f) => f(e)); return true; },
      click: vi.fn(),
    };
    const d2 = fakeDoc([handle as unknown as FakeBtn]);
    const hp2 = createHandPointer(d2, { createDragEvent: (type) => ({ type }) as unknown as Event });
    let pointerDowns = 0;
    handle.addEventListener('pointerdown', () => { pointerDowns++; });
    try {
      for (let i = 0; i < 8; i++) { t += 33; hp2.update([synthFist(160, 50)], t); }
      const cursor = cursorElOf(d2);
      expect(cursor.classList.contains('is-fist')).toBe(true);
      t += 33; hp2.update([synthFist(190, 70)], t); // move while fisted
      expect(pointerDowns).toBe(0);
      t += 33; hp2.update([synthHand(190, 70, false)], t); // open
      expect(handle.click).not.toHaveBeenCalled();
      expect(pointerDowns).toBe(0);
    } finally {
      hp2.destroy();
    }
  });

  it('dwell-click does not fire during a fist', () => {
    for (let i = 0; i < 100; i++) { t += 33; hp.update([synthFist(160, 50)], t); }
    expect(btn.click).not.toHaveBeenCalled();
  });

  it('ignores a small background hand even while it dwells', () => {
    const near = () => synthHand(160, 50, false);
    for (let i = 0; i < 10; i++) { t += 33; hp.update([near()], t); }
    // A tiny far-away hand (someone behind) over the other control:
    const tiny = synthHand(300, 50, false).map((p) => {
      const c = synthHand(300, 50, false)[0];
      return { x: c.x + (p.x - c.x) * 0.2, y: c.y + (p.y - c.y) * 0.2 };
    });
    for (let i = 0; i < 100; i++) { t += 33; hp.update([tiny, near()], t); }
    expect(other.click).not.toHaveBeenCalled();
    expect(hp.target).toBe(btn); // the big hand still owns the cursor
  });

  it('the cursor follows landmark 8 (the index fingertip), not an MCP/palm blend', () => {
    feed(160, 50, 10);
    const cursor = cursorElOf(doc);
    expect(cursor.hidden).toBe(false);
    const pos = cursorPos(cursor);
    expect(pos.x).toBeCloseTo(160, 0);
    expect(pos.y).toBeCloseTo(50, 0);
  });

  it('moving the middle fingertip (landmark 12) never moves the cursor', () => {
    feed(160, 50, 15);
    const cursor = cursorElOf(doc);
    const before = cursorPos(cursor);
    expect(before.x).toBeCloseTo(160, 0);
    for (let i = 0; i < 10; i++) {
      t += 33;
      // Middle tip jumps over the neighbouring button; index stays put.
      hp.update([synthHand(160, 50, false, { middle: { x: 300, y: 50 } })], t);
    }
    expect(cursor.hidden).toBe(false);
    const after = cursorPos(cursor);
    expect(after.x).toBeCloseTo(160, 0);
    expect(after.y).toBeCloseTo(50, 0);
    expect(hp.target).toBe(btn);
  });

  it('sticky target: jitter across the gap between neighbours does not flip the highlight', () => {
    feed(160, 50, 15);
    expect(hp.target).toBe(btn);
    feed(228, 50, 1);
    expect(hp.target).toBe(btn);
    feed(160, 50, 2);
    expect(hp.target).toBe(btn);
    // A sustained move onto the neighbour does switch.
    feed(300, 50, 15);
    expect(hp.target).toBe(other);
  });

  it('magnetic focus: a cursor resting within 60px of a control dwell-clicks the focused target, not empty space', () => {
    // 40px left of the left button (btn is 100–220). Inside the 60px magnet.
    feed(70, 50, 12);
    expect(hp.target).toBe(btn);
    const pos = cursorPos(cursorElOf(doc));
    // Cursor eases toward the button centre (160), not staying glued at 70.
    expect(pos.x).toBeGreaterThan(70);
    expect(pos.x).toBeLessThan(160);
    feed(70, 50, 100);
    expect(btn.click).toHaveBeenCalledTimes(1);
    expect(other.click).not.toHaveBeenCalled();
  });

  it('draws two cursors, one on each index fingertip, independently', () => {
    const feed2 = (a: { x: number; y: number }, b: { x: number; y: number }, frames = 1) => {
      for (let i = 0; i < frames; i++) {
        t += 33;
        hp.update([synthHand(a.x, a.y, false), synthHand(b.x, b.y, false)], t);
      }
    };
    feed2({ x: 160, y: 50 }, { x: 300, y: 50 }, 8);
    const cursors = cursorsOf(doc);
    expect(cursors).toHaveLength(2);
    const pos = cursors.map((c) => {
      expect(c.hidden).toBe(false);
      return cursorPos(c);
    });
    const xs = pos.map((p) => p.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(160, 0);
    expect(xs[1]).toBeCloseTo(300, 0);
  });

  it('losing one hand hides only that cursor after the sticky window; a brief dropout does not reset the other', () => {
    for (let i = 0; i < 10; i++) {
      t += 33;
      hp.update([synthHand(160, 50, false), synthHand(300, 50, false)], t);
    }
    expect(cursorsOf(doc).filter((c) => !c.hidden)).toHaveLength(2);
    // ~165 ms dropout: both cursors stay (one hand must not reset the other).
    for (let i = 0; i < 5; i++) {
      t += 33;
      hp.update([synthHand(300, 50, false)], t);
    }
    expect(cursorsOf(doc).filter((c) => !c.hidden)).toHaveLength(2);
    // After the 400 ms sticky lost window, only the remaining hand stays.
    t += 500;
    hp.update([synthHand(300, 50, false)], t);
    const left = cursorsOf(doc).filter((c) => !c.hidden);
    expect(left).toHaveLength(1);
    const m = cursorPos(left[0]);
    expect(m.x).toBeCloseTo(300, 0);
  });

  it('trace clickTarget is only set on the frame of an actual (dwell) click', () => {
    const tr = getGestureTrace();
    tr.enable();
    tr.clear();
    feed(160, 50, 6);
    expect(tr.dump().every((f) => f.clickTarget == null)).toBe(true);
    feed(160, 50, 95);
    expect(btn.click).toHaveBeenCalledTimes(1);
    const hits = tr.dump().filter((f) => f.clickTarget);
    expect(hits).toHaveLength(1);
    tr.clear();
  });

  it('at the camera edge, pose stays frozen, the cursor holds, and dwell does not click until after the cooldown', () => {
    const tr = getGestureTrace();
    tr.enable();
    tr.clear();
    feed(160, 50, 10);
    expect(tr.dump().at(-1)?.classification).toBe('point');
    const cursor = cursorElOf(doc);
    const held = cursorPos(cursor);

    // Same tip, but a landmark clips the camera frame and the fingers curl
    // into a fist — must not become a fist or break the cursor hold.
    for (let i = 0; i < 8; i++) {
      t += 33;
      const h = synthFist(160, 50);
      h[16] = { x: 0.01, y: 0.5 };
      hp.update([h], t);
    }
    const mid = tr.dump().slice(-8);
    expect(mid.every((f) => f.classification === 'point')).toBe(true);
    const atEdge = cursorPos(cursor);
    expect(Math.abs(atEdge.x - held.x)).toBeLessThan(6);
    expect(Math.abs(atEdge.y - held.y)).toBeLessThan(6);

    // Dwelling at the edge does not click.
    for (let i = 0; i < 20; i++) {
      t += 33;
      const h = synthHand(160, 50, false);
      h[16] = { x: 0.01, y: 0.5 };
      hp.update([h], t);
    }
    expect(btn.click).not.toHaveBeenCalled();

    // After leaving the edge and waiting out the cooldown, dwell clicks again
    // — the cooldown itself is recorded on the first clean frame, so the
    // full ~300ms cooldown plus the full ~3s dwell both happen inside feed().
    feed(160, 50, 115);
    expect(btn.click).toHaveBeenCalledTimes(1);
    tr.clear();
  });
});

describe('two-fist board move', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).innerWidth = W;
    (globalThis as Record<string, unknown>).innerHeight = H;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).innerWidth;
    delete (globalThis as Record<string, unknown>).innerHeight;
  });

  const feedPair = (
    hp: HandPointer,
    getT: () => number,
    setT: (v: number) => void,
    a: { x: number; y: number } | null,
    b: { x: number; y: number } | null,
    frames = 1,
  ) => {
    for (let i = 0; i < frames; i++) {
      setT(getT() + 33);
      const hands = [a ? synthFist(a.x, a.y) : null, b ? synthFist(b.x, b.y) : null].filter((h): h is Pt[] => h !== null);
      hp.update(hands, getT());
    }
  };

  it('both fists on the same board drag it by their midpoint until either hand opens', () => {
    const board = fakeFrame({ left: 100, top: 100, width: 400, height: 300 }, 'f1');
    const doc = fakeDoc([], [board]);
    const moves: Array<{ phase: string; frameId: string; dx: number; dy: number }> = [];
    const hp = createHandPointer(doc, { onBoardMove: (ev) => moves.push(ev) });
    let t = 0;
    try {
      feedPair(hp, () => t, (v) => (t = v), { x: 150, y: 150 }, { x: 350, y: 250 }, 10);
      expect(moves.some((m) => m.phase === 'start' && m.frameId === 'f1')).toBe(true);
      expect(hp.isBoardGrabbed()).toBe(true);

      moves.length = 0;
      // Shift both fists by the same (dx, dy): the midpoint follows exactly.
      feedPair(hp, () => t, (v) => (t = v), { x: 190, y: 170 }, { x: 390, y: 270 }, 10);
      const totalDx = moves.filter((m) => m.phase === 'move').reduce((s, m) => s + m.dx, 0);
      const totalDy = moves.filter((m) => m.phase === 'move').reduce((s, m) => s + m.dy, 0);
      expect(totalDx).toBeGreaterThan(30);
      expect(totalDx).toBeLessThan(50);
      expect(totalDy).toBeGreaterThan(10);
      expect(totalDy).toBeLessThan(30);

      // Opening one fist ends the move.
      moves.length = 0;
      t += 33;
      hp.update([synthHand(190, 170, false), synthFist(390, 270)], t);
      expect(moves.some((m) => m.phase === 'end')).toBe(true);
      expect(hp.isBoardGrabbed()).toBe(false);

      // Further joint movement after the open does nothing.
      moves.length = 0;
      feedPair(hp, () => t, (v) => (t = v), { x: 250, y: 250 }, { x: 450, y: 350 }, 5);
      expect(moves.some((m) => m.phase === 'move')).toBe(false);
    } finally {
      hp.destroy();
    }
  });

  it('one fist alone over a board never grabs it', () => {
    const board = fakeFrame({ left: 100, top: 100, width: 400, height: 300 }, 'f1');
    const doc = fakeDoc([], [board]);
    const moves: Array<{ phase: string }> = [];
    const hp = createHandPointer(doc, { onBoardMove: (ev) => moves.push(ev) });
    let t = 0;
    try {
      for (let i = 0; i < 10; i++) { t += 33; hp.update([synthFist(200, 200)], t); }
      expect(moves.length).toBe(0);
      expect(hp.isBoardGrabbed()).toBe(false);
    } finally {
      hp.destroy();
    }
  });

  it('fists on two different boards never grab either', () => {
    const boardA = fakeFrame({ left: 0, top: 0, width: 200, height: 200 }, 'fA');
    const boardB = fakeFrame({ left: 600, top: 0, width: 200, height: 200 }, 'fB');
    const doc = fakeDoc([], [boardA, boardB]);
    const moves: Array<{ phase: string }> = [];
    const hp = createHandPointer(doc, { onBoardMove: (ev) => moves.push(ev) });
    let t = 0;
    try {
      feedPair(hp, () => t, (v) => (t = v), { x: 100, y: 100 }, { x: 700, y: 100 }, 10);
      expect(moves.length).toBe(0);
      expect(hp.isBoardGrabbed()).toBe(false);
    } finally {
      hp.destroy();
    }
  });
});
