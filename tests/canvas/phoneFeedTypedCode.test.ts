// The phone's AI activity reaching the laptop's AI monitor, end to end with
// fakes, over the TYPED-CODE join (the path the Nothing phone used when the
// chime wasn't heard): laptop host room → phone types the code → the phone's
// terminals → aiEvent relay commands → the laptop's republisher → its
// BroadcastChannel feed → the monitor's "Android phone" tab.
import { describe, expect, it } from 'vitest';
import { createAiFeed, type FeedChannel } from '../../src/canvas/aiFeed';
import { createLaptopLink } from '../../src/canvas/laptopLink';
import { mountModelPanels } from '../../src/canvas/modelPanels';
import { createPhoneAiForwarder, createPhoneAiRepublisher } from '../../src/canvas/phoneAiFeed';
import { joinPhoneSession, type PhoneSessionDeps } from '../../src/canvas/phoneGuestJoin';
import { startPhoneJoin } from '../../src/canvas/phoneJoin';
import { mountMonitor } from '../../src/monitor/monitorMain';
import { ensureDeviceId, type StorageLike } from '../../src/relay/pairingStore';
import { createRoomFeed, STALE_READS_BEFORE_RESTART, type RoomDoc } from '../../src/relay/roomFeed';
import { createFakeTransport, type RelayTransport } from '../../src/relay/transport';
import { validateMessage, type RelayMessage } from '../../src/relay/protocol';

const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => (m.has(k) ? m.get(k)! : null), setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
}

/** Minimal fake DOM for the monitor (node environment). */
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
  return { canvas: mk(a, b), monitor: mk(b, a) };
}

/** The laptop: a host room wired as canvasApp wires it (AI-feed parts only). */
async function laptop(transport: RelayTransport, channel: FeedChannel) {
  const feed = createAiFeed({ channel });
  const phoneAi = createPhoneAiRepublisher({ feed });
  feed.onHello(() => phoneAi.replay());
  const labels: string[] = [];
  let session: { askWhoIsThere(): Promise<void> } | null = null;
  const res = await startPhoneJoin({
    transport, chime: () => undefined, origin: 'https://example.test',
    // One phone session left: forget every announce, ask who is still here.
    onState: (st) => { if (st === 'gone' || st === 'disconnected') { phoneAi.clear(); void session?.askWhoIsThere().catch(() => undefined); } },
    onCommand: (cmd) => {
      if (cmd.kind === 'aiEvent') { phoneAi.handle(cmd.text ?? ''); return; }
      if (cmd.kind !== 'announce') return;
      const o = JSON.parse(cmd.text ?? '{}') as { platform?: 'android' | 'ios'; deviceId?: unknown; native?: unknown; refresh?: unknown };
      if (!o.platform) return;
      const label = phoneAi.announce(o.platform, o.deviceId, o.native);
      if (o.refresh !== true) labels.push(label);
    },
  });
  if ('error' in res) throw new Error(res.error);
  session = res.session;
  return { ...res, labels, feed };
}

/** The phone shell: its real terminals teeing into the forwarder, and the
 *  Join-laptop link (canvasMain's wiring). */
function phone(transport: RelayTransport, opts: { join?: (d: PhoneSessionDeps) => ReturnType<typeof joinPhoneSession> } = {}) {
  const storage = memoryStorage();
  const fwd = createPhoneAiForwarder({ deviceId: ensureDeviceId(storage), localEngine: () => 'rules' });
  const stub = () => {
    const el: Record<string, unknown> = {
      hidden: false, textContent: '', innerHTML: '', childElementCount: 0, scrollTop: 0, scrollHeight: 0,
      classList: { add() {}, remove() {} }, append() {}, setAttribute() {},
    };
    el.querySelector = () => el;
    return el;
  };
  const panels = mountModelPanels(stub() as unknown as HTMLElement, { createElement: () => stub() } as unknown as Document, undefined, fwd);
  const link = createLaptopLink({
    storage, platform: 'android', native: true, aiForwarder: fwd,
    onSnapshot: () => undefined,
    join: opts.join,
    joinExtras: { transport, keepAliveTimers: { setInterval: () => 0, clearInterval: () => undefined } },
  });
  /** "connect everything in this room" on a phone with no on-device model. */
  const geminiTurn = (bytes: number) => {
    panels.forEngine('gemini').log('received', 'connect everything in this room');
    panels.forEngine('gemini').log('replied', '3 tiles filled');
    panels.setFooterBytes(bytes);
  };
  return { storage, fwd, panels, link, geminiTurn };
}

function monitor(channel: FeedChannel) {
  const root = new FakeEl('main', doc);
  const mon = mountMonitor(root as unknown as HTMLElement, channel, { device: 'android', keys: null });
  const view = () => root.all().find((x) => x.has('mon-view') && x.attrs['data-device'] === 'android')!;
  return { root, mon, view, offline: () => view().attrs['data-live'] !== 'true', text: () => view().text() };
}

describe('phone AI feed over the typed-code join', () => {
  it('a typed code pairs the phone; its Gemini turn shows on the monitor\'s Android tab with its bytes', async () => {
    const t = createFakeTransport();
    const ch = bus();
    const mon = monitor(ch.monitor);
    const host = await laptop(t, ch.canvas);
    expect(mon.offline()).toBe(true);

    const p = phone(t);
    await p.link.joinWithCode(host.code, true); // the grouped code as shown: "ABCD-EFGH"
    await flush();
    expect(p.link.state()).toBe('connected');
    expect(host.labels).toEqual(['Nothing phone']);
    // Paired is enough for the tab to stop saying "Not connected".
    expect(mon.offline()).toBe(false);
    expect(mon.mon.ledger.get('android').lastTotal).toBe(0);

    p.geminiTurn(2150);
    await flush();
    expect(mon.text()).toContain('3 tiles filled');
    expect(mon.mon.ledger.get('android').lastTotal).toBe(2150);
    // Never the laptop's bytes.
    expect(mon.mon.ledger.get('laptop').lastTotal).toBe(0);
    await p.link.stop();
    await host.stop();
  });

  it('a monitor opened after the phone paired (and after its turn) shows it connected, with its bytes', async () => {
    const t = createFakeTransport();
    const ch = bus();
    const host = await laptop(t, ch.canvas);
    const p = phone(t);
    await p.link.joinWithCode(host.code, true);
    await flush();
    p.geminiTurn(4600);
    await flush();

    const mon = monitor(ch.monitor); // says hello → the laptop replays who is here
    expect(mon.offline()).toBe(false);
    expect(mon.mon.ledger.get('android').lastTotal).toBe(4600);
    // A live request after the monitor opened appears.
    p.panels.forEngine('gemini').log('replied', '2 tiles filled');
    await new Promise((r) => setTimeout(r, 1100)); // the phone sends at most 5 lines a second
    await flush();
    expect(mon.text()).toContain('2 tiles filled');
    await p.link.stop();
    await host.stop();
  });

  it('a stale join torn down late does not unbind the join that replaced it', async () => {
    const t = createFakeTransport();
    const ch = bus();
    const mon = monitor(ch.monitor);
    const host = await laptop(t, ch.canvas);
    // The first join (a saved-pair rejoin, or a double tap on Join) is slow:
    // it finishes AFTER the typed-code join that superseded it.
    const gates: Array<() => void> = [];
    let calls = 0;
    const p = phone(t, {
      join: async (d) => {
        const mine = ++calls;
        if (mine === 1) await new Promise<void>((r) => { gates.push(r); });
        return joinPhoneSession(d);
      },
    });
    const first = p.link.joinWithCode(host.token, false);
    await flush();
    await p.link.joinWithCode(host.code, true);
    await flush();
    gates[0]!(); // the stale join completes now and is stopped
    await first;
    await flush();
    await new Promise((r) => setTimeout(r, 1100)); // past the phone's 5-a-second window
    expect(p.link.state()).toBe('connected');

    p.geminiTurn(900);
    await flush();
    expect(mon.mon.ledger.get('android').lastTotal).toBe(900);
    expect(mon.text()).toContain('3 tiles filled');
    await p.link.stop();
    await host.stop();
  });
});

describe('room feed: a listener that goes quiet', () => {
  /** A fake room: `server` is what the server holds; the listener only hears
   *  what `push(..., true)` lets through. */
  function room() {
    const server: RoomDoc[] = [];
    let listener: ((docs: RoomDoc[]) => void) | null = null;
    let at = 1000;
    const got: string[] = [];
    let restarts = 0;
    let hang = false;
    const timeouts: Array<() => void> = [];
    const feed = createRoomFeed({
      listen: (onDocs) => { listener = onDocs; return () => { listener = null; }; },
      fetchSince: (since) => (hang ? new Promise<RoomDoc[]>(() => undefined) : Promise.resolve(server.filter((d) => since === null || (d.at ?? 0) >= since))),
      restart: async () => { restarts++; },
      onDoc: (d) => { got.push(String(d)); },
      setInterval: () => 0, clearInterval: () => undefined,
      setTimeout: (fn) => { timeouts.push(fn); return 0; },
      now: () => at,
    });
    const push = (name: string, heard: boolean) => {
      const d: RoomDoc = { id: name, at: at++, data: name };
      server.push(d);
      if (heard) listener?.([d]);
    };
    return { feed, push, got, restarts: () => restarts, setHang: (h: boolean) => { hang = h; }, timeouts, tick: (ms: number) => { at += ms; } };
  }

  it('delivers what the listener missed, once, in order', async () => {
    const r = room();
    r.push('hello', true);
    r.push('announce', false); // the listener went quiet here
    r.push('aiEvent-1', false);
    await r.feed.catchUp();
    expect(r.got).toEqual(['hello', 'announce', 'aiEvent-1']);
    expect(r.feed.recovered()).toBe(2);
    // The listener delivering late (or again) never duplicates.
    r.push('aiEvent-2', true);
    await r.feed.catchUp();
    expect(r.got).toEqual(['hello', 'announce', 'aiEvent-1', 'aiEvent-2']);
    expect(r.restarts()).toBe(0);
    r.feed.stop();
  });

  it('restarts the connection when the listener keeps missing messages, or a read hangs', async () => {
    const r = room();
    for (let i = 0; i < STALE_READS_BEFORE_RESTART; i++) {
      r.push(`m${i}`, false);
      await r.feed.catchUp();
    }
    expect(r.restarts()).toBe(1);
    // Not again within the gap…
    r.setHang(true);
    const read = r.feed.catchUp();
    r.timeouts.at(-1)!();
    await read;
    expect(r.restarts()).toBe(1);
    // …but a read that hangs after it does.
    r.tick(60_000);
    const again = r.feed.catchUp();
    r.timeouts.at(-1)!();
    await again;
    expect(r.restarts()).toBe(2);
    r.feed.stop();
  });

  it('only valid relay messages reach a subscriber (the transport validates each doc)', () => {
    const ok: RelayMessage[] = [];
    const feed = createRoomFeed({
      listen: (onDocs) => {
        onDocs([
          { id: 'a', at: 1, data: { v: 1, from: 'phone', type: 'hello', at: {} } },
          { id: 'b', at: 2, data: { v: 1, from: 'phone', type: 'nope' } },
        ]);
        return () => undefined;
      },
      fetchSince: async () => [],
      onDoc: (d) => { const m = validateMessage(d); if (m) ok.push(m); },
      setInterval: () => 0, clearInterval: () => undefined,
    });
    expect(ok).toEqual([{ v: 1, from: 'phone', type: 'hello' }]);
    feed.stop();
  });
});
