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
    // Selector matching, just enough: an element "is a button" only for
    // selector lists that contain a selector starting with `button`.
    matches: (sel: string) => sel.split(',').some((s) => s.trim().startsWith('button')),
    getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }),
    getRootNode: () => ({ host: null }),
    parentElement: null,
    click: vi.fn(),
  };
}

function fakeOverlayEl() {
  return {
    className: '',
    hidden: true,
    style: {} as Record<string, string>,
    classList: { toggle: () => {}, add: () => {}, remove: () => {} },
    setAttribute: () => {},
    remove: () => {},
  };
}

function fakeDoc(buttons: FakeBtn[]) {
  return {
    createElement: () => fakeOverlayEl(),
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
  } as unknown as Document;
}

/** Camera-space hand whose cursorAnchor maps exactly to screen (px, py). */
function synthHand(px: number, py: number, pinched: boolean): Pt[] {
  // Invert mapToScreen (mirror on x).
  const cx = 1 - (REACH.x0 + (px / W) * (REACH.x1 - REACH.x0));
  const cy = REACH.y0 + (py / H) * (REACH.y1 - REACH.y0);
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  // Palm geometry: anchor (index-MCP/palm-centre blend) sits exactly at (cx, cy).
  const dm = -0.02;
  lm[0] = { x: cx, y: cy + 9 * -dm }; // wrist; hand scale = 0.2
  for (const i of [5, 9, 13, 17]) lm[i] = { x: cx, y: cy + dm };
  // Thumb/index tips set the pinch ratio: 0.8 open, 0.25 pinched.
  const gap = pinched ? 0.05 : 0.16;
  lm[4] = { x: cx - gap / 2, y: cy + 0.05 };
  lm[8] = { x: cx + gap / 2, y: cy + 0.05 };
  return lm;
}

describe('hand pointer real pipeline (synthetic frames)', () => {
  let btn: FakeBtn;
  let other: FakeBtn;
  let hp: HandPointer;
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
    hp = createHandPointer(fakeDoc([btn, other]), {});
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
});
