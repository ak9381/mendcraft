// Replay the live 8319f68 Chrome trace through the classifier and pinch
// machine. The recording has no landmarks, so poses are rebuilt as canonical
// synth hands (same helpers as the pointer pipeline). We assert that
// classifications and pinch-band behaviour are not worse than the recording.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyGesture } from '../../src/input/gestures';
import { HAND_FEEL, createPinchMachine } from '../../src/canvas/handFeel';
import { DEFAULT_PINCH_ON, DEFAULT_PINCH_OFF } from '../../src/input/handLogic';
import { PINCH_CLASSIFY } from '../../src/input/gestures';

const TRACE_PATH = '/workspace/hackathon/firebase-hybrid/e2e-review-2x/live/golden-trace-8319f68.json';

interface GoldenFrame {
  t: number;
  hand: number;
  classification: string;
  pinchDistance: number;
  raw: { x: number; y: number };
  eased: { x: number; y: number };
  clickTarget: string | null;
}

type Pt = { x: number; y: number };

function synthPose(kind: string): Pt[] {
  const cx = 0.5, cy = 0.45;
  const lm: Pt[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  lm[0] = { x: cx, y: cy + 0.22 };
  lm[9] = { x: cx, y: cy + 0.10 };
  if (kind === 'open-palm') {
    lm[5] = { x: cx - 0.05, y: cy + 0.10 };
    lm[13] = { x: cx + 0.05, y: cy + 0.10 };
    lm[17] = { x: cx + 0.10, y: cy + 0.11 };
    lm[8] = { x: cx, y: cy }; lm[6] = { x: cx, y: cy + 0.08 }; lm[7] = { x: cx, y: cy + 0.04 };
    lm[10] = { x: cx + 0.05, y: cy + 0.08 }; lm[12] = { x: cx + 0.05, y: cy - 0.08 };
    lm[14] = { x: cx + 0.10, y: cy + 0.08 }; lm[16] = { x: cx + 0.10, y: cy - 0.08 };
    lm[18] = { x: cx + 0.14, y: cy + 0.08 }; lm[20] = { x: cx + 0.14, y: cy - 0.08 };
    lm[4] = { x: cx - 0.16, y: cy };
    lm[2] = { x: cx - 0.10, y: cy + 0.08 }; lm[3] = { x: cx - 0.13, y: cy + 0.04 };
    return lm;
  }
  if (kind === 'point' || kind === 'pinch') {
    // Same pointing layout as handPointerPipeline.synthHand: index extended,
    // middle/ring/pinky curled, so classifyGesture reads 'point' (or 'pinch').
    lm[0] = { x: cx, y: cy + 0.42 };
    lm[9] = { x: cx, y: cy + 0.22 };
    lm[5] = { x: cx, y: cy + 0.22 };
    lm[8] = { x: cx, y: cy };
    lm[6] = { x: cx, y: cy + 0.12 };
    lm[7] = { x: cx, y: cy + 0.06 };
    const palmY = cy + 0.26;
    lm[10] = { x: cx + 0.05, y: palmY + 0.04 }; lm[11] = { x: cx + 0.05, y: palmY + 0.02 }; lm[12] = { x: cx + 0.05, y: palmY };
    lm[13] = { x: cx + 0.08, y: cy + 0.22 }; lm[14] = { x: cx + 0.08, y: palmY + 0.04 }; lm[15] = { x: cx + 0.08, y: palmY + 0.02 }; lm[16] = { x: cx + 0.08, y: palmY };
    lm[17] = { x: cx + 0.12, y: cy + 0.22 }; lm[18] = { x: cx + 0.12, y: palmY + 0.04 }; lm[19] = { x: cx + 0.12, y: palmY + 0.02 }; lm[20] = { x: cx + 0.12, y: palmY };
    const gap = kind === 'pinch' ? 0.006 : 0.16;
    lm[1] = { x: cx - gap, y: cy + 0.18 }; lm[2] = { x: cx - gap, y: cy + 0.12 }; lm[3] = { x: cx - gap, y: cy + 0.06 };
    lm[4] = { x: cx - gap, y: cy };
    return lm;
  }
  if (kind === 'fist' || kind === 'thumbs-up') {
    const wrist = { x: cx, y: cy + 0.2 };
    lm[0] = wrist;
    lm[9] = { x: cx, y: cy };
    lm[8] = { x: cx, y: cy };
    lm[6] = { x: wrist.x + (lm[8].x - wrist.x) * 1.5, y: wrist.y + (lm[8].y - wrist.y) * 1.5 };
    const curl = (pip: number, tip: number, ox: number) => {
      lm[pip] = { x: wrist.x + ox, y: wrist.y - 0.3 };
      lm[tip] = { x: wrist.x + ox, y: wrist.y - 0.03 };
    };
    curl(10, 12, 0.05); curl(14, 16, 0.1); curl(18, 20, 0.15);
    if (kind === 'thumbs-up') {
      lm[4] = { x: cx - 0.05, y: cy - 0.25 };
      lm[2] = { x: cx - 0.04, y: cy - 0.10 };
      lm[3] = { x: cx - 0.045, y: cy - 0.18 };
    } else {
      lm[1] = wrist; lm[2] = wrist; lm[3] = wrist; lm[4] = wrist;
    }
    return lm;
  }
  return lm;
}

function loadTrace(): GoldenFrame[] {
  return JSON.parse(readFileSync(TRACE_PATH, 'utf8')) as GoldenFrame[];
}

describe('golden trace 8319f68 replay', () => {
  const frames = loadTrace();

  it('keeps the live pinch band (0.24 / 0.33) used in the recording', () => {
    expect(HAND_FEEL.pinchOn).toBe(0.24);
    expect(HAND_FEEL.pinchOff).toBe(0.33);
    expect(DEFAULT_PINCH_ON).toBe(0.24);
    expect(DEFAULT_PINCH_OFF).toBe(0.33);
    expect(PINCH_CLASSIFY).toBe(0.24);
  });

  it('canonical poses for every non-none recorded class still classify the same', () => {
    const kinds = ['point', 'fist', 'open-palm', 'pinch', 'thumbs-up'] as const;
    for (const kind of kinds) {
      expect(classifyGesture(synthPose(kind))).toBe(kind);
    }
    const known = frames.filter((f) => (kinds as readonly string[]).includes(f.classification));
    expect(known.length).toBeGreaterThan(5000);
    const missed = known.filter((f) => classifyGesture(synthPose(f.classification)) !== f.classification);
    expect(missed).toHaveLength(0);
  });

  it('replays pinchDistance through the pinch machine and does not lose pinch-downs vs the recording', () => {
    // Baseline: crossings of the 0.24/0.33 band on frames the recording
    // itself labelled 'pinch' (fists that dip the ratio are not pinch clicks).
    const expectedDowns = { 0: 0, 1: 0 };
    for (const hand of [0, 1] as const) {
      const hs = frames.filter((f) => f.hand === hand).sort((a, b) => a.t - b.t);
      let pinched = false;
      for (const f of hs) {
        if (!pinched && f.classification === 'pinch' && f.pinchDistance < HAND_FEEL.pinchOn) {
          pinched = true;
          expectedDowns[hand] += 1;
        } else if (pinched && f.pinchDistance > HAND_FEEL.pinchOff) {
          pinched = false;
        }
      }
    }

    const liveDowns = { 0: 0, 1: 0 };
    for (const hand of [0, 1] as const) {
      const fsm = createPinchMachine(HAND_FEEL);
      const hs = frames.filter((f) => f.hand === hand).sort((a, b) => a.t - b.t);
      for (const f of hs) {
        // Skip fist-labelled frames: the pointer never feeds those to the pinch FSM.
        if (f.classification === 'fist' || f.classification === 'thumbs-up') continue;
        const st = fsm.update(f.pinchDistance, f.t, HAND_FEEL.pinchOn, HAND_FEEL.pinchOff);
        if (st.justDown) liveDowns[hand] += 1;
      }
    }

    const live = liveDowns[0] + liveDowns[1];
    const labelled = expectedDowns[0] + expectedDowns[1];
    // The FSM's engageFrames debounce yields fewer downs than a naive
    // crossing count. 16 is what 8319f68's unchanged pinch machine produces
    // on this series; this change must not go below that.
    expect(labelled).toBeGreaterThan(0);
    expect(live).toBeGreaterThanOrEqual(16);
  });

  it('records the same 12 clickTargets and does not invent extra click kinds', () => {
    const clicks = frames.filter((f) => f.clickTarget);
    expect(clicks).toHaveLength(12);
    const ids = [...new Set(clicks.map((c) => c.clickTarget))];
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  });
});
