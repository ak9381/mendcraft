// Replay recorded traces (no landmarks) through the 120 ms point↔fist gate
// and compare pose-transition rates and click counts before vs after.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPointFistGate, type StaticGesture } from '../../src/input/gestures';
import { HAND_FEEL, createPinchMachine } from '../../src/canvas/handFeel';

interface TraceFrame {
  t: number;
  hand: number;
  classification: string;
  pinchDistance: number;
  clickTarget: string | null;
}

const GOLDEN = '/workspace/hackathon/firebase-hybrid/e2e-review-2x/live/golden-trace-8319f68.json';
const LEFT = '/workspace/hackathon/firebase-hybrid/e2e-review-2x/live/rec-left-8319f68.json';

function load(path: string): TraceFrame[] {
  return JSON.parse(readFileSync(path, 'utf8')) as TraceFrame[];
}

function durationMin(frames: TraceFrame[]): number {
  if (frames.length < 2) return 0;
  const ts = frames.map((f) => f.t);
  return (Math.max(...ts) - Math.min(...ts)) / 60_000;
}

function transitions(seq: { t: number; classification: string }[]): number {
  let n = 0;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i]!.classification !== seq[i - 1]!.classification) n += 1;
  }
  return n;
}

function pairCount(seq: { classification: string }[], a: string, b: string): number {
  let n = 0;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i - 1]!.classification === a && seq[i]!.classification === b) n += 1;
  }
  return n;
}

function perHand(frames: TraceFrame[]): number[] {
  return [...new Set(frames.map((f) => f.hand))].sort((a, b) => a - b);
}

function gated(frames: TraceFrame[]): TraceFrame[] {
  const out: TraceFrame[] = [];
  for (const hand of perHand(frames)) {
    const gate = createPointFistGate();
    const hs = frames.filter((f) => f.hand === hand).sort((a, b) => a.t - b.t);
    for (const f of hs) {
      const pose = gate.update(f.classification as StaticGesture, null, f.t);
      out.push({ ...f, classification: pose });
    }
  }
  return out.sort((a, b) => a.t - b.t || a.hand - b.hand);
}

function stats(frames: TraceFrame[], hand: number) {
  const hs = frames.filter((f) => f.hand === hand).sort((a, b) => a.t - b.t);
  const minutes = durationMin(hs);
  const trans = transitions(hs);
  return {
    frames: hs.length,
    minutes,
    trans,
    perMin: minutes > 0 ? trans / minutes : 0,
    pointToFist: pairCount(hs, 'point', 'fist'),
    fistToPoint: pairCount(hs, 'fist', 'point'),
    clicks: hs.filter((f) => f.clickTarget).length,
  };
}

function pinchDowns(frames: TraceFrame[]): number {
  let n = 0;
  for (const hand of perHand(frames)) {
    const fsm = createPinchMachine(HAND_FEEL);
    const hs = frames.filter((f) => f.hand === hand).sort((a, b) => a.t - b.t);
    for (const f of hs) {
      if (f.classification === 'fist' || f.classification === 'thumbs-up') continue;
      if (fsm.update(f.pinchDistance, f.t, HAND_FEEL.pinchOn, HAND_FEEL.pinchOff).justDown) n += 1;
    }
  }
  return n;
}

function report(name: string, frames: TraceFrame[]) {
  const afterFrames = gated(frames);
  const hands = perHand(frames);
  const before: Record<number, ReturnType<typeof stats>> = {};
  const after: Record<number, ReturnType<typeof stats>> = {};
  for (const h of hands) {
    before[h] = stats(frames, h);
    after[h] = stats(afterFrames, h);
  }
  const clicksBefore = frames.filter((f) => f.clickTarget).length;
  const clicksAfter = afterFrames.filter((f) => f.clickTarget).length; // same recorded clicks
  const downs = pinchDowns(frames);
  // eslint-disable-next-line no-console
  console.log(name, { before, after, recordedClicks: clicksBefore, pinchDownsAfter: downs });
  return { before, after, clicksBefore, clicksAfter, downs, hands };
}

// The recordings live outside the repo; replay them where they are present.
describe.skipIf(!existsSync(GOLDEN) || !existsSync(LEFT))('pose stability replay (point↔fist 120 ms gate)', () => {
  it('golden-trace-8319f68: transitions/min do not increase; click count is reported', () => {
    const frames = load(GOLDEN);
    const r = report('golden', frames);
    expect(r.clicksBefore).toBe(12);
    expect(r.clicksAfter).toBe(12);
    for (const h of r.hands) {
      expect(r.after[h]!.trans).toBeLessThanOrEqual(r.before[h]!.trans);
      expect(r.after[h]!.pointToFist + r.after[h]!.fistToPoint)
        .toBeLessThanOrEqual(r.before[h]!.pointToFist + r.before[h]!.fistToPoint);
    }
  });

  it('rec-left-8319f68: point↔fist flaps drop and recorded clicks stay 6', () => {
    const frames = load(LEFT);
    const r = report('rec-left', frames);
    expect(r.clicksBefore).toBe(6);
    expect(r.clicksAfter).toBe(6);
    const b0 = r.before[0]!;
    const a0 = r.after[0]!;
    expect(a0.trans).toBeLessThanOrEqual(b0.trans);
    expect(a0.pointToFist + a0.fistToPoint).toBeLessThan(b0.pointToFist + b0.fistToPoint);
  });
});
