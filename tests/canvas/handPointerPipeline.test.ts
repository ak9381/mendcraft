// REAL-BEHAVIOUR pipeline test: synthetic 21-landmark frames pushed through
// the actual createHandPointer().update() path — One-Euro smoothing, dead
// zone, magnet target lock, edge guard, dwell-click, fist grabs — on a
// faked document. The cursor is anchored to the PALM CENTRE. The only way to
// click is a target-locked dwell: once a control (or a board's title) has
// captured the cursor it clicks after HAND_FEEL.dwellMs (800 ms), whatever
// the jitter inside the lock. There is no pinch-click, pinch-drag or
// two-finger scroll in this pipeline.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandPointer, type HandPointer } from '../../src/canvas/handPointer';
import { synthHand as synthHandAt, synthFist as synthFistAt, type SynthOpts } from '../helpers/synthHands';
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
      if (sel === '.mc-frame') return frames;
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

/** Open pointing hand whose PALM CENTRE (the cursor anchor) maps exactly to
 *  screen (px, py) — see tests/helpers/synthHands.ts. */
function synthHand(px: number, py: number, pinched: boolean, opts?: SynthOpts): Pt[] {
  return synthHandAt(px, py, pinched, W, H, opts);
}

/** A genuine FIST whose palm centre maps exactly to (px, py). */
function synthFist(px: number, py: number): Pt[] {
  return synthFistAt(px, py, W, H);
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

  it('a control that captures the cursor fills the dwell ring then clicks exactly once at ~800 ms', () => {
    feed(500, 400, 5); // enter mid-screen
    feed(160, 50, 10); // move to the control: the magnet captures it on the way in
    expect(hp.target).toBe(btn);
    const cursor = cursorElOf(doc);
    expect(cursor.hidden).toBe(false);
    feed(160, 50, 10); // ≈660 ms since arriving — the lock is younger than 800 ms
    expect(btn.click).not.toHaveBeenCalled();
    feed(160, 50, 10); // ≈990 ms since arriving: past 800 ms of lock
    expect(btn.click).toHaveBeenCalledTimes(1);
    expect(other.click).not.toHaveBeenCalled();
    feed(160, 50, 60); // keep resting 2 s: no second click without leaving
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('moving inside the locked control does not restart the ring (target lock, no slop reset)', () => {
    feed(160, 50, 12); // ≈400 ms locked on btn
    // A 45px move that stays on the same button: the old 12px slop would have
    // restarted the 1.5 s window; the lock keeps counting.
    feed(205, 50, 8); // ≈660 ms
    expect(btn.click).not.toHaveBeenCalled();
    feed(205, 50, 6); // ≈860 ms since the lock began
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('leaving the control before 800 ms does not click', () => {
    feed(160, 50, 12); // ≈400 ms, under the dwell window
    feed(500, 400, 30); // leaves well past the 60px release before completing
    expect(btn.click).not.toHaveBeenCalled();
    expect(other.click).not.toHaveBeenCalled();
  });

  it('a board BODY is never a dwell target; dwelling on its title focuses it', () => {
    const board = fakeFrame({ left: 400, top: 150, width: 400, height: 260 }, 'f1');
    const title = fakeButton({ left: 410, top: 156, width: 200, height: 28 });
    (title as unknown as { closest: (sel: string) => FakeFrame | null }).closest = (sel) => (sel === '.mc-frame' ? board : null);
    const d2 = fakeDoc([title], [board]);
    const hp2 = createHandPointer(d2, {});
    let t2 = 0;
    try {
      // Resting on the body (far from the title) for 2 s: nothing.
      for (let i = 0; i < 60; i++) { t2 += 33; hp2.update([synthHand(600, 330, false)], t2); }
      expect(hp2.target).toBeNull();
      expect(board.click).not.toHaveBeenCalled();
      expect(title.click).not.toHaveBeenCalled();
      // On the title: the title button clicks (canvasApp's world click focuses the board).
      for (let i = 0; i < 40; i++) { t2 += 33; hp2.update([synthHand(500, 170, false)], t2); }
      expect(title.click).toHaveBeenCalledTimes(1);
      expect(board.click).not.toHaveBeenCalled();
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
    for (let i = 0; i < 3; i++) { t += 33; hp.update([synthHand(160, 50, false)], t); } // "release" — under 800 ms
    expect(btn.click).not.toHaveBeenCalled(); // a quick pinch-and-release never clicked
    // Resting in that same (pinched) hand shape long enough still dwell-clicks —
    // the trigger is stillness, not the pose.
    for (let i = 0; i < 90; i++) { t += 33; hp.update([synthHand(160, 50, true)], t); }
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('a fist over a control (a drag handle) never dispatches pointerdown or clicks — fists only grab boards/canvas', () => {
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

  it('the cursor follows the palm centre (mean of landmarks 0/5/9/13/17), not the index fingertip', () => {
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
      // Middle tip jumps over the neighbouring button; the palm stays put.
      hp.update([synthHand(160, 50, false, { middle: { x: 300, y: 50 } })], t);
    }
    expect(cursor.hidden).toBe(false);
    const after = cursorPos(cursor);
    expect(after.x).toBeCloseTo(160, 0);
    expect(after.y).toBeCloseTo(50, 0);
    expect(hp.target).toBe(btn);
  });

  it('closing the hand (every fingertip and the thumb curling in) never moves the cursor', () => {
    feed(160, 50, 15);
    const cursor = cursorElOf(doc);
    const before = cursorPos(cursor);
    for (let i = 0; i < 10; i++) {
      t += 33;
      const h = synthHand(160, 50, false);
      for (const k of [4, 8, 12, 16, 20]) h[k] = { x: h[k].x + 0.05, y: h[k].y + 0.05 };
      hp.update([h], t);
    }
    const after = cursorPos(cursor);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  it('fingertips clipping the top of the camera frame (palm inside) do not freeze the cursor at the top bar', () => {
    const lift = (x: number, y: number) => {
      const h = synthHand(x, y, false);
      for (const k of [4, 8, 12, 16, 20]) h[k] = { x: h[k].x, y: 0.02 }; // fingertips at the frame top
      return h;
    };
    for (let i = 0; i < 10; i++) { t += 33; hp.update([lift(600, 40)], t); }
    for (let x = 600; x >= 300; x -= 10) { t += 33; hp.update([lift(x, 40)], t); }
    for (let i = 0; i < 40; i++) { t += 33; hp.update([lift(300, 40)], t); }
    const pos = cursorPos(cursorElOf(doc));
    expect(pos.x).toBeLessThan(310); // followed the palm, not pinned at 600
    expect(pos.x).toBeGreaterThan(290);
  });

  it('a raised index fingertip past the top of the active box is not an edge — the palm decides', () => {
    feed(160, 50, 5);
    for (let i = 0; i < 40; i++) {
      t += 33;
      const h = synthHand(160, 50, false);
      h[8] = { x: h[8].x, y: 0.12 }; // index tip far above the active box (still in frame)
      hp.update([h], t);
    }
    expect(btn.click).toHaveBeenCalledTimes(1); // edge guard did not block the dwell
  });

  it('magnet lock: jitter across the gap between neighbours does not flip the highlight', () => {
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

  it('magnetic focus: a cursor within 40px of a control targets it; a fist tap there clicks it (dwell only accrues within 20px)', () => {
    // 30px left of the left button (btn is 100–220). Inside the 40px capture.
    feed(70, 50, 12);
    expect(hp.target).toBe(btn);
    const pos = cursorPos(cursorElOf(doc));
    // Cursor eases toward the button centre (160), not staying glued at 70.
    expect(pos.x).toBeGreaterThan(70);
    expect(pos.x).toBeLessThan(160);
    feed(70, 50, 40);
    expect(btn.click).not.toHaveBeenCalled(); // 30px out: the ring pauses
    for (let i = 0; i < 4; i++) { t += 33; hp.update([synthFist(70, 50)], t); }
    feed(70, 50, 4);
    expect(btn.click).toHaveBeenCalledTimes(1);
    expect(other.click).not.toHaveBeenCalled();
  });

  it('draws two cursors, one on each palm, independently', () => {
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
    feed(160, 50, 40);
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
      h[17] = { x: 0.01, y: h[17].y }; // a PALM landmark clips the frame
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
      h[17] = { x: 0.01, y: h[17].y }; // a PALM landmark clips the frame
      hp.update([h], t);
    }
    expect(btn.click).not.toHaveBeenCalled();

    // After leaving the edge and waiting out the cooldown, dwell clicks again
    // — the cooldown itself is recorded on the first clean frame, so the
    // full ~300ms cooldown plus the full 800 ms dwell both happen inside feed().
    feed(160, 50, 45);
    expect(btn.click).toHaveBeenCalledTimes(1);
    tr.clear();
  });
});

describe('fist grabs (one fist moves a board / pans, two fists zoom)', () => {
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

  it('two fists on the same board zoom (they no longer drag it); opening either ends it', () => {
    const board = fakeFrame({ left: 100, top: 100, width: 400, height: 300 }, 'f1');
    const doc = fakeDoc([], [board]);
    const moves: Array<{ phase: string; frameId: string; dx: number; dy: number }> = [];
    const zooms: Array<{ phase: string }> = [];
    const hp = createHandPointer(doc, { onBoardMove: (ev) => moves.push(ev), onWorldZoom: (ev) => zooms.push(ev) });
    let t = 0;
    try {
      feedPair(hp, () => t, (v) => (t = v), { x: 150, y: 150 }, { x: 350, y: 250 }, 14);
      expect(zooms[0]?.phase).toBe('start');
      expect(hp.isGrabActive()).toBe(true);
      expect(hp.isBoardGrabbed()).toBe(false);

      // Shift both fists by the same (dx, dy): a zoom 'move', never a board move.
      feedPair(hp, () => t, (v) => (t = v), { x: 190, y: 170 }, { x: 390, y: 270 }, 10);
      expect(zooms.some((z) => z.phase === 'move')).toBe(true);
      expect(moves).toHaveLength(0);

      // Opening one fist ends the zoom — after the release grace (a 1-frame
      // flicker does not).
      t += 33;
      hp.update([synthHand(190, 170, false), synthFist(390, 270)], t);
      expect(hp.isGrabActive()).toBe(true);
      for (let i = 0; i < 4; i++) { t += 33; hp.update([synthHand(190, 170, false), synthFist(390, 270)], t); }
      expect(zooms.at(-1)?.phase).toBe('end');
      expect(hp.isGrabActive()).toBe(false);

      // Further joint movement after the open does nothing until both re-close.
      const n = zooms.length;
      t += 33;
      hp.update([synthHand(250, 250, false), synthFist(450, 350)], t);
      expect(zooms).toHaveLength(n);
      expect(moves).toHaveLength(0);
    } finally {
      hp.destroy();
    }
  });

  it('one fist alone over a board grabs it and moves it', () => {
    const board = fakeFrame({ left: 100, top: 100, width: 400, height: 300 }, 'f1');
    const doc = fakeDoc([], [board]);
    const moves: Array<{ phase: string; dx: number }> = [];
    const hp = createHandPointer(doc, { onBoardMove: (ev) => moves.push(ev) });
    let t = 0;
    try {
      for (let i = 0; i < 14; i++) { t += 33; hp.update([synthFist(200, 200)], t); }
      expect(moves[0]?.phase).toBe('start');
      expect(hp.isBoardGrabbed()).toBe(true);
      for (let i = 0; i < 30; i++) { t += 33; hp.update([synthFist(240, 200)], t); }
      const dx = moves.filter((m) => m.phase === 'move').reduce((s, m) => s + m.dx, 0);
      expect(dx).toBeGreaterThan(35);
      expect(dx).toBeLessThan(45);
    } finally {
      hp.destroy();
    }
  });

  it('fists on two different boards zoom the world and move neither board', () => {
    const boardA = fakeFrame({ left: 0, top: 0, width: 200, height: 200 }, 'fA');
    const boardB = fakeFrame({ left: 600, top: 0, width: 200, height: 200 }, 'fB');
    const doc = fakeDoc([], [boardA, boardB]);
    const moves: Array<{ phase: string }> = [];
    const zooms: Array<{ phase: string }> = [];
    const hp = createHandPointer(doc, { onBoardMove: (ev) => moves.push(ev), onWorldZoom: (ev) => zooms.push(ev) });
    let t = 0;
    try {
      feedPair(hp, () => t, (v) => (t = v), { x: 100, y: 100 }, { x: 700, y: 100 }, 14);
      expect(moves.length).toBe(0);
      expect(hp.isBoardGrabbed()).toBe(false);
      expect(zooms[0]?.phase).toBe('start');
    } finally {
      hp.destroy();
    }
  });

  it('a two-fist zoom silences dwell on a button under the cursor; dwell works again once a fist opens', () => {
    const board = fakeFrame({ left: 100, top: 100, width: 400, height: 300 }, 'f1');
    const insideBtn = fakeButton({ left: 250, top: 200, width: 80, height: 40 });
    // The button sits inside the board, so its own frame lookup still finds f1.
    (insideBtn as unknown as { closest: (sel: string) => FakeFrame | null }).closest =
      (sel) => (sel === '.mc-frame' ? board : null);
    const doc = fakeDoc([insideBtn], [board]);
    const hp = createHandPointer(doc, {});
    let t = 0;
    try {
      // Both fists land on the board, right over the button — a zoom starts.
      for (let i = 0; i < 14; i++) { t += 33; hp.update([synthFist(270, 220), synthFist(310, 220)], t); }
      expect(hp.isGrabActive()).toBe(true);
      // Resting there well past the 800 ms dwell window: isGrabActive silences
      // this slot's target/dwell even with the button sitting right under it.
      for (let i = 0; i < 60; i++) { t += 33; hp.update([synthFist(270, 220), synthFist(310, 220)], t); }
      expect(insideBtn.click).not.toHaveBeenCalled();
      expect(hp.target).toBeNull();

      // One fist opens: the zoom ends (after the release grace).
      for (let i = 0; i < 5; i++) { t += 33; hp.update([synthHand(270, 220, false), synthFist(310, 220)], t); }
      expect(hp.isGrabActive()).toBe(false);

      // Only the open hand remains, resting on the same button: dwell works again.
      for (let i = 0; i < 35; i++) { t += 33; hp.update([synthHand(270, 220, false)], t); }
      expect(insideBtn.click).toHaveBeenCalledTimes(1);
    } finally {
      hp.destroy();
    }
  });
});
