import { describe, expect, it } from 'vitest';
import {
  AI_EVENT_TEXT_MAX,
  LOCAL_RECEIVED_LINE,
  coerceAiEvent,
  createPhoneAiForwarder,
  createPhoneAiRepublisher,
  createRateLimiter,
  phoneAiEventToFeed,
  type PhoneAiEvent,
} from '../../src/canvas/phoneAiFeed';
import { createAiFeed, isAiFeedMsg, type FeedChannel } from '../../src/canvas/aiFeed';
import { mountModelPanels } from '../../src/canvas/modelPanels';
import { createCanvasLedger } from '../../src/canvas/ledger';
import { APPLE_ON_DEVICE_NOTE } from '../../src/canvas/engines';
import { AI_EVENT_JSON_MAX, fitsRoomMessageRules, validateCommand, validateMessage, type RelayCommand } from '../../src/relay/protocol';
import type { Person } from '../../src/privacy/directory';

const SHARMA: Person = { id: 'p1', name: 'Sharma', role: 'client', token: '[Client A]', notes: [], createdAt: 0 };
const people = () => [SHARMA];

function chan() {
  const sent: Array<Record<string, unknown>> = [];
  const listeners: Array<(e: { data: unknown }) => void> = [];
  const channel: FeedChannel = { postMessage: (m) => { sent.push(m as Record<string, unknown>); }, addEventListener: (_t, f) => { listeners.push(f); } };
  return { channel, sent, deliver: (d: unknown) => listeners.forEach((f) => f({ data: d })) };
}

/** The phone's real terminals (stub DOM) feeding a forwarder, as canvasApp wires it. */
function phonePanels(localEngine: () => 'apple' | 'nano' | 'rules', platform: 'ios' | 'android', clock = { t: 0 }) {
  const cmds: RelayCommand[] = [];
  const timers: Array<() => void> = [];
  const fwd = createPhoneAiForwarder({
    platform, localEngine, people, now: () => clock.t, setTimer: (fn) => { timers.push(fn); },
  });
  fwd.bind({ sendCommand: async (c) => { cmds.push(c); } });
  const stub = () => {
    const el: Record<string, unknown> = {
      hidden: false, textContent: '', innerHTML: '', childElementCount: 0, scrollTop: 0, scrollHeight: 0,
      classList: { add() {}, remove() {} }, append() {}, setAttribute() {},
    };
    el.querySelector = () => el;
    return el;
  };
  const panels = mountModelPanels(stub() as unknown as HTMLElement, { createElement: () => stub() } as unknown as Document, undefined, fwd);
  const events = () => cmds.map((c) => { expect(c.kind).toBe('aiEvent'); return JSON.parse(c.text!) as PhoneAiEvent; });
  return { fwd, panels, cmds, events, timers, clock };
}

describe('coerceAiEvent', () => {
  it('accepts each kind and drops unknown fields', () => {
    const ev = coerceAiEvent(JSON.stringify({ k: 'log', platform: 'ios', engine: 'apple', verb: 'done', text: 'ok', extra: 'x', raw: 'secret' }));
    expect(ev).toEqual({ k: 'log', platform: 'ios', engine: 'apple', verb: 'done', text: 'ok' });
    expect(coerceAiEvent({ k: 'state', platform: 'android', engine: 'gemini', state: 'working', line: 'x' }))
      .toEqual({ k: 'state', platform: 'android', engine: 'gemini', state: 'working' });
    expect(coerceAiEvent({ k: 'bytes', platform: 'android', bytes: 1126 })).toEqual({ k: 'bytes', platform: 'android', bytes: 1126 });
    expect(coerceAiEvent({ k: 'handoff', platform: 'ios', from: 'apple', to: 'gemini', text: 'r' })).not.toBeNull();
  });

  it('rejects unknown kinds, engines, verbs, states, platforms and bad bytes', () => {
    expect(coerceAiEvent({ k: 'exec', platform: 'ios' })).toBeNull();
    expect(coerceAiEvent({ k: 'log', platform: 'ios', engine: 'openai', verb: 'done', text: '' })).toBeNull();
    expect(coerceAiEvent({ k: 'log', platform: 'ios', engine: 'apple', verb: 'rm -rf', text: '' })).toBeNull();
    expect(coerceAiEvent({ k: 'log', platform: 'ios', engine: 'apple', verb: 'done' })).toBeNull();
    expect(coerceAiEvent({ k: 'state', platform: 'ios', engine: 'apple', state: 'hacked' })).toBeNull();
    expect(coerceAiEvent({ k: 'bytes', platform: 'windows', bytes: 1 })).toBeNull();
    for (const bytes of [-1, 1.5, NaN, Infinity, '5', 2e9]) expect(coerceAiEvent({ k: 'bytes', platform: 'ios', bytes })).toBeNull();
    expect(coerceAiEvent('{not json')).toBeNull();
    expect(coerceAiEvent('[]')).toBeNull();
    expect(coerceAiEvent('x'.repeat(AI_EVENT_JSON_MAX + 1))).toBeNull();
  });

  it('caps text at 120 chars and strips control characters', () => {
    const ev = coerceAiEvent({ k: 'log', platform: 'ios', engine: 'apple', verb: 'note', text: `a\u0000b\n${'z'.repeat(400)}` });
    expect(ev && ev.k === 'log' && ev.text.length).toBe(AI_EVENT_TEXT_MAX);
    expect(ev && ev.k === 'log' && /[\u0000\n]/.test(ev.text)).toBe(false);
  });

  it('the relay accepts a small aiEvent cmd, rejects an oversized one, and it fits the room rules', () => {
    const text = JSON.stringify({ k: 'bytes', platform: 'ios', bytes: 0 });
    expect(validateCommand({ kind: 'aiEvent', text })).not.toBeNull();
    expect(validateCommand({ kind: 'aiEvent', text: '' })).toBeNull();
    expect(validateCommand({ kind: 'aiEvent', text: 'x'.repeat(AI_EVENT_JSON_MAX + 1) })).toBeNull();
    const msg = validateMessage({ v: 1, from: 'phone', type: 'cmd', cmd: { kind: 'aiEvent', text } });
    expect(msg).not.toBeNull();
    expect(fitsRoomMessageRules({ ...msg, at: new Date() })).toBe(true);
  });
});

describe('host republish', () => {
  it('tags device + label; rules events are not republished', () => {
    expect(phoneAiEventToFeed({ k: 'log', platform: 'ios', engine: 'apple', verb: 'done', text: 'ok' }, 'iPhone'))
      .toEqual({ kind: 'log', engine: 'apple', verb: 'done', text: 'ok', device: 'iphone', deviceLabel: 'iPhone' });
    expect(phoneAiEventToFeed({ k: 'bytes', platform: 'android', bytes: 1126 }, 'Nothing phone'))
      .toEqual({ kind: 'bytes', total: 1126, device: 'android', deviceLabel: 'Nothing phone' });
    expect(phoneAiEventToFeed({ k: 'log', platform: 'android', engine: 'rules', verb: 'note', text: 'x' }, 'Nothing phone')).toBeNull();
  });

  it('only announced phones reach the feed, tagged, and the messages pass isAiFeedMsg', () => {
    const c = chan();
    const feed = createAiFeed({ channel: c.channel });
    const rep = createPhoneAiRepublisher({ feed });
    const bytes = JSON.stringify({ k: 'bytes', platform: 'android', bytes: 1126 });
    expect(rep.handle(bytes)).toBe(false); // not announced yet
    expect(rep.announce('android')).toBe('Nothing phone');
    expect(rep.announce('ios')).toBe('iPhone');
    expect(rep.handle(bytes)).toBe(true);
    expect(rep.handle(JSON.stringify({ k: 'log', platform: 'ios', engine: 'apple', verb: 'done', text: 'lamp set' }))).toBe(true);
    expect(rep.handle(JSON.stringify({ k: 'nope', platform: 'ios' }))).toBe(false);
    expect(c.sent).toHaveLength(2);
    expect(c.sent.every(isAiFeedMsg)).toBe(true);
    expect(c.sent[0]).toMatchObject({ kind: 'bytes', total: 1126, device: 'android', deviceLabel: 'Nothing phone' });
    expect(c.sent[1]).toMatchObject({ kind: 'log', engine: 'apple', device: 'iphone', deviceLabel: 'iPhone' });
  });

  it('phone activity is excluded from the laptop AI byte totals (feed snapshot + ledger)', () => {
    const c = chan();
    const feed = createAiFeed({ channel: c.channel });
    const ledger = createCanvasLedger();
    ledger.record({ engine: 'gemini', sentText: 'abcd' });
    feed.publish({ kind: 'bytes', total: ledger.totals().aiBytes });
    const rep = createPhoneAiRepublisher({ feed });
    rep.announce('android');
    rep.handle(JSON.stringify({ k: 'bytes', platform: 'android', bytes: 99999 }));
    rep.handle(JSON.stringify({ k: 'log', platform: 'android', engine: 'gemini', verb: 'received', text: '[Client A] plan' }));
    rep.handle(JSON.stringify({ k: 'state', platform: 'android', engine: 'gemini', state: 'failed' }));
    expect(ledger.totals().aiBytes).toBe(4);
    c.sent.length = 0;
    c.deliver({ v: 1, sid: 'm', t: 1, kind: 'hello' });
    const snap = c.sent[0] as { kind: string; total: number; engines: { gemini: { state: string; lines: string[] } } };
    expect(snap.kind).toBe('snapshot');
    expect(snap.total).toBe(4); // the laptop's own total, untouched by the phone
    expect(snap.engines.gemini.lines).toHaveLength(0);
    expect(snap.engines.gemini.state).toBe('idle');
  });

  it('rate-limits each phone to 5 per second', () => {
    const clock = { t: 0 };
    const sent: unknown[] = [];
    const rep = createPhoneAiRepublisher({ feed: { publish: (m) => { sent.push(m); } }, now: () => clock.t });
    rep.announce('ios'); rep.announce('android');
    const log = (p: string) => JSON.stringify({ k: 'log', platform: p, engine: 'gemini', verb: 'note', text: 'x' });
    for (let i = 0; i < 12; i++) rep.handle(log('ios'));
    for (let i = 0; i < 3; i++) rep.handle(log('android'));
    expect(sent).toHaveLength(8);
    clock.t = 1001;
    expect(rep.handle(log('ios'))).toBe(true);
  });
});

describe('createRateLimiter', () => {
  it('allows max per window and reports the wait', () => {
    const clock = { t: 0 };
    const l = createRateLimiter({ max: 2, windowMs: 1000, now: () => clock.t });
    expect(l.allow()).toBe(true);
    clock.t = 100;
    expect(l.allow()).toBe(true);
    expect(l.allow()).toBe(false);
    expect(l.waitMs()).toBe(900);
    clock.t = 1000;
    expect(l.allow()).toBe(true);
  });
});

describe('phone forwarder', () => {
  it('an Apple turn on the iPhone: engine apple, 0 bytes, no raw utterance or name leaves the phone', () => {
    const { panels, events, clock } = phonePanels(() => 'apple', 'ios');
    // What canvasApp.aiSent logs for an on-device turn.
    panels.setFooterBytes(0);
    panels.forEngine('nano').log('received', "floor plan for Mrs Sharma's flat");
    panels.forEngine('nano').log('redact', 'Sharma → [Client A]');
    clock.t = 1500;
    panels.forEngine('nano').log('note', APPLE_ON_DEVICE_NOTE);
    panels.forEngine('nano').log('done', 'Floor plan for Sharma ready');
    const evs = events();
    const wire = JSON.stringify(evs);
    expect(wire).not.toMatch(/Sharma/);
    expect(wire).not.toMatch(/floor plan for Mrs/);
    expect(evs).toContainEqual({ k: 'bytes', platform: 'ios', bytes: 0 });
    expect(evs).toContainEqual({ k: 'log', platform: 'ios', engine: 'apple', verb: 'received', text: LOCAL_RECEIVED_LINE });
    expect(evs).toContainEqual({ k: 'log', platform: 'ios', engine: 'apple', verb: 'redact', text: 'name kept on the phone → [Client A]' });
    expect(evs).toContainEqual({ k: 'log', platform: 'ios', engine: 'apple', verb: 'done', text: 'Floor plan for [Client A] ready' });
    expect(evs.filter((e) => e.k !== 'bytes').every((e) => (e as { engine: string }).engine === 'apple')).toBe(true);
    // Every event round-trips through the host's strict coercion.
    expect(evs.every((e) => coerceAiEvent(JSON.stringify(e)) !== null)).toBe(true);
  });

  it('a Gemini turn on the Nothing phone: engine gemini and the phone\'s own cloud byte total', () => {
    const { panels, events } = phonePanels(() => 'rules', 'android');
    const ledger = createCanvasLedger();
    const payload = 'Plan a floor plan for [Client A]';
    ledger.record({ engine: 'gemini', sentText: payload });
    panels.setFooterBytes(ledger.totals().aiBytes);
    panels.forEngine('gemini').log('received', payload);
    const evs = events();
    expect(evs).toContainEqual({ k: 'bytes', platform: 'android', bytes: ledger.totals().aiBytes });
    expect(evs).toContainEqual({ k: 'log', platform: 'android', engine: 'gemini', verb: 'received', text: payload });
    expect(evs).toContainEqual({ k: 'state', platform: 'android', engine: 'gemini', state: 'working' });
  });

  it('drops everything with no session, and stops after unbind', () => {
    const cmds: RelayCommand[] = [];
    const fwd = createPhoneAiForwarder({ platform: 'ios', localEngine: () => 'apple' });
    fwd.publish({ kind: 'bytes', total: 0 });
    expect(cmds).toHaveLength(0);
    fwd.bind({ sendCommand: async (c) => { cmds.push(c); } });
    fwd.publish({ kind: 'bytes', total: 0 });
    fwd.bind(null);
    fwd.publish({ kind: 'bytes', total: 5 });
    expect(cmds).toHaveLength(1);
  });

  it('≤5/s: excess log lines drop, the latest byte total is held and flushed', () => {
    const { fwd, cmds, events, timers, clock } = phonePanels(() => 'apple', 'ios');
    for (let i = 0; i < 10; i++) fwd.publish({ kind: 'log', engine: 'gemini', verb: 'note', text: `n${i}` });
    fwd.publish({ kind: 'bytes', total: 10 });
    fwd.publish({ kind: 'bytes', total: 20 });
    expect(cmds).toHaveLength(5);
    expect(timers).toHaveLength(1);
    clock.t = 1000;
    timers[0]!();
    const evs = events();
    expect(evs).toHaveLength(6);
    expect(evs[5]).toEqual({ k: 'bytes', platform: 'ios', bytes: 20 });
  });
});
