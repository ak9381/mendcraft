// B-012: a tremor tap on the old editor's palette. The hand pointer judges a tap
// per frame (TAP_MOVE_LIMIT) and debounces the pinch with hysteresis
// (on 0.045 / off 0.07), so a shaky hand that pinches once on a button still
// gives exactly one pinch-tap, and a pinch whose ratio flickers inside the
// hysteresis band doesn't double-press.
import { describe, expect, it } from 'vitest';
import { createHandsProcessor, TAP_MOVE_LIMIT } from '../../src/input/handLogic';
import { pinchRatio } from '../../src/input/gestures';

type Pt = { x: number; y: number };
function hand(gap: number, ox = 0, oy = 0): Pt[] {
  const p: Pt[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 1.0 }));
  const f: [number, number, number, number][] = [[5, 6, 8, 0.45], [9, 10, 12, 0.5], [13, 14, 16, 0.55], [17, 18, 20, 0.6]];
  for (const [m, pp, t, x] of f) { p[m] = { x, y: 0.7 }; p[pp] = { x, y: 0.55 }; p[t] = t === 8 ? { x, y: 0.4 } : { x: x + 0.01, y: 0.68 }; }
  p[2] = { x: 0.4, y: 0.8 }; p[3] = { x: 0.4, y: 0.6 };
  p[4] = { x: 0.45 - gap, y: 0.4 }; // thumb tip `gap` away from the index tip
  return p.map((q) => ({ x: q.x + ox, y: q.y + oy }));
}
let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
function run(frames: Pt[][]): string[] {
  const evs: string[] = [];
  const proc = createHandsProcessor((e) => evs.push(e.type));
  for (const lm of frames) proc.process([{ landmarks: lm }] as never);
  return evs;
}
const OPEN = 0.25; const SHUT = 0.0;

describe('B-012 tremor tap on the palette', () => {
  it('fixture: open is above the release threshold, shut is a pinch', () => {
    expect(pinchRatio(hand(OPEN))).toBeGreaterThan(0.07);
    expect(pinchRatio(hand(SHUT))).toBeLessThan(0.045);
  });
  it('a shaky hand (±1% of the frame per axis, every frame) still taps exactly once', () => {
    const amp = 0.02; // peak-to-peak 2% ≈ 29px on a 1440px screen
    expect(amp).toBeLessThan(TAP_MOVE_LIMIT);
    const j = () => amp * rnd();
    const seq = [
      ...Array.from({ length: 5 }, () => hand(OPEN, j(), j())),
      ...Array.from({ length: 6 }, () => hand(SHUT, j(), j())),
      ...Array.from({ length: 5 }, () => hand(OPEN, j(), j())),
    ];
    const evs = run(seq);
    expect(evs.filter((e) => e === 'pinch-start')).toHaveLength(1);
    expect(evs.filter((e) => e === 'pinch-tap')).toHaveLength(1);
  });
  it('a pinch whose ratio flickers inside the hysteresis band presses once', () => {
    const seq: Pt[][] = [hand(OPEN), hand(OPEN), hand(SHUT)];
    // flicker the gap so the ratio stays between on (0.045) and off (0.07)
    let mid = 0.0; while (pinchRatio(hand(mid)) < 0.055) mid += 0.0005;
    for (let i = 0; i < 8; i++) seq.push(hand(i % 2 ? mid : SHUT));
    seq.push(hand(OPEN), hand(OPEN));
    const evs = run(seq);
    expect(evs.filter((e) => e === 'pinch-start')).toHaveLength(1);
    expect(evs.filter((e) => e === 'pinch-tap')).toHaveLength(1);
  });
});
