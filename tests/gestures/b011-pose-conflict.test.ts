// B-011: which hand poses press a control under the pointer. Open palm (pan)
// and point never start a pinch, so passing them over the palette can't
// click it. A closing fist does start one — by design fist = grab on the same
// pinch pointer (DEFAULT_GESTURE_MAP fist→drag), and a lateral "key" pinch
// (thumb on a curled index) reads as a fist, so it must keep pressing.
import { describe, expect, it } from 'vitest';
import { classifyGesture } from '../../src/input/gestures';
import { createHandsProcessor } from '../../src/input/handLogic';

type Pt = { x: number; y: number };
const WRIST: Pt = { x: 0.5, y: 1.0 };
const FX: Record<string, number> = { index: 0.45, middle: 0.5, ring: 0.55, pinky: 0.6 };
const MCP: Record<string, number> = { index: 5, middle: 9, ring: 13, pinky: 17 };
const PIP: Record<string, number> = { index: 6, middle: 10, ring: 14, pinky: 18 };
const TIP: Record<string, number> = { index: 8, middle: 12, ring: 16, pinky: 20 };
function hand(pose: 'open' | 'point' | 'fist'): Pt[] {
  const p: Pt[] = Array.from({ length: 21 }, () => ({ ...WRIST }));
  for (const f of ['index', 'middle', 'ring', 'pinky']) {
    const x = FX[f]; p[MCP[f]] = { x, y: 0.7 }; p[PIP[f]] = { x, y: 0.55 };
    const ext = pose === 'open' || (pose === 'point' && f === 'index');
    p[TIP[f]] = ext ? { x, y: 0.35 } : { x: x + 0.01, y: 0.68 };
  }
  p[2] = { x: 0.4, y: 0.8 }; p[3] = { x: 0.37, y: 0.72 };
  p[4] = pose === 'fist' ? { x: 0.47, y: 0.7 } : { x: 0.3, y: 0.6 };
  return p;
}
function run(seq: Pt[][]): string[] {
  const evs: string[] = [];
  const proc = createHandsProcessor((e) => evs.push(e.type));
  for (const lm of seq) proc.process([{ landmarks: lm }] as never);
  return evs;
}

describe('B-011 pose conflict near the palette', () => {
  it('open palm and point sweeping over controls never press', () => {
    expect(classifyGesture(hand('open'))).toBe('open-palm');
    expect(classifyGesture(hand('point'))).toBe('point');
    const evs = run([hand('open'), hand('point'), hand('open'), hand('point'), hand('open')]);
    expect(evs).not.toContain('pinch-start');
    expect(evs).not.toContain('pinch-tap');
  });
  it('a closing fist is a grab on the pinch pointer (presses, like the mapped fist→drag)', () => {
    expect(classifyGesture(hand('fist'))).toBe('fist');
    const evs = run([hand('open'), hand('fist'), hand('fist'), hand('open')]);
    expect(evs).toContain('pinch-start');
    expect(evs).toContain('pinch-end');
  });
});
