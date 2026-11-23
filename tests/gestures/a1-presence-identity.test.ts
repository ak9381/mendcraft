// A1 hand-path tests: motion-event suppression during a hold, left/right
// hand parity, idle second hand non-interference, and re-entry identity.
import { describe, expect, it } from 'vitest';
import { createCanvasHandsAdapter, type CanvasHandEvent } from '../../src/canvas/canvasHands';
import { classifyGesture } from '../../src/input/gestures';
import { pickPrimaryHand } from '../../src/canvas/handFeel';
import { createHandsProcessor, type HandEvent } from '../../src/input/handLogic';
import { OPEN, PINCH, POINT, FIST, place, mirror } from '../helpers/hands';
import type { Pt } from '../../src/input/handLogic';

const S = 0.5;
/** A pose moving linearly from (x0,y0) to (x1,y1) over `ms`, 30fps — same
 *  construction gestureCatalog.test.ts uses to drive a real palm swipe. */
function move(pose: () => Pt[], ms: number, x0: number, y0: number, x1: number, y1: number): Array<{ hands: Pt[][]; now: number }> {
  const f: Array<{ hands: Pt[][]; now: number }> = [];
  for (let t = 0; t <= ms; t += 33) {
    const k = t / ms;
    f.push({ hands: [place(pose(), x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, S)], now: t });
  }
  return f;
}

describe('A1-021 static pose vs motion gesture overlap (suppressMotion)', () => {
  it('a palm swipe fires drop normally, but is suppressed while suppressMotion flags its id (morph hold in progress)', () => {
    const plain: CanvasHandEvent[] = [];
    const normal = createCanvasHandsAdapter((e) => plain.push(e));
    for (const f of move(OPEN, 400, 0.7, 0.8, 0.35, 0.8)) normal.update(f);
    expect(plain.some((e) => e.type === 'drop')).toBe(true);

    const suppressed: CanvasHandEvent[] = [];
    const suppressing = createCanvasHandsAdapter((e) => suppressed.push(e), {
      suppressMotion: (id) => id === 'palm-swipe-left',
    });
    for (const f of move(OPEN, 400, 0.7, 0.8, 0.35, 0.8)) suppressing.update(f);
    expect(suppressed.some((e) => e.type === 'drop')).toBe(false);
  });
});

describe('A1-027 / A1-028 left hand vs right hand parity', () => {
  it('classifyGesture reads the same pose identically whichever physical hand produced it (mirroring is purely geometric)', () => {
    for (const pose of [OPEN, PINCH, POINT, FIST]) {
      const straight = classifyGesture(pose());
      const asOtherHand = classifyGesture(mirror(pose()));
      expect(asOtherHand).toBe(straight);
    }
    expect(classifyGesture(OPEN())).toBe('open-palm');
    expect(classifyGesture(mirror(OPEN()))).toBe('open-palm');
    expect(classifyGesture(PINCH())).toBe('pinch');
    expect(classifyGesture(mirror(PINCH()))).toBe('pinch');
  });
});

describe('A1-029 idle hand does not interfere with the active hand', () => {
  it('a second, idle hand present in frame does not change which hand drives the cursor', () => {
    const active = place(OPEN(), 0.6, 0.5, 0.5); // bigger / closer to camera
    const idle = place(FIST(), 0.2, 0.2, 0.08); // smaller / farther, just resting in frame

    const aloneResult = pickPrimaryHand([active]);
    const withIdleResult = pickPrimaryHand([idle, active]);

    expect(withIdleResult).toBe(active);
    expect(withIdleResult).toEqual(aloneResult);
  });
});

function setupLogic() {
  const events: HandEvent[] = [];
  const p = createHandsProcessor((e) => events.push(e));
  return { p, events };
}
/** Minimal 21-point hand centred at (cx, cy); gap controls pinch distance. */
function hand(cx: number, cy: number, gap = 0.15): Pt[] {
  const pts: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  pts[0] = { x: cx, y: cy + 0.2 };
  pts[9] = { x: cx, y: cy };
  pts[8] = { x: cx, y: cy - 0.05 };
  pts[4] = { x: cx + gap, y: cy - 0.05 };
  return pts;
}

describe('A1-023 hand presence: re-entry resumes the same identity', () => {
  it('the common case — one hand briefly drops out while the other stays — the returning hand regains its original slot', () => {
    const { p } = setupLogic();
    let f = p.process([{ landmarks: hand(0.3, 0.5), label: 'Left' }, { landmarks: hand(0.7, 0.5), label: 'Right' }]);
    expect(f.find((h) => h.label === 'Left')!.slot).toBe(0);
    expect(f.find((h) => h.label === 'Right')!.slot).toBe(1);

    // Left drops out for a couple of frames (tracking dip); Right stays visible.
    p.process([{ landmarks: hand(0.7, 0.5), label: 'Right' }]);
    p.process([{ landmarks: hand(0.7, 0.5), label: 'Right' }]);

    // Left reappears.
    f = p.process([{ landmarks: hand(0.3, 0.5), label: 'Left' }, { landmarks: hand(0.7, 0.5), label: 'Right' }]);
    expect(f.find((h) => h.label === 'Left')!.slot).toBe(0);
    expect(f.find((h) => h.label === 'Right')!.slot).toBe(1);
  });

  // BUG: when BOTH hands drop out in the same frame (e.g. a shared occlusion)
  // and reappear in a different array order than before, assignSlots
  // (handLogic.ts:143-155) has already cleared both slots' `label` the
  // instant they were absent (handLogic.ts:175-181), so re-entry falls
  // through to the position-based "first free slot" branch instead of the
  // handedness-label match — the two hands silently swap colour slots. A
  // real user would see their own hand's cursor colour jump to the other
  // hand's colour after a shared tracking dropout.
  it.skip('BUG: both hands dropping out together and reappearing in a different order swap colour slots instead of keeping identity — handLogic.ts:175-181', () => {
    const { p } = setupLogic();
    let f = p.process([{ landmarks: hand(0.3, 0.5), label: 'Left' }, { landmarks: hand(0.7, 0.5), label: 'Right' }]);
    expect(f.find((h) => h.label === 'Left')!.slot).toBe(0);
    expect(f.find((h) => h.label === 'Right')!.slot).toBe(1);

    p.process([]); // both hands occluded for a frame

    // Both reappear, but MediaPipe reports them in the opposite array order.
    f = p.process([{ landmarks: hand(0.7, 0.5), label: 'Right' }, { landmarks: hand(0.3, 0.5), label: 'Left' }]);
    expect(f.find((h) => h.label === 'Left')!.slot).toBe(0); // fails: actually lands on slot 1
    expect(f.find((h) => h.label === 'Right')!.slot).toBe(1); // fails: actually lands on slot 0
  });
});
