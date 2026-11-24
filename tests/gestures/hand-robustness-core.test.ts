// C-ROBUST: hand-tracking robustness — re-entry, silence timeout, profile
// knobs, slow/fast pinch timing, shared refractory across targets, and the
// tap-vs-drag move limit — against the real pure modules.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandsProcessor, TAP_MOVE_LIMIT, type HandEvent, type Pt } from '../../src/input/handLogic';
import { createPinchMachine, HAND_FEEL } from '../../src/canvas/handFeel';
import { PROFILES } from '../../src/input/handProfile';
import { createDwellClicker } from '../../src/input/dwell';
import { createHandPointer, type HandPointer } from '../../src/canvas/handPointer';
import { synthHand as synthHandAt } from '../helpers/synthHands';

/** 21 landmarks; wrist->middle MCP = 0.2. `gap` = thumb-index tip distance.
 *  Same fixture tests/handLogic.test.ts uses for this module. */
function hand(cx: number, cy: number, gap: number): Pt[] {
  const pts: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  pts[0] = { x: cx, y: cy + 0.2 };
  pts[9] = { x: cx, y: cy };
  pts[8] = { x: cx, y: cy - 0.05 };
  pts[4] = { x: cx + gap, y: cy - 0.05 };
  return pts;
}
const OPEN = 0.15;
const PINCH = 0.006;

describe('C192 a hand that re-enters the frame after leaving resumes cleanly', () => {
  it('a slot forgotten on exit is freely reassigned (with a tracking event) when the hand comes back', () => {
    const events: HandEvent[] = [];
    const p = createHandsProcessor((e) => events.push(e));
    p.process([{ landmarks: hand(0.3, 0.5, OPEN), label: 'Left' }]);
    p.process([]); // hand leaves — slot freed, label forgotten
    expect(events.at(-1)?.type).toBe('lost');
    events.length = 0;
    p.process([{ landmarks: hand(0.3, 0.5, OPEN), label: 'Left' }]); // comes back
    expect(events.some((e) => e.type === 'tracking' && e.hand === 0)).toBe(true);
    // And it can pinch normally — not stuck in some half-tracked state.
    p.process([{ landmarks: hand(0.3, 0.5, PINCH), label: 'Left' }]);
    expect(events.at(-1)?.type).toBe('pinch-start');
  });
});

describe('C194 the 400ms silence timeout is the real boundary for "lost"', () => {
  const W = 1000, H = 800;
  function fakeButton(rect: { left: number; top: number; width: number; height: number }) {
    return {
      tagName: 'BUTTON',
      classList: { add() {}, remove() {}, toggle() {} },
      getAttribute: () => null,
      closest: () => null,
      matches: (sel: string) => sel.split(',').some((s) => s.trim().startsWith('button')),
      getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }),
      getRootNode: () => ({ host: null }),
      parentElement: null,
    };
  }
  function fakeDoc(btn: ReturnType<typeof fakeButton>) {
    return {
      createElement: () => ({ className: '', hidden: true, style: {}, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, remove() {} }),
      body: { append: () => {} },
      querySelectorAll: (sel: string) => (sel.split(',').some((s) => s.trim().startsWith('button')) ? [btn] : []),
      elementFromPoint: (x: number, y: number) => {
        const r = btn.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? btn : null;
      },
    } as unknown as Document;
  }
  // The cursor is anchored to the PALM CENTRE: the shared builder places the
  // palm exactly on the target (index extended, others curled — a 'point').
  function synthHand(px: number, py: number): Pt[] {
    return synthHandAt(px, py, false, W, H);
  }
  let hp: HandPointer;
  beforeEach(() => {
    (globalThis as Record<string, unknown>).innerWidth = W;
    (globalThis as Record<string, unknown>).innerHeight = H;
  });
  afterEach(() => {
    hp.destroy();
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).innerWidth;
    delete (globalThis as Record<string, unknown>).innerHeight;
  });

  it('holding the target through a sub-400ms gap keeps it; 400ms of silence clears it', () => {
    vi.useFakeTimers();
    const btn = fakeButton({ left: 160, top: 40, width: 60, height: 30 });
    hp = createHandPointer(fakeDoc(btn), {});
    for (let i = 0; i < 10; i++) hp.update([synthHand(190, 55)], i * 33); // dwell onto the button
    expect(hp.target).toBe(btn);
    vi.advanceTimersByTime(399); // no new frames at all — e.g. a brief tracking glitch
    expect(hp.target).toBe(btn); // still held — under the 400ms boundary
    vi.advanceTimersByTime(2); // crosses 400ms of total silence
    expect(hp.target).toBeNull(); // lost() fires and clears it
  });
});

describe('C202/C203/C204/C205 hand-profile knobs: pinch thresholds, target size, smoothing, click mode', () => {
  it('C202 assist loosens pinch thresholds; precise tightens them', () => {
    expect(PROFILES.precise.pinchOn).toBeCloseTo(0.42);
    expect(PROFILES.precise.pinchOff).toBeCloseTo(0.56);
    expect(PROFILES.standard.pinchOn).toBeCloseTo(0.50);
    expect(PROFILES.standard.pinchOff).toBeCloseTo(0.64);
    expect(PROFILES.assist.pinchOn).toBeCloseTo(0.60);
    expect(PROFILES.assist.pinchOff).toBeCloseTo(0.74);
  });
  it('C203 assist grows target size; precise shrinks it', () => {
    expect(PROFILES.precise.targetScale).toBeCloseTo(0.9);
    expect(PROFILES.standard.targetScale).toBeCloseTo(1.0);
    expect(PROFILES.assist.targetScale).toBeCloseTo(1.3);
  });
  it('C204 assist smooths the cursor far more aggressively than precise', () => {
    expect(PROFILES.precise.smoothing).toBeCloseTo(0.15);
    expect(PROFILES.standard.smoothing).toBeCloseTo(0.35);
    expect(PROFILES.assist.smoothing).toBeCloseTo(0.6);
  });
  it('C205 only assist defaults to dwell clicking; the others pinch', () => {
    expect(PROFILES.precise.clickMode).toBe('pinch');
    expect(PROFILES.standard.clickMode).toBe('pinch');
    expect(PROFILES.assist.clickMode).toBe('dwell');
  });
});

describe('C207 a slow, deliberate pinch still engages once it has been held ~80 ms', () => {
  it('3 closed frames spread 40 ms apart (80 ms hold) engage; a 10s gap restarts the hold', () => {
    const m = createPinchMachine();
    expect(m.update(0.03, 0).pinched).toBe(false);
    expect(m.update(0.03, 40).pinched).toBe(false);
    const r = m.update(0.03, 80);
    expect(r.pinched).toBe(true);
    expect(r.justDown).toBe(true);

    const gapped = createPinchMachine();
    gapped.update(0.03, 0);
    gapped.update(0.03, 10_000); // gap > engageMs — hold restarts
    expect(gapped.update(0.03, 10_040).pinched).toBe(false);
    expect(gapped.update(0.03, 10_080).pinched).toBe(true);
  });
});

describe('C209 a fast flick never engages — 3 frames and ~80 ms is the floor', () => {
  it('1 or 2 quick closed frames do not engage; 3 frames over 80 ms do', () => {
    const m = createPinchMachine();
    const r1 = m.update(0.03, 0);
    expect(r1.pinched).toBe(false);
    m.update(0.8, 5); // opens again — the "flick" ends short
    expect(m.update(0.8, 9).pinched).toBe(false);

    const fast = createPinchMachine();
    fast.update(0.03, 100);
    expect(fast.update(0.03, 103).pinched).toBe(false); // 3 ms hold, 2 frames
    expect(fast.update(0.03, 140).pinched).toBe(false); // 40 ms, 3 frames, under 80 ms
    expect(fast.update(0.03, 180).pinched).toBe(true);
  });
});

describe('C210 the refractory window is shared across targets, not per-target', () => {
  it('releasing a pinch on one target blocks a genuine new pinch on a different target for refractoryMs', () => {
    const m = createPinchMachine(); // one machine == one hand's pinch channel, target-agnostic
    m.update(0.1, 0); m.update(0.1, 40); m.update(0.1, 80); // engage ("click" target A)
    m.update(0.6, 100); m.update(0.6, 133); // release (HAND_FEEL.releaseFrames)
    const tooSoon = 133 + HAND_FEEL.refractoryMs - 90;
    expect(m.update(0.1, tooSoon).pinched).toBe(false);
    expect(m.update(0.1, tooSoon + 40).pinched).toBe(false);
    expect(m.update(0.1, tooSoon + 80).pinched).toBe(false); // still 10 ms inside refractory
  });
});

describe('C215 TAP_MOVE_LIMIT is the real tap-vs-drag boundary', () => {
  it('movement within the limit still taps; movement past it cancels the tap (drag instead)', () => {
    expect(TAP_MOVE_LIMIT).toBeCloseTo(0.045);

    const tapEvents: HandEvent[] = [];
    const tapP = createHandsProcessor((e) => tapEvents.push(e));
    tapP.process([{ landmarks: hand(0.3, 0.5, OPEN), label: 'Left' }]);
    tapP.process([{ landmarks: hand(0.3, 0.5, PINCH), label: 'Left' }]); // pinch-start
    tapP.process([{ landmarks: hand(0.33, 0.5, PINCH), label: 'Left' }]); // moves 0.03 < limit
    tapP.process([{ landmarks: hand(0.33, 0.5, OPEN), label: 'Left' }]); // release
    expect(tapEvents.some((e) => e.type === 'pinch-tap')).toBe(true);

    const dragEvents: HandEvent[] = [];
    const dragP = createHandsProcessor((e) => dragEvents.push(e));
    dragP.process([{ landmarks: hand(0.3, 0.5, OPEN), label: 'Left' }]);
    dragP.process([{ landmarks: hand(0.3, 0.5, PINCH), label: 'Left' }]);
    dragP.process([{ landmarks: hand(0.37, 0.5, PINCH), label: 'Left' }]); // moves 0.07 > limit
    dragP.process([{ landmarks: hand(0.37, 0.5, OPEN), label: 'Left' }]);
    expect(dragEvents.some((e) => e.type === 'pinch-tap')).toBe(false);
  });
});

describe('C218 dwell duration genuinely scales with the hand profile, via the generic dwell clicker', () => {
  it('createDwellClicker respects setDwell(profile.dwellMs) for each of the three profiles', () => {
    for (const name of ['precise', 'standard', 'assist'] as const) {
      const profile = PROFILES[name];
      const d = createDwellClicker();
      d.setDwell(profile.dwellMs);
      const target = {};
      d.update(target, 0);
      const r = d.update(target, profile.dwellMs - 1);
      expect(r.fire).toBe(false); // not yet, 1ms short of this profile's own dwell time
      const r2 = d.update(target, profile.dwellMs);
      expect(r2.fire).toBe(true);
    }
  });
});
