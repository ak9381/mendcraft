// The fixed-gesture shape classifier: each shape on both hands, mirrored,
// with and without depth, plus the near-misses that must NOT read as a
// button gesture (relaxed hand, finger pointing at the camera).
import { describe, expect, it } from 'vitest';
import { classifyHandShape, createHandPolarity, palmFacing, resolveHandSide, FIXED_SHAPES, type HandShape } from '../../src/canvas/handShape';
import { mirrorHand, syntheticHand } from '../../src/canvas/handShapeFixtures';

const SHAPES: HandShape[] = ['thumbsUp', 'thumbsDown', 'one', 'peace', 'three', 'open', 'fist'];

describe('classifyHandShape — each shape', () => {
  for (const shape of SHAPES) {
    for (const side of ['L', 'R'] as const) {
      for (const depth of [false, true]) {
        it(`${side} ${shape}${depth ? ' (3D)' : ''}`, () => {
          const r = classifyHandShape(syntheticHand(shape, side, { depth }));
          expect(r.shape).toBe(shape);
          expect(r.hand).toBe(side);
          expect(r.confidence).toBeGreaterThan(0.5);
        });
      }
    }
  }

  it('reads the same shape at other sizes and positions', () => {
    for (const shape of SHAPES) {
      const r = classifyHandShape(syntheticHand(shape, 'R', { size: 0.6, at: { x: 0.55, y: 0.5 } }));
      expect(r.shape).toBe(shape);
      const big = classifyHandShape(syntheticHand(shape, 'L', { size: 1.6, at: { x: 0.3, y: 0.8 } }));
      expect(big.shape).toBe(shape);
    }
  });

  it('only thumbs up/down and the finger counts are fixed (button) shapes', () => {
    expect(FIXED_SHAPES).toEqual(['thumbsUp', 'thumbsDown', 'one', 'peace', 'three']);
  });
});

describe('classifyHandShape — mirror safe', () => {
  it('the selfie flip never changes the shape (raw camera space, mirrored: false)', () => {
    for (const shape of SHAPES) {
      for (const side of ['L', 'R'] as const) {
        const lm = syntheticHand(shape, side);
        const r = classifyHandShape(mirrorHand(lm), undefined, null, { mirrored: false });
        expect(r.shape).toBe(shape);
        expect(r.hand).toBe(side);
      }
    }
  });

  it('mirrored=false (raw camera space) keeps L/R right via the face side', () => {
    // A right hand in selfie space at x 0.68, face at 0.5. In raw camera space
    // the same hand is at 0.32 with the face at 0.5.
    const raw = mirrorHand(syntheticHand('thumbsUp', 'R', { label: null }));
    const r = classifyHandShape(raw, undefined, 0.5, { mirrored: false });
    expect(r).toMatchObject({ shape: 'thumbsUp', hand: 'R', handFrom: 'face' });
  });
});

describe('classifyHandShape — handedness cross-check', () => {
  it('uses the MediaPipe label when no face is known', () => {
    const lm = syntheticHand('peace', 'R', { label: 'Left' }); // label says Left
    const r = classifyHandShape(lm);
    expect(r).toMatchObject({ hand: 'L', handFrom: 'label' });
  });

  it('the face side overrides a flipped label when the hand is clearly to one side', () => {
    const lm = syntheticHand('peace', 'R', { label: 'Left', at: { x: 0.75, y: 0.7 } });
    const r = classifyHandShape(lm, undefined, 0.5);
    expect(r).toMatchObject({ shape: 'peace', hand: 'R', handFrom: 'face' });
  });

  it('a hand in front of the face keeps the label (too close to call by position)', () => {
    const lm = syntheticHand('one', 'L', { at: { x: 0.52, y: 0.7 } });
    expect(classifyHandShape(lm, undefined, 0.5)).toMatchObject({ hand: 'L', handFrom: 'label' });
  });

  it('explicit handedness argument wins over the stamped label', () => {
    const lm = syntheticHand('one', 'R');
    expect(classifyHandShape(lm, 'Left').hand).toBe('L');
  });

  it('no label and no face: falls back to the side of the frame', () => {
    expect(resolveHandSide(syntheticHand('one', 'R', { label: null }), undefined, null)).toEqual({ hand: 'R', from: 'position' });
    expect(resolveHandSide(syntheticHand('one', 'L', { label: null }), undefined, null)).toEqual({ hand: 'L', from: 'position' });
  });

  it('face-confirmed L/R is more confident than a bare label', () => {
    const lm = syntheticHand('thumbsUp', 'R', { at: { x: 0.8, y: 0.7 } });
    expect(classifyHandShape(lm, undefined, 0.5).confidence).toBeGreaterThan(classifyHandShape(lm).confidence);
  });
});

describe('classifyHandShape — near misses', () => {
  it('a relaxed, half-bent hand is not three (or any button shape)', () => {
    for (const side of ['L', 'R'] as const) {
      for (const depth of [false, true]) {
        const r = classifyHandShape(syntheticHand('relaxed', side, { depth }));
        expect(FIXED_SHAPES).not.toContain(r.shape);
      }
    }
  });

  it('three with a loose (not curled) pinky is not three', () => {
    const three = syntheticHand('three', 'R');
    const relaxed = syntheticHand('relaxed', 'R');
    for (const i of [17, 18, 19, 20]) three[i] = relaxed[i];
    expect(classifyHandShape(three).shape).toBe('other');
  });

  it('an index pointing AT the camera is ambiguous → other, never one', () => {
    for (const side of ['L', 'R'] as const) {
      const r = classifyHandShape(syntheticHand('pointCamera', side));
      expect(r.shape).toBe('other');
      expect(r.confidence).toBe(0);
    }
  });

  it('index + ring (not a count we use) is other', () => {
    expect(classifyHandShape(syntheticHand('other', 'R')).shape).toBe('other');
  });

  it('a fist with the thumb out sideways is neither thumbs up nor down', () => {
    const lm = syntheticHand('thumbsUp', 'R');
    // Rotate the whole hand 90° back so the thumb points sideways.
    const c = lm[0];
    const side = lm.map((p) => ({ x: c.x + (p.y - c.y), y: c.y - (p.x - c.x) }));
    const r = classifyHandShape(side, 'Right');
    expect(['thumbsUp', 'thumbsDown']).not.toContain(r.shape);
  });

  it('too few landmarks → other', () => {
    expect(classifyHandShape([{ x: 0, y: 0 }]).shape).toBe('other');
  });
});

/** The same hand turned around: its BACK toward the camera (mirror about the wrist). */
const backOf = (lm: ReturnType<typeof syntheticHand>) => {
  const w = lm[0].x;
  const out = lm.map((p) => ({ ...p, x: 2 * w - p.x })) as typeof lm;
  out.label = lm.label;
  return out;
};

describe('classifyHandShape — pointing is not "1"', () => {
  it('index up with the BACK of the hand to the camera (pointing at the screen) → other', () => {
    for (const side of ['L', 'R'] as const) {
      for (const depth of [false, true]) {
        const r = classifyHandShape(backOf(syntheticHand('one', side, { depth })));
        expect(r.shape).toBe('other');
      }
    }
  });

  it('an edge-on pointing hand (side to the camera) → other', () => {
    const lm = syntheticHand('one', 'R');
    const w = lm[0].x;
    const edge = lm.map((p) => ({ ...p, x: w + (p.x - w) * 0.1 })) as typeof lm;
    edge.label = 'Right';
    expect(classifyHandShape(edge).shape).toBe('other');
  });

  it('palm facing is read per hand and mirror', () => {
    const r = syntheticHand('open', 'R');
    expect(palmFacing(r, 'R')).toBe(true);
    expect(palmFacing(r, 'L')).toBe(false);
    expect(palmFacing(mirrorHand(r), 'R', false)).toBe(true);
    expect(palmFacing(backOf(r), 'R')).toBe(false);
  });

  it('peace and three are not orientation-gated (only the lone index is ambiguous)', () => {
    expect(classifyHandShape(backOf(syntheticHand('peace', 'R'))).shape).toBe('peace');
  });
});

describe('createHandPolarity — learns whether MediaPipe Left/Right is flipped', () => {
  const FACE = 0.5;
  const R = (label: string, x = 0.8) => ({ lm: syntheticHand('open', 'R', { at: { x, y: 0.7 } }), label });
  const L = (label: string, x = 0.2) => ({ lm: syntheticHand('open', 'L', { at: { x, y: 0.7 } }), label });
  const frames = (n: number, fn: () => void) => { for (let i = 0; i < n; i++) fn(); };

  it('two hands, labels agreeing with their sides of the face → normal; labels untouched', () => {
    const p = createHandPolarity();
    frames(60, () => p.observeFrame([R('Right'), L('Left')], FACE));
    expect(p.polarity).toBe('normal');
    expect(p.correct('Right')).toBe('Right');
  });

  it('two hands, labels consistently the wrong way round for ~1.5 s → flipped; labels swapped', () => {
    const p = createHandPolarity();
    frames(30, () => p.observeFrame([R('Left'), L('Right')], FACE));
    expect(p.polarity).toBe('unknown'); // not yet: 1 s is not enough
    frames(30, () => p.observeFrame([R('Left'), L('Right')], FACE));
    expect(p.polarity).toBe('flipped');
    expect(p.correct('Left')).toBe('Right');
    expect(p.correct('Right')).toBe('Left');
    const front = syntheticHand('thumbsUp', 'R', { at: { x: 0.52, y: 0.7 }, label: 'Left' });
    expect(classifyHandShape(front, p.correct('Left'), FACE).hand).toBe('R');
  });

  it('a single hand reaching across the body never flips it (0.3–2 s, any number of times)', () => {
    const p = createHandPolarity();
    // The RIGHT hand (labelled Right) pointing across to the LEFT of the face.
    for (const n of [9, 30, 60]) frames(n, () => p.observeFrame([R('Right', 0.2)], FACE));
    expect(p.polarity).toBe('unknown');
    expect(p.correct('Right')).toBe('Right');
    expect(p.score).toBe(0);
  });

  it('two hands crossed briefly do not flip an established normal', () => {
    const p = createHandPolarity();
    frames(90, () => p.observeFrame([R('Right'), L('Left')], FACE));
    frames(60, () => p.observeFrame([R('Right', 0.2), L('Left', 0.8)], FACE)); // arms crossed 2 s
    expect(p.polarity).not.toBe('flipped');
  });

  it('without votes the score decays back toward MediaPipe\'s labels', () => {
    const p = createHandPolarity({ decay: 1 });
    frames(60, () => p.observeFrame([R('Left'), L('Right')], FACE));
    expect(p.polarity).toBe('flipped');
    frames(60, () => p.observeFrame([R('Right')], FACE));
    expect(p.polarity).toBe('unknown');
    expect(p.correct('Left')).toBe('Left');
  });

  it('hands near the face never vote', () => {
    const p = createHandPolarity();
    frames(120, () => p.observeFrame([R('Left', 0.55), L('Right', 0.45)], FACE));
    expect(p.polarity).toBe('unknown');
  });

  it('mirrored=false (raw camera space) learns the same way', () => {
    const p = createHandPolarity();
    frames(60, () => p.observeFrame([
      { lm: mirrorHand(R('x').lm), label: 'Left' },
      { lm: mirrorHand(L('x').lm), label: 'Right' },
    ], 1 - FACE, false));
    expect(p.polarity).toBe('flipped');
  });
});
