// Fist gestures through the REAL createHandPointer().update() pipeline with
// synthetic frames:
//  - FIST TAP (close + re-open within 300 ms, < 12 px) = click the target;
//  - ONE fist held ≥ 300 ms (or moved ≥ 12 px) = grab: a control or chrome
//    under it → nothing; a board (frame RECTS) → move it; bare canvas → pan;
//  - TWO fists = zoom.
// A running grab only ends after the release grace (≥120 ms AND ≥3 open
// frames), so a loose fist flickering open for a frame or two keeps it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHandPointer, GRAB_HOLD_MS, type HandPointer, type HandPointerOptions } from '../../src/canvas/handPointer';
import { HAND_FEEL } from '../../src/canvas/handFeel';
import { synthFist, synthHand, synthRelaxed, synthThumbOutFist } from '../helpers/synthHands';
import { fakeButton, fakeFrame, fakeHandDoc, type FakeEl } from '../helpers/fakeHandDoc';
import { syntheticHand } from '../../src/canvas/handShapeFixtures';

const W = 1000;
const H = 800;
const FRAME = 33;
/** Frames for a fist to close (2) and pass the 300 ms hold. */
const HOLD = 13;

type BoardEv = { phase: string; frameId: string; dx: number; dy: number };
type PanEv = { phase: string; dx: number; dy: number };
type ZoomEv = { phase: string; a: { x: number; y: number }; b: { x: number; y: number } };

describe('fist tap, one-fist grab, two-fist zoom', () => {
  let t: number;
  let hp: HandPointer;
  let board: BoardEv[];
  let pans: PanEv[];
  let zooms: ZoomEv[];
  let clicks: number;
  let lastDoc: ReturnType<typeof fakeHandDoc>;

  const mount = (buttons: FakeEl[], frames: FakeEl[], covers: FakeEl[] = [], extra: HandPointerOptions = {}) => {
    board = []; pans = []; zooms = []; clicks = 0;
    lastDoc = fakeHandDoc(buttons, frames, covers);
    hp = createHandPointer(lastDoc, {
      onBoardMove: (ev) => board.push(ev),
      onWorldPan: (ev) => pans.push(ev),
      onWorldZoom: (ev) => zooms.push(ev),
      onHandEvent: (ev) => { if (ev.type === 'click') clicks++; },
      dwellClick: () => false, // the app default: dwell off, tap is the click
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
  /** A deliberate tap: open and still ≥150 ms, fist ≈130 ms, open again. */
  const tap = (x: number, y: number) => { open(x, y, 8); fist(x, y, 4); open(x, y, 4); };
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

  it('fist feel constants: 300 ms tap/hold, 20 px, 400 ms tap cooldown, 120 ms + 3 frame release grace, tap guards', () => {
    expect(GRAB_HOLD_MS).toBe(300);
    expect(HAND_FEEL.fistTapMs).toBe(300);
    expect(HAND_FEEL.fistMovePx).toBe(20);
    expect(HAND_FEEL.fistCloseFrames).toBe(2);
    expect(HAND_FEEL.fistOpenFrames).toBe(3);
    expect(HAND_FEEL.tapMinClosedMs).toBe(60);
    expect(HAND_FEEL.tapMinOpenBeforeMs).toBe(150);
    expect(HAND_FEEL.tapAfterHoldOpenMs).toBe(250);
    expect(HAND_FEEL.grabLooseOpenMs).toBe(400);
    expect(HAND_FEEL.tapMaxPalmSpeed).toBe(0.8);
    expect(HAND_FEEL.tapMinLockMs).toBe(100);
    expect(HAND_FEEL.tapCooldownMs).toBe(400);
    expect(HAND_FEEL.releaseGraceMs).toBe(120);
    expect(HAND_FEEL.releaseGraceFrames).toBe(3);
  });

  // ---------------------------------------------------------------- tap

  it('a fist tap on a button clicks it once', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    mount([btn], []);
    tap(500, 400);
    expect(btn.click).toHaveBeenCalledTimes(1);
    expect(clicks).toBe(1);
    expect(pans).toHaveLength(0);
  });

  it('with the open-palm highlight on, a fist tap over empty space clicks the HIGHLIGHTED button (targetOverride)', () => {
    const highlighted = fakeButton({ left: 700, top: 370, width: 100, height: 60 });
    mount([highlighted], [], [], { targetOverride: () => highlighted as unknown as HTMLElement });
    tap(560, 400); // 140 px from it: outside the pointer's own magnet
    expect(highlighted.click).toHaveBeenCalledTimes(1);
  });

  it('a control DIRECTLY under the raw point wins over the highlight', () => {
    const under = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    const highlighted = fakeButton({ left: 700, top: 370, width: 100, height: 60 });
    mount([under, highlighted], [], [], { targetOverride: () => highlighted as unknown as HTMLElement });
    tap(500, 400);
    expect(under.click).toHaveBeenCalledTimes(1);
    expect(highlighted.click).not.toHaveBeenCalled();
  });

  it('a stale highlight (override returns null) never steals the tap', () => {
    const under = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    const highlighted = fakeButton({ left: 700, top: 370, width: 100, height: 60 });
    mount([under, highlighted], [], [], { targetOverride: () => null });
    tap(560, 400);
    expect(highlighted.click).not.toHaveBeenCalled();
  });

  it('a held thumbs-up (four fingers curled, thumb up) is never a fist: no tap, no pan, no zoom', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    mount([btn], []);
    const thumb = (x: number, y: number) => {
      // Camera space: the synthetic selfie hand mirrored (x → 1 − x).
      const h = syntheticHand('thumbsUp', 'R', { at: { x: 1 - x / W, y: y / H } }).map((p) => ({ ...p, x: 1 - p.x }));
      return h;
    };
    for (let i = 0; i < 70; i++) { t += FRAME; hp.update([thumb(300, 600)], t); }
    for (let i = 0; i < 70; i++) { t += FRAME; hp.update([thumb(300, 600), thumb(700, 600)], t); }
    expect(pans).toHaveLength(0);
    expect(zooms).toHaveLength(0);
    expect(board).toHaveLength(0);
    expect(hp.isGrabActive()).toBe(false);
    expect(btn.click).not.toHaveBeenCalled();
  });

  it('the highlight never stops a fist on bare canvas from panning', () => {
    const highlighted = fakeButton({ left: 700, top: 370, width: 100, height: 60 });
    mount([highlighted], [], [], { targetOverride: () => highlighted as unknown as HTMLElement });
    open(300, 400, 8);
    fist(300, 400, HOLD);
    fist(340, 400, 6);
    expect(sum(pans, 'dx')).toBeGreaterThan(20);
    expect(highlighted.click).not.toHaveBeenCalled();
  });

  it('a deliberate ~120 ms tap from a still open hand clicks', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    mount([btn], []);
    open(500, 400, 8); // still and open ≥150 ms, target locked ≥150 ms
    fist(500, 400, 4); // ≈132 ms closed (first fist frame → first open frame)
    open(500, 400, 3);
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('a 1-frame fist flicker never clicks; a relaxed half-curled hand never clicks', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    mount([btn], []);
    open(500, 400, 8);
    for (let k = 0; k < 6; k++) { fist(500, 400, 1); open(500, 400, 5); }
    expect(btn.click).not.toHaveBeenCalled();
    // A relaxed hand (fingers loosely half-curled — not all four curled),
    // drifting in and out of that shape for seconds: never a fist, never a click.
    for (let k = 0; k < 10; k++) {
      for (let i = 0; i < 4; i++) { t += FRAME; hp.update([synthRelaxed(500, 400, W, H)], t); }
      open(500, 400, 4);
    }
    for (let i = 0; i < 60; i++) { t += FRAME; hp.update([synthRelaxed(500, 400, W, H)], t); }
    expect(btn.click).not.toHaveBeenCalled();
    expect(pans).toHaveLength(0);
    // Frame-rate independent: at 60 fps a 3-frame (48 ms) squeeze registers
    // as a fist but is below the 60 ms floor — no click…
    const at60 = (x: number, y: number, n: number, closed: boolean) => {
      for (let i = 0; i < n; i++) { t += 16; hp.update([closed ? synthFist(x, y, W, H) : synthHand(x, y, false, W, H)], t); }
    };
    at60(500, 400, 12, false);
    at60(500, 400, 3, true); at60(500, 400, 4, false);
    expect(btn.click).not.toHaveBeenCalled();
    // …while a 5-frame (80 ms) one, from a still open hand, does click.
    at60(500, 400, 30, false);
    at60(500, 400, 5, true); at60(500, 400, 4, false);
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('a thumb-out fist tap clicks on the FIRST try', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    mount([btn], []);
    open(500, 400, 5); // ≈165 ms open and resting
    for (let i = 0; i < 3; i++) { t += FRAME; hp.update([synthThumbOutFist(500, 400, W, H)], t); }
    open(500, 400, 3);
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('a held fist with pinky twitches (3–5 frames) never clicks and never drops the drag', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    const f1 = fakeFrame({ left: 100, top: 100, width: 300, height: 300 }, 'f1');
    mount([btn], [f1]);
    const twitch = (x: number, y: number) => {
      const h = synthFist(x, y, W, H);
      // The pinky tip flicks out (a lone pinky guess from the tracker).
      const w = h[0], pip = h[18];
      h[20] = { x: w.x + (pip.x - w.x) * 1.6, y: w.y + (pip.y - w.y) * 1.6 };
      return h;
    };
    // Over the button: hold, twitch, re-close — no click.
    open(500, 400, 8);
    fist(500, 400, 4);
    for (let i = 0; i < 3; i++) { t += FRAME; hp.update([twitch(500, 400)], t); }
    fist(500, 400, 3);
    open(500, 400, 4);
    expect(btn.click).not.toHaveBeenCalled();
    // Dragging a board: twitches mid-drag keep the grab.
    open(250, 250, 10);
    fist(250, 250, HOLD);
    expect(board[0]?.phase).toBe('start');
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < 5; i++) { t += FRAME; hp.update([twitch(260 + k * 10, 250)], t); } // longer than the release grace
      fist(265 + k * 10, 250, 3);
    }
    expect(board.some((e) => e.phase === 'end')).toBe(false);
    expect(hp.isBoardGrabbed()).toBe(true);
  });

  it('after a held fist, re-opening and closing quickly is not a tap (250 ms open-before)', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    mount([btn], []);
    open(500, 400, 8);
    fist(500, 400, 15); // a hold (blocked over the button)
    open(500, 400, 6); // ≈200 ms open
    fist(500, 400, 4); open(500, 400, 4);
    expect(btn.click).not.toHaveBeenCalled();
    open(500, 400, 10);
    fist(500, 400, 4); open(500, 400, 4); // a normal tap now
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('during a grab, a half-relaxed hand held ≥ 400 ms drops the board', () => {
    const f1 = fakeFrame({ left: 100, top: 100, width: 300, height: 300 }, 'f1');
    mount([], [f1]);
    fist(250, 250, HOLD);
    expect(hp.isBoardGrabbed()).toBe(true);
    for (let i = 0; i < 8; i++) { t += FRAME; hp.update([synthRelaxed(250, 250, W, H)], t); } // ≈260 ms
    expect(hp.isBoardGrabbed()).toBe(true);
    for (let i = 0; i < 10; i++) { t += FRAME; hp.update([synthRelaxed(250, 250, W, H)], t); }
    expect(hp.isBoardGrabbed()).toBe(false);
    expect(board.at(-1)?.phase).toBe('end');
  });

  it('classifier flips (fist ↔ thumbs-up ↔ pinch) during a deliberate tap still click once', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    mount([btn], []);
    open(500, 400, 6);
    const frames = [synthThumbOutFist, synthFist, synthThumbOutFist, synthFist];
    for (const f of frames) { t += FRAME; hp.update([f(500, 400, W, H)], t); }
    // The re-opening hand passes through a pinch shape on its first frame.
    t += FRAME; hp.update([synthHand(500, 400, true, W, H)], t);
    open(500, 400, 3);
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('a fist closing right after the hand opened (or while it moves fast) does not tap', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    mount([btn], []);
    open(500, 400, 8);
    fist(500, 400, 6); open(500, 400, 3); // not a tap (≈200 ms) but the hand was open only ~100 ms
    fist(500, 400, 4); open(500, 400, 4);
    expect(btn.click).toHaveBeenCalledTimes(1); // the first one only
    open(500, 400, 15);
    // Sweeping in fast and closing on arrival: the palm is still moving.
    const b2 = fakeButton({ left: 650, top: 370, width: 100, height: 60 });
    hp.destroy();
    mount([b2], []);
    open(300, 400, 8);
    for (let x = 340; x <= 700; x += 40) open(x, 400);
    fist(700, 400, 4); open(700, 400, 4);
    expect(b2.click).not.toHaveBeenCalled();
  });

  it('an open-flicker during an intended grab does not click', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    mount([btn], []);
    open(500, 400, 8);
    fist(500, 400, 6); // intending a hold
    open(500, 400, 2); // a 2-frame flicker open
    fist(500, 400, 12); // …and held
    open(500, 400, 6);
    expect(btn.click).not.toHaveBeenCalled();
  });

  it('a tap over a dialog scrim does not dismiss it', () => {
    const scrim = fakeFrame({ left: 0, top: 0, width: W, height: H }, 'x');
    scrim.dataset = {};
    scrim.getAttribute = ((n: string) => (n === 'data-hand-dismiss' ? '' : null)) as unknown as FakeEl['getAttribute'];
    scrim.closest = ((sel: string) => (sel === '[data-hand-dismiss]' ? scrim : null)) as FakeEl['closest'];
    mount([], [], [scrim]);
    tap(500, 400);
    expect(scrim.click).not.toHaveBeenCalled();
    expect(scrim.dispatchEvent).not.toHaveBeenCalled();
  });

  it('a fist tap clicks the magnet target (30 px off the button)', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    mount([btn], []);
    tap(420, 400);
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('a fist held past 300 ms over a button, then opened, does not click (and does not grab)', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    mount([btn], []);
    open(500, 400, 6);
    fist(500, 400, 15);
    open(500, 400, 4);
    expect(btn.click).not.toHaveBeenCalled();
    expect(pans).toHaveLength(0);
  });

  it('a fist that moves ≥ 20 px (unfiltered palm) while closed is not a tap', () => {
    const btn = fakeButton({ left: 400, top: 370, width: 200, height: 60 });
    mount([btn], []);
    open(450, 400, 6);
    fist(450, 400, 4);
    fist(500, 400, 2); // the palm travels 50 px while closed
    open(500, 400, 4);
    expect(btn.click).not.toHaveBeenCalled();
  });

  it('tap cooldown: a second tap within 400 ms is ignored, a later one clicks', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    mount([btn], []);
    open(500, 400, 8);
    fist(500, 400, 4); open(500, 400, 5); // tap 1 (fires on the 3rd open frame)
    fist(500, 400, 4); open(500, 400, 3); // tap 2 ≈300 ms after tap 1
    expect(btn.click).toHaveBeenCalledTimes(1);
    open(500, 400, 12);
    fist(500, 400, 4); open(500, 400, 4);
    expect(btn.click).toHaveBeenCalledTimes(2);
  });

  it('a fist tap on bare canvas or a board body does nothing', () => {
    const f1 = fakeFrame({ left: 200, top: 200, width: 300, height: 300 }, 'f1');
    mount([], [f1]);
    tap(800, 600);
    tap(350, 350);
    expect(clicks).toBe(0);
    expect(f1.click).not.toHaveBeenCalled();
    expect(board).toHaveLength(0);
    expect(pans).toHaveLength(0);
  });

  it('a confirm action (Reject) needs a direct hit: a magnet-only tap does not click it', () => {
    const reject = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    reject.getAttribute = ((n: string) => (n === 'aria-label' ? 'Reject' : null)) as unknown as FakeEl['getAttribute'];
    mount([reject], []);
    tap(420, 400); // 30 px off: magnet target, not a direct hit
    expect(reject.click).not.toHaveBeenCalled();
    open(500, 400, 15);
    tap(500, 400);
    expect(reject.click).toHaveBeenCalledTimes(1);
  });

  it('clickTarget() (the face-click hook) clicks the current target like a tap', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    mount([btn], []);
    expect(hp.clickTarget()).toBe(false); // no hand, no target
    open(500, 400, 6);
    expect(hp.clickTarget()).toBe(true);
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------- grab

  it('one fist held over a board then moving +50px → onBoardMove deltas sum to +50, no click', () => {
    const f1 = fakeFrame({ left: 200, top: 200, width: 400, height: 300 }, 'f1');
    mount([], [f1]);
    fist(400, 350, HOLD);
    expect(board.some((e) => e.phase === 'start' && e.frameId === 'f1')).toBe(true);
    expect(hp.isBoardGrabbed()).toBe(true);
    expect(hp.isGrabActive()).toBe(true);
    for (let x = 405; x <= 450; x += 5) fist(x, 350);
    fist(450, 350, 60);
    expect(sum(board, 'dx')).toBeGreaterThan(47);
    expect(sum(board, 'dx')).toBeLessThan(53);
    expect(Math.abs(sum(board, 'dy'))).toBeLessThan(3);
    expect(pans).toHaveLength(0);
    open(450, 350, 6);
    expect(board.at(-1)?.phase).toBe('end');
    expect(hp.isBoardGrabbed()).toBe(false);
    expect(clicks).toBe(0);
    expect(f1.click).not.toHaveBeenCalled();
  });

  it('moving the fist ≥ 20 px starts the grab early (before 300 ms), from where it closed', () => {
    const f1 = fakeFrame({ left: 200, top: 200, width: 400, height: 300 }, 'f1');
    mount([], [f1]);
    fist(400, 350, 2);
    for (let x = 410; x <= 460; x += 10) fist(x, 350); // ≈200 ms in, moving
    expect(board[0]?.phase).toBe('start');
    fist(460, 350, 60);
    expect(sum(board, 'dx')).toBeGreaterThan(56);
    expect(sum(board, 'dx')).toBeLessThan(63);
  });

  it('1–2 flicker frames mid-drag do not end the grab; ~150 ms open does', () => {
    const f1 = fakeFrame({ left: 200, top: 200, width: 400, height: 300 }, 'f1');
    mount([], [f1]);
    fist(400, 350, HOLD);
    for (let x = 405; x <= 430; x += 5) fist(x, 350);
    open(430, 350, 1); // one flicker
    fist(430, 350, 3);
    open(430, 350, 2); // two flickers
    for (let x = 435; x <= 450; x += 5) fist(x, 350);
    expect(board.some((e) => e.phase === 'end')).toBe(false);
    expect(hp.isBoardGrabbed()).toBe(true);
    fist(450, 350, 40);
    // Movement the smoothed cursor makes during a flicker is dropped (no
    // deltas in the grace), so a little of the 50 px can be lost.
    expect(sum(board, 'dx')).toBeGreaterThan(40);
    expect(sum(board, 'dx')).toBeLessThan(54);
    open(450, 350, 5); // ≈165 ms open
    expect(board.at(-1)?.phase).toBe('end');
  });

  it('no deltas are sent during the release grace', () => {
    const f1 = fakeFrame({ left: 200, top: 200, width: 400, height: 300 }, 'f1');
    mount([], [f1]);
    fist(400, 350, HOLD);
    fist(400, 350, 30);
    const n = board.length;
    open(480, 350, 2); // the hand opens and swings: inside the grace
    expect(board.slice(n).filter((e) => e.phase === 'move')).toHaveLength(0);
  });

  it('a board under non-interactive chrome (a panel over the board) is NOT grabbed — the fist is spent', () => {
    const f1 = fakeFrame({ left: 600, top: 200, width: 350, height: 300 }, 'f1');
    const panel = fakeFrame({ left: 820, top: 150, width: 160, height: 400 }, 'chrome');
    panel.dataset = {};
    panel.closest = () => null; // a review dialog / dock / engine bar area
    mount([], [f1], [panel]);
    fist(880, 300, HOLD + 5);
    for (let x = 870; x >= 700; x -= 20) fist(x, 300); // slides off onto the board
    expect(board).toHaveLength(0);
    expect(pans).toHaveLength(0);
  });

  it('dragging a board across buttons and chrome keeps moving it (no hit-tests while a grab runs)', () => {
    const f1 = fakeFrame({ left: 100, top: 300, width: 300, height: 200 }, 'f1');
    const chip = fakeButton({ left: 600, top: 380, width: 120, height: 40 });
    mount([chip], [f1]);
    fist(250, 400, HOLD);
    for (let x = 260; x <= 700; x += 20) fist(x, 400);
    fist(700, 400, 40);
    expect(sum(board, 'dx')).toBeGreaterThan(430);
    expect(board.some((e) => e.phase === 'end')).toBe(false);
    expect(chip.click).not.toHaveBeenCalled();
    expect(clicks).toBe(0);
  });

  it('dragging a board to the screen edge does not drop it (only camera clipping is an edge)', () => {
    const f1 = fakeFrame({ left: 600, top: 300, width: 300, height: 200 }, 'f1');
    mount([], [f1]);
    fist(750, 400, HOLD);
    for (let x = 760; x <= 1000; x += 20) fist(x, 400); // past the right screen margin
    fist(1000, 400, 10);
    expect(board.some((e) => e.phase === 'end')).toBe(false);
    expect(hp.isBoardGrabbed()).toBe(true);
  });

  it('one fist over empty canvas → onWorldPan (1:1), not a board move', () => {
    mount([], [fakeFrame({ left: 0, top: 0, width: 100, height: 100 }, 'f1')]);
    fist(500, 400, HOLD);
    expect(pans[0]?.phase).toBe('start');
    for (let y = 410; y <= 450; y += 10) fist(500, y);
    fist(500, 450, 60);
    expect(sum(pans, 'dy')).toBeGreaterThan(47);
    expect(sum(pans, 'dy')).toBeLessThan(53);
    expect(board).toHaveLength(0);
    open(500, 450, 6);
    expect(pans.at(-1)?.phase).toBe('end');
    expect(hp.isGrabActive()).toBe(false);
  });

  it('one fist held over a button → no onBoardMove, no onWorldPan, no click (Review Focus 3)', () => {
    const f1 = fakeFrame({ left: 200, top: 200, width: 400, height: 300 }, 'f1');
    const btn = fakeButton({ left: 350, top: 320, width: 100, height: 60 }, f1);
    mount([btn], [f1]);
    fist(400, 350, HOLD + 3);
    for (let x = 405; x <= 500; x += 5) fist(x, 350);
    fist(500, 350, 40);
    open(500, 350, 6);
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
    fist(500, 400, HOLD);
    for (let x = 520; x <= 800; x += 20) fist(x, 400);
    expect(pans).toHaveLength(0);
    open(800, 400, 6);
    fist(800, 400, HOLD);
    expect(pans[0]?.phase).toBe('start');
  });

  it('a fist on a board TITLE moves the board (hold); a tap on it clicks the title', () => {
    const f1 = fakeFrame({ left: 200, top: 200, width: 400, height: 300 }, 'f1');
    const title = fakeButton({ left: 210, top: 206, width: 200, height: 28 }, f1);
    title.matches = (sel: string) => sel.split(',').some((s) => s.trim().startsWith('button') || s.trim() === '.mc-frame-title');
    mount([title], [f1]);
    tap(300, 220);
    expect(title.click).toHaveBeenCalledTimes(1);
    open(300, 220, 15);
    fist(300, 220, HOLD);
    expect(board.some((e) => e.phase === 'start' && e.frameId === 'f1')).toBe(true);
  });

  it('a held fist on a panel drag / resize handle drags it with pointerdown → move → up (review window)', () => {
    for (const attr of ['[data-mc-drag-handle]', '[data-mc-resize-handle]']) {
      const handle = fakeButton({ left: 600, top: 100, width: 200, height: 48 });
      handle.matches = (sel: string) => sel.split(',').some((s) => s.trim().startsWith('button') || s.trim() === attr);
      const evs: { type: string; x: number; y: number }[] = [];
      mount([handle], [], [], { createDragEvent: (type, p) => { evs.push({ type, x: p.x, y: p.y }); return { type } as unknown as Event; } });
      open(700, 124, 6);
      fist(700, 124, HOLD);
      for (let x = 700; x <= 760; x += 20) fist(x, 124 + (x - 700));
      open(760, 184, 8);
      const types = evs.map((e) => e.type);
      expect(types[0], attr).toBe('pointerdown');
      expect(types).toContain('pointermove');
      expect(types[types.length - 1], attr).toBe('pointerup');
      expect(evs.filter((e) => e.type === 'pointermove').pop()!.x).toBeGreaterThan(720);
      expect(handle.dispatchEvent).toHaveBeenCalled();
      expect(board).toHaveLength(0);
      expect(pans).toHaveLength(0);
      hp.destroy();
    }
  });

  it('a fist on an ordinary button still never grabs (only board titles and drag/resize handles do)', () => {
    const btn = fakeButton({ left: 600, top: 100, width: 200, height: 48 });
    const evs: string[] = [];
    mount([btn], [], [], { createDragEvent: (type) => { evs.push(type); return { type } as unknown as Event; } });
    open(700, 124, 6);
    fist(700, 124, HOLD);
    for (let x = 700; x <= 780; x += 20) fist(x, 124);
    expect(evs).toHaveLength(0);
    expect(pans).toHaveLength(0);
  });

  it('in focus mode, one fist on the FOCUSED board pans instead of moving it', () => {
    const f1 = fakeFrame({ left: 100, top: 100, width: 800, height: 600 }, 'f1');
    mount([], [f1], [], { focusedFrameId: () => 'f1' });
    fist(500, 400, HOLD);
    expect(pans[0]?.phase).toBe('start');
    expect(board).toHaveLength(0);
  });

  it('a fist closed < 300 ms and still → nothing grabs', () => {
    mount([], [fakeFrame({ left: 200, top: 200, width: 400, height: 300 }, 'f1')]);
    fist(400, 350, 7); // ≈230 ms
    open(400, 350, 5);
    open(300, 300, 20);
    fist(300, 300, 3);
    open(300, 300, 5);
    expect(board).toHaveLength(0);
    expect(pans).toHaveLength(0);
    expect(zooms).toHaveLength(0);
  });

  it('two fists spreading → onWorldZoom start then move, end when one opens', () => {
    mount([], []);
    fists({ x: 400, y: 400 }, { x: 600, y: 400 }, HOLD);
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
    for (let i = 0; i < 5; i++) { t += FRAME; hp.update([synthHand(300, 400, false, W, H), synthFist(700, 400, W, H)], t); }
    expect(zooms.at(-1)?.phase).toBe('end');
    for (let i = 0; i < 20; i++) { t += FRAME; hp.update([synthHand(300, 400, false, W, H), synthFist(700 + i * 5, 400, W, H)], t); }
    expect(pans).toHaveLength(0); // the remaining fist is spent
    expect(clicks).toBe(0); // and the opening fist is not a tap
  });

  it('a second fist arriving ends the board move before the zoom starts', () => {
    const f1 = fakeFrame({ left: 200, top: 200, width: 400, height: 300 }, 'f1');
    mount([], [f1]);
    fist(400, 350, HOLD);
    expect(board[0]?.phase).toBe('start');
    for (let i = 0; i < HOLD + 2; i++) { t += FRAME; hp.update([synthFist(400, 350, W, H), synthFist(750, 350, W, H)], t); }
    const endAt = board.findIndex((e) => e.phase === 'end');
    expect(endAt).toBeGreaterThan(0);
    expect(zooms[0]?.phase).toBe('start');
    expect(hp.isBoardGrabbed()).toBe(false);
    expect(hp.isGrabActive()).toBe(true);
  });

  it('pinch frames (one or two hands) never click, grab, pan, or zoom', () => {
    const btn = fakeButton({ left: 350, top: 320, width: 100, height: 60 });
    mount([btn], [fakeFrame({ left: 200, top: 200, width: 400, height: 300 }, 'f1')]);
    for (let i = 0; i < 20; i++) { t += FRAME; hp.update([synthHand(400, 350, i % 4 < 2, W, H)], t); }
    for (let i = 0; i < 20; i++) { t += FRAME; hp.update([synthHand(300 - i * 5, 350, true, W, H), synthHand(700 + i * 5, 350, true, W, H)], t); }
    expect(btn.click).not.toHaveBeenCalled();
    expect(board).toHaveLength(0);
    expect(pans).toHaveLength(0);
    expect(zooms).toHaveLength(0);
  });

  it('dwell (when on) is suppressed while a grab is active, on both hands', () => {
    const btn = fakeButton({ left: 700, top: 370, width: 100, height: 60 });
    mount([btn], [], [], { dwellClick: () => true });
    fist(300, 400, HOLD);
    for (let i = 0; i < 40; i++) { t += FRAME; hp.update([synthFist(300, 400, W, H), synthHand(750, 400, false, W, H)], t); }
    expect(btn.click).not.toHaveBeenCalled();
    expect(hp.target).toBeNull();
  });

  // ---------------------------------------------------------------- facing gate

  it('not facing (held ≥300 ms): no tap, no grab, no pan; the cursor dims and a hint shows', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    mount([btn], []);
    open(500, 400, 4);
    hp.setFacing!(false, t);
    open(500, 400, 10); // ≈330 ms not facing → locked
    expect(hp.handsLocked!()).toBe(true);
    expect(hp.target).toBeNull();
    const created = (lastDoc as unknown as { __created: { className: string; hidden: boolean; textContent?: string; classList: { contains(c: string): boolean } }[] }).__created;
    expect(created.filter((e) => e.className.includes('mc-hand-cursor')).some((c) => c.classList.contains('is-away'))).toBe(true);
    const hint = created.find((e) => e.className === 'mc-hand-away-hint');
    expect(hint?.hidden).toBe(false);
    expect(hint?.textContent).toBe('Look at the screen to use hands');
    tap(500, 400);
    expect(btn.click).not.toHaveBeenCalled();
    fist(800, 400, HOLD + 5);
    expect(pans).toHaveLength(0);
    expect(hp.clickTarget()).toBe(false);
  });

  it('a glance away (< 300 ms) does not lock the hands', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    mount([btn], []);
    open(500, 400, 4);
    hp.setFacing!(false, t);
    open(500, 400, 6); // ≈200 ms
    hp.setFacing!(true, t);
    expect(hp.handsLocked!()).toBe(false);
    tap(500, 400);
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('unknown facing (no face tracked) never locks the hands', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    mount([btn], []);
    hp.setFacing!(null, t);
    open(500, 400, 30);
    expect(hp.handsLocked!()).toBe(false);
    tap(500, 400);
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('a running grab ends cleanly when facing is lost > 400 ms, and the closed fist stays spent after facing returns', () => {
    const f1 = fakeFrame({ left: 200, top: 200, width: 400, height: 300 }, 'f1');
    mount([], [f1]);
    fist(400, 350, HOLD);
    expect(board[0]?.phase).toBe('start');
    hp.setFacing!(false, t);
    fist(400, 350, 8); // ≈260 ms: still grabbing
    expect(hp.isBoardGrabbed()).toBe(true);
    fist(400, 350, 6); // past 400 ms
    expect(board.at(-1)?.phase).toBe('end');
    expect(hp.isGrabActive()).toBe(false);
    hp.setFacing!(true, t);
    expect(hp.handsLocked!()).toBe(false);
    const n = board.length;
    fist(450, 350, HOLD + 5); // the same fist, still closed: no new grab
    expect(board).toHaveLength(n);
    open(450, 350, 6);
    fist(450, 350, HOLD); // a fresh fist works again at once
    expect(board.at(-1)?.phase === 'start' || board.at(-1)?.phase === 'move').toBe(true);
  });

  it('after facing returns, the tap guards restart (open-before and target lock count from the resume)', () => {
    const btn = fakeButton({ left: 450, top: 370, width: 100, height: 60 });
    mount([btn], []);
    open(500, 400, 6);
    hp.setFacing!(false, t);
    open(500, 400, 12);
    hp.setFacing!(true, t);
    fist(500, 400, 3); open(500, 400, 3); // immediately after resuming: < 100 ms guard
    expect(btn.click).not.toHaveBeenCalled();
    tap(500, 400);
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('losing the hand mid-grab ends the grab', () => {
    mount([], []);
    fist(500, 400, HOLD);
    expect(hp.isGrabActive()).toBe(true);
    hp.lost();
    expect(pans.at(-1)?.phase).toBe('end');
    expect(hp.isGrabActive()).toBe(false);
  });
});
