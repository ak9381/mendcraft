// What canvas to open with: the document the caller joined from the stored
// layout and artifacts (canvasPersistence.ts), else a fully blank canvas —
// zero boards, the "What would you like to build?" lead. Nothing is seeded.
import { CANVAS_DOC_VERSION, type CanvasDoc } from './frames';

export function emptyDoc(): CanvasDoc {
  return { version: CANVAS_DOC_VERSION, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: [], surfaces: {} };
}

export function initialDoc(doc: CanvasDoc | null | undefined): CanvasDoc {
  return doc ?? emptyDoc();
}
