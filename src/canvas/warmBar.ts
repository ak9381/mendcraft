// The engine bar while the background Nano warm-up loads the model: the
// existing "Nano is loading the model…" line, then a short "Nano has loaded
// the model." that clears by itself. A turn owns the Nano card: while one
// runs (or once one has run since), the warm-up never writes over it.
import type { EngineBar } from './engineBar';
import { NANO_LOADING_LINE } from './aiTurn';

export const WARM_LOADED_LINE = 'Nano has loaded the model.';
export const WARM_LINE_MS = 4000;

export interface WarmBarDeps {
  bar: Pick<EngineBar, 'set'> | null;
  /** A turn is streaming / awaiting its review. */
  busy(): boolean;
  /** When the last turn let go of the board (ms). */
  lastTurnEndedAt(): number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export function createWarmBar(d: WarmBarDeps): (state: 'loading' | 'loaded' | 'failed') => void {
  const now = d.now ?? (() => Date.now());
  const setTimer = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = d.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let shown = false;
  let timer: unknown = null;
  return (state) => {
    const bar = d.bar;
    if (!bar) return;
    if (state === 'loading') {
      if (d.busy()) return;
      shown = true;
      if (timer != null) { clearTimer(timer); timer = null; }
      bar.set('nano', 'working', NANO_LOADING_LINE);
      return;
    }
    if (!shown) return;
    shown = false;
    if (d.busy()) return;
    if (state !== 'loaded') { bar.set('nano', 'idle', ''); return; }
    bar.set('nano', 'idle', WARM_LOADED_LINE);
    const at = now();
    if (timer != null) clearTimer(timer);
    timer = setTimer(() => { timer = null; if (!shown && !d.busy() && d.lastTurnEndedAt() < at) bar.set('nano', 'idle', ''); }, WARM_LINE_MS);
  };
}
