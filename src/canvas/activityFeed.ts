// AI activity on its own tab (activity.html): the same log the in-app drawer
// shows — the engines' terminal lines plus the live log (clicks, gestures,
// Spotify calls, notes) — as ONE list, newest entry on top.
//
// It rides the existing AI feed BroadcastChannel (aiFeed.ts): same browser,
// same machine, no network. The canvas keeps a short, timestamped history so
// a tab that opens (or reloads) late gets everything so far when it says
// hello. The monitor ignores these messages (they are not AiFeedMsg kinds).
//
// Honesty: every row is a real log line or a real event from the canvas;
// nothing is invented here. Pure except for the channel it is handed.
import { FEED_CHANNEL, isAiFeedMsg, type AiFeed, type FeedChannel, type FeedEngine } from './aiFeed';
import type { ActivityEntry, ActivityKind } from './activityLog';

/** What a row is, which decides its colour (activity.css) — the monitor
 *  stream's kinds, plus the drawer's hand and Spotify events. */
export type RowKind =
  | 'heard' | 'sent' | 'handoff' | 'redact' | 'replied' | 'done' | 'kept' | 'fail' | 'work' | 'queued' | 'note'
  | 'click' | 'grab' | 'gesture' | 'spotify';

export interface ActivityRow {
  /** When it happened (ms). */
  t: number;
  kind: RowKind;
  /** Short human label: "Heard", "Handed off", "Sent", "Kept on device", "Blocked"… */
  label: string;
  text: string;
  /** Who: "Nano", "Gemini", "Rules", "iPhone"… ('' for hand events). */
  who: string;
  sim: boolean;
}

export const ACTIVITY_KEEP = 200;

const ENGINE_NAME: Record<FeedEngine, string> = { nano: 'Nano', gemini: 'Gemini', apple: 'Apple', rules: 'Rules' };
const WORK_LABEL: Record<string, string> = { plan: 'Planning', build: 'Building', fill: 'Filling' };
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function stripSim(text: string): { text: string; sim: boolean } {
  const m = /^\s*SIM\s*·\s*/.exec(text);
  return m ? { text: text.slice(m[0].length), sim: true } : { text, sim: /\bSIM\b/.test(text) };
}

/** One engine log line (verb + text) as a row. The labels and kinds match the
 *  monitor's stream: on-device `received` = Heard, cloud `received` = Sent,
 *  an on-device failure = Blocked, a finished on-device turn that sent
 *  nothing = Kept on device. */
export function rowFromLog(engine: FeedEngine, verb: string, rawText: string, t: number, deviceLabel = ''): ActivityRow {
  const { text, sim } = stripSim(rawText);
  const cloud = engine === 'gemini';
  const who = deviceLabel ? `${deviceLabel} · ${ENGINE_NAME[engine]}` : ENGINE_NAME[engine];
  const mk = (kind: RowKind, label: string, body = text): ActivityRow => ({ t, kind, label, text: body, who, sim });
  switch (verb) {
    case 'received': return cloud ? mk('sent', 'Sent') : mk('heard', 'Heard');
    case 'handoff': {
      const m = /^(→|←)\s*(\w+):\s*(.*)$/.exec(text.trim());
      const body = m ? `${m[1]} ${cap(m[2]!)}: ${m[3]}` : text;
      return mk('handoff', /^\s*←/.test(text) ? 'Picked up' : 'Handed off', body);
    }
    case 'redact': return mk('redact', 'Redacted');
    case 'replied': return mk('replied', 'Replied');
    case 'done': return !cloud && /nothing sent|on this device|kept/i.test(text) ? mk('kept', 'Kept on device') : mk('done', 'Done');
    case 'fail': return cloud ? mk('fail', 'Failed') : mk('fail', 'Blocked');
    case 'queued': return mk('queued', 'Queued');
    case 'note': return /^refused:/i.test(text) ? mk('fail', 'Blocked', text.replace(/^refused:\s*/i, '')) : mk('note', 'Note');
    default: return mk('work', WORK_LABEL[verb] ?? cap(verb));
  }
}

const ENTRY_KIND: Record<ActivityKind, { kind: RowKind; label: string }> = {
  click: { kind: 'click', label: 'Click' },
  grab: { kind: 'grab', label: 'Grab' },
  gesture: { kind: 'gesture', label: 'Gesture' },
  spotify: { kind: 'spotify', label: 'Spotify' },
  ai: { kind: 'work', label: 'AI' },
  note: { kind: 'note', label: 'Note' },
};

/** One drawer live-log entry (click, gesture, Spotify call, note) as a row. */
export function rowFromEntry(e: ActivityEntry): ActivityRow {
  const k = ENTRY_KIND[e.kind] ?? ENTRY_KIND.note;
  const body = (e.kind === 'click' || e.kind === 'grab') && e.target ? e.target : e.text;
  const { text, sim } = stripSim(body || k.label);
  return { t: e.at, kind: k.kind, label: k.label, text, who: '', sim };
}

/** Newest first; rows that happened in the same millisecond keep the later
 *  one on top. Returns a new, capped list. Pure. */
export function addRow(rows: readonly ActivityRow[], row: ActivityRow, keep = ACTIVITY_KEEP): ActivityRow[] {
  let i = 0;
  while (i < rows.length && rows[i].t > row.t) i++;
  const out = [...rows.slice(0, i), row, ...rows.slice(i)];
  return out.length > keep ? out.slice(0, keep) : out;
}

/** A snapshot (oldest → newest, as the canvas kept it) merged under anything
 *  newer the tab already has. Newest first. Pure. */
export function mergeSnapshot(rows: readonly ActivityRow[], snap: readonly ActivityRow[], keep = ACTIVITY_KEEP): ActivityRow[] {
  const last = snap.length ? Math.max(...snap.map((r) => r.t)) : -Infinity;
  let out: ActivityRow[] = [];
  for (const r of snap) out = addRow(out, r, keep);
  for (const r of [...rows].reverse()) if (r.t > last) out = addRow(out, r, keep);
  return out;
}

export type ActivityMsg = { v: 1; sid: string; t: number } & (
  | { kind: 'activity'; row: ActivityRow }
  | { kind: 'activity-snapshot'; rows: ActivityRow[]; sim?: boolean }
);

const isRow = (r: unknown): r is ActivityRow => {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return typeof o.t === 'number' && Number.isFinite(o.t) && typeof o.kind === 'string' && typeof o.label === 'string'
    && typeof o.text === 'string' && typeof o.who === 'string' && typeof o.sim === 'boolean';
};

export function isActivityMsg(d: unknown): d is ActivityMsg {
  if (!d || typeof d !== 'object') return false;
  const m = d as Record<string, unknown>;
  if (m.v !== 1 || typeof m.sid !== 'string' || typeof m.t !== 'number') return false;
  if (m.kind === 'activity') return isRow(m.row);
  if (m.kind === 'activity-snapshot') return Array.isArray(m.rows) && m.rows.every(isRow);
  return false;
}

export interface ActivityBroadcast {
  /** Tee this into the canvas's AI feed: engine log lines become rows. */
  feed: AiFeed;
  /** A drawer live-log entry (click, gesture, Spotify, note). */
  entry(e: ActivityEntry): void;
  /** Everything kept so far, oldest first. */
  history(): ActivityRow[];
}

function defaultChannel(): FeedChannel | null {
  try { return typeof BroadcastChannel === 'function' ? new BroadcastChannel(FEED_CHANNEL) : null; } catch { return null; }
}

/** The canvas side: records every row with its time, posts it live, and
 *  answers a tab's hello with the history so far. */
export function createActivityBroadcast(opts: { channel?: FeedChannel | null; sim?: boolean; keep?: number } = {}): ActivityBroadcast {
  const channel = opts.channel === undefined ? defaultChannel() : opts.channel;
  const keep = opts.keep ?? ACTIVITY_KEEP;
  const sid = `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const rows: ActivityRow[] = []; // oldest first
  const post = (m: Record<string, unknown>) => {
    try { channel?.postMessage({ v: 1, sid, t: Date.now(), ...m }); } catch { /* best-effort */ }
  };
  const push = (row: ActivityRow) => {
    rows.push(row);
    if (rows.length > keep) rows.splice(0, rows.length - keep);
    post({ kind: 'activity', row });
  };
  channel?.addEventListener('message', (e) => {
    const d = e.data as { kind?: unknown; v?: unknown } | null;
    if (!d || typeof d !== 'object' || d.v !== 1 || d.kind !== 'hello') return;
    post({ kind: 'activity-snapshot', rows: [...rows], ...(opts.sim ? { sim: true } : {}) });
  });
  return {
    feed: {
      publish(m) {
        // Only log lines are rows: a handoff is already logged in both
        // terminals, and state / bytes messages are not log entries.
        if (m.kind !== 'log') return;
        push(rowFromLog(m.engine, m.verb, m.text, Date.now(), m.deviceLabel ?? ''));
      },
      onHello() { /* the canvas's own feed answers hello */ },
    },
    entry(e) { push(rowFromEntry(e)); },
    history: () => [...rows],
  };
}

/** The tab side: a newest-first list fed by the channel. `onChange` gets the
 *  whole list and, for a live row, that row (so the page can animate it in). */
export function createActivityStore(channel: FeedChannel | null, onChange: (rows: ActivityRow[], added: ActivityRow | null, sim: boolean) => void, keep = ACTIVITY_KEEP) {
  let rows: ActivityRow[] = [];
  let sim = false;
  channel?.addEventListener('message', (e) => {
    const d = e.data;
    if (isActivityMsg(d)) {
      if (d.kind === 'activity') { rows = addRow(rows, d.row, keep); onChange(rows, d.row, sim); }
      else { rows = mergeSnapshot(rows, d.rows, keep); sim = !!d.sim; onChange(rows, null, sim); }
      return;
    }
    // The canvas's own feed says whether it runs scripted (?sim=1).
    if (isAiFeedMsg(d) && d.kind !== 'hello' && !!d.sim !== sim) { sim = !!d.sim; onChange(rows, null, sim); }
  });
  return {
    rows: () => rows,
    hello() { try { channel?.postMessage({ v: 1, sid: 'activity', t: Date.now(), kind: 'hello' }); } catch { /* best-effort */ } },
  };
}
