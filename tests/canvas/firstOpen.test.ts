import { describe, expect, it } from 'vitest';
import { initialDoc } from '../../src/canvas/firstOpen';
import { CANVAS_DOC_VERSION, type CanvasDoc } from '../../src/canvas/frames';

const seed: CanvasDoc = { version: CANVAS_DOC_VERSION, camera: { x: 1, y: 2, z: 1 }, focusId: null, frames: [], surfaces: {} };
const makeSeed = () => seed;

describe('first open', () => {
  it('returns the stored doc when there is one', () => {
    const stored: CanvasDoc = { ...seed, camera: { x: 9, y: 9, z: 1 } };
    expect(initialDoc(stored, {}, makeSeed)).toBe(stored);
  });

  it('loads the seed doc when ?seed=1', () => {
    expect(initialDoc(null, { seed: true }, makeSeed)).toBe(seed);
  });

  it('otherwise starts with one empty focused Board 1', () => {
    const d = initialDoc(null, {}, makeSeed);
    expect(d.frames).toHaveLength(1);
    expect(d.frames[0].title).toBe('Board 1');
    expect(d.focusId).toBe(d.frames[0].id);
    expect(d.surfaces).toEqual({});
  });

  it('starts fully blank — zero boards — on ?fresh=1', () => {
    const d = initialDoc(null, { fresh: true }, makeSeed);
    expect(d.frames).toHaveLength(0);
    expect(d.focusId).toBeNull();
    expect(d.surfaces).toEqual({});
  });

  it('a stored doc wins over ?fresh=1', () => {
    const stored: CanvasDoc = { ...seed, camera: { x: 9, y: 9, z: 1 } };
    expect(initialDoc(stored, { fresh: true }, makeSeed)).toBe(stored);
  });
});
