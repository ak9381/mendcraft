// Rule parser for canvas navigation speech. Device and CAD phrases fall
// through (null) to their own parsers.
export type CanvasCommand =
  | { type: 'newFrame' }
  | { type: 'showEverything' }
  | { type: 'zoom'; dir: 1 | -1 }
  | { type: 'zoomReset' }
  | { type: 'save' }
  | { type: 'buildNext' }
  | { type: 'back' }
  | { type: 'step'; dir: 1 | -1 }
  | { type: 'pin'; on: boolean }
  | { type: 'goTo'; target: string }
  | { type: 'keep' }
  | { type: 'drop' }
  | { type: 'undo' }
  /** "bring the board back (from the iPhone)": a board sent to a phone comes back. */
  | { type: 'bringBack'; from?: 'ios' | 'android' };

/** A spoken phone name → its platform ("the nothing phone", "my iphone"). */
export function phoneFromWords(w: string): 'ios' | 'android' | null {
  if (/\b(iphone|apple)\b/.test(w)) return 'ios';
  if (/\b(nothing|android)\b/.test(w)) return 'android';
  return null;
}

export function normalise(text: string): string {
  return text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(please|hey mendcraft|mendcraft|now|ok|okay)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

const BOARD = '(canvas|canvases|board|boards|frame|frames|page|pages)';

export function parseCanvasCommand(text: string): CanvasCommand | null {
  const t = normalise(text);
  if (!t) return null;
  if (new RegExp(`\\b(new|another|fresh|blank)\\s+${BOARD}\\b`).test(t)) return { type: 'newFrame' };
  if (/^(show (me )?(everything|it all|all( of)?( the)?( \w+)?)|zoom all the way out|fit( to screen| all)?|overview|birds eye( view)?)$/.test(t)) return { type: 'showEverything' };
  if (/^zoom in$/.test(t)) return { type: 'zoom', dir: 1 };
  if (/^zoom out$/.test(t)) return { type: 'zoom', dir: -1 };
  if (/^(reset zoom|zoom reset|(zoom )?(to )?100( percent)?|actual size)$/.test(t)) return { type: 'zoomReset' };
  if (/^save( (this|it|that|the (board|canvas|dashboard)))?$/.test(t)) return { type: 'save' };
  if (/\bbuild (the )?next\b/.test(t)) return { type: 'buildNext' };
  if (/^(go )?back$/.test(t)) return { type: 'back' };
  if (new RegExp(`^next ${BOARD}$`).test(t)) return { type: 'step', dir: 1 };
  if (new RegExp(`^(previous|prev|last) ${BOARD}$`).test(t)) return { type: 'step', dir: -1 };
  if (/^unpin( (this|it|that))?$/.test(t)) return { type: 'pin', on: false };
  if (/^(pin|dock)( (this|it|that))?( to the side)?$/.test(t)) return { type: 'pin', on: true };
  if (/^(yes )?keep( (it|this|that|them))?$/.test(t)) return { type: 'keep' };
  if (/^((no )?drop( (it|this|that))?|reject( (it|this|that))?)$/.test(t)) return { type: 'drop' };
  if (/^undo( (it|this|that))?$/.test(t)) return { type: 'undo' };
  // Not "pin"/"unpin" (those dock a board to the side).
  const back = /^(bring|get|take) (the |my |that )?(status )?(board|dashboard|it) back( (from|to) (.*))?$/.exec(t);
  if (back) {
    const from = back[7] ? phoneFromWords(back[7]) : null;
    return from ? { type: 'bringBack', from } : { type: 'bringBack' };
  }
  const m = /^(go to|open|show me|jump to|take me to|switch to)\s+(the\s+)?(.+)$/.exec(t);
  if (m) return { type: 'goTo', target: m[3] };
  return null;
}

/** Whether running "save" should also pin the focused board to the side
 *  dock — yes, unless it's pinned already; "unpin" stays the only way back
 *  off, and nothing happens with no board focused. */
export function saveShouldPin(focused: { pinned: boolean } | null | undefined): boolean {
  return !!focused && !focused.pinned;
}

/** "save" should also open a new board (so the dashboard actually appears
 *  in the side dock and the main canvas is clear) when the focused board is
 *  an unpinned dockable room. The dock only renders a pinned room that is
 *  NOT the focused board — pinning alone would leave it hidden. */
export function saveShouldOpenNextBoard(
  focused: { pinned: boolean } | null | undefined,
  surface: { kind: string } | null | undefined,
  hasDockTiles: boolean,
): boolean {
  return saveShouldPin(focused) && surface?.kind === 'room' && hasDockTiles;
}

const ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, one: 1, two: 2, three: 3, four: 4, five: 5 };

function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

/** Map a spoken board name, ordinal or "last" to a frame id. */
export function resolveFrame(frames: readonly { id: string; title: string }[], target: string): string | null {
  const t = normalise(target).replace(/\b(the|one|board|canvas|frame|number|no)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || !frames.length) return null;
  if (t === 'last') return frames[frames.length - 1].id;
  const n = /^\d+$/.test(t) ? Number(t) : ORD[t];
  if (n) return frames[n - 1]?.id ?? null;
  let best: { id: string; score: number } | null = null;
  for (const f of frames) {
    const title = normalise(f.title);
    let score = 0;
    if (title === t) score = 100;
    else if (t.split(' ').every((w) => title.split(' ').includes(w))) score = 80;
    else {
      const dist = lev(t, title);
      if (dist <= Math.max(2, Math.floor(title.length * 0.2))) score = 60 - dist;
    }
    if (score && (!best || score > best.score)) best = { id: f.id, score };
  }
  return best?.id ?? null;
}
