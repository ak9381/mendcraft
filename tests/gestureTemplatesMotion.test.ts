import { describe, expect, it } from 'vitest';
import {
  coerceMotionTemplate,
  dtwDistance,
  matchMotionTemplate,
  normalizePose,
  sequenceMotion,
  type MotionTemplate,
} from '../src/input/gestureTemplates';
import { buildHandPose } from '../src/dev/trackingSim';
import type { Pt } from '../src/input/handLogic';

/** A curl motion: the hand morphs from open to fist (or the reverse) over
 *  `steps` frames. normalizePose erases wrist position/scale/rotation, so a
 *  genuine "motion" fixture has to change the pose itself, not just slide
 *  the hand across the screen. */
function swipeSequence(steps: number, dir: 1 | -1 = 1): Pt[][] {
  const open = buildHandPose('open', { x: 0.5, y: 0.6 }, 0.22);
  const fist = buildHandPose('fist', { x: 0.5, y: 0.6 }, 0.22);
  const [from, to] = dir === 1 ? [open, fist] : [fist, open];
  const out: Pt[][] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    out.push(from.map((p, j) => ({ x: p.x + (to[j].x - p.x) * t, y: p.y + (to[j].y - p.y) * t })));
  }
  return out;
}

describe('dtwDistance', () => {
  it('is ~0 between a sequence and itself', () => {
    const seq = swipeSequence(10).map((p) => normalizePose(p)!);
    expect(dtwDistance(seq, seq)).toBeCloseTo(0, 5);
  });

  it('time-warps: the same motion at a different speed is far closer than the reverse motion', () => {
    const fast = swipeSequence(8, 1).map((p) => normalizePose(p)!);
    const slow = swipeSequence(20, 1).map((p) => normalizePose(p)!);
    const reverse = swipeSequence(20, -1).map((p) => normalizePose(p)!);
    expect(dtwDistance(fast, slow)).toBeLessThan(dtwDistance(fast, reverse) / 2);
  });

  it('is large between opposite-direction swipes', () => {
    const left = swipeSequence(10, 1).map((p) => normalizePose(p)!);
    const right = swipeSequence(10, -1).map((p) => normalizePose(p)!);
    expect(dtwDistance(left, right)).toBeGreaterThan(dtwDistance(left, left) + 0.05);
  });

  it('returns Infinity for an empty sequence', () => {
    expect(dtwDistance([], [[0, 0]])).toBe(Infinity);
  });
});

describe('matchMotionTemplate', () => {
  function template(id: string, steps: number, dir: 1 | -1): MotionTemplate {
    return { id, label: id, frames: swipeSequence(steps, dir).map((p) => normalizePose(p)!), createdAt: 0 };
  }

  it('matches a live swipe to the same-direction template, not the opposite one', () => {
    const live = swipeSequence(12, 1);
    const templates = [template('swipe-right', 15, 1), template('swipe-left', 15, -1)];
    const match = matchMotionTemplate(live, templates);
    expect(match?.id).toBe('swipe-right');
  });

  it('returns null when nothing is close enough', () => {
    const live = swipeSequence(12, 1);
    const match = matchMotionTemplate(live, [template('swipe-left', 15, -1)]);
    expect(match).toBeNull();
  });
});

describe('sequenceMotion', () => {
  it('is near zero for a held pose', () => {
    const held = Array.from({ length: 10 }, () => buildHandPose('thumbs-up', { x: 0.6, y: 0.6 }, 0.22));
    expect(sequenceMotion(held)).toBeLessThan(0.01);
  });

  it('is well above zero for a swipe', () => {
    expect(sequenceMotion(swipeSequence(12))).toBeGreaterThan(0.05);
  });
});

describe('coerceMotionTemplate', () => {
  it('accepts a well-formed template', () => {
    const raw = { id: 'wave-hi', label: 'Wave hi', frames: [new Array(42).fill(0), new Array(42).fill(0.1)], createdAt: 123 };
    expect(coerceMotionTemplate(raw)).toEqual(raw);
  });

  it.each([
    { ...{}, label: 'x', frames: [[0]] },
    { id: 'bad id!', label: 'x', frames: [new Array(42).fill(0), new Array(42).fill(0)] },
    { id: 'ok', label: 'x', frames: [new Array(42).fill(0)] }, // < 2 frames
    { id: 'ok', label: 'x', frames: [new Array(41).fill(0), new Array(41).fill(0)] }, // wrong width
  ])('rejects malformed input %#', (raw) => {
    expect(coerceMotionTemplate(raw)).toBeNull();
  });
});
