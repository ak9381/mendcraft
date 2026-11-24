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
function synthHand(px: number, py: number, pinched: boolean, opts?: { middle?: { x: number; y: number }; index?: { x: number; y: number } }): Pt[] {
  // Invert mapToScreen (mirror on x).
  const cx = 1 - (REACH.x0 + (px / W) * (REACH.x1 - REACH.x0));
  const cy = REACH.y0 + (py / H) * (REACH.y1 - REACH.y0);
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));

  // Anatomically scaled so a pointing index sits ≳ 1.3× palm size from the
  // palm (a real reach), while landmark 8 stays exactly on the target.
  // Palm size (wrist→middle MCP) is 0.2; tip→MCP is 0.22 → tip/palm ≈ 1.3.
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

  // Thumb closes IN toward the (still) index tip: 0.8 open, 0.25 pinched —
  // so the cursor-freeze test still proves the click lands pre-pinch.
  const gap = pinched ? 0.006 : 0.16;
  lm[1] = { x: cx - gap, y: cy + 0.18 }; lm[2] = { x: cx - gap, y: cy + 0.12 }; lm[3] = { x: cx - gap, y: cy + 0.06 };
  lm[4] = { x: cx - gap, y: cy };
  const toCam = (sx: number, sy: number) => ({
    x: 1 - (REACH.x0 + (sx / W) * (REACH.x1 - REACH.x0)),
    y: REACH.y0 + (sy / H) * (REACH.y1 - REACH.y0),
  });
  if (opts?.middle) lm[12] = toCam(opts.middle.x, opts.middle.y);
  // Optional live index tip (used to simulate a mid-pinch 8↔12 tracker swap).
  if (opts?.index) lm[8] = toCam(opts.index.x, opts.index.y);
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

/** Open palm at (px, py): all four fingertips reach out, thumb away.
 *  Used to prove a fist can start from an open hand with no pinch frames. */
function synthOpen(px: number, py: number): Pt[] {
  const cx = 1 - (REACH.x0 + (px / W) * (REACH.x1 - REACH.x0));
  const cy = REACH.y0 + (py / H) * (REACH.y1 - REACH.y0);
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  lm[0] = { x: cx, y: cy + 0.22 }; // wrist
  lm[9] = { x: cx, y: cy + 0.10 }; // middle MCP — palm size ~0.12
  lm[5] = { x: cx - 0.05, y: cy + 0.10 };
  lm[13] = { x: cx + 0.05, y: cy + 0.10 };
  lm[17] = { x: cx + 0.10, y: cy + 0.11 };
  // Index tip is the cursor hotspot; PIP sits closer to the wrist so it reads extended.
  lm[8] = { x: cx, y: cy };
  lm[6] = { x: cx, y: cy + 0.08 };
  lm[7] = { x: cx, y: cy + 0.04 };
  // Other fingertips also reach out, far from the palm.
  lm[10] = { x: cx + 0.05, y: cy + 0.08 }; lm[12] = { x: cx + 0.05, y: cy - 0.08 };
  lm[14] = { x: cx + 0.10, y: cy + 0.08 }; lm[16] = { x: cx + 0.10, y: cy - 0.08 };
  lm[18] = { x: cx + 0.14, y: cy + 0.08 }; lm[20] = { x: cx + 0.14, y: cy - 0.08 };
  lm[4] = { x: cx - 0.16, y: cy }; // thumb well away — not a pinch
  lm[2] = { x: cx - 0.10, y: cy + 0.08 }; lm[3] = { x: cx - 0.13, y: cy + 0.04 };
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

  it('pure hovering under the dwell window fires nothing', () => {
    // Dwell-click is the new resting click (~500ms); a short hover must still
    // be inert (the 2-second "hover never clicks" rule was replaced by dwell).
    feed(160, 50, false, 8); // ~264ms, under dwellMs
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
    feed(160, 50, false, 6);
    feed(160, 50, true, 1); // blip shorter than engageFrames
    feed(160, 50, false, 2);
    feed(160, 50, true, 1);
    feed(160, 50, false, 4);
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

  it('open hand to fist, with no pinch frames, shows the move cursor and drags', () => {
    const rect = { left: 100, top: 30, width: 120, height: 40, right: 220, bottom: 70 };
    const listeners: Record<string, Array<(e: unknown) => void>> = {};
    const handle = {
      tagName: 'BUTTON',
      rect,
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
      for (let i = 0; i < 8; i++) { t += 33; hp2.update([synthOpen(160, 50)], t); }
      const cursor = cursorElOf(d2);
      expect(cursor.classList.contains('is-pinched')).toBe(false);
      expect(cursor.classList.contains('is-fist')).toBe(false);
      expect(handle.click).not.toHaveBeenCalled();

      // Direct open → fist. No pinch frames in between.
      for (let i = 0; i < 5; i++) { t += 33; hp2.update([synthFist(160, 50)], t); }
      expect(cursor.classList.contains('is-fist')).toBe(true);
      expect(cursor.classList.contains('is-pinched')).toBe(false);

      t += 33; hp2.update([synthFist(190, 70)], t);
      expect(pointerDowns).toBe(1);
      t += 33; hp2.update([synthOpen(190, 70)], t);
      expect(handle.click).not.toHaveBeenCalled();
      expect(cursor.classList.contains('is-fist')).toBe(false);
    } finally {
      hp2.destroy();
    }
  });

  it('pinch then curl becomes a fist and never fires a pinch click', () => {
    const rect = { left: 100, top: 30, width: 120, height: 40, right: 220, bottom: 70 };
    const listeners: Record<string, Array<(e: unknown) => void>> = {};
    const handle = {
      tagName: 'BUTTON',
      rect,
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
    try {
      for (let i = 0; i < 8; i++) { t += 33; hp2.update([synthHand(160, 50, false)], t); }
      for (let i = 0; i < 5; i++) { t += 33; hp2.update([synthHand(160, 50, true)], t); }
      const cursor = cursorElOf(d2);
      expect(cursor.classList.contains('is-pinched')).toBe(true);
      for (let i = 0; i < 5; i++) { t += 33; hp2.update([synthFist(160, 50)], t); }
      expect(cursor.classList.contains('is-fist')).toBe(true);
      expect(cursor.classList.contains('is-pinched')).toBe(false);
      t += 33; hp2.update([synthOpen(160, 50)], t);
      expect(handle.click).not.toHaveBeenCalled();
    } finally {
      hp2.destroy();
    }
  });


  function cursorsOf(d: Document): FakeOverlayEl[] {
    const all = (d as unknown as { __created: FakeOverlayEl[] }).__created;
    // Each slot creates a frame, a cursor, then a dwell ring.
    return all.filter((el) => String(el.className).includes('mc-hand-cursor'));
  }

  it('draws two cursors, one on each index fingertip, with independent pinch clicks', () => {
    const feed2 = (a: { x: number; y: number; pinch: boolean }, b: { x: number; y: number; pinch: boolean }, frames = 1) => {
      for (let i = 0; i < frames; i++) {
        t += 33;
        hp.update([synthHand(a.x, a.y, a.pinch), synthHand(b.x, b.y, b.pinch)], t);
      }
    };
    feed2({ x: 160, y: 50, pinch: false }, { x: 300, y: 50, pinch: false }, 8);
    const cursors = cursorsOf(doc);
    expect(cursors).toHaveLength(2);
    const pos = cursors.map((c) => {
      expect(c.hidden).toBe(false);
      const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(c.style.transform);
      expect(m).not.toBeNull();
      return { x: Number(m![1]), y: Number(m![2]) };
    });
    const xs = pos.map((p) => p.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(160, 0);
    expect(xs[1]).toBeCloseTo(300, 0);

    // Pinch only the left-hand cursor: only the left button clicks.
    feed2({ x: 160, y: 50, pinch: true }, { x: 300, y: 50, pinch: false }, 5);
    feed2({ x: 160, y: 50, pinch: false }, { x: 300, y: 50, pinch: false }, 3);
    expect(btn.click).toHaveBeenCalledTimes(1);
    expect(other.click).not.toHaveBeenCalled();

    // Pinch only the right-hand cursor: only the right button clicks.
    feed2({ x: 160, y: 50, pinch: false }, { x: 300, y: 50, pinch: true }, 5);
    feed2({ x: 160, y: 50, pinch: false }, { x: 300, y: 50, pinch: false }, 3);
    expect(btn.click).toHaveBeenCalledTimes(1);
    expect(other.click).toHaveBeenCalledTimes(1);
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
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(left[0].style.transform);
    expect(Number(m![1])).toBeCloseTo(300, 0);
  });

  it('left pinch click alone and right pinch click alone never start two-hand zoom', () => {
    const feed2 = (a: { x: number; y: number; pinch: boolean }, b: { x: number; y: number; pinch: boolean }, frames = 1) => {
      for (let i = 0; i < frames; i++) {
        t += 33;
        hp.update([synthHand(a.x, a.y, a.pinch), synthHand(b.x, b.y, b.pinch)], t);
      }
    };
    feed2({ x: 160, y: 50, pinch: false }, { x: 300, y: 50, pinch: false }, 8);
    feed2({ x: 160, y: 50, pinch: true }, { x: 300, y: 50, pinch: false }, 5);
    expect(hp.isTwoHandZooming()).toBe(false);
    feed2({ x: 160, y: 50, pinch: false }, { x: 300, y: 50, pinch: false }, 3);
    expect(btn.click).toHaveBeenCalledTimes(1);
    expect(other.click).not.toHaveBeenCalled();

    feed2({ x: 160, y: 50, pinch: false }, { x: 300, y: 50, pinch: true }, 5);
    expect(hp.isTwoHandZooming()).toBe(false);
    feed2({ x: 160, y: 50, pinch: false }, { x: 300, y: 50, pinch: false }, 3);
    expect(btn.click).toHaveBeenCalledTimes(1);
    expect(other.click).toHaveBeenCalledTimes(1);
  });

  it('simultaneous pinches enter two-hand zoom and cancel both pending clicks', () => {
    const feed2 = (a: { x: number; y: number; pinch: boolean }, b: { x: number; y: number; pinch: boolean }, frames = 1) => {
      for (let i = 0; i < frames; i++) {
        t += 33;
        hp.update([synthHand(a.x, a.y, a.pinch), synthHand(b.x, b.y, b.pinch)], t);
      }
    };
    feed2({ x: 160, y: 50, pinch: false }, { x: 300, y: 50, pinch: false }, 8);
    feed2({ x: 160, y: 50, pinch: true }, { x: 300, y: 50, pinch: true }, 6);
    expect(hp.isTwoHandZooming()).toBe(true);
    expect(cursorsOf(doc).filter((c) => !c.hidden)).toHaveLength(2);
    feed2({ x: 160, y: 50, pinch: false }, { x: 300, y: 50, pinch: false }, 4);
    expect(hp.isTwoHandZooming()).toBe(false);
    expect(btn.click).not.toHaveBeenCalled();
    expect(other.click).not.toHaveBeenCalled();
  });

  it('fist on one hand while the other points moves only the fist cursor and clicks nothing', () => {
    for (let i = 0; i < 8; i++) {
      t += 33;
      hp.update([synthHand(160, 50, false), synthHand(500, 400, false)], t);
    }
    expect(cursorsOf(doc).filter((c) => !c.hidden)).toHaveLength(2);
    for (let i = 0; i < 6; i++) {
      t += 33;
      hp.update([synthFist(160, 50), synthHand(500, 400, false)], t);
    }
    const cursors = cursorsOf(doc);
    const byX = [...cursors].sort((a, b) => cursorPos(a).x - cursorPos(b).x);
    expect(byX[0].classList.contains('is-fist')).toBe(true);
    expect(byX[1].classList.contains('is-fist')).toBe(false);
    expect(byX[1].classList.contains('is-pinched')).toBe(false);
    expect(cursorPos(byX[1]).x).toBeCloseTo(500, 0);

    for (let i = 0; i < 8; i++) {
      t += 33;
      hp.update([synthFist(200, 80), synthHand(500, 400, false)], t);
    }
    const after = [...cursorsOf(doc)].sort((a, b) => cursorPos(a).x - cursorPos(b).x);
    expect(cursorPos(after[0]).x).toBeGreaterThan(180);
    expect(cursorPos(after[0]).x).toBeLessThan(210);
    expect(cursorPos(after[1]).x).toBeCloseTo(500, 0);
    expect(btn.click).not.toHaveBeenCalled();
    expect(other.click).not.toHaveBeenCalled();
  });

  it('magnetic focus: nearest control within 60px gets the ring and a pinch clicks the focused target, not the raw miss', () => {
    // 40px left of the left button (btn is 100–220). Inside the 60px magnet.
    feed(70, 50, false, 12);
    expect(hp.target).toBe(btn);
    expect(cursorElOf(doc).hidden).toBe(false);
    const pos = cursorPos(cursorElOf(doc));
    // Cursor eases toward the button centre (160), not staying glued at 70.
    expect(pos.x).toBeGreaterThan(70);
    expect(pos.x).toBeLessThan(160);
    feed(70, 50, true, 5);
    feed(70, 50, false, 3);
    expect(btn.click).toHaveBeenCalledTimes(1);
    expect(other.click).not.toHaveBeenCalled();
  });

  it('a pinch clicks the control under the RAW fingertip, not a sticky/magnet neighbour', () => {
    // Close neighbours (8px gap) so the old 14px sticky margin would keep the left control.
    btn = fakeButton({ left: 100, top: 30, width: 120, height: 40 });
    (btn as FakeBtn & { getAttribute: (n: string) => string | null }).getAttribute = (n: string) => n === 'aria-label' ? 'Left control' : null;
    other = fakeButton({ left: 228, top: 30, width: 120, height: 40 });
    (other as FakeBtn & { getAttribute: (n: string) => string | null }).getAttribute = (n: string) => n === 'aria-label' ? 'Right control' : null;
    hp.destroy();
    doc = fakeDoc([btn, other]);
    hp = createHandPointer(doc, {});
    t = 0;
    // Hover left, then move onto the right control and pinch immediately (inside stickyMs).
    feed(160, 50, false, 6);
    expect(hp.target).toBe(btn);
    feed(280, 50, false, 2);
    expect(hp.target).toBe(other); // raw hit on the right control wins
    feed(280, 50, true, 4);
    feed(280, 50, false, 3);
    expect(other.click).toHaveBeenCalledTimes(1);
    expect(btn.click).not.toHaveBeenCalled();
  });

  it('a short pinch on Approve does not fire; a ~300 ms held pinch does, after showing the name', () => {
    const approve = fakeButton({ left: 100, top: 30, width: 120, height: 40 });
    (approve as FakeBtn & { getAttribute: (n: string) => string | null }).getAttribute = (n: string) => n === 'aria-label' ? 'Approve' : null;
    (approve as unknown as { textContent: string }).textContent = 'Approve';
    const d2 = fakeDoc([approve]);
    const hp2 = createHandPointer(d2, {});
    let t2 = 0;
    const feed2 = (pinch: boolean, n: number, step = 33) => {
      for (let i = 0; i < n; i++) { t2 += step; hp2.update([synthHand(160, 50, pinch)], t2); }
    };
    try {
      feed2(false, 6);
      feed2(true, 4);           // ~132 ms — too short
      feed2(false, 3);
      expect(approve.click).not.toHaveBeenCalled();
      // Leave the button so confirm-dwell cannot fire, then come back
      // after the click refractory.
      for (let i = 0; i < 8; i++) { t2 += 33; hp2.update([synthHand(500, 400, false)], t2); }
      t2 += 600;
      feed2(false, 6);
      feed2(true, 12);          // ~400 ms hold
      feed2(false, 3);
      expect(approve.click).toHaveBeenCalledTimes(1);
    } finally {
      hp2.destroy();
    }
  });

  function cursorPos(c: FakeOverlayEl): { x: number; y: number } {
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(c.style.transform);
    expect(m).not.toBeNull();
    return { x: Number(m![1]), y: Number(m![2]) };
  }

  it('moving the middle fingertip (landmark 12) never moves the cursor', () => {
    feed(160, 50, false, 15);
    const cursor = cursorElOf(doc);
    const before = cursorPos(cursor);
    expect(before.x).toBeCloseTo(160, 0);
    expect(before.y).toBeCloseTo(50, 0);
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

  it('pinch click stays on the pre-pinch index tip even if landmark 8 jumps to the middle finger', () => {
    feed(160, 50, false, 8);
    expect(hp.target).toBe(btn);
    const cursor = cursorElOf(doc);
    // Engage the pinch on the real index tip first, then simulate MediaPipe
    // swapping landmark 8 onto the middle tip mid-pinch. Click and cursor
    // must stay on the pre-pinch index tip, not the other button.
    feed(160, 50, true, 4);
    for (let i = 0; i < 5; i++) {
      t += 33;
      hp.update([synthHand(160, 50, true, { middle: { x: 300, y: 50 }, index: { x: 300, y: 50 } })], t);
    }
    expect(cursor.hidden).toBe(false);
    expect(cursor.classList.contains('is-pinched')).toBe(true);
    const during = cursorPos(cursor);
    expect(during.x).toBeCloseTo(160, 0);
    expect(during.y).toBeCloseTo(50, 0);
    // Release on the real index (the swap is a mid-pinch tracker glitch).
    feed(160, 50, false, 3);
    expect(btn.click).toHaveBeenCalledTimes(1);
    expect(other.click).not.toHaveBeenCalled();
  });

  it('dwell-click fires once after ~500ms still on a control, and does not re-fire until the cursor leaves', () => {
    feed(160, 50, false, 5);
    expect(btn.click).not.toHaveBeenCalled();
    // ~500ms more of a still hover (15 frames × 33ms ≈ 495, plus a couple extra)
    feed(160, 50, false, 16);
    expect(btn.click).toHaveBeenCalledTimes(1);
    expect(other.click).not.toHaveBeenCalled();
    // Keep resting on the same button: no second click.
    feed(160, 50, false, 20);
    expect(btn.click).toHaveBeenCalledTimes(1);
    // Leave, then come back: a new dwell can fire. Extra frames let the
    // 1-Euro filter settle so slop doesn't keep resetting the timer.
    feed(500, 400, false, 12);
    feed(160, 50, false, 40);
    expect(btn.click).toHaveBeenCalledTimes(2);
  });

  it('dwell-click does not fire during a fist', () => {
    for (let i = 0; i < 25; i++) { t += 33; hp.update([synthFist(160, 50)], t); }
    expect(btn.click).not.toHaveBeenCalled();
  });
});
