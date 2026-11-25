// Replay negatives: ordinary hand use must NEVER fire a fixed button gesture
// (and so never press the highlighted button — that also needs a fired
// R thumbs-up). No recorded landmark traces ship in tests/fixtures (the
// golden-trace JSONs are not in the repo), so these are synthesized,
// realistic sessions at 30 fps with seeded jitter, transitional frames between
// shapes, two hands, and occasional dropped frames — run through the real
// shape classifier (with label-polarity learning) → hold engine, the same
// pair gestureControl runs every frame.
import { describe, expect, it } from 'vitest';
import { classifyHandShape, createHandPolarity, type HandShape } from '../../src/canvas/handShape';
import { createHoldEngine, type GestureHand } from '../../src/canvas/gestureHold';
import { syntheticHand } from '../../src/canvas/handShapeFixtures';
import { handScale, palmCenter } from '../../src/canvas/handFeel';
import type { Pt } from '../../src/input/handLogic';

type Hand = Pt[] & { label?: string };
const FPS = 33;

/** Seeded PRNG (mulberry32) so a failure replays exactly. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function jitter(h: Hand, r: () => number, amp = 0.003): Hand {
  const out = h.map((p) => ({ ...p, x: p.x + (r() - 0.5) * 2 * amp, y: p.y + (r() - 0.5) * 2 * amp })) as Hand;
  out.label = h.label;
  return out;
}
function lerp(a: Hand, b: Hand, k: number): Hand {
  const out = a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * k, y: p.y + (b[i].y - p.y) * k })) as Hand;
  out.label = a.label;
  return out;
}
/** The same hand, back to the camera (pointing at the screen). */
function backOf(h: Hand): Hand {
  const w = h[0].x;
  const out = h.map((p) => ({ ...p, x: 2 * w - p.x })) as Hand;
  out.label = h.label;
  return out;
}

/** Run frames through classify → hold; count fires and which shapes were seen. */
function run(frames: Hand[][], faceX: number | null = 0.5) {
  const engine = createHoldEngine();
  const polarity = createHandPolarity();
  const fired: string[] = [];
  const seen = new Set<HandShape>();
  frames.forEach((hands, i) => {
    const read: GestureHand[] = hands.map((h) => {
      polarity.observe(h, h.label, faceX);
      const r = classifyHandShape(h, polarity.correct(h.label), faceX);
      seen.add(r.shape);
      return { shape: r.shape, hand: r.hand, palm: palmCenter(h), scale: handScale(h) };
    });
    const s = engine.update({ hands: read, facing: true, now: i * FPS });
    if (s.fired) fired.push(s.fired);
  });
  return { fired, seen };
}
const secs = (s: number) => Math.round((s * 1000) / FPS);

describe('replay negatives: normal use never fires a button gesture', () => {
  it('cursor use: an open palm wandering over the screen for 40 s (both hands at times)', () => {
    const r = rng(1);
    const frames: Hand[][] = [];
    for (let i = 0; i < secs(40); i++) {
      const t = i / 30;
      const R = jitter(syntheticHand('open', 'R', { at: { x: 0.62 + 0.12 * Math.sin(t * 0.7), y: 0.65 + 0.08 * Math.sin(t * 1.3) } }), r);
      const both = Math.floor(t / 7) % 2 === 1;
      frames.push(both ? [R, jitter(syntheticHand('relaxed', 'L', { at: { x: 0.3, y: 0.8 } }), r)] : r() < 0.03 ? [] : [R]);
    }
    expect(run(frames).fired).toEqual([]);
  });

  it('fist taps: open, close (with in-between frames), open — 25 taps', () => {
    const r = rng(2);
    const frames: Hand[][] = [];
    const at = { x: 0.66, y: 0.66 };
    const open = syntheticHand('open', 'R', { at }), fist = syntheticHand('fist', 'R', { at });
    for (let k = 0; k < 25; k++) {
      for (let i = 0; i < 12; i++) frames.push([jitter(open, r)]);
      for (let i = 1; i <= 3; i++) frames.push([jitter(lerp(open, fist, i / 4), r)]);
      for (let i = 0; i < 4; i++) frames.push([jitter(fist, r)]);
      for (let i = 3; i >= 1; i--) frames.push([jitter(lerp(open, fist, i / 4), r)]);
    }
    const out = run(frames);
    expect(out.fired).toEqual([]);
    expect(out.seen.has('fist')).toBe(true);
  });

  it('pan and board drags: a fist held and moved, then held STILL for 3 s, repeatedly', () => {
    const r = rng(3);
    const frames: Hand[][] = [];
    for (let k = 0; k < 6; k++) {
      for (let i = 0; i < secs(1.5); i++) frames.push([jitter(syntheticHand('fist', 'R', { at: { x: 0.5 + i * 0.004, y: 0.6 } }), r)]);
      for (let i = 0; i < secs(3); i++) frames.push([jitter(syntheticHand('fist', 'R', { at: { x: 0.68, y: 0.6 } }), r)]);
      for (let i = 0; i < secs(0.5); i++) frames.push([jitter(syntheticHand('open', 'R', { at: { x: 0.68, y: 0.6 } }), r)]);
    }
    // Two-fist zoom held still.
    for (let i = 0; i < secs(4); i++) frames.push([jitter(syntheticHand('fist', 'L', { at: { x: 0.3, y: 0.6 } }), r), jitter(syntheticHand('fist', 'R', { at: { x: 0.7, y: 0.6 } }), r)]);
    expect(run(frames).fired).toEqual([]);
  });

  it('resting: relaxed, half-curled hands held in view for 30 s', () => {
    const r = rng(4);
    const frames: Hand[][] = [];
    for (let i = 0; i < secs(30); i++) {
      frames.push([
        jitter(syntheticHand('relaxed', 'L', { at: { x: 0.3, y: 0.75 }, depth: i % 2 === 0 }), r, 0.002),
        jitter(syntheticHand('relaxed', 'R', { at: { x: 0.7, y: 0.75 }, depth: i % 2 === 1 }), r, 0.002),
      ]);
    }
    expect(run(frames).fired).toEqual([]);
  });

  it('pointing at the screen / a device for 5 s (back of the hand, or the finger at the camera) never fires "1"', () => {
    const r = rng(5);
    const frames: Hand[][] = [];
    for (let i = 0; i < secs(5); i++) frames.push([jitter(backOf(syntheticHand('one', 'R')), r)]);
    for (let i = 0; i < secs(5); i++) frames.push([jitter(syntheticHand('pointCamera', 'R'), r)]);
    for (let i = 0; i < secs(5); i++) frames.push([jitter(backOf(syntheticHand('one', 'L')), r), jitter(backOf(syntheticHand('one', 'R')), r)]);
    expect(run(frames).fired).toEqual([]);
  });

  it('control: the same pipeline DOES fire a real held thumbs-up (so the negatives mean something)', () => {
    const r = rng(6);
    const frames: Hand[][] = [];
    for (let i = 0; i < secs(2.4); i++) frames.push([jitter(syntheticHand('thumbsUp', 'R'), r)]);
    expect(run(frames).fired).toEqual(['R:thumbsUp']);
  });
});
