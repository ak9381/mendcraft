// A hand that drops out of the camera mid-gesture: its fist state and any
// grab it held go with it. No late tap when it comes back open, no grab left
// hanging, and a review-window handle grab gets its matching pointerup.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandPointer, type HandPointer } from '../../src/canvas/handPointer';
import { synthFist, synthHand } from '../helpers/synthHands';
import { fakeButton, fakeFrame, fakeHandDoc } from '../helpers/fakeHandDoc';

const W = 1000;
const H = 800;
const FRAME = 33;

describe('hand dropout mid-gesture', () => {
  let t: number;
  let hp: HandPointer;
  const fist = (x: number, y: number, frames = 1) => { for (let i = 0; i < frames; i++) { t += FRAME; hp.update([synthFist(x, y, W, H)], t); } };
  const open = (x: number, y: number, frames = 1) => { for (let i = 0; i < frames; i++) { t += FRAME; hp.update([synthHand(x, y, false, W, H)], t); } };
  /** No frames at all (the adapter only calls update when hands are seen). */
  const gone = (ms: number) => { vi.advanceTimersByTime(ms); t += ms; };

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as Record<string, unknown>).innerWidth = W;
    (globalThis as Record<string, unknown>).innerHeight = H;
    t = 0;
  });
  afterEach(() => {
    hp?.destroy();
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).innerWidth;
    delete (globalThis as Record<string, unknown>).innerHeight;
  });

  it('a hand lost mid-tap that returns open never fires a late click', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    hp = createHandPointer(fakeHandDoc([btn], []), { dwellClick: () => false });
    open(500, 400, 8);
    fist(500, 400, 3); // a tap in progress (armed)
    gone(600); // the hand leaves the camera: the 400 ms lost timer fires
    open(500, 400, 8); // it comes back, open, over the same button
    expect(btn.click).not.toHaveBeenCalled();
    // ...and a fresh, deliberate tap still works afterwards.
    fist(500, 400, 4);
    open(500, 400, 4);
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('a long-closed fist is never a tap, even with a stale armed state', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    hp = createHandPointer(fakeHandDoc([btn], []), { dwellClick: () => false });
    open(500, 400, 8);
    fist(500, 400, 3);
    // A long stretch of frames the tracker lost (but under the 400 ms timer
    // each time): ~1 s later it opens.
    for (let i = 0; i < 4; i++) { t += 300; fist(500, 400, 1); }
    open(500, 400, 6);
    expect(btn.click).not.toHaveBeenCalled();
  });

  it('a board grab ends when the hand disappears', () => {
    const f1 = fakeFrame({ left: 200, top: 200, width: 400, height: 300 }, 'f1');
    const board: Array<{ phase: string }> = [];
    hp = createHandPointer(fakeHandDoc([], [f1]), { dwellClick: () => false, onBoardMove: (e) => board.push(e) });
    open(300, 300, 10);
    fist(300, 300, 14);
    expect(board[0]?.phase).toBe('start');
    expect(hp.isGrabActive()).toBe(true);
    gone(600);
    expect(board.at(-1)?.phase).toBe('end');
    expect(hp.isGrabActive()).toBe(false);
  });

  it('a review-window handle grab gets its pointerup when the hand disappears', () => {
    const handle = fakeButton({ left: 450, top: 370, width: 200, height: 40 });
    handle.tagName = 'DIV';
    // Found by the control scan (button-ish) and matching the drag-handle selector.
    handle.matches = (sel: string) => sel.includes('[data-mc-drag-handle]') || sel.split(',').some((x) => x.trim().startsWith('button'));
    const types: string[] = [];
    hp = createHandPointer(fakeHandDoc([handle], []), {
      dwellClick: () => false,
      createDragEvent: (type) => { types.push(type); return { type } as unknown as Event; },
    });
    open(500, 390, 10);
    fist(500, 390, 14);
    expect(types[0]).toBe('pointerdown');
    expect(hp.isGrabActive()).toBe(true);
    gone(600);
    expect(types.at(-1)).toBe('pointerup');
    expect(hp.isGrabActive()).toBe(false);
  });
});
