// One fist = grab (move a board / pan the world), two fists = zoom — through
// the REAL createHandPointer().update() pipeline with synthetic frames.
// Start order (streamB B6): a control under the fist → nothing; a board
// (hit by frame RECTS, so chrome over the board doesn't drop it) → move it;
// empty canvas → pan. A fist must be held ≥150 ms (on top of the 120 ms
// point/fist gate) before anything happens.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHandPointer, GRAB_HOLD_MS, type HandPointer, type HandPointerOptions } from '../../src/canvas/handPointer';
import { synthFist, synthHand } from '../helpers/synthHands';
import { fakeButton, fakeFrame, fakeHandDoc, type FakeEl } from '../helpers/fakeHandDoc';

const W = 1000;
const H = 800;
const FRAME = 33;

type BoardEv = { phase: string; frameId: string; dx: number; dy: number };
type PanEv = { phase: string; dx: number; dy: number };
type ZoomEv = { phase: string; a: { x: number; y: number }; b: { x: number; y: number } };

describe('one-fist grab, two-fist zoom', () => {
  let t: number;
  let hp: HandPointer;
  let board: BoardEv[];
  let pans: PanEv[];
  let zooms: ZoomEv[];
  let clicks: number;

  const mount = (buttons: FakeEl[], frames: FakeEl[], covers: FakeEl[] = [], extra: HandPointerOptions = {}) => {
    board = []; pans = []; zooms = []; clicks = 0;
    hp = createHandPointer(fakeHandDoc(buttons, frames, covers), {
      onBoardMove: (ev) => board.push(ev),
      onWorldPan: (ev) => pans.push(ev),
      onWorldZoom: (ev) => zooms.push(ev),
      onHandEvent: (ev) => { if (ev.type === 'click') clicks++; },
      ...extra,
    });
  };
  const fist = (x: number, y: number, frames = 1) => {
    for (let i = 0; i < frames; i++) { t += FRAME; hp.update([synthFist(x, y, W, H)], t); }
  };
  const open = (x: number, y: number, frames = 1) => {
    for (let i = 0; i < frames; i++) { t += FRAME; hp.update([synthHand(x, y, false, W, H)], t); }
  };
  const fists = (a: { x: number; y: number }, b: { x: number; y: number }, frames = 1) => {
    for (let i = 0; i < frames; i++) { t += FRAME; hp.update([synthFist(a.x, a.y, W, H), synthFist(b.x, b.y, W, H)], t); }
  };
  const sum = (evs: { phase: string; dx: number; dy: number }[], k: 'dx' | 'dy') =>
    evs.filter((e) => e.phase === 'move').reduce((s, e) => s + e[k], 0);

  beforeEach(() => {
    (globalThis as Record<string, unknown>).innerWidth = W;
    (globalThis as Record<string, unknown>).innerHeight = H;
    t = 0;
  });
  afterEach(() => {
    hp?.destroy();
    delete (globalThis as Record<string, unknown>).innerWidth;
    delete (globalThis as Record<string, unknown>).innerHeight;
  });

  it('the hold is 150 ms', () => {
    expect(GRAB_HOLD_MS).toBe(150);
  });

  it('one fist over a board for 200 ms then moving +50px → onBoardMove deltas sum to +50, no click', () => {
    const f1 = fakeFrame({ left: 200, top: 200, width: 400, height: 300 }, 'f1');
    mount([], [f1]);
    fist(400, 350, 7); // ≈230 ms held
    expect(board.some((e) => e.phase === 'start' && e.frameId === 'f1')).toBe(true);
    expect(hp.isBoardGrabbed()).toBe(true);
    expect(hp.isGrabActive()).toBe(true);
    // Move +50px in steps, then hold still long enough for the filter to settle.
    for (let x = 405; x <= 450; x += 5) fist(x, 350);
    fist(450, 350, 60);
    expect(sum(board, 'dx')).toBeGreaterThan(47);
    expect(sum(board, 'dx')).toBeLessThan(53);
    expect(Math.abs(sum(board, 'dy'))).toBeLessThan(3);
    expect(pans).toHaveLength(0);
    // Opening the hand ends the move.
    open(450, 350, 2);
    expect(board.at(-1)?.phase).toBe('end');
    expect(hp.isBoardGrabbed()).toBe(false);
    expect(clicks).toBe(0);
    expect(f1.click).not.toHaveBeenCalled();
  });

  it('a board under non-interactive chrome (the right-side cluster) is still grabbed by its rect', () => {
    const f1 = fakeFrame({ left: 600, top: 200, width: 350, height: 300 }, 'f1');
    const cluster = fakeFrame({ left: 820, top: 150, width: 160, height: 400 }, 'chrome');
    cluster.dataset = {}; // not a board: just something on top
    cluster.closest = () => null;
    mount([], [f1], [cluster]);
    fist(880, 300, 7);
    expect(board.some((e) => e.phase === 'start' && e.frameId === 'f1')).toBe(true);
    expect(pans).toHaveLength(0);
  });

  it('dragging a board across buttons keeps moving it (hit-tests are ignored while a grab runs)', () => {
    const f1 = fakeFrame({ left: 100, top: 300, width: 300, height: 200 }, 'f1');
    const chip = fakeButton({ left: 600, top: 380, width: 120, height: 40 });
    mount([chip], [f1]);
    fist(250, 400, 7);
    for (let x = 260; x <= 700; x += 20) fist(x, 400);
    fist(700, 400, 40); // resting right on the chip, well past the dwell time
    expect(sum(board, 'dx')).toBeGreaterThan(430);
    expect(board.some((e) => e.phase === 'end')).toBe(false);
    expect(chip.click).not.toHaveBeenCalled();
    expect(clicks).toBe(0);
  });

  it('one fist over empty canvas → onWorldPan (1:1), not a board move', () => {
    mount([], [fakeFrame({ left: 0, top: 0, width: 100, height: 100 }, 'f1')]);
    fist(500, 400, 7);
    expect(pans[0]?.phase).toBe('start');
    for (let y = 410; y <= 450; y += 10) fist(500, y);
    fist(500, 450, 60);
    expect(sum(pans, 'dy')).toBeGreaterThan(47);
    expect(sum(pans, 'dy')).toBeLessThan(53);
    expect(board).toHaveLength(0);
    open(500, 450, 2);
    expect(pans.at(-1)?.phase).toBe('end');
    expect(hp.isGrabActive()).toBe(false);
  });

  it('one fist over a button → no onBoardMove, no onWorldPan, no click (Review Focus 3)', () => {
    const f1 = fakeFrame({ left: 200, top: 200, width: 400, height: 300 }, 'f1');
    const btn = fakeButton({ left: 350, top: 320, width: 100, height: 60 }, f1);
    mount([btn], [f1]);
    fist(400, 350, 10);
    for (let x = 405; x <= 500; x += 5) fist(x, 350);
    fist(500, 350, 40);
    expect(board).toHaveLength(0);
    expect(pans).toHaveLength(0);
    expect(zooms).toHaveLength(0);
    expect(clicks).toBe(0);
    expect(btn.click).not.toHaveBeenCalled();
    expect(hp.isGrabActive()).toBe(false);
  });

  it('a fist that started over a button stays spent until it opens (no pan once it slides off)', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    mount([btn], []);
    fist(500, 400, 8);
    for (let x = 520; x <= 800; x += 20) fist(x, 400); // slides off onto empty canvas
    expect(pans).toHaveLength(0);
    open(800, 400, 6);
    fist(800, 400, 12); // a fresh fist (120 ms gate + 150 ms hold) on empty canvas does pan
    expect(pans[0]?.phase).toBe('start');
  });

  it('a fist on a board TITLE moves the board (the title is a handle, not a no-op control)', () => {
    const f1 = fakeFrame({ left: 200, top: 200, width: 400, height: 300 }, 'f1');
    const title = fakeButton({ left: 210, top: 206, width: 200, height: 28 }, f1);
    title.matches = (sel: string) => sel.split(',').some((s) => s.trim().startsWith('button') || s.trim() === '.mc-frame-title');
    mount([title], [f1]);
    fist(300, 220, 7);
    expect(board.some((e) => e.phase === 'start' && e.frameId === 'f1')).toBe(true);
  });

  it('in focus mode, one fist on the FOCUSED board pans instead of moving it', () => {
    const f1 = fakeFrame({ left: 100, top: 100, width: 800, height: 600 }, 'f1');
    mount([], [f1], [], { focusedFrameId: () => 'f1' });
    fist(500, 400, 7);
    expect(pans[0]?.phase).toBe('start');
    expect(board).toHaveLength(0);
  });

  it('a fist held < 150 ms → nothing', () => {
    mount([], [fakeFrame({ left: 200, top: 200, width: 400, height: 300 }, 'f1')]);
    fist(400, 350, 4); // ≈130 ms
    open(400, 350, 5);
    fist(300, 300, 3);
    open(300, 300, 5);
    expect(board).toHaveLength(0);
    expect(pans).toHaveLength(0);
    expect(zooms).toHaveLength(0);
  });

  it('two fists spreading → onWorldZoom start then move, end when one opens', () => {
    mount([], []);
    fists({ x: 400, y: 400 }, { x: 600, y: 400 }, 7);
    expect(zooms[0]?.phase).toBe('start');
    for (let d = 10; d <= 100; d += 10) fists({ x: 400 - d, y: 400 }, { x: 600 + d, y: 400 });
    fists({ x: 300, y: 400 }, { x: 700, y: 400 }, 20);
    const moves = zooms.filter((z) => z.phase === 'move');
    expect(moves.length).toBeGreaterThan(5);
    const last = moves.at(-1)!;
    const span = Math.hypot(last.b.x - last.a.x, last.b.y - last.a.y);
    const span0 = Math.hypot(zooms[0].b.x - zooms[0].a.x, zooms[0].b.y - zooms[0].a.y);
    expect(span / span0).toBeGreaterThan(1.8);
    expect(pans).toHaveLength(0);
    expect(board).toHaveLength(0);
    t += FRAME; hp.update([synthHand(300, 400, false, W, H), synthFist(700, 400, W, H)], t);
    expect(zooms.at(-1)?.phase).toBe('end');
    // The remaining fist is spent: it does not start panning.
    for (let i = 0; i < 10; i++) { t += FRAME; hp.update([synthHand(300, 400, false, W, H), synthFist(700 + i * 5, 400, W, H)], t); }
    expect(pans).toHaveLength(0);
  });

  it('a second fist arriving ends the board move before the zoom starts', () => {
    const f1 = fakeFrame({ left: 200, top: 200, width: 400, height: 300 }, 'f1');
    mount([], [f1]);
    fist(400, 350, 7);
    expect(board[0]?.phase).toBe('start');
    for (let i = 0; i < 8; i++) { t += FRAME; hp.update([synthFist(400, 350, W, H), synthFist(750, 350, W, H)], t); }
    const endAt = board.findIndex((e) => e.phase === 'end');
    expect(endAt).toBeGreaterThan(0);
    expect(zooms[0]?.phase).toBe('start');
    expect(hp.isBoardGrabbed()).toBe(false);
    expect(hp.isGrabActive()).toBe(true);
  });

  it('pinch frames (one or two hands) never grab, pan, or zoom', () => {
    mount([], [fakeFrame({ left: 200, top: 200, width: 400, height: 300 }, 'f1')]);
    for (let i = 0; i < 20; i++) { t += FRAME; hp.update([synthHand(400, 350, true, W, H)], t); }
    for (let i = 0; i < 20; i++) { t += FRAME; hp.update([synthHand(300 - i * 5, 350, true, W, H), synthHand(700 + i * 5, 350, true, W, H)], t); }
    expect(board).toHaveLength(0);
    expect(pans).toHaveLength(0);
    expect(zooms).toHaveLength(0);
  });

  it('dwell is suppressed while a grab is active, on both hands', () => {
    const btn = fakeButton({ left: 700, top: 370, width: 100, height: 60 });
    mount([btn], []);
    fist(300, 400, 7); // pan starts on empty canvas
    for (let i = 0; i < 40; i++) { t += FRAME; hp.update([synthFist(300, 400, W, H), synthHand(750, 400, false, W, H)], t); }
    expect(btn.click).not.toHaveBeenCalled();
    expect(hp.target).toBeNull();
  });

  it('losing the hand mid-grab ends the grab', () => {
    mount([], []);
    fist(500, 400, 7);
    expect(hp.isGrabActive()).toBe(true);
    hp.lost();
    expect(pans.at(-1)?.phase).toBe('end');
    expect(hp.isGrabActive()).toBe(false);
  });
});
