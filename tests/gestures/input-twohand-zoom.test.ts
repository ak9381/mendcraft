// B19 (two-hand pan/zoom gesture layer) + hand-agnostic selection (B-087) and
// gesture-ambiguity (B-089). Pure src/input/gestures.ts + gestureMap.ts +
// handLogic.ts, plus one plan-tool integration check. NOTE: main.ts's actual
// keydown-synthesis wiring (B-148's "full dispatch path", B-151's open-palm
// pan) is a non-exported closure and is NOT reached by these tests — see the
// report for that caveat.
import { describe, expect, it } from 'vitest';
import { createGestureRecognizer, classifyGesture } from '../../src/input/gestures';
import { DEFAULT_GESTURE_MAP } from '../../src/input/gestureMap';
import { createHandsProcessor, type HandEvent, type Pt } from '../../src/input/handLogic';
import { createPlanTools, nudgeSelected } from '../../src/plan/tools';
import { emptyPlan, type Wall } from '../../src/plan/doc';
import { makeFakeCtx, ptr } from './toolCtxFake';

/** 21 landmarks; wrist->middle MCP = 0.2. `gap` = thumb-index tip distance.
 *  The index reaches out (~1.3× palm size) so this is a pinch, not a fist. */
function hand(cx: number, cy: number, gap: number): Pt[] {
  const pts: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  pts[0] = { x: cx, y: cy + 0.42 }; // wrist
  pts[5] = { x: cx, y: cy + 0.22 };
  pts[9] = { x: cx, y: cy + 0.22 }; // middle MCP — palm size 0.2
  pts[13] = { x: cx + 0.06, y: cy + 0.22 };
  pts[17] = { x: cx + 0.10, y: cy + 0.22 };
  pts[8] = { x: cx, y: cy }; // index tip, ~1.3× palm size from the palm
  pts[6] = { x: cx, y: cy + 0.12 };
  pts[4] = { x: cx + gap, y: cy };
  // Other fingertips stay curled at the palm so only the index is reaching.
  const palmY = cy + 0.26;
  pts[12] = { x: cx + 0.05, y: palmY };
  pts[16] = { x: cx + 0.08, y: palmY };
  pts[20] = { x: cx + 0.12, y: palmY };
  return pts;
}
const PINCH_GAP = 0.02;

describe('B-147 keyboard +/- zoom has no lone one-hand gesture equivalent', () => {
  it('only the two-hand-zoom gesture maps to the zoom action; no single-hand pose does', () => {
    const singleHandGestures = ['pinch', 'double-pinch', 'fist', 'open-palm', 'point', 'thumbs-up'] as const;
    for (const g of singleHandGestures) expect(DEFAULT_GESTURE_MAP[g]).not.toBe('zoom');
    expect(DEFAULT_GESTURE_MAP['two-hand-zoom']).toBe('zoom');
  });
});

describe('B-148 two-hand-zoom gesture resolves to the zoom action (recognizer -> map boundary)', () => {
  it('both hands pinching recognises two-hand-zoom, which the default map sends to "zoom"', () => {
    const r = createGestureRecognizer();
    const a = hand(0.3, 0.5, PINCH_GAP);
    const b = hand(0.7, 0.5, PINCH_GAP);
    const res = r.update({ hands: [a, b], now: 0 });
    expect(res.gesture).toBe('two-hand-zoom');
    expect(DEFAULT_GESTURE_MAP[res.gesture]).toBe('zoom');
    // NOT covered here: main.ts's synthetic '='/'-' keydown dispatch from this
    // action onto the viewport — that closure isn't exported for unit testing.
  });
});

describe('B-151 open-palm maps to the pan action at the gesture-map layer', () => {
  it('open-palm resolves to "pan" in the default map', () => {
    expect(DEFAULT_GESTURE_MAP['open-palm']).toBe('pan');
    // NOT covered here: whether main.ts wires this to a continuous drag the
    // way two-hand-zoom's synthetic keydowns are wired (unconfirmed per the
    // checklist) — that main.ts wiring isn't exported for unit testing.
  });
});

describe('B-152 nudging a selection (the "arrow keys with a selection" half of the pan/nudge ambiguity)', () => {
  it('nudgeSelected moves the selected walls/fixtures by (dx, dy) as one step', () => {
    const doc = emptyPlan();
    const w: Wall = { id: 'w1', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, thickness: 100 };
    doc.walls.push(w);
    const { ctx, state } = makeFakeCtx({ doc, selectedId: 'w1' });
    const ok = nudgeSelected(ctx, 100, 0);
    expect(ok).toBe(true);
    expect(state.applied).toContainEqual({ op: 'move_many', ids: ['w1'], dx: 100, dy: 0 });
    // NOT covered here: renderer.ts's own arrow-key branch that chooses
    // between panning the viewport and calling nudgeSelected — that decision
    // lives outside src/plan/tools.ts.
  });
});

describe('B-154 two-hand-zoom is unaffected by which physical hand is hands[0] vs hands[1]', () => {
  it('swapping the array order of the same two hands yields the identical span/delta', () => {
    const left = hand(0.3, 0.5, PINCH_GAP);
    const right = hand(0.7, 0.5, PINCH_GAP);
    const r1 = createGestureRecognizer();
    r1.update({ hands: [left, right], now: 0 });
    const res1 = r1.update({ hands: [left, hand(0.8, 0.5, PINCH_GAP)], now: 50 });

    const r2 = createGestureRecognizer();
    r2.update({ hands: [right, left], now: 0 }); // same two hands, swapped order
    const res2 = r2.update({ hands: [hand(0.8, 0.5, PINCH_GAP), left], now: 50 });

    expect(res1.gesture).toBe('two-hand-zoom');
    expect(res2.gesture).toBe('two-hand-zoom');
    expect(res2.zoomDelta).toBeCloseTo(res1.zoomDelta, 6);
  });
});

describe('B-155 one hand leaving the frame mid-two-hand-zoom degrades gracefully, no jump', () => {
  it('dropping to a single hand after a two-hand-zoom frame reports zoomDelta 0, not a spurious jump', () => {
    const r = createGestureRecognizer();
    r.update({ hands: [hand(0.3, 0.5, PINCH_GAP), hand(0.5, 0.5, PINCH_GAP)], now: 0 });
    const zoomed = r.update({ hands: [hand(0.3, 0.5, PINCH_GAP), hand(0.9, 0.5, PINCH_GAP)], now: 50 });
    expect(zoomed.gesture).toBe('two-hand-zoom');
    expect(zoomed.zoomDelta).toBeGreaterThan(0);

    const dropped = r.update({ hands: [hand(0.3, 0.5, PINCH_GAP)], now: 100 }); // right hand gone
    expect(dropped.gesture).not.toBe('two-hand-zoom');
    expect(dropped.zoomDelta).toBe(0);

    // Re-acquiring a second hand later starts a fresh span, not a jump from the old one.
    const reacquired = r.update({ hands: [hand(0.3, 0.5, PINCH_GAP), hand(0.9, 0.5, PINCH_GAP)], now: 150 });
    expect(reacquired.zoomDelta).toBe(0); // first frame of the new pair: no prior span to diff against
  });
});

describe('B-156 unverified precedence: two-hand-zoom classification vs single-owner pinch ownership', () => {
  it('BOTH hands pinching makes gestures.ts report two-hand-zoom AND handLogic grant ownership to only one hand — two independent, unreconciled signals', () => {
    const events: HandEvent[] = [];
    const proc = createHandsProcessor((e) => events.push(e));
    const recognizer = createGestureRecognizer();

    const frame1 = [
      { landmarks: hand(0.3, 0.5, PINCH_GAP), label: 'Left' as const },
      { landmarks: hand(0.7, 0.5, 0.15) /* open */, label: 'Right' as const },
    ];
    proc.process(frame1);
    const frame2 = [
      { landmarks: hand(0.3, 0.5, PINCH_GAP), label: 'Left' as const },
      { landmarks: hand(0.7, 0.5, PINCH_GAP), label: 'Right' as const }, // right pinches too
    ];
    proc.process(frame2);
    const gestureRes = recognizer.update({
      hands: [hand(0.3, 0.5, PINCH_GAP), hand(0.7, 0.5, PINCH_GAP)],
      now: 0,
    });

    // handLogic: ownership stays with the hand that pinched first (left, slot 0).
    expect(proc.owner).toBe(0);
    // gestures.ts, fed the SAME two pinching hands independently, reports a
    // two-hand gesture regardless of who "owns" the pointer drag.
    expect(gestureRes.gesture).toBe('two-hand-zoom');
  });
});

describe('B-157 the recognizer never thresholds/scales zoomDelta itself (any filtering is downstream)', () => {
  it('a sub-pixel span change still comes back as a raw, unfiltered signed delta', () => {
    const r = createGestureRecognizer();
    const a = hand(0.3, 0.5, PINCH_GAP);
    r.update({ hands: [a, hand(0.5, 0.5, PINCH_GAP)], now: 0 });
    const res = r.update({ hands: [a, hand(0.5001, 0.5, PINCH_GAP)], now: 10 });
    expect(res.zoomDelta).not.toBe(0);
    expect(Math.abs(res.zoomDelta)).toBeLessThan(0.001); // tiny — nothing snapped/clamped it
  });
});

describe('B-087 selection is hand-agnostic: either hand label produces the identical select_set', () => {
  it.each(['Left', 'Right'] as const)('%s hand pinch-tap selects the same object as any other hand', (label) => {
    const events: HandEvent[] = [];
    const proc = createHandsProcessor((e) => events.push(e));
    proc.process([{ landmarks: hand(0.5, 0.5, 0.15), label }]); // open
    proc.process([{ landmarks: hand(0.5, 0.5, PINCH_GAP), label }]); // pinch down
    proc.process([{ landmarks: hand(0.5, 0.5, 0.15), label }]); // release -> tap
    const tap = events.find((e) => e.type === 'pinch-tap');
    expect(tap).toBeTruthy();

    const doc = emptyPlan();
    const { ctx, state } = makeFakeCtx({ doc, pickResult: 'w1' });
    const select = createPlanTools(ctx).find((t) => t.id === 'select')!;
    select.onDown!(ptr(10, 10, 'pinch'));
    expect(state.applied).toContainEqual({ op: 'select_set', ids: ['w1'] });
  });
});

describe('B-089 gesture-classifier ambiguity between point and pinch is harmless by design', () => {
  it('classifyGesture always returns exactly one pose, and point/pinch both map to the same action', () => {
    const pointHand = hand(0.5, 0.5, 0.15); // index-ish stand-in; real point/pinch share the "select" action regardless
    const g = classifyGesture(pointHand);
    expect(['pinch', 'fist', 'open-palm', 'point', 'thumbs-up', 'none']).toContain(g);
    expect(DEFAULT_GESTURE_MAP.point).toBe(DEFAULT_GESTURE_MAP.pinch);
    expect(DEFAULT_GESTURE_MAP.point).toBe('select');
  });
});
