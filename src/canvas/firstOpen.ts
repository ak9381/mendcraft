// What canvas to open with. A stored doc always wins; ?seed=1 loads the
// finished "cold open" canvas; ?fresh=1 (with nothing stored) starts fully
// blank, zero boards, for the "let's build something fun" opening prompt;
// otherwise she starts on one empty Board 1, focused, with the
// connect/floor-plan hint. Pure: seedDoc() is injected so this stays free of
// the canvas shell (which imports it back).
import { CANVAS_DOC_VERSION, createFrameRegistry, type CanvasDoc } from './frames';

export interface InitialParams { seed?: boolean; fresh?: boolean }

export function initialDoc(stored: CanvasDoc | null, params: InitialParams, makeSeed: () => CanvasDoc): CanvasDoc {
  if (stored) return stored;
  if (params.seed) return makeSeed();
  if (params.fresh) return { version: CANVAS_DOC_VERSION, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: [], surfaces: {} };
  const r = createFrameRegistry();
  const board = r.add('note', 'Board 1');
  return { version: CANVAS_DOC_VERSION, camera: { x: 0, y: 0, z: 1 }, focusId: board.id, frames: r.list(), surfaces: {} };
}
