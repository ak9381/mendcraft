import { describe, expect, it } from 'vitest';
import { handFitsFace, createHandBinder, type HandCandidate } from '../src/input/handBinding';
import type { FaceBox } from '../src/input/faceLogic';

// Smallish face box (operator at a typical webcam distance). Body reach radius
// scales with box size, so a compact face keeps the radius discriminating.
function box(cx = 0.5, cy = 0.35, w = 0.12, h = 0.15): FaceBox {
  return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy };
}

function hand(index: number, x: number, y: number, label?: string): HandCandidate {
  return { index, wrist: { x, y }, label };
}

describe('handFitsFace gate', () => {
  const b = box();

  it('accepts a wrist below the face', () => {
    expect(handFitsFace(hand(0, 0.5, 0.85), b).ok).toBe(true);
  });

  it('accepts a wrist beside the face', () => {
    expect(handFitsFace(hand(0, 0.62, 0.55), b).ok).toBe(true);
  });

  it('rejects a wrist far above the face (not attached)', () => {
    const d = handFitsFace(hand(0, 0.5, 0.05), b);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('above');
  });

  it('rejects a far wrist (another person across the frame)', () => {
    const d = handFitsFace(hand(0, 0.95, 0.9), b);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('far');
  });

  it('rejects a hand on the wrong handedness side', () => {
    // Raw coords: a "Right" hand is expected on image-left; this one is far right.
    const d = handFitsFace(hand(0, 0.8, 0.5, 'Right'), b);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('side');
  });

  it('accepts a hand on the correct handedness side', () => {
    // A "Left" hand is expected on image-right.
    expect(handFitsFace(hand(0, 0.8, 0.5, 'Left'), b).ok).toBe(true);
  });

  it('honours the mirrored convention flag', () => {
    // With mirrored coords, "Right" is expected on image-right instead.
    expect(handFitsFace(hand(0, 0.8, 0.5, 'Right'), b, { mirrored: true }).ok).toBe(true);
  });
});

describe('hand binder selection', () => {
  it('caps accepted hands at two (nearest first)', () => {
    const binder = createHandBinder();
    const b = box();
    const accepted = binder.bind(
      [hand(0, 0.5, 0.9), hand(1, 0.55, 0.6), hand(2, 0.6, 0.55)],
      b,
    );
    expect(accepted).toHaveLength(2);
    // Nearest two to the face centre are indices 2 and 1 (index 0 is lowest/farthest).
    expect(accepted).toEqual([2, 1]);
  });

  it('drops hands that fail the gate before capping', () => {
    const binder = createHandBinder();
    const b = box();
    const accepted = binder.bind(
      [hand(0, 0.5, 0.75), hand(1, 0.95, 0.9), hand(2, 0.5, 0.02)],
      b,
    );
    expect(accepted).toEqual([0]); // 1 is far, 2 is above
  });

  it('keeps continuous hands over a newly appearing closer hand', () => {
    const binder = createHandBinder();
    const b = box();
    const prevA = hand(1, 0.4, 0.75);
    const prevB = hand(2, 0.6, 0.78);
    expect(binder.bind([prevA, prevB], b)).toEqual([1, 2]); // prevA is nearer the face centre
    // Second frame: a third, nearer hand appears but the two tracked hands persist.
    const third = hand(0, 0.55, 0.63);
    const accepted = binder.bind([third, prevA, prevB], b);
    expect(accepted).toContain(1);
    expect(accepted).toContain(2);
    expect(accepted).not.toContain(0);
  });

  it('reset() forgets continuity', () => {
    const binder = createHandBinder();
    const b = box();
    binder.bind([hand(1, 0.4, 0.75), hand(2, 0.6, 0.78)], b);
    binder.reset();
    // After reset, nearest-first ranking with no continuity bonus.
    const accepted = binder.bind([hand(0, 0.55, 0.63), hand(1, 0.4, 0.75), hand(2, 0.6, 0.78)], b);
    expect(accepted[0]).toBe(0); // the closest hand now leads
  });
});
