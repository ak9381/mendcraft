// Presence and the skeleton overlay store hands in selfie space (x' = 1 − x)
// so the drawn bones match a front-facing camera. handPointer.update and
// mapToScreen expect RAW camera-space landmarks and will mirror them once.
// Passing already-mirrored points through mapToScreen flips the cursor to the
// opposite side of the screen — pinches miss Talk and the Tools cluster.

export function cameraPointFromSelfie<T extends { x: number; y: number }>(p: T): T {
  return { ...p, x: 1 - p.x };
}

/** MediaPipe "Left"/"Right" stamped on a landmark array (non-enumerable is not required). */
export function handLabelOf(h: unknown): 'Left' | 'Right' | undefined {
  const l = (h as { label?: string } | null | undefined)?.label;
  return l === 'Left' || l === 'Right' ? l : undefined;
}

export function stampHandLabel<T>(points: T[], label?: string | null): T[] {
  if (label === 'Left' || label === 'Right') {
    (points as T[] & { label?: string }).label = label;
  }
  return points;
}

/** Invert the selfie-mirror applied by createHandsProcessor, per hand.
 *  Copies any MediaPipe handedness label so the pointer can stay left/right aware. */
export function cameraHandsFromSelfie<T extends { x: number; y: number }>(
  hands: readonly (readonly T[])[],
): T[][] {
  return hands.map((h) => {
    const out = stampHandLabel(h.map((p) => cameraPointFromSelfie(p)), handLabelOf(h));
    // The frame's shared shape read (handShape.stampShape) is mirror-safe.
    const shape = (h as { shape?: string }).shape;
    if (shape) (out as T[] & { shape?: string }).shape = shape;
    return out;
  });
}
