// REAL-BEHAVIOUR pipeline test: synthetic 21-landmark frames pushed through
// the actual createHandPointer().update() path — One-Euro smoothing, dead
// zone, pinch state machine, cursor freeze, sticky target, hit-testing — on a
// faked document. Proves: dwell + deliberate pinch clicks a toolbar control
// EXACTLY once, pure hovering for 2 s clicks NOTHING, and the pinch jerk
// cannot drag the click off the button (pre-pinch freeze).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandPointer, REACH, type HandPointer } from '../../src/canvas/handPointer';
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

function fakeButton(rect: { left: number; top: number; width: number; height: number }, opts: { dragHandle?: boolean } = {}): FakeBtn {
  return {
    tagName: 'BUTTON',
    rect,
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    getAttribute: () => null,
    closest: () => null,
    // Selector matching, just enough: an element "is a button" only for
    // selector lists that contain a selector starting with `button` — plus,
    // when built as a drag handle, the DRAG_HANDLE attribute selectors too
    // (real drag handles are plain buttons with a data-mc-*-handle attribute).
    matches: (sel: string) => sel.split(',').some((s) => {
      const t = s.trim();
      if (t.startsWith('button')) return true;
      return !!opts.dragHandle && (t === '[data-mc-drag-handle]' || t === '[data-mc-resize-handle]');
    }),
    getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }),
    getRootNode: () => ({ host: null }),
    parentElement: null,
    click: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

/** Real-enough fake classList so tests can read what paint() decided, not
 *  just that it didn't throw. */
function fakeOverlayEl() {
  const classes = new Set<string>();
  return {
    className: '',
    hidden: true,
    style: {} as Record<string, string>,
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

function fakeDoc(buttons: FakeBtn[]) {
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
      }) ?? null,
  } as unknown as Document & { __created: FakeOverlayEl[] };
  (doc as unknown as { __created: FakeOverlayEl[] }).__created = created;
  return doc;
}
/** handPointer.ts creates the target frame first, then the cursor. */
function cursorElOf(doc: Document): FakeOverlayEl {
  return (doc as unknown as { __created: FakeOverlayEl[] }).__created[1];
}

/** Camera-space hand whose INDEX_TIP (landmark 8 — the cursor's hotspot)
 *  maps exactly to screen (px, py). Middle/ring/pinky are built curled (not
 *  extended) and the index extended, so classifyGesture() never reads this
 *  as a fist (which would otherwise swallow the pinch/click under test) —
 *  it reads as 'point' open or 'pinch' closed, same as a real pointing hand. */
function synthHand(px: number, py: number, pinched: boolean): Pt[] {
  // Invert mapToScreen (mirror on x).
  const cx = 1 - (REACH.x0 + (px / W) * (REACH.x1 - REACH.x0));
  const cy = REACH.y0 + (py / H) * (REACH.y1 - REACH.y0);
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));

  lm[8] = { x: cx, y: cy }; // INDEX_TIP: the pointer's hotspot, exactly on target
  lm[0] = { x: cx, y: cy + 0.2 }; // wrist; hand scale (wrist->mid-MCP) = 0.2
  lm[9] = { x: cx, y: cy }; // middle MCP
  lm[5] = { x: cx, y: cy + 0.15 }; // index MCP
  lm[6] = { x: cx, y: cy + 0.12 }; // index PIP — nearer the wrist than the tip: extended
  lm[7] = { x: cx, y: cy + 0.06 }; // index DIP
  // Middle/ring/pinky curled back toward the wrist (tip nearer the wrist
  // than its own PIP) so they read as NOT extended.
  lm[10] = { x: cx + 0.05, y: cy + 0.1 }; lm[11] = { x: cx + 0.05, y: cy + 0.15 }; lm[12] = { x: cx + 0.05, y: cy + 0.18 };
  lm[13] = { x: cx + 0.1, y: cy + 0.15 }; lm[14] = { x: cx + 0.1, y: cy + 0.1 }; lm[15] = { x: cx + 0.1, y: cy + 0.15 }; lm[16] = { x: cx + 0.1, y: cy + 0.18 };
  lm[17] = { x: cx + 0.15, y: cy + 0.15 }; lm[18] = { x: cx + 0.15, y: cy + 0.1 }; lm[19] = { x: cx + 0.15, y: cy + 0.15 }; lm[20] = { x: cx + 0.15, y: cy + 0.18 };

  // Thumb closes IN toward the (still) index tip: 0.8 open, 0.25 pinched —
  // so the cursor-freeze test still proves the click lands pre-pinch.
  const gap = pinched ? 0.05 : 0.16;
  lm[1] = { x: cx - gap, y: cy + 0.18 }; lm[2] = { x: cx - gap, y: cy + 0.12 }; lm[3] = { x: cx - gap, y: cy + 0.06 };
  lm[4] = { x: cx - gap, y: cy };
  return lm;
}

/** A genuine FIST at (px, py): every finger (including the index) curled —
 *  tip nearer the wrist than its own PIP — so classifyGesture() reads
 *  'fist', not 'point'/'pinch'. landmark 8 (the cursor hotspot) still sits
 *  exactly on the target, matching what real tracking reports (the tip
 *  position is known even while curled). */
function synthFist(px: number, py: number): Pt[] {
  const cx = 1 - (REACH.x0 + (px / W) * (REACH.x1 - REACH.x0));
  const cy = REACH.y0 + (py / H) * (REACH.y1 - REACH.y0);
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  const wrist = { x: cx, y: cy + 0.2 };
  lm[0] = wrist;
  lm[9] = { x: cx, y: cy }; // middle MCP: hand scale (wrist->mid-MCP) = 0.2
  lm[8] = { x: cx, y: cy }; // INDEX_TIP: still exactly on the target
  // Index PIP extrapolated PAST the tip (farther from the wrist than the
  // tip) — the same "tip folded back" shape a real fist reports.
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

  const feed = (px: number, py: number, pinched: boolean, frames = 1) => {
    for (let i = 0; i < frames; i++) {
      t += 33;
      hp.update([synthHand(px, py, pinched)], t);
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

  it('move → dwell → pinch → release clicks the toolbar control exactly once', () => {
    feed(500, 400, false, 5); // enter mid-screen
    feed(160, 50, false, 15); // move to the control and dwell (top edge: reachable)
    expect(hp.target).toBe(btn);
    feed(160, 50, true, 3); // deliberate pinch: 3 debounced frames
    feed(160, 50, false, 3); // release → click
    expect(btn.click).toHaveBeenCalledTimes(1);
    feed(160, 50, false, 10); // keep hovering: nothing more
    expect(btn.click).toHaveBeenCalledTimes(1);
    expect(other.click).not.toHaveBeenCalled();
  });

  it('pure hovering for 2 seconds fires nothing', () => {
    feed(160, 50, false, 60); // ~2 s of open-hand hover on the control
    expect(hp.target).toBe(btn);
    expect(btn.click).not.toHaveBeenCalled();
    expect(other.click).not.toHaveBeenCalled();
  });

  it('cursor freeze: the pinch jerk cannot drag the click off the button', () => {
    feed(160, 50, false, 15); // dwell on the control
    expect(hp.target).toBe(btn);
    // The hand lurches while closing (typical pinch motion): the frames during
    // the pinch sit far away from the button…
    feed(420, 260, true, 3);
    feed(420, 260, false, 3); // release far away too
    // …but the click lands where the hand was BEFORE the pinch began.
    expect(btn.click).toHaveBeenCalledTimes(1);
    expect(other.click).not.toHaveBeenCalled();
  });

  it('1–2 frame pinch blips while hovering never click', () => {
    feed(160, 50, false, 10);
    feed(160, 50, true, 2); // blip shorter than engageFrames
    feed(160, 50, false, 2);
    feed(160, 50, true, 1);
    feed(160, 50, false, 10);
    expect(btn.click).not.toHaveBeenCalled();
  });

  it('sticky target: jitter across the gap between neighbours does not flip the highlight', () => {
    feed(160, 50, false, 15);
    expect(hp.target).toBe(btn);
    // One jittery frame leaning toward the neighbour, then back — the 33 ms
    // excursion is far below stickyMs, so the target must hold.
    feed(228, 50, false, 1);
    expect(hp.target).toBe(btn);
    feed(160, 50, false, 2);
    expect(hp.target).toBe(btn);
    // A sustained move onto the neighbour does switch.
    feed(300, 50, false, 15);
    expect(hp.target).toBe(other);
  });

  it('ignores a small background hand even when it pinches', () => {
    const near = () => synthHand(160, 50, false);
    for (let i = 0; i < 10; i++) { t += 33; hp.update([near()], t); }
    // A tiny far-away hand (someone behind) pinching over the other control:
    const tiny = synthHand(300, 50, true).map((p, i) => {
      const c = synthHand(300, 50, true)[0];
      return { x: c.x + (p.x - c.x) * 0.2, y: c.y + (p.y - c.y) * 0.2 };
    });
    for (let i = 0; i < 10; i++) { t += 33; hp.update([tiny, near()], t); }
    expect(other.click).not.toHaveBeenCalled();
    expect(hp.target).toBe(btn); // the big hand still owns the cursor
  });

  it('the cursor follows landmark 8 (the index fingertip), not an MCP/palm blend', () => {
    feed(160, 50, false, 10);
    const cursor = cursorElOf(doc);
    expect(cursor.hidden).toBe(false);
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(cursor.style.transform);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(160, 0);
    expect(Number(m![2])).toBeCloseTo(50, 0);
  });

  it('pinch shows a darker/smaller cursor and still clicks', () => {
    feed(160, 50, false, 15);
    const cursor = cursorElOf(doc);
    expect(cursor.classList.contains('is-pinched')).toBe(false);
    feed(160, 50, true, 3); // debounced into the pinch
    expect(cursor.classList.contains('is-pinched')).toBe(true);
    feed(160, 50, false, 3); // release → click
    expect(cursor.classList.contains('is-pinched')).toBe(false);
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('fist shows the move cursor and starts a drag on a handle — never a click', () => {
    // Same addEventListener/dispatchEvent fake + createDragEvent override
    // a1-tremor-speed-touch.test.ts uses for DRAG_HANDLE — real PointerEvent
    // isn't available in this repo's node-env test run.
    const rect = { left: 100, top: 30, width: 120, height: 40, right: 220, bottom: 70 };
    const listeners: Record<string, Array<(e: unknown) => void>> = {};
    const handle = {
      tagName: 'BUTTON',
      rect, // fakeDoc's elementFromPoint reads .rect, not getBoundingClientRect()
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      getAttribute: () => null,
      closest: () => null,
      matches: (sel: string) => sel.split(',').some((s) => {
        const t2 = s.trim();
        return t2.startsWith('button') || t2 === '[data-mc-drag-handle]' || t2 === '[data-mc-resize-handle]';
      }),
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
      // fist engages immediately (no debounce like pinch) — fed to hp2 (the
      // drag-handle doc), not the shared hp/feedFist from the outer scope.
      for (let i = 0; i < 5; i++) { t += 33; hp2.update([synthFist(160, 50)], t); }
      const cursor = cursorElOf(d2);
      expect(cursor.classList.contains('is-fist')).toBe(true);
      // Move far enough past the drag threshold to start the drag.
      t += 33; hp2.update([synthFist(190, 70)], t);
      expect(pointerDowns).toBe(1);
      // Open the fist (back to a normal point/hover pose): drag ends, no tap.
      t += 33; hp2.update([synthHand(190, 70, false)], t);
      expect(handle.click).not.toHaveBeenCalled();
    } finally {
      hp2.destroy();
    }
  });
});
