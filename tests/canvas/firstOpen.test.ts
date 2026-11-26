import { describe, expect, it } from 'vitest';
import { emptyDoc, initialDoc } from '../../src/canvas/firstOpen';
import { CANVAS_DOC_VERSION, type CanvasDoc } from '../../src/canvas/frames';

const joined: CanvasDoc = { version: CANVAS_DOC_VERSION, camera: { x: 1, y: 2, z: 1 }, focusId: null, frames: [], surfaces: {} };

describe('first open', () => {
  it('opens the document the caller joined from storage', () => {
    expect(initialDoc(joined)).toBe(joined);
  });

  it('with nothing stored it opens fully blank — zero boards, nothing seeded', () => {
    for (const d of [initialDoc(null), initialDoc(undefined)]) {
      expect(d.frames).toHaveLength(0);
      expect(d.focusId).toBeNull();
      expect(d.surfaces).toEqual({});
    }
    expect(emptyDoc()).toEqual(initialDoc(null));
  });
});
