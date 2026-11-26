// AI activity on its own tab — the log the in-app drawer shows, as one large,
// readable list with the NEWEST entry on top (older entries push down),
// colour-coded by kind like the monitor's stream. Live over the AI feed
// BroadcastChannel (see ../canvas/activityFeed.ts); nothing is invented here.
// Built with createElement/textContent only (no innerHTML), so it also runs
// under the suite's node-only fake DOM.
import './activity.css';
import { FEED_CHANNEL, type FeedChannel } from '../canvas/aiFeed';
import { createActivityStore, type ActivityRow, type RowKind } from '../canvas/activityFeed';

const BOLD: ReadonlySet<RowKind> = new Set<RowKind>(['sent', 'handoff', 'redact', 'kept', 'fail']);
const LEGEND: Array<[RowKind, string]> = [
  ['heard', 'Heard'], ['handoff', 'Handed off'], ['sent', 'Sent to cloud'], ['kept', 'Kept on device'],
  ['fail', 'Blocked'], ['redact', 'Redacted'], ['gesture', 'Hands'],
];

export function clock(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export interface ActivityPage { el: HTMLElement; rows(): ActivityRow[] }

export function mountActivityPage(root: HTMLElement, channel: FeedChannel | null, doc: Document = document): ActivityPage {
  const make = (tag: string, cls: string, text?: string): HTMLElement => {
    const e = doc.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const wrap = make('div', 'act');
  const head = make('header', 'act-head');
  const live = make('span', 'act-live', 'Waiting for the canvas');
  live.setAttribute('role', 'status');
  const legend = make('ul', 'act-legend');
  legend.setAttribute('aria-label', 'Colours');
  for (const [kind, label] of LEGEND) {
    const li = make('li', '', label);
    li.setAttribute('data-kind', kind);
    legend.appendChild(li);
  }
  head.appendChild(make('h1', 'act-title', 'AI activity'));
  head.appendChild(live);
  head.appendChild(make('p', 'act-order', 'Newest first'));
  head.appendChild(legend);
  const empty = make('p', 'act-empty', 'Nothing yet. Keep the canvas open in another tab and say or do something — each step shows up here, newest on top.');
  const list = make('ol', 'act-list');
  list.setAttribute('aria-live', 'polite');
  list.setAttribute('aria-label', 'Activity, newest first');
  wrap.appendChild(head);
  wrap.appendChild(empty);
  wrap.appendChild(list);
  root.appendChild(wrap);

  function rowEl(r: ActivityRow, isNew: boolean): HTMLElement {
    const li = make('li', `act-row${isNew ? ' is-new' : ''}`);
    li.setAttribute('data-kind', r.kind);
    li.setAttribute('data-bold', String(BOLD.has(r.kind)));
    li.appendChild(make('time', 'act-time', clock(r.t)));
    const kind = make('span', 'act-kind', r.label);
    if (r.who) kind.appendChild(make('span', 'act-who', r.who));
    li.appendChild(kind);
    const text = make('span', 'act-text', r.text);
    if (r.sim) text.appendChild(make('span', 'act-sim', 'SIM'));
    li.appendChild(text);
    return li;
  }

  const store = createActivityStore(channel, (rows, added, sim) => {
    // Newest first: the list is rebuilt in store order, so DOM order is
    // always the store's order (index 0 = the most recent entry).
    list.textContent = '';
    for (const r of rows) list.appendChild(rowEl(r, r === added));
    empty.hidden = rows.length > 0;
    live.textContent = sim ? 'SIM — scripted, nothing sent' : 'Live';
    live.setAttribute('data-live', 'true');
    live.setAttribute('data-sim', String(sim));
  });
  store.hello();
  return { el: wrap, rows: () => store.rows() };
}

if (typeof document !== 'undefined' && document.getElementById('activity')) {
  let channel: FeedChannel | null = null;
  try { channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(FEED_CHANNEL) : null; } catch { channel = null; }
  mountActivityPage(document.getElementById('activity')!, channel);
}
