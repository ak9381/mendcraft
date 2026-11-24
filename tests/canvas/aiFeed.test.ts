import { describe, expect, it } from 'vitest';
import { createAiFeed, FEED_KEEP_LINES, isAiFeedMsg, type FeedChannel } from '../../src/canvas/aiFeed';
import { mountModelPanels } from '../../src/canvas/modelPanels';

function chan() {
  const sent: Array<Record<string, unknown>> = [];
  const listeners: Array<(e: { data: unknown }) => void> = [];
  const channel: FeedChannel = { postMessage: (m) => { sent.push(m as Record<string, unknown>); }, addEventListener: (_t, f) => { listeners.push(f); } };
  return { channel, sent, deliver: (d: unknown) => listeners.forEach((f) => f({ data: d })) };
}

describe('createAiFeed', () => {
  it('stamps v, sid and t on every message, same sid per feed', () => {
    const c = chan();
    const feed = createAiFeed({ channel: c.channel });
    feed.publish({ kind: 'bytes', total: 5 });
    feed.publish({ kind: 'log', engine: 'nano', verb: 'plan', text: 'x' });
    expect(c.sent).toHaveLength(2);
    expect(c.sent.every((m) => m.v === 1 && typeof m.t === 'number' && isAiFeedMsg(m))).toBe(true);
    expect(c.sent[0]!.sid).toBe(c.sent[1]!.sid);
    const c2 = chan();
    createAiFeed({ channel: c2.channel }).publish({ kind: 'bytes', total: 1 });
    expect(c2.sent[0]!.sid).not.toBe(c.sent[0]!.sid);
  });

  it('keeps only the last 40 lines per engine for snapshots', () => {
    const c = chan();
    const feed = createAiFeed({ channel: c.channel });
    for (let i = 0; i < FEED_KEEP_LINES + 10; i++) feed.publish({ kind: 'log', engine: 'nano', verb: 'note', text: `l${i}` });
    c.sent.length = 0;
    c.deliver({ v: 1, sid: 'm', t: 1, kind: 'hello' });
    const snap = c.sent[0] as { kind: string; engines: { nano: { lines: string[] }; gemini: { lines: string[] } } };
    expect(snap.kind).toBe('snapshot');
    expect(snap.engines.nano.lines).toHaveLength(FEED_KEEP_LINES);
    expect(snap.engines.nano.lines[0]).toBe('note\tl10');
    expect(snap.engines.gemini.lines).toHaveLength(0);
  });

  it('works with no channel available (no-op)', () => {
    const feed = createAiFeed({ channel: null });
    expect(() => feed.publish({ kind: 'bytes', total: 1 })).not.toThrow();
  });

  it('swallows a throwing channel', () => {
    const channel: FeedChannel = { postMessage: () => { throw new Error('closed'); }, addEventListener: () => {} };
    expect(() => createAiFeed({ channel }).publish({ kind: 'bytes', total: 1 })).not.toThrow();
  });
});

describe('isAiFeedMsg', () => {
  it('rejects junk', () => {
    expect(isAiFeedMsg(null)).toBe(false);
    expect(isAiFeedMsg({ v: 1, sid: 's', t: 1, kind: 'bytes', total: NaN })).toBe(false);
    expect(isAiFeedMsg({ v: 1, sid: 's', t: 1, kind: 'hello' })).toBe(true);
  });
});

describe('modelPanels publishes to the feed', () => {
  it('log, state, handoff and bytes all go out without touching call sites', () => {
    const published: unknown[] = [];
    const feed = { publish: (m: unknown) => { published.push(m); }, onHello: () => {} };
    const stub = () => {
      const el: Record<string, unknown> = {
        hidden: false, textContent: '', innerHTML: '', childElementCount: 0, scrollTop: 0, scrollHeight: 0,
        classList: { add() {}, remove() {} }, append() {}, setAttribute() {},
      };
      el.querySelector = () => el;
      return el;
    };
    const aiPanel = stub() as unknown as HTMLElement;
    const doc = { createElement: () => stub() } as unknown as Document;
    const panels = mountModelPanels(aiPanel, doc, undefined, feed);
    panels.forEngine('nano').log('plan', 'hello');
    panels.showHandoff('nano', 'because');
    panels.setFooterBytes(42);
    const kinds = published.map((p) => (p as { kind: string }).kind);
    expect(kinds).toContain('log');
    expect(kinds).toContain('state');
    expect(published).toContainEqual({ kind: 'handoff', from: 'nano', to: 'gemini', text: 'because' });
    expect(published).toContainEqual({ kind: 'bytes', total: 42 });
  });
});
