// The fixed-gesture shape classifier: each shape on both hands, mirrored,
// with and without depth, plus the near-misses that must NOT read as a
// button gesture (relaxed hand, finger pointing at the camera).
import { describe, expect, it } from 'vitest';
import { classifyHandShape, resolveHandSide, FIXED_SHAPES, type HandShape } from '../../src/canvas/handShape';
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
  it('the selfie flip never changes the shape', () => {
    for (const shape of SHAPES) {
      for (const side of ['L', 'R'] as const) {
        const lm = syntheticHand(shape, side);
        expect(classifyHandShape(mirrorHand(lm)).shape).toBe(shape);
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
