// Presence and the skeleton overlay store hands in selfie space (x' = 1 − x)
// so the drawn bones match a front-facing camera. handPointer.update and
// mapToScreen expect RAW camera-space landmarks and will mirror them once.
// Passing already-mirrored points through mapToScreen flips the cursor to the
// opposite side of the screen — pinches miss Talk and the Tools cluster.

export function cameraPointFromSelfie<T extends { x: number; y: number }>(p: T): T {
  return { ...p, x: 1 - p.x };
}

/** Invert the selfie-mirror applied by createHandsProcessor, per hand. */
export function cameraHandsFromSelfie<T extends { x: number; y: number }>(
  hands: readonly (readonly T[])[],
): T[][] {
  return hands.map((h) => h.map((p) => cameraPointFromSelfie(p)));
}
