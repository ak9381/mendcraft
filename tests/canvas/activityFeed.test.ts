// AI activity on its own tab: the drawer's log over the feed channel, with the
// newest entry on top (older entries push down), colour-coded by kind.
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_KEEP, addRow, createActivityBroadcast, createActivityStore, isActivityMsg, mergeSnapshot, rowFromEntry, rowFromLog, type ActivityRow,
} from '../../src/canvas/activityFeed';
import { createActivityLog } from '../../src/canvas/activityLog';
import { createAiFeed, isAiFeedMsg, type FeedChannel } from '../../src/canvas/aiFeed';
import { mountModelPanels, MODEL_PANELS_HTML } from '../../src/canvas/modelPanels';
import { mountActivityPage } from '../../src/activity/activityMain';

/** Two ends of one in-memory BroadcastChannel (a post reaches the OTHER end). */
function pair(): { canvas: FeedChannel; tab: FeedChannel } {
  const a: Array<(e: { data: unknown }) => void> = [];
  const b: Array<(e: { data: unknown }) => void> = [];
  const clone = (m: unknown) => JSON.parse(JSON.stringify(m)) as unknown;
  return {
    canvas: { postMessage: (m) => b.forEach((f) => f({ data: clone(m) })), addEventListener: (_t, f) => { a.push(f); } },
    tab: { postMessage: (m) => a.forEach((f) => f({ data: clone(m) })), addEventListener: (_t, f) => { b.push(f); } },
  };
}
const row = (t: number, text: string): ActivityRow => ({ t, kind: 'note', label: 'Note', text, who: '', sim: false });

describe('newest entry on top', () => {
  it('addRow puts the most recent first and pushes older rows down', () => {
    let rows: ActivityRow[] = [];
    for (const [t, s] of [[1, 'first'], [2, 'second'], [3, 'third']] as const) rows = addRow(rows, row(t, s));
    expect(rows.map((r) => r.text)).toEqual(['third', 'second', 'first']);
  });

  it('a late-arriving older row still lands in time order; same-instant rows keep the later one on top', () => {
    let rows = [row(30, 'c'), row(10, 'a')];
    rows = addRow(rows, row(20, 'b'));
    expect(rows.map((r) => r.text)).toEqual(['c', 'b', 'a']);
    rows = addRow(rows, row(30, 'c2'));
    expect(rows.map((r) => r.text)).toEqual(['c2', 'c', 'b', 'a']);
  });

  it('caps the list by dropping the oldest', () => {
    let rows: ActivityRow[] = [];
    for (let i = 0; i < ACTIVITY_KEEP + 5; i++) rows = addRow(rows, row(i, `r${i}`));
    expect(rows).toHaveLength(ACTIVITY_KEEP);
    expect(rows[0].text).toBe(`r${ACTIVITY_KEEP + 4}`);
    expect(rows.at(-1)!.text).toBe('r5');
  });

  it('a snapshot (oldest → newest) is merged under anything newer the tab already has', () => {
    const merged = mergeSnapshot([row(50, 'live'), row(20, 'dup-b')], [row(10, 'a'), row(20, 'b'), row(30, 'c')]);
    expect(merged.map((r) => r.text)).toEqual(['live', 'c', 'b', 'a']);
  });

  it('the in-app drawer\'s live log is newest-first too', () => {
    const log = createActivityLog(null);
    log.push({ kind: 'click', text: 'Click', target: 'Save', at: 1 });
    log.push({ kind: 'gesture', text: 'Thumbs up → press', at: 2 });
    expect(log.list().map((e) => e.kind)).toEqual(['gesture', 'click']);
  });

  it('the drawer\'s terminals put the newest line on top', () => {
    type El = { cls: string; kids: El[]; hidden: boolean; innerHTML: string; scrollTop: number; scrollHeight: number; childElementCount: number;
      className: string; classList: { add(): void; remove(): void }; querySelector(s: string): El | null; prepend(c: El): void; append(c: El): void; textContent: string };
    const made = new Map<string, El>();
    const mk = (cls: string): El => {
      const e: El = {
        cls, kids: [], hidden: false, innerHTML: '', scrollTop: 99, scrollHeight: 500, className: '', textContent: '',
        get childElementCount() { return e.kids.length; },
        classList: { add() {}, remove() {} },
        querySelector(s: string) { const k = `${cls} ${s}`; if (!made.has(k)) made.set(k, mk(k)); return made.get(k)!; },
        prepend(c) { e.kids.unshift(c); }, append(c) { e.kids.push(c); },
      };
      return e;
    };
    const panel = mk('ai');
    const doc = { createElement: () => mk('line') };
    const panels = mountModelPanels(panel as never, doc as never);
    const nano = panels.forEngine('nano');
    nano.log('received', 'first');
    nano.log('plan', 'second');
    nano.log('done', 'third');
    const lines = panel.querySelector('.mc-terminal-nano')!.querySelector('.mc-term-lines')!;
    expect(lines.kids.map((l) => /mc-term-detail">([^<]*)</.exec(l.innerHTML)![1])).toEqual(['third', 'second', 'first']);
    expect(panel.querySelector('.mc-terminal-nano')!.querySelector('.mc-term-body')!.scrollTop).toBe(0);
    expect(MODEL_PANELS_HTML).toContain('mc-term-lines');
  });
});

describe('rows are colour-coded by kind, like the monitor stream', () => {
  it('heard / handed off / sent / kept / blocked', () => {
    expect(rowFromLog('nano', 'received', 'make a dashboard', 1)).toMatchObject({ kind: 'heard', label: 'Heard', who: 'Nano', text: 'make a dashboard' });
    expect(rowFromLog('gemini', 'received', 'plan for [Client A]', 1)).toMatchObject({ kind: 'sent', label: 'Sent', who: 'Gemini' });
    expect(rowFromLog('nano', 'handoff', '→ gemini: plan the pack', 1)).toMatchObject({ kind: 'handoff', label: 'Handed off', text: '→ Gemini: plan the pack' });
    expect(rowFromLog('gemini', 'handoff', '← nano: plan the pack', 1)).toMatchObject({ kind: 'handoff', label: 'Picked up' });
    expect(rowFromLog('nano', 'done', 'checked here. Nothing sent.', 1)).toMatchObject({ kind: 'kept', label: 'Kept on device' });
    expect(rowFromLog('gemini', 'done', 'board ready', 1)).toMatchObject({ kind: 'done', label: 'Done' });
    expect(rowFromLog('nano', 'fail', 'Lamps go from 10 to 100 %. Nothing changed.', 1)).toMatchObject({ kind: 'fail', label: 'Blocked' });
    expect(rowFromLog('gemini', 'fail', 'quota', 1)).toMatchObject({ kind: 'fail', label: 'Failed' });
    expect(rowFromLog('rules', 'note', 'refused: Lamps go from 10 to 100 %. Nothing changed.', 1)).toMatchObject({ kind: 'fail', label: 'Blocked', who: 'Rules', text: 'Lamps go from 10 to 100 %. Nothing changed.' });
    expect(rowFromLog('nano', 'redact', 'Sharma → [Client A]', 1)).toMatchObject({ kind: 'redact', label: 'Redacted' });
    expect(rowFromLog('nano', 'plan', 'two lamps', 1)).toMatchObject({ kind: 'work', label: 'Planning' });
  });

  it('a SIM tag is lifted into a flag, never dropped; a phone\'s line says which phone', () => {
    expect(rowFromLog('nano', 'note', 'SIM · proposed Desk lamp to 500%', 1)).toMatchObject({ sim: true, text: 'proposed Desk lamp to 500%' });
    expect(rowFromLog('apple', 'received', 'lights on', 1, 'iPhone').who).toBe('iPhone · Apple');
  });

  it('drawer entries (clicks, gestures, Spotify) are rows too', () => {
    expect(rowFromEntry({ kind: 'click', text: 'Click · Save', target: 'Save', at: 5 })).toMatchObject({ t: 5, kind: 'click', label: 'Click', text: 'Save' });
    expect(rowFromEntry({ kind: 'gesture', text: 'Thumbs up → press', at: 6 })).toMatchObject({ kind: 'gesture', label: 'Gesture', text: 'Thumbs up → press' });
    expect(rowFromEntry({ kind: 'spotify', text: 'Spotify search', at: 7 })).toMatchObject({ kind: 'spotify', label: 'Spotify' });
  });
});

describe('live over the existing feed channel', () => {
  it('engine log lines and drawer entries reach the tab as they happen, newest first', () => {
    const ch = pair();
    const cast = createActivityBroadcast({ channel: ch.canvas });
    const seen: string[][] = [];
    const store = createActivityStore(ch.tab, (rows) => seen.push(rows.map((r) => `${r.label}:${r.text}`)));
    cast.feed.publish({ kind: 'log', engine: 'nano', verb: 'received', text: 'turn on the lamp' });
    cast.entry({ kind: 'click', text: 'Click · Turn on', target: 'Turn on', at: Date.now() + 1 });
    cast.feed.publish({ kind: 'state', engine: 'nano', state: 'working' }); // not a log line: no row
    cast.feed.publish({ kind: 'handoff', from: 'nano', to: 'gemini', text: 'x' }); // already logged in both terminals
    expect(seen.at(-1)).toEqual(['Click:Turn on', 'Heard:turn on the lamp']);
    expect(store.rows()).toHaveLength(2);
  });

  it('a tab that opens late says hello and gets everything so far', () => {
    const ch = pair();
    const cast = createActivityBroadcast({ channel: ch.canvas, sim: true });
    cast.feed.publish({ kind: 'log', engine: 'nano', verb: 'received', text: 'one' });
    cast.feed.publish({ kind: 'log', engine: 'nano', verb: 'done', text: 'two' });
    let last: { rows: string[]; sim: boolean } | null = null;
    const store = createActivityStore(ch.tab, (rows, _added, sim) => { last = { rows: rows.map((r) => r.text), sim }; });
    expect(store.rows()).toEqual([]);
    store.hello();
    expect(last).toEqual({ rows: ['two', 'one'], sim: true });
    cast.feed.publish({ kind: 'log', engine: 'gemini', verb: 'received', text: 'three' });
    expect(last!.rows).toEqual(['three', 'two', 'one']);
  });

  it('shares the channel without confusing the monitor: activity messages are not AI feed messages', () => {
    const sent: unknown[] = [];
    const channel: FeedChannel = { postMessage: (m) => { sent.push(m); }, addEventListener: () => {} };
    createActivityBroadcast({ channel }).entry({ kind: 'note', text: 'hi', at: 1 });
    expect(isActivityMsg(sent[0])).toBe(true);
    expect(isAiFeedMsg(sent[0])).toBe(false);
    // …and the feed's own messages are not activity rows.
    const feedSent: unknown[] = [];
    createAiFeed({ channel: { postMessage: (m) => { feedSent.push(m); }, addEventListener: () => {} } }).publish({ kind: 'bytes', total: 1 });
    expect(isActivityMsg(feedSent[0])).toBe(false);
  });

  it('no channel (a phone shell) is a no-op', () => {
    const cast = createActivityBroadcast({ channel: null });
    expect(() => cast.entry({ kind: 'note', text: 'x', at: 1 })).not.toThrow();
    expect(cast.history()).toHaveLength(1);
  });
});

describe('the activity page', () => {
  interface El { tag: string; className: string; textContent: string; hidden: boolean; kids: El[]; attrs: Record<string, string>; setAttribute(n: string, v: string): void; appendChild(c: El): El }
  const doc = {
    createElement(tag: string): El {
      let textValue = '';
      const el = { tag, className: '', hidden: false, kids: [] as El[], attrs: {} as Record<string, string>,
        setAttribute(n: string, v: string) { el.attrs[n] = v; }, appendChild(c: El) { el.kids.push(c); return c; } } as unknown as El;
      Object.defineProperty(el, 'textContent', { get: () => textValue, set: (v: string) => { textValue = v; el.kids.length = 0; } });
      return el;
    },
  };
  const find = (el: El, cls: string): El[] => [...(el.className.split(' ').includes(cls) ? [el] : []), ...el.kids.flatMap((k) => find(k, cls))];

  it('renders rows newest-first in the DOM, each tagged with its kind, and marks only the new row', () => {
    const ch = pair();
    const cast = createActivityBroadcast({ channel: ch.canvas });
    const root = doc.createElement('main');
    const page = mountActivityPage(root as never, ch.tab, doc as never);
    expect(find(root, 'act-empty')[0].hidden).toBe(false);
    cast.feed.publish({ kind: 'log', engine: 'nano', verb: 'received', text: 'make it blue' });
    cast.feed.publish({ kind: 'log', engine: 'gemini', verb: 'received', text: 'plan' });
    cast.feed.publish({ kind: 'log', engine: 'nano', verb: 'fail', text: 'out of range' });
    const rows = find(root, 'act-row');
    expect(rows.map((r) => r.attrs['data-kind'])).toEqual(['fail', 'sent', 'heard']);
    expect(rows.map((r) => find(r, 'act-text')[0].textContent)).toEqual(['out of range', 'plan', 'make it blue']);
    expect(rows.map((r) => r.className.includes('is-new'))).toEqual([true, false, false]);
    expect(find(root, 'act-empty')[0].hidden).toBe(true);
    expect(find(root, 'act-live')[0].textContent).toBe('Live');
    expect(page.rows()).toHaveLength(3);
  });
});
