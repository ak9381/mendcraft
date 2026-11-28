// One turn per line she says or types. A new line aborts the turn before it,
// so a late model answer for an older line says and does nothing ("dropped:
// stale"). A phrase the router re-runs for her (Nano's pick, a chip) is a
// CHILD turn: it lives exactly as long as the line it came from.
// Pure: no DOM, no timers of its own.

export interface Turn {
  readonly id: number;
  readonly text: string;
  readonly parent: Turn | null;
  readonly startedAt: number;
  /** Aborted the moment a newer line begins. */
  readonly signal: AbortSignal;
  /** Still the line she is on (its root has not been replaced). */
  live(): boolean;
}

export interface Turns {
  /** A new line: aborts the current root turn. With `parent`, a child that
   *  shares the parent's life and aborts nothing. */
  begin(text: string, parent?: Turn | null): Turn;
  /** The current root turn (null before the first line). */
  current(): Turn | null;
}

export function createTurns(o: { now?: () => number } = {}): Turns {
  const now = o.now ?? (() => Date.now());
  let seq = 0;
  let cur: Turn | null = null;
  let curCtl: AbortController | null = null;
  return {
    begin(text, parent = null) {
      if (parent) {
        const root = rootOf(parent);
        const t: Turn = {
          id: ++seq, text, parent, startedAt: now(), signal: root.signal,
          live: () => root.live(),
        };
        return t;
      }
      curCtl?.abort();
      const ctl = new AbortController();
      const t: Turn = {
        id: ++seq, text, parent: null, startedAt: now(), signal: ctl.signal,
        live: () => cur === t && !ctl.signal.aborted,
      };
      cur = t; curCtl = ctl;
      return t;
    },
    current: () => cur,
  };
}

function rootOf(t: Turn): Turn { let r = t; while (r.parent) r = r.parent; return r; }

/** Nano's pick: "Still working…" after this long, then give up. */
export const INTENT_STILL_MS = 4_000;
export const INTENT_STILL_LINE = 'Still working…';
