import { describe, expect, it } from 'vitest';
import { unletterboxNorm, unletterboxLandmarks } from '../../src/input/squareFrame';

describe('unletterboxNorm', () => {
  it('maps a letterboxed 16:9 landmark back onto the video’s 0–1 space', () => {
    const w = 1920, h = 1080;
    const size = Math.max(w, h);
    // A point at the centre of the video, as MediaPipe would report it in
    // the square letterboxed frame (video is centred, black bars top/bottom).
    const sq = { x: 0.5, y: ((size - h) / 2 + h / 2) / size };
    const p = unletterboxNorm(sq, w, h);
    expect(p.x).toBeCloseTo(0.5, 5);
    expect(p.y).toBeCloseTo(0.5, 5);
  });

  it('is a no-op for a square frame', () => {
    const p = { x: 0.25, y: 0.75 };
    expect(unletterboxNorm(p, 800, 800)).toEqual(p);
  });

  it('remaps a whole landmark list', () => {
    const lms = unletterboxLandmarks([{ x: 0.5, y: 0.5, z: 0 }], 1920, 1080);
    expect(lms).toHaveLength(1);
    expect(lms[0].x).toBeCloseTo(0.5, 5);
    expect(lms[0].z).toBe(0);
  });
});
