import { describe, expect, it } from 'vitest';
import { createAiFeed, type FeedChannel } from '../../src/canvas/aiFeed';
import {
  CARRY_MS, createLedger, deriveHeadline, handoffText, lineStyle, mountMonitor, MONITOR_MAX_LINES, parseDeviceParam, parseRedaction, sentenceCase, stripSim,
} from '../../src/monitor/monitorMain';

/** Minimal fake DOM (the suite runs under Vitest's node environment). */
class FakeEl {
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  hidden = false;
  textContent = '';
  className = '';
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
  find(cls: string): FakeEl | undefined { return this.all().find((x) => x.has(cls)); }
  findAll(cls: string): FakeEl[] { return this.all().filter((x) => x.has(cls)); }
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

function setup(opts: { withFeed?: boolean; device?: 'laptop' | 'iphone' | 'android' } = {}) {
  const ch = bus();
  const root = new FakeEl('main', doc);
  const feed = createAiFeed({ channel: opts.withFeed === false ? { postMessage() {}, addEventListener() {} } : ch.canvas });
  const mon = mountMonitor(root as unknown as HTMLElement, ch.monitor, { device: opts.device, keys: null });
  const view = (d: string) => root.all().find((x) => x.has('mon-view') && x.attrs['data-device'] === d)!;
  const half = (d: string, side: 'device' | 'cloud') => view(d).find(`mon-half--${side}`)!;
  const find = (cls: string) => root.find(cls)!;
  // a phone event, shaped like the phone-feed republisher's: it reaches the
  // monitor through the laptop's own feed (same session id)
  let t = 1e12;
  const phone = (m: Record<string, unknown>) => (opts.withFeed === false
    ? ch.toMonitor({ v: 1, sid: 'phone-sid', t: t++, ...m })
    : feed.publish(m as Parameters<typeof feed.publish>[0]));
  return { ch, feed, root, mon, view, half, find, phone };
}

// The laptop's real Kannada turn, in the order canvasApp publishes it.
function kannadaTurn(feed: ReturnType<typeof createAiFeed>, opts: { redact?: string; total?: number } = {}) {
  feed.publish({ kind: 'bytes', total: opts.total ?? 2253 });
  feed.publish({ kind: 'log', engine: 'nano', verb: 'received', text: 'add kannada' });
  if (opts.redact) feed.publish({ kind: 'log', engine: 'nano', verb: 'redact', text: opts.redact });
  feed.publish({ kind: 'log', engine: 'gemini', verb: 'received', text: 'Translate the smart-canvas UI into Kannada.' });
  feed.publish({ kind: 'log', engine: 'gemini', verb: 'note', text: 'SIM · Kannada sentence: Deep understands it better.' });
  feed.publish({ kind: 'log', engine: 'nano', verb: 'handoff', text: '→ gemini: plan the Kannada pack — too complex for on-device' });
  feed.publish({ kind: 'handoff', from: 'nano', to: 'gemini', text: 'plan the Kannada pack — too complex for on-device' });
}

describe('monitor derivations', () => {
  it('headlines come from the latest meaningful line', () => {
    expect(deriveHeadline('nano', 'received', 'add kannada')?.headline).toBe('Add Kannada');
    expect(deriveHeadline('nano', 'handoff', '→ gemini: plan the Kannada pack — too complex for on-device')?.headline)
      .toBe('Handing off: too complex for on-device');
    expect(deriveHeadline('gemini', 'handoff', '← nano: plan the Kannada pack — too complex for on-device')?.headline)
      .toBe('Plan the Kannada pack');
    expect(deriveHeadline('gemini', 'replied', 'Kannada pack ready · 19 swaps')?.headline).toBe('Kannada pack ready');
    expect(deriveHeadline('gemini', 'handoff', '→ nano: apply 19 label swaps locally')?.headline).toBe('Handing back: apply 19 label swaps locally');
    const fail = deriveHeadline('nano', 'fail', 'Lamps go from 10 to 100 %. Nothing changed.');
    expect(fail).toMatchObject({ headline: 'Blocked — Lamps go from 10 to 100 %. Nothing changed.', tone: 'fail' });
    expect(deriveHeadline('nano', 'note', 'SIM · Checked on this device. Nothing sent.')).toBeNull();
  });

  it('SIM is stripped from headlines but reported, never dropped', () => {
    expect(stripSim('SIM · proposed Main light to 500%')).toEqual({ text: 'proposed Main light to 500%', sim: true });
    expect(stripSim('2 tiles filled').sim).toBe(false);
    expect(deriveHeadline('nano', 'plan', 'SIM · group the lights')?.headline).toBe('Group the lights');
    expect(sentenceCase('add  kannada')).toBe('Add Kannada');
  });

  it('redaction tokens come only from a real redact line', () => {
    expect(parseRedaction('Sharma → [Client A]')).toEqual({ name: 'Sharma', token: '[Client A]' });
    expect(parseRedaction('no arrow here')).toBeNull();
    expect(parseRedaction('Sharma → Client A')).toBeNull();
    // a phone's redact line carries no name: nothing to strike
    expect(parseRedaction('name kept on the phone → [Client A]')).toBeNull();
  });

  it('?device= picks a tab', () => {
    expect(parseDeviceParam('?device=iphone')).toBe('iphone');
    expect(parseDeviceParam('?x=1&device=Android')).toBe('android');
    expect(parseDeviceParam('?device=toaster')).toBeNull();
    expect(parseDeviceParam('')).toBeNull();
  });
});

describe('monitor ledger', () => {
  it('a packet crosses only when the cloud received the turn AND bytes grew', () => {
    const l = createLedger();
    expect(l.bytes('laptop', 2253)).toEqual([]); // nothing received yet: pending
    expect(l.log('laptop', 'nano', 'received', 'add kannada')).toEqual([]);
    expect(l.log('laptop', 'nano', 'redact', 'Sharma → [Client A]')).toEqual([]);
    const fx = l.log('laptop', 'gemini', 'received', 'payload');
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({ kind: 'packet', dir: 'out', bytes: 2253, device: 'laptop' });
    expect((fx[0] as { redactions: unknown[] }).redactions).toHaveLength(1);
    // the same bytes never cross twice
    expect(l.log('laptop', 'gemini', 'received', 'payload')).toEqual([]);
  });

  it('no bytes delta, no packet', () => {
    const l = createLedger();
    l.bytes('laptop', 500);
    l.log('laptop', 'nano', 'received', 'a');
    l.log('laptop', 'gemini', 'received', 'p'); // crosses 500
    l.bytes('laptop', 500); // same total
    l.log('laptop', 'nano', 'received', 'b');
    expect(l.log('laptop', 'gemini', 'received', 'p')).toEqual([]);
  });

  it('late bytes (after the cloud received it) still cross once', () => {
    const l = createLedger();
    l.log('android', 'gemini', 'received', 'turn the hallway light off');
    expect(l.bytes('android', 900)).toMatchObject([{ kind: 'packet', dir: 'out', bytes: 900, device: 'android' }]);
  });

  it('a reply packet only on a real cloud → device handoff', () => {
    const l = createLedger();
    expect(l.handoff('laptop', 'gemini', 'nano', 'apply 19 label swaps locally')).toMatchObject([{ kind: 'packet', dir: 'back' }]);
    expect(l.handoff('laptop', 'nano', 'gemini', 'plan')).toEqual([]);
  });

  it('kept on device: one per on-device turn with 0 bytes and no Gemini', () => {
    const l = createLedger();
    l.log('laptop', 'nano', 'received', 'connect everything in this room');
    expect(l.log('laptop', 'nano', 'done', '2 tiles filled')).toEqual([{ kind: 'kept', device: 'laptop', refused: false }]);
    expect(l.log('laptop', 'nano', 'done', 'again')).toEqual([]); // counted once
    // the next turn goes to Gemini: not kept
    l.bytes('laptop', 2306);
    l.log('laptop', 'nano', 'received', 'connect everything in this room');
    l.log('laptop', 'gemini', 'received', 'payload');
    expect(l.log('laptop', 'nano', 'done', 'x')).toEqual([]);
    // a refusal decided on the device counts, flagged
    l.log('laptop', 'nano', 'received', 'set the main light to 500% brightness');
    expect(l.log('laptop', 'nano', 'fail', 'Lamps go from 10 to 100 %.')).toEqual([{ kind: 'kept', device: 'laptop', refused: true }]);
    expect(l.keptTotal()).toBe(2);
    // a done line with no turn open is not a task
    expect(createLedger().log('laptop', 'nano', 'done', 'x')).toEqual([]);
  });

  it('a handoff to the cloud mid-turn disqualifies the turn', () => {
    const l = createLedger();
    l.log('iphone', 'rules', 'received', 'request received');
    l.handoff('iphone', 'apple', 'gemini', 'too big');
    expect(l.log('iphone', 'apple', 'done', 'x')).toEqual([]);
  });

  it('bytes are per device; the total is their sum', () => {
    const l = createLedger();
    l.bytes('laptop', 1000);
    l.bytes('iphone', 300);
    l.bytes('laptop', 1200);
    expect(l.get('laptop').lastTotal).toBe(1200);
    expect(l.get('iphone').lastTotal).toBe(300);
    expect(l.sentTotal()).toBe(1500);
  });
});

describe('AI monitor (DOM)', () => {
  it('renders nano on this device and gemini in the cloud half', () => {
    const { feed, half } = setup();
    feed.publish({ kind: 'log', engine: 'nano', verb: 'received', text: 'plan the room' });
    expect(half('laptop', 'device').text()).toContain('plan the room');
    expect(half('laptop', 'device').find('mon-headline')!.textContent).toBe('Plan the room');
    expect(half('laptop', 'cloud').text()).not.toContain('plan the room');
  });

  it('the Kannada turn: headline, one packet with the real size, no fake redaction', () => {
    const { feed, half, view, find } = setup();
    kannadaTurn(feed);
    expect(half('laptop', 'device').find('mon-headline')!.textContent).toBe('Handing off: too complex for on-device');
    const packets = view('laptop').findAll('mon-packet');
    expect(packets).toHaveLength(1);
    expect(packets[0]!.attrs['data-bytes']).toBe('2253');
    expect(packets[0]!.text()).toContain('2.2 KB');
    expect(packets[0]!.text()).not.toContain('redacted');
    expect(view('laptop').findAll('mon-redact-row')).toHaveLength(0);
    expect(find('mon-bytes').textContent).toBe('2.2 KB sent to cloud');
    expect(find('mon-total--cloud').text()).toContain('2.2 KB');
  });

  it('a real redact line shows name → token and labels the packet', () => {
    const { feed, view } = setup();
    kannadaTurn(feed, { redact: 'Sharma → [Client A]' });
    const row = view('laptop').find('mon-redact-row')!;
    expect(row.find('mon-redact-name')!.text()).toContain('Sharma');
    expect(row.find('mon-redact-token')!.textContent).toBe('[Client A]');
    const pk = view('laptop').find('mon-packet')!;
    expect(pk.text()).toContain('1 name redacted');
    expect(pk.attrs['data-after-redact']).toBe('true');
  });

  it('a 0-byte nano turn settles as "Stayed on this device · 0 B"', () => {
    const { feed, view, find } = setup();
    feed.publish({ kind: 'bytes', total: 0 });
    feed.publish({ kind: 'log', engine: 'nano', verb: 'received', text: 'connect everything in this room' });
    feed.publish({ kind: 'log', engine: 'nano', verb: 'done', text: '2 tiles filled' });
    expect(view('laptop').findAll('mon-packet')).toHaveLength(0);
    expect(view('laptop').find('mon-settle')!.text()).toContain('Stayed on this device · 0 B');
    expect(find('mon-total--kept').find('mon-total-num')!.textContent).toBe('1');
  });

  it('a nano refusal: red state, Blocked headline, shockwave, nothing sent', () => {
    const { feed, half, view } = setup();
    feed.publish({ kind: 'log', engine: 'nano', verb: 'received', text: 'set the main light to 500% brightness' });
    feed.publish({ kind: 'log', engine: 'nano', verb: 'note', text: 'SIM · proposed Main light to 500%. Checking it before anything changes.' });
    feed.publish({ kind: 'log', engine: 'nano', verb: 'fail', text: 'Lamps go from 10 to 100 %. Nothing changed.' });
    const dev = half('laptop', 'device');
    expect(dev.attrs['data-state']).toBe('failed');
    expect(dev.find('mon-headline')!.textContent).toBe('Blocked — Lamps go from 10 to 100 %. Nothing changed.');
    expect(dev.find('mon-headline')!.attrs['data-tone']).toBe('fail');
    expect(dev.find('mon-shock')).toBeTruthy();
    expect(dev.find('mon-sim')!.hidden).toBe(false); // the SIM tag stays visible
    expect(view('laptop').findAll('mon-packet')).toHaveLength(0);
    expect(view('laptop').find('mon-settle')!.text()).toContain('0 B sent');
  });

  it('state messages drive the pill and the tab dot', () => {
    const { feed, half, root } = setup();
    feed.publish({ kind: 'state', engine: 'gemini', state: 'working', line: 'x' });
    expect(half('laptop', 'cloud').attrs['data-state']).toBe('working');
    expect(half('laptop', 'cloud').find('mon-pill')!.text()).toContain('Working');
    const tab = root.all().find((x) => x.has('mon-tab') && x.attrs['data-device'] === 'laptop')!;
    expect(tab.find('mon-tab-dot')!.attrs['data-activity']).toBe('working');
  });

  it('settle() on the panels publishes Done for an engine still Working', () => {
    const { feed, half } = setup();
    feed.publish({ kind: 'state', engine: 'nano', state: 'working' });
    feed.publish({ kind: 'state', engine: 'nano', state: 'done' });
    expect(half('laptop', 'device').attrs['data-state']).toBe('done');
  });

  it('hides the title card once something arrives', () => {
    const { ch, find, root } = setup({ withFeed: false });
    expect(find('mon-empty').hidden).toBe(false);
    expect(root.children[0]!.attrs['data-idle']).toBe('true');
    ch.toMonitor({ v: 1, sid: 's', t: 1, kind: 'bytes', total: 0 });
    expect(find('mon-empty').hidden).toBe(true);
  });
});

describe('devices and tabs', () => {
  it('routes phone events to their own view; laptop stays untouched', () => {
    const { phone, half, view } = setup({ withFeed: false });
    phone({ kind: 'log', engine: 'rules', verb: 'received', text: 'request received', device: 'iphone', deviceLabel: 'iPhone' });
    phone({ kind: 'log', engine: 'apple', verb: 'plan', text: 'dim the bedroom lamp', device: 'iphone', deviceLabel: 'iPhone' });
    phone({ kind: 'log', engine: 'gemini', verb: 'received', text: 'hallway light at 11 pm', device: 'android', deviceLabel: 'Nothing phone' });
    expect(half('iphone', 'device').find('mon-headline')!.textContent).toBe('Dim the bedroom lamp');
    expect(view('iphone').find('mon-model')!.textContent).toBe('Apple on-device model');
    expect(half('android', 'cloud').text()).toContain('hallway light');
    expect(view('android').find('mon-where')!.textContent).toBe('This device · Nothing phone');
    expect(half('laptop', 'device').find('mon-ticker')!.children).toHaveLength(0);
    expect(half('laptop', 'cloud').find('mon-ticker')!.children).toHaveLength(0);
    expect(view('iphone').attrs['data-live']).toBe('true');
    expect(view('laptop').attrs['data-live']).toBe('false');
  });

  it("'rules' names the left side only until a model is seen", () => {
    const { phone, view } = setup({ withFeed: false });
    phone({ kind: 'log', engine: 'rules', verb: 'received', text: 'r', device: 'android' });
    expect(view('android').find('mon-model')!.textContent).toBe('On this phone · no model');
    phone({ kind: 'log', engine: 'apple', verb: 'plan', text: 'p', device: 'iphone' });
    phone({ kind: 'log', engine: 'rules', verb: 'received', text: 'r', device: 'iphone' });
    expect(view('iphone').find('mon-model')!.textContent).toBe('Apple on-device model');
  });

  it('per-device bytes: each view shows its own, the footer the sum', () => {
    const { feed, phone, half, find } = setup();
    feed.publish({ kind: 'bytes', total: 1000 });
    phone({ kind: 'bytes', total: 500, device: 'iphone', deviceLabel: 'iPhone' });
    expect(half('laptop', 'cloud').find('mon-half-stat')!.textContent).toBe('1000 B sent to cloud from Laptop');
    expect(half('iphone', 'cloud').find('mon-half-stat')!.textContent).toBe('500 B sent to cloud from iPhone');
    expect(find('mon-bytes').textContent).toBe('1.5 KB sent to cloud');
  });

  it('a phone packet crosses in that phone\'s view only', () => {
    const { phone, view } = setup({ withFeed: false });
    phone({ kind: 'bytes', total: 1843, device: 'iphone' });
    phone({ kind: 'log', engine: 'rules', verb: 'received', text: 'request received', device: 'iphone' });
    phone({ kind: 'log', engine: 'rules', verb: 'redact', text: 'name kept on the phone → [Client A]', device: 'iphone' });
    phone({ kind: 'log', engine: 'gemini', verb: 'received', text: 'plan a reading nook for [Client A]', device: 'iphone' });
    expect(view('iphone').findAll('mon-packet')).toHaveLength(1);
    expect(view('iphone').find('mon-packet')!.text()).toContain('1.8 KB');
    expect(view('iphone').find('mon-redact-raw')!.textContent).toBe('name kept on the phone → [Client A]');
    expect(view('iphone').find('mon-redact-name')).toBeUndefined();
    expect(view('laptop').findAll('mon-packet')).toHaveLength(0);
  });

  it('tabs: default laptop, keys 1/2/3, ?device=, and history survives switching', () => {
    const { feed, mon, view } = setup();
    expect(mon.active()).toBe('laptop');
    expect(view('iphone').hidden).toBe(true);
    feed.publish({ kind: 'log', engine: 'nano', verb: 'received', text: 'keep me' });
    expect(mon.key('2')).toBe(true);
    expect(mon.active()).toBe('iphone');
    expect(view('laptop').hidden).toBe(true);
    expect(view('iphone').hidden).toBe(false);
    mon.key('3');
    expect(mon.active()).toBe('android');
    mon.key('1');
    expect(view('laptop').text()).toContain('keep me');
    expect(mon.key('x')).toBe(false);
    expect(setup({ device: 'android' }).mon.active()).toBe('android');
  });

  it('follow mode (off by default) switches to the device with the newest event', () => {
    const { feed, phone, mon, root } = setup();
    phone({ kind: 'log', engine: 'apple', verb: 'plan', text: 'x', device: 'iphone' });
    expect(mon.active()).toBe('laptop');
    mon.key('f');
    expect(mon.follow()).toBe(true);
    expect(root.children[0]!.attrs['data-follow']).toBe('true');
    phone({ kind: 'log', engine: 'apple', verb: 'plan', text: 'y', device: 'iphone' });
    expect(mon.active()).toBe('iphone');
    feed.publish({ kind: 'log', engine: 'nano', verb: 'plan', text: 'z' });
    expect(mon.active()).toBe('laptop');
    mon.key('F');
    phone({ kind: 'log', engine: 'apple', verb: 'plan', text: 'w', device: 'iphone' });
    expect(mon.active()).toBe('laptop');
    expect(mon.follow()).toBe(false);
  });

  it('follow mode follows the laptop within one feed session', () => {
    const { ch, mon } = setup({ withFeed: false });
    mon.setFollow(true);
    ch.toMonitor({ v: 1, sid: 's', t: 1, kind: 'log', engine: 'apple', verb: 'plan', text: 'a', device: 'iphone' });
    expect(mon.active()).toBe('iphone');
    ch.toMonitor({ v: 1, sid: 's', t: 2, kind: 'log', engine: 'nano', verb: 'plan', text: 'b' });
    expect(mon.active()).toBe('laptop');
  });
});

describe('feed session handling', () => {
  it('a monitor opened mid-turn gets a snapshot via hello — no packets replayed, no tasks counted', () => {
    const ch = bus();
    const feed = createAiFeed({ channel: ch.canvas });
    feed.publish({ kind: 'bytes', total: 900 });
    feed.publish({ kind: 'log', engine: 'nano', verb: 'received', text: 'early line' });
    feed.publish({ kind: 'log', engine: 'gemini', verb: 'received', text: 'payload' });
    feed.publish({ kind: 'state', engine: 'nano', state: 'working' });
    const root = new FakeEl('main', doc);
    const mon = mountMonitor(root as unknown as HTMLElement, ch.monitor, { keys: null });
    const dev = root.all().find((x) => x.has('mon-half--device'))!;
    expect(dev.text()).toContain('early line');
    expect(dev.attrs['data-state']).toBe('working');
    expect(root.findAll('mon-packet')).toHaveLength(0);
    expect(root.find('mon-bytes')!.textContent).toBe('900 B sent to cloud');
    expect(mon.ledger.keptTotal()).toBe(0);
    // the next real delta is measured from the snapshot total
    feed.publish({ kind: 'bytes', total: 1000 });
    feed.publish({ kind: 'log', engine: 'nano', verb: 'received', text: 'next' });
    feed.publish({ kind: 'log', engine: 'gemini', verb: 'received', text: 'payload' });
    expect(root.find('mon-packet')!.attrs['data-bytes']).toBe('100');
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

  it('follows the newest tab, and a tab can win again later (A, B, A)', () => {
    const { ch, half } = setup({ withFeed: false });
    const m = (sid: string, t: number, text: string) => ({ v: 1, sid, t, kind: 'log', engine: 'nano', verb: 'note', text });
    ch.toMonitor(m('A', 100, 'from A'));
    ch.toMonitor(m('B', 200, 'from B'));
    expect(half('laptop', 'device').text()).toContain('from B');
    expect(half('laptop', 'device').text()).not.toContain('from A');
    ch.toMonitor(m('A', 300, 'A again'));
    expect(half('laptop', 'device').text()).toContain('A again');
    expect(half('laptop', 'device').text()).not.toContain('from B');
  });

  it('asks the new sender for a snapshot when it switches tabs', () => {
    const ch = bus();
    const root = new FakeEl('main', doc);
    mountMonitor(root as unknown as HTMLElement, ch.monitor, { keys: null });
    const hellos: unknown[] = [];
    ch.canvas.addEventListener('message', (e) => { if ((e.data as { kind?: string }).kind === 'hello') hellos.push(e.data); });
    const m = (sid: string, t: number) => ({ v: 1, sid, t, kind: 'bytes', total: 1 });
    ch.toMonitor(m('A', 1)); ch.toMonitor(m('B', 2));
    expect(hellos).toHaveLength(1);
  });

  it('ignores a different sid whose message is older than the current tab', () => {
    const { ch, half } = setup({ withFeed: false });
    const m = (sid: string, t: number, text: string) => ({ v: 1, sid, t, kind: 'log', engine: 'nano', verb: 'note', text });
    ch.toMonitor(m('B', 200, 'from B'));
    ch.toMonitor(m('A', 100, 'stale A'));
    expect(half('laptop', 'device').text()).toContain('from B');
    expect(half('laptop', 'device').text()).not.toContain('stale A');
  });

  it('ignores unknown and malformed messages', () => {
    const { ch, find, root } = setup({ withFeed: false });
    [null, 'x', 5, {}, { v: 2, sid: 's', t: 1, kind: 'log' }, { v: 1, sid: 's', t: 1, kind: 'nope' },
      { v: 1, sid: 's', t: 1, kind: 'log', engine: 'bogus', verb: 'a', text: 'b' },
      { v: 1, sid: 's', t: 1, kind: 'log', engine: 'nano', verb: 'a', text: 'b', device: 'fridge' },
      { v: 1, sid: 's', t: 1, kind: 'bytes', total: 'many' },
      { v: 1, sid: 's', t: 1, kind: 'snapshot', total: 1 }].forEach((d) => ch.toMonitor(d));
    expect(root.findAll('mon-line')).toHaveLength(0);
    expect(find('mon-empty').hidden).toBe(false);
    expect(find('mon-bytes').textContent).toBe('0 B sent to cloud');
  });

  it('caps lines per half', () => {
    const { feed, half } = setup();
    for (let i = 0; i < MONITOR_MAX_LINES + 15; i++) feed.publish({ kind: 'log', engine: 'gemini', verb: 'note', text: `l${i}` });
    const lines = half('laptop', 'cloud').find('mon-ticker')!.children;
    expect(lines.length).toBe(MONITOR_MAX_LINES);
    expect(lines[0]!.text()).toContain('l15');
  });
});

describe('fix round 1', () => {
  it('self-check notes never take the headline or sub-line, stay off the cloud half, and passing ones collapse', () => {
    const { feed, half } = setup();
    feed.publish({ kind: 'log', engine: 'nano', verb: 'received', text: 'connect everything in this room' });
    feed.publish({ kind: 'log', engine: 'nano', verb: 'done', text: '2 tiles filled' });
    const ok = 'self-check: 3 controls, tap replay ok, 0 overlaps';
    for (let i = 0; i < 3; i++) {
      feed.publish({ kind: 'log', engine: 'nano', verb: 'note', text: ok });
      feed.publish({ kind: 'log', engine: 'gemini', verb: 'note', text: ok });
    }
    feed.publish({ kind: 'log', engine: 'nano', verb: 'note', text: 'self-check: fix verified in 0.40s, 0 problems' });
    const dev = half('laptop', 'device');
    expect(dev.find('mon-headline')!.textContent).toBe('2 tiles filled');
    expect(dev.find('mon-sub')!.textContent).toBe('');
    const lines = dev.find('mon-ticker')!.children;
    const last = lines[lines.length - 1]!;
    expect(last.has('mon-line--selfok')).toBe(true);
    expect(last.attrs['data-n']).toBe('4');
    expect(last.text()).toContain('×4');
    expect(half('laptop', 'cloud').text()).not.toContain('self-check');
    // problems stay visible (and break the collapsed run); still no headline
    feed.publish({ kind: 'log', engine: 'nano', verb: 'note', text: 'self-check: 1 problem — tile 2 overlaps' });
    feed.publish({ kind: 'log', engine: 'nano', verb: 'note', text: 'self-check: fix declined — last good tile kept' });
    expect(dev.text()).toContain('1 problem — tile 2 overlaps');
    expect(dev.text()).toContain('fix declined');
    expect(dev.find('mon-headline')!.textContent).toBe('2 tiles filled');
    expect(dev.find('mon-sub')!.textContent).toBe('');
  });

  it('self-check notes on the cloud half do not disqualify a kept turn', () => {
    const { feed, find } = setup();
    feed.publish({ kind: 'log', engine: 'nano', verb: 'received', text: 'start a floor plan' });
    feed.publish({ kind: 'log', engine: 'gemini', verb: 'note', text: 'self-check: 0 controls, tap replay ok, 0 overlaps' });
    feed.publish({ kind: 'log', engine: 'nano', verb: 'done', text: '1 tile filled' });
    expect(find('mon-total--kept').find('mon-total-num')!.textContent).toBe('1');
  });

  it("the cloud's raw prompt is summarised in the ticker; full text only in title", () => {
    const { feed, half } = setup();
    const prompt = 'You build one board on a smart canvas. Reply with JSON only, matching:\n{"kind":"room"}';
    feed.publish({ kind: 'bytes', total: 2306 });
    feed.publish({ kind: 'log', engine: 'nano', verb: 'received', text: 'connect everything in this room' });
    feed.publish({ kind: 'log', engine: 'gemini', verb: 'received', text: prompt });
    const line = half('laptop', 'cloud').find('mon-line--received')!;
    expect(line.text()).toContain("the model prompt · 2.3 KB");
    expect(line.attrs["data-kind"]).toBe("sent");
    expect(line.text()).not.toContain('JSON only');
    expect(line.attrs.title).toBe(prompt);
    // the packet still carries the real bytes delta
    expect(half('laptop', 'cloud').find('mon-headline')!.textContent).toBe('Received 2.3 KB');
    // a short, plain received line is shown as-is
    const s2 = setup();
    s2.feed.publish({ kind: 'log', engine: 'gemini', verb: 'received', text: 'plan a reading nook for [Client A]' });
    expect(s2.half('laptop', 'cloud').find('mon-line--received')!.text()).toContain('plan a reading nook');
  });

  it("stale or late bytes never become the next turn's packet", () => {
    const l = createLedger();
    l.bytes('android', 900, 0);
    l.log('android', 'gemini', 'received', 'later request', CARRY_MS + 10);
    expect(l.get('android').pending).toBe(0);
    expect(l.get('android').lastTotal).toBe(900); // still in the totals
    // late bytes after the cloud answered do not cross, and don't carry over
    const k = createLedger();
    k.bytes('laptop', 400, 0);
    k.log('laptop', 'nano', 'received', 'a', 1);
    expect(k.log('laptop', 'gemini', 'received', 'p', 2)).toHaveLength(1);
    k.log('laptop', 'gemini', 'replied', 'done', 3);
    expect(k.bytes('laptop', 700, 4)).toEqual([]);
    k.log('laptop', 'nano', 'received', 'b', 4 + CARRY_MS + 1);
    expect(k.log('laptop', 'gemini', 'received', 'p', 4 + CARRY_MS + 2)).toEqual([]);
    // fresh bytes right before a turn still carry into it
    k.bytes('laptop', 1000, 10_000);
    k.log('laptop', 'nano', 'received', 'c', 10_001);
    expect(k.log('laptop', 'gemini', 'received', 'p', 10_002)).toMatchObject([{ bytes: 300 }]);
  });

  it('a laptop snapshot or tab switch does not wipe the phone tabs', () => {
    const ch = bus();
    const root = new FakeEl('main', doc);
    mountMonitor(root as unknown as HTMLElement, ch.monitor, { keys: null });
    const iphone = () => root.all().find((x) => x.has('mon-view') && x.attrs['data-device'] === 'iphone')!;
    ch.toMonitor({ v: 1, sid: 'A', t: 1, kind: 'log', engine: 'nano', verb: 'note', text: 'laptop A' });
    ch.toMonitor({ v: 1, sid: 'A', t: 2, kind: 'log', engine: 'apple', verb: 'plan', text: 'iphone line', device: 'iphone' });
    ch.toMonitor({ v: 1, sid: 'B', t: 3, kind: 'log', engine: 'nano', verb: 'note', text: 'laptop B' });
    expect(iphone().text()).toContain('iphone line');
    ch.toMonitor({ v: 1, sid: 'B', t: 4, kind: 'snapshot', engines: { nano: { state: 'idle', lines: [] }, gemini: { state: 'idle', lines: [] } }, total: 0 });
    expect(iphone().text()).toContain('iphone line');
  });

  it('phone events under another sid are applied and never switch the laptop session', () => {
    const { ch, half } = setup({ withFeed: false });
    ch.toMonitor({ v: 1, sid: 'laptop', t: 100, kind: 'log', engine: 'nano', verb: 'note', text: 'laptop line' });
    ch.toMonitor({ v: 1, sid: 'phone', t: 50, kind: 'log', engine: 'apple', verb: 'plan', text: 'phone line', device: 'iphone' });
    expect(half('iphone', 'device').text()).toContain('phone line');
    ch.toMonitor({ v: 1, sid: 'laptop', t: 101, kind: 'log', engine: 'nano', verb: 'note', text: 'still laptop' });
    expect(half('laptop', 'device').text()).toContain('laptop line');
    expect(half('laptop', 'device').text()).toContain('still laptop');
  });
});

describe('activity stream styles', () => {
  it('maps each verb to a human label, kind and weight', () => {
    const t = (e: 'nano' | 'gemini' | 'apple' | 'rules', v: string, x = 'x') => {
      const s = lineStyle(e, v, x);
      return [s.label, s.kind, s.bold];
    };
    expect(t('nano', 'received')).toEqual(['Heard', 'heard', false]);
    expect(t('gemini', 'received')).toEqual(['Sent', 'sent', true]);
    expect(t('nano', 'handoff', '→ gemini: plan')).toEqual(['Handed off', 'handoff', true]);
    expect(t('gemini', 'handoff', '← nano: plan')).toEqual(['Picked up', 'handoff', true]);
    expect(t('nano', 'redact', 'Sharma → [Client A]')).toEqual(['Redacted', 'redact', true]);
    expect(t('gemini', 'replied')).toEqual(['Replied', 'replied', false]);
    expect(t('nano', 'done')).toEqual(['Done', 'done', false]);
    expect(t('nano', 'fail')).toEqual(['Blocked', 'fail', true]);
    expect(t('gemini', 'fail')).toEqual(['Failed', 'fail', true]);
    expect(t('nano', 'plan')).toEqual(['Planning', 'work', false]);
    expect(t('nano', 'queued')).toEqual(['Queued', 'queued', false]);
    expect(t('nano', 'note')).toEqual(['Note', 'note', false]);
    expect(t('nano', 'note', 'self-check: 3 controls, tap replay ok, 0 overlaps')).toEqual(['Self-check', 'self', false]);
    expect(lineStyle('nano', 'fail', 'Lamps go from 10 to 100 %.').text).toBe('Blocked — Lamps go from 10 to 100 %.');
    expect(handoffText('→ gemini: plan the Kannada pack')).toBe('→ Gemini: plan the Kannada pack');
  });

  it('lifts SIM into a pill instead of dropping it', () => {
    expect(lineStyle('nano', 'note', 'SIM · Checked on this device.')).toMatchObject({ sim: true, text: 'Checked on this device.' });
    const { feed, half } = setup();
    feed.publish({ kind: 'log', engine: 'nano', verb: 'note', text: 'SIM · Checked on this device.' });
    const line = half('laptop', 'device').find('mon-line')!;
    expect(line.find('mon-sim-pill')!.textContent).toBe('SIM');
    expect(line.find('mon-verb')!.textContent).toBe('Note');
  });

  it('renders the stream: labels, kinds, a real redaction struck and tokenised, kept and bold endings', () => {
    const { feed, half } = setup();
    feed.publish({ kind: 'log', engine: 'nano', verb: 'received', text: "floor plan for Mrs Sharma's flat" });
    feed.publish({ kind: 'log', engine: 'nano', verb: 'redact', text: 'Sharma → [Client A]' });
    feed.publish({ kind: 'log', engine: 'nano', verb: 'done', text: '1 tile filled' });
    feed.publish({ kind: 'log', engine: 'nano', verb: 'done', text: 'again' });
    const lines = half('laptop', 'device').find('mon-ticker')!.children;
    expect(lines.map((l) => l.attrs['data-kind'])).toEqual(['heard', 'redact', 'done', 'kept', 'done']);
    expect(lines.map((l) => l.find('mon-verb')!.textContent)).toEqual(['Heard', 'Redacted', 'Done', 'Kept on device', 'Done']);
    expect(lines[1]!.find('mon-strike')!.textContent).toBe('Sharma');
    expect(lines[1]!.find('mon-token')!.textContent).toBe('[Client A]');
    expect(lines[2]!.attrs['data-bold']).toBe('true'); // the done that ends the turn
    expect(lines[4]!.attrs['data-bold']).toBe('false');
    expect(lines[3]!.text()).toContain('✓ Stayed on this device · 0 B');
    expect(lines[3]!.attrs['data-bold']).toBe('true');
  });

  it('a redact line without the name → token shape is shown as-is (nothing struck)', () => {
    const { phone, half } = setup({ withFeed: false });
    phone({ kind: 'log', engine: 'rules', verb: 'received', text: 'request received', device: 'iphone' });
    phone({ kind: 'log', engine: 'rules', verb: 'redact', text: 'name kept on the phone → [Client A]', device: 'iphone' });
    const line = half('iphone', 'device').findAll('mon-line')[1]!;
    expect(line.attrs['data-kind']).toBe('redact');
    expect(line.find('mon-strike')).toBeUndefined();
    expect(line.text()).toContain('name kept on the phone → [Client A]');
  });

  it('handoff lines read "→ Gemini: …" in bold; sent lines carry the real size', () => {
    const { feed, half } = setup();
    kannadaTurn(feed);
    const h = half('laptop', 'device').findAll('mon-line').find((l) => l.attrs['data-kind'] === 'handoff')!;
    expect(h.text()).toContain('→ Gemini: plan the Kannada pack — too complex for on-device');
    expect(h.attrs['data-bold']).toBe('true');
    const sent = half('laptop', 'cloud').findAll('mon-line').find((l) => l.attrs['data-kind'] === 'sent')!;
    expect(sent.text()).toContain('2.2 KB');
  });
});
