// The AI monitor: a second-display view of Nano (left) and Gemini (right), the
// handoffs and redactions between them (centre lane) and the honest ledger
// total. It only renders what the canvas broadcasts over the feed channel —
// it never invents a line or a number. Built with createElement/textContent
// only so it runs under the suite's node-only fake DOM.
import './monitor.css';
import { FEED_CHANNEL, handoffLabel, isAiFeedMsg, isPhoneTagged, type AiFeedMsg, type FeedChannel } from '../canvas/aiFeed';
import type { EngineId } from '../canvas/aiTurn';
import type { EngineState } from '../canvas/engineBar';
import { formatFooterBytes } from '../canvas/modelPanels';

export const MONITOR_MAX_LINES = 200;
const LANE_MAX = 60;

const STATE_TEXT: Record<EngineState, string> = {
  idle: 'Ready', working: 'Working', done: 'Done', queued: 'Queued', failed: 'Failed', unavailable: 'Unavailable',
};
const NAME: Record<EngineId, string> = { nano: 'Nano', gemini: 'Gemini' };
const WHERE: Record<EngineId, string> = { nano: 'on this device', gemini: 'cloud' };
const ENGINES: readonly EngineId[] = ['nano', 'gemini'];

export interface Monitor { el: HTMLElement }

export function mountMonitor(root: HTMLElement, channel: FeedChannel | null): Monitor {
  const doc = root.ownerDocument;
  const make = <T extends HTMLElement>(tag: string, cls: string, text?: string): T => {
    const e = doc.createElement(tag) as T;
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const wrap = make<HTMLElement>('div', 'mon');
  const top = make<HTMLElement>('header', 'mon-top');
  top.append(make('span', 'mon-title', 'Mendcraft · AI monitor'));
  const bytes = make<HTMLElement>('div', 'mon-bytes', formatFooterBytes(0));
  bytes.setAttribute('role', 'status');
  top.append(bytes);
  const empty = make<HTMLElement>('p', 'mon-empty', 'Waiting for the canvas…');
  const stage = make<HTMLElement>('div', 'mon-stage');

  const cols = {} as Record<EngineId, { col: HTMLElement; state: HTMLElement; body: HTMLElement }>;
  const buildCol = (engine: EngineId): HTMLElement => {
    const col = make<HTMLElement>('section', 'mon-col');
    col.setAttribute('data-engine', engine);
    col.setAttribute('data-state', 'idle');
    const head = make('div', 'mon-head');
    const dot = make('span', 'mon-dot');
    dot.setAttribute('aria-hidden', 'true');
    const names = make('div', 'mon-names');
    names.append(make('strong', 'mon-name', NAME[engine]), make('span', 'mon-where', WHERE[engine]));
    const state = make('span', 'mon-state', STATE_TEXT.idle);
    head.append(dot, names, state);
    const body = make<HTMLElement>('div', 'mon-lines');
    col.append(head, body);
    cols[engine] = { col, state, body };
    return col;
  };
  const lane = make<HTMLElement>('div', 'mon-lane');
  lane.setAttribute('aria-label', 'Handoffs and redactions');
  stage.append(buildCol('nano'), lane, buildCol('gemini'));
  wrap.append(top, empty, stage);
  root.append(wrap);

  const cap = (list: HTMLElement, max: number) => {
    while (list.children.length > max) (list.children[0] as HTMLElement).remove();
  };
  const scrollEnd = (e: HTMLElement) => { e.scrollTop = e.scrollHeight; };

  const addLine = (engine: EngineId, verb: string, text: string) => {
    const p = make('p', `mon-line mon-line--${verb}`);
    p.append(make('span', 'mon-verb', verb), make('span', 'mon-text', text));
    const { body } = cols[engine];
    body.append(p);
    cap(body, MONITOR_MAX_LINES);
    scrollEnd(body);
  };
  const addLane = (kind: 'handoff' | 'redact', text: string) => {
    lane.append(make('p', `mon-note mon-note--${kind}`, text));
    cap(lane, LANE_MAX);
    scrollEnd(lane);
  };
  const setState = (engine: EngineId, state: EngineState) => {
    cols[engine].col.setAttribute('data-state', state);
    cols[engine].state.textContent = STATE_TEXT[state] ?? String(state);
  };
  const setTotal = (n: number) => { bytes.textContent = formatFooterBytes(n); };
  const clear = () => {
    ENGINES.forEach((e) => { cols[e].body.innerHTML = ''; setState(e, 'idle'); });
    lane.innerHTML = '';
    setTotal(0);
  };
  const splitTab = (s: string): [string, string] => {
    const i = s.indexOf('\t');
    return i < 0 ? ['note', s] : [s.slice(0, i), s.slice(i + 1)];
  };

  // Follow the newest tab: a different sender takes over only if its message
  // is not older than the current one. Any tab can win again later.
  let currentSid: string | null = null;
  let currentT = 0;
  const hello = () => { try { channel?.postMessage({ v: 1, sid: 'monitor', t: Date.now(), kind: 'hello' }); } catch { /* best effort */ } };

  const apply = (m: AiFeedMsg) => {
    switch (m.kind) {
      case 'log': if (m.engine === 'apple' || m.engine === 'rules') break; addLine(m.engine, m.verb, m.text); if (m.verb === 'redact') addLane('redact', m.text); break;
      case 'state': if (m.engine === 'apple' || m.engine === 'rules') break; if (m.state in STATE_TEXT) setState(m.engine, m.state); break;
      case 'handoff': addLane('handoff', handoffLabel(m.from, m.to, m.text)); break;
      case 'bytes': setTotal(m.total); break;
      case 'snapshot':
        clear();
        ENGINES.forEach((e) => {
          const s = m.engines[e];
          s.lines.forEach((l) => { const [v, t] = splitTab(l); addLine(e, v, t); });
          if (s.state in STATE_TEXT) setState(e, s.state);
        });
        (m.lane ?? []).forEach((l) => { const [k, t] = splitTab(l); addLane(k === 'redact' ? 'redact' : 'handoff', t); });
        setTotal(m.total);
        break;
      case 'hello': break;
    }
  };

  channel?.addEventListener('message', (e) => {
    if (!isAiFeedMsg(e.data)) return;
    const m = e.data;
    if (m.kind === 'hello') return;
    // Phone-tagged events (device: iphone/android) are for the per-device view;
    // this two-column layout is laptop-only, so never mix them in here.
    if (isPhoneTagged(m)) return;
    if (currentSid !== m.sid) {
      if (currentSid !== null && m.t < currentT) return;
      const had = currentSid !== null;
      currentSid = m.sid;
      currentT = 0;
      if (had) { clear(); if (m.kind !== 'snapshot') hello(); }
    }
    currentT = Math.max(currentT, m.t);
    empty.hidden = true;
    apply(m);
  });

  hello();
  return { el: wrap };
}

if (typeof document !== 'undefined' && document.getElementById('monitor')) {
  let channel: FeedChannel | null = null;
  try { channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(FEED_CHANNEL) : null; } catch { channel = null; }
  mountMonitor(document.getElementById('monitor')!, channel);
}
