import { describe, expect, it } from 'vitest';
import { createAiFeed, type FeedChannel } from '../../src/canvas/aiFeed';
import { mountMonitor, MONITOR_MAX_LINES } from '../../src/monitor/monitorMain';

/** Minimal fake DOM (the suite runs under Vitest's node environment). */
class FakeEl {
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  hidden = false;
  textContent = '';
  className = '';
  scrollTop = 0;
  scrollHeight = 0;
  ownerDocument: unknown;
  constructor(public tag: string, doc: unknown) { this.ownerDocument = doc; }
  set innerHTML(_v: string) { this.children.forEach((c) => { c.parent = null; }); this.children = []; }
  get innerHTML() { return ''; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  append(...els: FakeEl[]) { els.forEach((e) => { e.parent = this; this.children.push(e); }); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  all(): FakeEl[] { return this.children.flatMap((c) => [c, ...c.all()]); }
  has(cls: string) { return this.className.split(/\s+/).includes(cls); }
  text(): string { return this.textContent + this.children.map((c) => c.text()).join(' '); }
}
const doc = { createElement: (t: string) => new FakeEl(t, doc) };

/** Two channel ends wired like BroadcastChannel (no self-delivery). */
function bus() {
  type L = (e: { data: unknown }) => void;
  const a: L[] = []; const b: L[] = [];
  const mk = (mine: L[], theirs: L[]): FeedChannel => ({
    postMessage: (m) => { theirs.forEach((f) => f({ data: JSON.parse(JSON.stringify(m)) })); },
    addEventListener: (_t, f) => { mine.push(f); },
  });
  return { canvas: mk(a, b), monitor: mk(b, a), toMonitor: (m: unknown) => b.forEach((f) => f({ data: m })) };
}

function setup(withFeed = true) {
  const ch = bus();
  const root = new FakeEl('main', doc);
  const feed = createAiFeed({ channel: withFeed ? ch.canvas : { postMessage() {}, addEventListener() {} } });
  mountMonitor(root as unknown as HTMLElement, ch.monitor);
  const col = (e: string) => root.all().find((x) => x.has('mon-col') && x.attrs['data-engine'] === e)!;
  const find = (cls: string) => root.all().find((x) => x.has(cls))!;
  return { ch, feed, root, col, find };
}

describe('AI monitor', () => {
  it('renders a nano log line in the left column and none in the right', () => {
    const { feed, col } = setup();
    feed.publish({ kind: 'log', engine: 'nano', verb: 'received', text: 'plan the room' });
    expect(col('nano').text()).toContain('plan the room');
    expect(col('gemini').text()).not.toContain('plan the room');
  });

  it('shows handoffs and redactions in the centre lane', () => {
    const { feed, find } = setup();
    feed.publish({ kind: 'handoff', from: 'nano', to: 'gemini', text: 'plan the Kannada pack' });
    feed.publish({ kind: 'log', engine: 'nano', verb: 'redact', text: 'Mrs Sharma → [PERSON_1]' });
    const lane = find('mon-lane').text();
    expect(lane).toContain('Nano → Gemini: plan the Kannada pack');
    expect(lane).toContain('[PERSON_1]');
  });

  it('shows the honest ledger total', () => {
    const { feed, find } = setup();
    feed.publish({ kind: 'bytes', total: 2253 });
    expect(find('mon-bytes').textContent).toBe('2.2 KB sent to cloud');
  });

  it('state changes drive the column dot/state', () => {
    const { feed, col } = setup();
    feed.publish({ kind: 'state', engine: 'gemini', state: 'working', line: 'x' });
    expect(col('gemini').attrs['data-state']).toBe('working');
  });

  it('hides the empty state once something arrives', () => {
    const { ch, find } = setup(false);
    expect(find('mon-empty').hidden).toBe(false);
    ch.toMonitor({ v: 1, sid: 's', t: 1, kind: 'bytes', total: 0 });
    expect(find('mon-empty').hidden).toBe(true);
  });

  it('a monitor opened mid-turn gets a snapshot via hello', () => {
    const ch = bus();
    const feed = createAiFeed({ channel: ch.canvas });
    feed.publish({ kind: 'log', engine: 'nano', verb: 'plan', text: 'early line' });
    feed.publish({ kind: 'state', engine: 'nano', state: 'working' });
    feed.publish({ kind: 'handoff', from: 'nano', to: 'gemini', text: 'go' });
    feed.publish({ kind: 'bytes', total: 900 });
    const root = new FakeEl('main', doc);
    mountMonitor(root as unknown as HTMLElement, ch.monitor);
    const all = root.all();
    const nano = all.find((x) => x.has('mon-col') && x.attrs['data-engine'] === 'nano')!;
    expect(nano.text()).toContain('early line');
    expect(nano.attrs['data-state']).toBe('working');
    expect(all.find((x) => x.has('mon-lane'))!.text()).toContain('Nano → Gemini: go');
    expect(all.find((x) => x.has('mon-bytes'))!.textContent).toBe('900 B sent to cloud');
  });

  it('the feed answers hello with a snapshot and notifies onHello', () => {
    const ch = bus();
    const feed = createAiFeed({ channel: ch.canvas });
    let hellos = 0; feed.onHello(() => { hellos++; });
    const got: Array<{ kind?: string }> = [];
    ch.monitor.addEventListener('message', (e) => got.push(e.data as { kind?: string }));
    ch.monitor.postMessage({ v: 1, sid: 'm', t: 1, kind: 'hello' });
    expect(got.map((g) => g.kind)).toEqual(['snapshot']);
    expect(hellos).toBe(1);
  });

  it('follows the newest tab and ignores an older sid afterwards', () => {
    const { ch, col } = setup(false);
    const m = (sid: string, t: number, text: string) => ({ v: 1, sid, t, kind: 'log', engine: 'nano', verb: 'note', text });
    ch.toMonitor(m('A', 100, 'from A'));
    ch.toMonitor(m('B', 200, 'from B'));
    ch.toMonitor(m('A', 300, 'A again'));
    const t = col('nano').text();
    expect(t).toContain('from B');
    expect(t).not.toContain('from A');
    expect(t).not.toContain('A again');
  });

  it('ignores a different sid whose message is older than the current tab', () => {
    const { ch, col } = setup(false);
    const m = (sid: string, t: number, text: string) => ({ v: 1, sid, t, kind: 'log', engine: 'nano', verb: 'note', text });
    ch.toMonitor(m('B', 200, 'from B'));
    ch.toMonitor(m('A', 100, 'stale A'));
    expect(col('nano').text()).toContain('from B');
    expect(col('nano').text()).not.toContain('stale A');
  });

  it('ignores unknown and malformed messages', () => {
    const { ch, col, find } = setup(false);
    [null, 'x', 5, {}, { v: 2, sid: 's', t: 1, kind: 'log' }, { v: 1, sid: 's', t: 1, kind: 'nope' },
      { v: 1, sid: 's', t: 1, kind: 'log', engine: 'bogus', verb: 'a', text: 'b' },
      { v: 1, sid: 's', t: 1, kind: 'bytes', total: 'many' },
      { v: 1, sid: 's', t: 1, kind: 'snapshot', total: 1 }].forEach((d) => ch.toMonitor(d));
    expect(col('nano').children[1]!.children.length).toBe(0);
    expect(find('mon-empty').hidden).toBe(false);
    expect(find('mon-bytes').textContent).toBe('0 B sent to cloud');
  });

  it('caps lines per column', () => {
    const { feed, col } = setup();
    for (let i = 0; i < MONITOR_MAX_LINES + 15; i++) feed.publish({ kind: 'log', engine: 'gemini', verb: 'note', text: `l${i}` });
    const lines = col('gemini').children[1]!.children;
    expect(lines.length).toBe(MONITOR_MAX_LINES);
    expect(lines[0]!.text()).toContain('l15');
  });
});
