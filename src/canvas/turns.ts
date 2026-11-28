// One turn per line she says or types. A new line aborts the turn before it,
// so a late model answer for an older line says and does nothing ("dropped:
// stale"). A phrase the router re-runs for her (Nano's pick, a chip) is a
// CHILD turn: it lives exactly as long as the line it came from.
// Pure: no DOM, no timers of its own.

/** How a turn ended, said on screen (data-outcome) and in the log. */
export type OutcomeKind = 'done' | 'asked' | 'answered' | 'refused';
export interface Outcome { kind: OutcomeKind; line: string; reason?: string }

export interface Turn {
  readonly id: number;
  readonly text: string;
  readonly parent: Turn | null;
  readonly startedAt: number;
  /** Aborted the moment a newer line begins. */
  readonly signal: AbortSignal;
  /** Still the line she is on (its root has not been replaced). */
  live(): boolean;
  /** First one wins (a child settles its root). False if already settled. */
  settle(o: Outcome): boolean;
  outcome(): Outcome | null;
  /** A fixed-phrase route ran for this line (its RouteName). */
  ranRoute(name: string): void;
  route(): string | null;
  /** A line was shown while this turn was current. */
  noteSaid(): void;
  saidCount(): number;
}

interface TurnState { outcome: Outcome | null; route: string | null; said: number }

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
          settle: (o) => root.settle(o), outcome: () => root.outcome(),
          ranRoute: (n) => root.ranRoute(n), route: () => root.route(),
          noteSaid: () => root.noteSaid(), saidCount: () => root.saidCount(),
        };
        return t;
      }
      curCtl?.abort();
      const ctl = new AbortController();
      const st: TurnState = { outcome: null, route: null, said: 0 };
      const t: Turn = {
        id: ++seq, text, parent: null, startedAt: now(), signal: ctl.signal,
        live: () => cur === t && !ctl.signal.aborted,
        settle(o) { if (st.outcome) return false; st.outcome = o; return true; },
        outcome: () => st.outcome,
        ranRoute(n) { if (!st.route) st.route = n; },
        route: () => st.route,
        noteSaid() { st.said++; },
        saidCount: () => st.said,
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

// ---- the watchdog: a finished turn is never silent, and never said twice ----

export const DONE_CUE = 'Done. Say something else.';
export const NOTHING_DONE_LINE = 'I didn’t do anything with that. Say it another way.';
/** Short names for "Done: … Say something else." (RouteName → words). */
export const ROUTE_LABEL: Readonly<Record<string, string>> = {
  showDevices: 'status board', connectRoom: 'dashboard', floorPlan: 'floor plan', planEdit: 'plan edit', planExtra: 'plan check',
  device: 'device', deviceState: 'device status', musicSearch: 'music search', connectDevices: 'pairing', connectByName: 'connect',
  connectSheet: 'connect a device', pointConnect: 'point to connect', gimbal: 'gimbal', gimbalScan: 'room scan', language: 'language',
  canvas: 'board', voice: 'voice', artifacts: 'artifacts', history: 'history', tool: 'tools', scroll: 'scroll', packIntent: 'command',
  paletteOpen: 'tools', paletteClose: 'tools', teach: 'teach a gesture', teachList: 'gestures', showAi: 'AI activity', hideAi: 'AI activity',
  monitor: 'AI monitor', activityTab: 'AI activity',
};
export const doneLine = (route: string): string => `Done: ${ROUTE_LABEL[route] ?? route}. Say something else.`;

/** What to say once everything is idle and this turn has not been closed:
 *  a route ran → "Done: <route>."; an answer or other line was shown → the
 *  plain done cue; nothing at all happened → refused, "say it another way".
 *  A turn already asked / refused / done (or the boot turn) gets nothing;
 *  the caller says it once per turn. */
export function watchdogOutcome(t: Turn): Outcome | null {
  if (!t.text.trim()) return null;
  const o = t.outcome();
  if (o && o.kind !== 'answered') return null;
  const route = t.route();
  if (route) return { kind: 'done', line: doneLine(route) };
  if (o || t.saidCount() > 0) return { kind: 'done', line: DONE_CUE };
  return { kind: 'refused', line: NOTHING_DONE_LINE, reason: 'nothing ran' };
}

/** Second command in a row that nothing could place: refuse, don't ask again. */
export const CANT_YET_PHRASES = ['show my devices', 'build the dashboard', 'draw a floor plan'] as const;
export const cantDoYetLine = (): string => `I can’t do that yet. Try: ${CANT_YET_PHRASES.map((p) => `“${p}”`).join(', ')}.`;
