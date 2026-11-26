import { describe, expect, it } from 'vitest';
import {
  AI_EVENT_TEXT_MAX,
  LOCAL_FIXED_LINE,
  LOCAL_RECEIVED_LINE,
  capText,
  coerceAiEvent,
  createPhoneAiForwarder,
  createPhoneAiRepublisher,
  createRateLimiter,
  maskAddresses,
  phoneAiEventToFeed,
  phoneDeviceLabel,
  phoneSafeText,
  type PhoneAiEvent,
} from '../../src/canvas/phoneAiFeed';
import { createAiFeed, isAiFeedMsg, type FeedChannel } from '../../src/canvas/aiFeed';
import { mountModelPanels } from '../../src/canvas/modelPanels';
import { createCanvasLedger } from '../../src/canvas/ledger';
import { APPLE_ON_DEVICE_NOTE } from '../../src/canvas/engines';
import { LAMP_RANGE_REFUSAL } from '../../src/canvas/deviceGuard';
import { AI_EVENT_JSON_MAX, fitsRoomMessageRules, validateCommand, validateMessage, type RelayCommand } from '../../src/relay/protocol';
import type { Person } from '../../src/privacy/directory';
import { announcePhone, keepAnnouncing, RE_ANNOUNCE_MS } from '../../src/canvas/phoneGuestJoin';
import { createFakeTransport } from '../../src/relay/transport';
import { createGuestSession, createHostSession } from '../../src/relay/session';

const SHARMA: Person = { id: 'p1', name: 'Sharma', role: 'client', token: '[Client A]', notes: [], createdAt: 0 };
const people = () => [SHARMA];
const IPHONE = 'dev-1111aaaa';
const NOTHING = 'dev-2222bbbb';

function chan() {
  const sent: Array<Record<string, unknown>> = [];
  const listeners: Array<(e: { data: unknown }) => void> = [];
  const channel: FeedChannel = { postMessage: (m) => { sent.push(m as Record<string, unknown>); }, addEventListener: (_t, f) => { listeners.push(f); } };
  return { channel, sent, deliver: (d: unknown) => listeners.forEach((f) => f({ data: d })) };
}

/** The phone's real terminals (stub DOM) feeding a forwarder, as canvasApp wires it. */
function phonePanels(localEngine: () => 'apple' | 'nano' | 'rules', deviceId: string, clock = { t: 0 }) {
  const cmds: RelayCommand[] = [];
  const timers: Array<() => void> = [];
  const fwd = createPhoneAiForwarder({
    deviceId, localEngine, people, now: () => clock.t, setTimer: (fn) => { timers.push(fn); },
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
  /** Run queued flush timers, advancing the clock a window each time. */
  const drain = () => {
    for (let i = 0; i < 20 && timers.length; i++) { clock.t += 1000; timers.shift()!(); }
  };
  return { fwd, panels, cmds, events, timers, clock, drain };
}

describe('coerceAiEvent', () => {
  it('accepts each kind and drops unknown fields (incl. a platform claim)', () => {
    const ev = coerceAiEvent(JSON.stringify({ k: 'log', id: IPHONE, platform: 'ios', engine: 'apple', verb: 'done', text: 'ok', raw: 'secret' }));
    expect(ev).toEqual({ k: 'log', id: IPHONE, engine: 'apple', verb: 'done', text: 'ok' });
    expect(coerceAiEvent({ k: 'state', id: NOTHING, engine: 'gemini', state: 'working', line: 'x' }))
      .toEqual({ k: 'state', id: NOTHING, engine: 'gemini', state: 'working' });
    expect(coerceAiEvent({ k: 'bytes', id: NOTHING, bytes: 1126 })).toEqual({ k: 'bytes', id: NOTHING, bytes: 1126 });
    expect(coerceAiEvent({ k: 'handoff', id: IPHONE, from: 'apple', to: 'gemini', text: 'r' })).not.toBeNull();
  });

  it('rejects unknown kinds, engines, verbs, states, ids and bad bytes', () => {
    expect(coerceAiEvent({ k: 'exec', id: IPHONE })).toBeNull();
    expect(coerceAiEvent({ k: 'log', id: IPHONE, engine: 'openai', verb: 'done', text: '' })).toBeNull();
    expect(coerceAiEvent({ k: 'log', id: IPHONE, engine: 'apple', verb: 'rm -rf', text: '' })).toBeNull();
    expect(coerceAiEvent({ k: 'log', id: IPHONE, engine: 'apple', verb: 'done' })).toBeNull();
    expect(coerceAiEvent({ k: 'state', id: IPHONE, engine: 'apple', state: 'hacked' })).toBeNull();
    expect(coerceAiEvent({ k: 'bytes', bytes: 1 })).toBeNull();
    expect(coerceAiEvent({ k: 'bytes', id: 'x', bytes: 1 })).toBeNull();
    expect(coerceAiEvent({ k: 'bytes', id: 'dev-<script>', bytes: 1 })).toBeNull();
    for (const bytes of [-1, 1.5, NaN, Infinity, '5', 2e9]) expect(coerceAiEvent({ k: 'bytes', id: IPHONE, bytes })).toBeNull();
    expect(coerceAiEvent('{not json')).toBeNull();
    expect(coerceAiEvent('[]')).toBeNull();
    expect(coerceAiEvent('x'.repeat(AI_EVENT_JSON_MAX + 1))).toBeNull();
  });

  it('caps text at 120 chars and strips control, bidi and zero-width characters', () => {
    const ev = coerceAiEvent({ k: 'log', id: IPHONE, engine: 'apple', verb: 'note', text: `a\u0000b\n${'z'.repeat(400)}` });
    expect(ev && ev.k === 'log' && ev.text.length).toBe(AI_EVENT_TEXT_MAX);
    expect(ev && ev.k === 'log' && /[\u0000\n]/.test(ev.text)).toBe(false);
    const sneaky = capText('ok​‏‮⁦done⁩');
    expect(sneaky).not.toMatch(/[​-‏‪-‮⁦-⁩]/);
  });

  it('the relay accepts a small aiEvent cmd, rejects an oversized one, and it fits the room rules', () => {
    const text = JSON.stringify({ k: 'bytes', id: IPHONE, bytes: 0 });
    expect(validateCommand({ kind: 'aiEvent', text })).not.toBeNull();
    expect(validateCommand({ kind: 'aiEvent', text: '' })).toBeNull();
    expect(validateCommand({ kind: 'aiEvent', text: 'x'.repeat(AI_EVENT_JSON_MAX + 1) })).toBeNull();
    const msg = validateMessage({ v: 1, from: 'phone', type: 'cmd', cmd: { kind: 'aiEvent', text } });
    expect(msg).not.toBeNull();
    expect(fitsRoomMessageRules({ ...msg, at: new Date() })).toBe(true);
  });
});

describe('host republish', () => {
  it('tags device + label from the announce; rules events are tagged, not dropped', () => {
    expect(phoneAiEventToFeed({ k: 'log', id: IPHONE, engine: 'apple', verb: 'done', text: 'ok' }, { platform: 'ios', label: 'iPhone' }))
      .toEqual({ kind: 'log', engine: 'apple', verb: 'done', text: 'ok', device: 'iphone', deviceLabel: 'iPhone' });
    expect(phoneAiEventToFeed({ k: 'bytes', id: NOTHING, bytes: 1126 }, { platform: 'android', label: 'Nothing phone' }))
      .toEqual({ kind: 'bytes', total: 1126, device: 'android', deviceLabel: 'Nothing phone' });
    expect(phoneAiEventToFeed({ k: 'log', id: NOTHING, engine: 'rules', verb: 'redact', text: 'x' }, { platform: 'android', label: 'Nothing phone' }))
      .toMatchObject({ kind: 'log', engine: 'rules', device: 'android' });
  });

  it('labels: iPhone, Nothing phone (native Android), Android phone (narrow browser)', () => {
    expect(phoneDeviceLabel('ios')).toBe('iPhone');
    expect(phoneDeviceLabel('android', true)).toBe('Nothing phone');
    expect(phoneDeviceLabel('android', false)).toBe('Android phone');
    const rep = createPhoneAiRepublisher({ feed: { publish: () => {} } });
    expect(rep.announce('android', NOTHING, false)).toBe('Android phone');
    expect(rep.announce('android', NOTHING)).toBe('Nothing phone');
  });

  it('only announced deviceIds reach the feed, tagged, and the messages pass isAiFeedMsg', () => {
    const c = chan();
    const feed = createAiFeed({ channel: c.channel });
    const rep = createPhoneAiRepublisher({ feed });
    const bytes = JSON.stringify({ k: 'bytes', id: NOTHING, bytes: 1126 });
    expect(rep.handle(bytes)).toBe(false); // not announced yet
    rep.announce('android', NOTHING, true);
    rep.announce('ios', IPHONE, true);
    rep.announce('ios', undefined, true); // legacy announce: placed, but no events accepted
    // Each newly announced phone is shown as present (its own total so far: 0 B).
    expect(c.sent).toEqual([
      expect.objectContaining({ kind: 'bytes', total: 0, device: 'android', deviceLabel: 'Nothing phone' }),
      expect.objectContaining({ kind: 'bytes', total: 0, device: 'iphone', deviceLabel: 'iPhone' }),
    ]);
    rep.announce('android', NOTHING, true); // a keep-alive re-announce says nothing new
    expect(c.sent).toHaveLength(2);
    c.sent.length = 0;
    expect(rep.handle(bytes)).toBe(true);
    expect(rep.handle(JSON.stringify({ k: 'log', id: IPHONE, engine: 'apple', verb: 'done', text: '3 tiles filled' }))).toBe(true);
    expect(rep.handle(JSON.stringify({ k: 'nope', id: IPHONE }))).toBe(false);
    expect(c.sent).toHaveLength(2);
    expect(c.sent.every(isAiFeedMsg)).toBe(true);
    expect(c.sent[0]).toMatchObject({ kind: 'bytes', total: 1126, device: 'android', deviceLabel: 'Nothing phone' });
    expect(c.sent[1]).toMatchObject({ kind: 'log', engine: 'apple', device: 'iphone', deviceLabel: 'iPhone' });
  });

  it('a spoofing Android guest cannot post as the iPhone', () => {
    const sent: Array<Record<string, unknown>> = [];
    const rep = createPhoneAiRepublisher({ feed: { publish: (m) => { sent.push(m as Record<string, unknown>); } } });
    rep.announce('android', NOTHING, true);
    sent.length = 0;
    // Claims iPhone in the payload, with its own id: labelled by its announce.
    expect(rep.handle(JSON.stringify({ k: 'log', id: NOTHING, platform: 'ios', engine: 'apple', verb: 'done', text: 'x' }))).toBe(true);
    expect(sent[0]).toMatchObject({ device: 'android', deviceLabel: 'Nothing phone' });
    // Makes up an id that never announced: dropped.
    expect(rep.handle(JSON.stringify({ k: 'log', id: 'dev-ffffffff', platform: 'ios', engine: 'apple', verb: 'done', text: 'x' }))).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('replay() tells a late monitor who is here and each phone\'s latest total, even one sent over the rate', () => {
    const clock = { t: 0 };
    const sent: Array<Record<string, unknown>> = [];
    const rep = createPhoneAiRepublisher({ feed: { publish: (m) => { sent.push(m as Record<string, unknown>); } }, now: () => clock.t, setTimer: () => 0 });
    rep.announce('android', NOTHING, true);
    for (let i = 0; i < 10; i++) rep.handle(JSON.stringify({ k: 'log', id: NOTHING, engine: 'gemini', verb: 'note', text: 'x' }));
    expect(rep.handle(JSON.stringify({ k: 'bytes', id: NOTHING, bytes: 4600 }))).toBe(true); // over the rate: waits its turn
    expect(rep.queued()).toBe(1);
    sent.length = 0;
    rep.replay();
    expect(sent).toEqual([{ kind: 'bytes', total: 4600, device: 'android', deviceLabel: 'Nothing phone' }]);
    rep.clear();
    sent.length = 0;
    rep.replay();
    expect(sent).toEqual([]);
  });

  it('clear() forgets announced phones (drop / disconnect)', () => {
    const sent: unknown[] = [];
    const rep = createPhoneAiRepublisher({ feed: { publish: (m) => { sent.push(m); } } });
    rep.announce('ios', IPHONE);
    rep.clear();
    expect(rep.handle(JSON.stringify({ k: 'bytes', id: IPHONE, bytes: 0 }))).toBe(false);
    rep.announce('ios', IPHONE); // rejoin re-announces
    expect(rep.handle(JSON.stringify({ k: 'bytes', id: IPHONE, bytes: 0 }))).toBe(true);
  });

  it('phone activity is excluded from the laptop AI byte totals (feed snapshot + ledger)', () => {
    const c = chan();
    const feed = createAiFeed({ channel: c.channel });
    const ledger = createCanvasLedger();
    ledger.record({ engine: 'gemini', sentText: 'abcd' });
    feed.publish({ kind: 'bytes', total: ledger.totals().aiBytes });
    const rep = createPhoneAiRepublisher({ feed });
    rep.announce('android', NOTHING);
    rep.handle(JSON.stringify({ k: 'bytes', id: NOTHING, bytes: 99999 }));
    rep.handle(JSON.stringify({ k: 'log', id: NOTHING, engine: 'gemini', verb: 'received', text: '[Client A] plan' }));
    rep.handle(JSON.stringify({ k: 'state', id: NOTHING, engine: 'gemini', state: 'failed' }));
    rep.handle(JSON.stringify({ k: 'log', id: NOTHING, engine: 'rules', verb: 'received', text: LOCAL_RECEIVED_LINE }));
    expect(ledger.totals().aiBytes).toBe(4);
    c.sent.length = 0;
    c.deliver({ v: 1, sid: 'm', t: 1, kind: 'hello' });
    const snap = c.sent[0] as { kind: string; total: number; engines: { gemini: { state: string; lines: string[] } } };
    expect(snap.kind).toBe('snapshot');
    expect(snap.total).toBe(4); // the laptop's own total, untouched by the phone
    expect(snap.engines.gemini.lines).toHaveLength(0);
    expect(snap.engines.gemini.state).toBe('idle');
  });

  it('rate-limits each phone to 10 per second (the rest wait, see phoneLinkProof.test.ts)', () => {
    const clock = { t: 0 };
    const sent: unknown[] = [];
    const rep = createPhoneAiRepublisher({ feed: { publish: (m) => { sent.push(m); } }, now: () => clock.t, setTimer: () => 0 });
    rep.announce('ios', IPHONE); rep.announce('android', NOTHING);
    sent.length = 0;
    const log = (id: string) => JSON.stringify({ k: 'log', id, engine: 'gemini', verb: 'note', text: 'x' });
    for (let i = 0; i < 15; i++) rep.handle(log(IPHONE));
    for (let i = 0; i < 3; i++) rep.handle(log(NOTHING));
    expect(sent).toHaveLength(13);
    clock.t = 1001;
    expect(rep.handle(log(IPHONE))).toBe(true);
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

describe('phoneSafeText (on-phone text never leaves unless app-authored)', () => {
  it('a local done reply with raw words never leaves', () => {
    const reply = 'Sure — I dimmed the bedroom lamp because you said you have a migraine';
    expect(phoneSafeText('apple', 'done', reply, people())).toBe(LOCAL_FIXED_LINE.done);
    expect(phoneSafeText('apple', 'replied', reply, people())).toBe('replied on the phone');
  });
  it('a local fail echoing the prompt becomes the fixed line', () => {
    expect(phoneSafeText('apple', 'fail', 'Could not parse: "turn the lamp up for my migraine"', people())).toBe('failed on the phone');
    expect(phoneSafeText('nano', 'plan', 'planning your migraine room', people())).toBe('working on the phone');
  });
  it('app-authored templates pass', () => {
    expect(phoneSafeText('apple', 'done', '3 tiles filled', people())).toBe('3 tiles filled');
    expect(phoneSafeText('apple', 'note', APPLE_ON_DEVICE_NOTE, people())).toBe(APPLE_ON_DEVICE_NOTE);
    expect(phoneSafeText('apple', 'note', `SIM · ${APPLE_ON_DEVICE_NOTE}`, people())).toBe(`SIM · ${APPLE_ON_DEVICE_NOTE}`);
    expect(phoneSafeText('apple', 'fail', LAMP_RANGE_REFUSAL, people())).toBe(LAMP_RANGE_REFUSAL);
    // The try-to-break refusal names what she said; only the template leaves.
    expect(phoneSafeText('apple', 'fail', "There's no coffee machine for Sharma connected. Nothing changed.", people()))
      .toBe('No such device connected. Nothing changed.');
  });
  it('handoff reasons: known ones pass, others become "handed off", tile labels dropped', () => {
    expect(phoneSafeText('apple', 'handoff', '→ gemini: group the lights and add a room plan', people())).toBe('→ gemini: group the lights and add a room plan');
    expect(phoneSafeText('apple', 'handoff', '→ gemini: edit one tile: Sharma bedroom', people())).toBe('→ gemini: edit one tile');
    expect(phoneSafeText('apple', 'handoff', 'because she is ill', people())).toBe('handed off');
  });
  it('Gemini lines keep protectForCloud and mask IPv4/MAC addresses', () => {
    expect(phoneSafeText('gemini', 'replied', 'Done for Sharma at 192.168.1.20 (aa:bb:cc:dd:ee:ff)', people()))
      .toBe('Done for [Client A] at [ip] ([mac])');
    expect(maskAddresses('10.0.0.1 AA-BB-CC-DD-EE-FF')).toBe('[ip] [mac]');
  });
});

describe('phone forwarder', () => {
  it('an Apple turn on the iPhone: apple/rules engines, 0 bytes, no raw words or name leave the phone', () => {
    const { panels, events, drain } = phonePanels(() => 'apple', IPHONE);
    // What canvasApp.aiSent + the turn's end log for an on-device turn.
    panels.setFooterBytes(0);
    panels.forEngine('nano').log('received', "floor plan for Mrs Sharma's flat");
    panels.forEngine('nano').log('redact', 'Sharma → [Client A]');
    panels.forEngine('nano').log('note', APPLE_ON_DEVICE_NOTE);
    panels.forEngine('nano').log('done', 'Floor plan for Sharma ready, she wants it calm');
    drain();
    const evs = events();
    const wire = JSON.stringify(evs);
    expect(wire).not.toMatch(/Sharma|floor plan for Mrs|calm/);
    expect(evs).toContainEqual({ k: 'bytes', id: IPHONE, bytes: 0 });
    expect(evs).toContainEqual({ k: 'log', id: IPHONE, engine: 'rules', verb: 'received', text: LOCAL_RECEIVED_LINE });
    expect(evs).toContainEqual({ k: 'log', id: IPHONE, engine: 'rules', verb: 'redact', text: 'name kept on the phone → [Client A]' });
    expect(evs).toContainEqual({ k: 'log', id: IPHONE, engine: 'apple', verb: 'note', text: APPLE_ON_DEVICE_NOTE });
    expect(evs).toContainEqual({ k: 'log', id: IPHONE, engine: 'apple', verb: 'done', text: 'replied on the phone' });
    expect(evs.every((e) => coerceAiEvent(JSON.stringify(e)) !== null)).toBe(true);
  });

  it('a Gemini turn on the Nothing phone: engine gemini and the phone\'s own cloud byte total', () => {
    const { panels, events } = phonePanels(() => 'rules', NOTHING);
    const ledger = createCanvasLedger();
    const payload = 'Plan a floor plan for [Client A]';
    ledger.record({ engine: 'gemini', sentText: payload });
    panels.setFooterBytes(ledger.totals().aiBytes);
    panels.forEngine('gemini').log('received', payload);
    const evs = events();
    expect(evs).toContainEqual({ k: 'bytes', id: NOTHING, bytes: ledger.totals().aiBytes });
    expect(evs).toContainEqual({ k: 'log', id: NOTHING, engine: 'gemini', verb: 'received', text: payload });
    expect(evs).toContainEqual({ k: 'state', id: NOTHING, engine: 'gemini', state: 'working' });
  });

  it('drops everything with no session, and stops after unbind', () => {
    const cmds: RelayCommand[] = [];
    const fwd = createPhoneAiForwarder({ deviceId: IPHONE, localEngine: () => 'apple' });
    fwd.publish({ kind: 'bytes', total: 0 });
    expect(cmds).toHaveLength(0);
    fwd.bind({ sendCommand: async (c) => { cmds.push(c); } });
    fwd.publish({ kind: 'bytes', total: 0 });
    fwd.bind(null);
    fwd.publish({ kind: 'bytes', total: 5 });
    expect(cmds).toHaveLength(1);
  });

  it('a full burst turn still delivers its final line (FIFO, ≤5/s)', () => {
    const { panels, events, cmds, drain } = phonePanels(() => 'rules', NOTHING);
    panels.setFooterBytes(812);
    panels.forEngine('gemini').log('received', 'Plan a room for [Client A]');
    panels.forEngine('gemini').log('note', 'Gemini · cloud — sent your words and device names to improve the layout');
    panels.forEngine('gemini').log('plan', 'layout');
    panels.forEngine('gemini').log('build', 'tiles');
    panels.forEngine('gemini').log('fill', 'values');
    panels.forEngine('gemini').log('replied', '4 tiles filled');
    expect(cmds.length).toBeLessThanOrEqual(5);
    drain();
    const evs = events();
    expect(evs.at(-1)).toMatchObject({ k: 'state', engine: 'gemini', state: 'done' });
    expect(evs).toContainEqual({ k: 'log', id: NOTHING, engine: 'gemini', verb: 'replied', text: '4 tiles filled' });
    expect(evs).toContainEqual({ k: 'bytes', id: NOTHING, bytes: 812 });
  });

  it('holds at most 10 queued log lines (oldest dropped) and coalesces bytes', () => {
    const { fwd, events, drain } = phonePanels(() => 'apple', IPHONE);
    for (let i = 0; i < 30; i++) fwd.publish({ kind: 'log', engine: 'gemini', verb: 'note', text: `n${i}` });
    fwd.publish({ kind: 'bytes', total: 10 });
    fwd.publish({ kind: 'bytes', total: 20 });
    drain();
    const evs = events();
    const notes = evs.filter((e) => e.k === 'log').map((e) => (e as { text: string }).text);
    expect(notes).toHaveLength(15); // 5 sent at once + 10 queued
    expect(notes.at(-1)).toBe('n29');
    expect(evs.filter((e) => e.k === 'bytes')).toEqual([{ k: 'bytes', id: IPHONE, bytes: 20 }]);
  });
});

describe('re-announce after a drop', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const TOKEN = 'ABCDEFGHJKMNPQRSTVWXYZ01';

  it('keepAnnouncing re-announces with refresh every 20 s and on whoIsThere, until stopped', () => {
    const cmds: RelayCommand[] = [];
    let tick: (() => void) | null = null;
    let who: (() => void) | null = null;
    const stop = keepAnnouncing(
      { sendCommand: async (c) => { cmds.push(c); }, onWhoIsThere: (cb) => { who = cb; } },
      'ios', { deviceId: IPHONE, native: true },
      { setInterval: (fn, ms) => { expect(ms).toBe(RE_ANNOUNCE_MS); tick = fn; return 1; }, clearInterval: () => { tick = null; } },
    );
    tick!();
    who!();
    expect(cmds.map((c) => JSON.parse(c.text!))).toEqual([
      { platform: 'ios', deviceId: IPHONE, native: true, refresh: true },
      { platform: 'ios', deviceId: IPHONE, native: true, refresh: true },
    ]);
    stop();
    who!();
    expect(cmds).toHaveLength(2);
  });

  it('after one phone drops and the host clears, the phone that stayed is accepted again', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, undefined, { token: TOKEN });
    const sent: Array<Record<string, unknown>> = [];
    const rep = createPhoneAiRepublisher({ feed: { publish: (m) => { sent.push(m as Record<string, unknown>); } } });
    // canvasApp's wiring, reduced to the AI-feed parts.
    host.onCommand((cmd) => {
      if (cmd.kind === 'announce') {
        const o = JSON.parse(cmd.text!) as { platform: 'ios' | 'android'; deviceId?: string; native?: boolean };
        rep.announce(o.platform, o.deviceId, o.native);
      } else if (cmd.kind === 'aiEvent') rep.handle(cmd.text!);
    });
    host.onState((st) => {
      if (st === 'gone' || st === 'disconnected') { rep.clear(); void host.askWhoIsThere().catch(() => undefined); }
    });
    const iphone = await createGuestSession(t, TOKEN);
    const nothing = await createGuestSession(t, TOKEN);
    await flush();
    const noTimers = { setInterval: () => 0, clearInterval: () => {} };
    const stopNothing = keepAnnouncing(nothing, 'android', { deviceId: NOTHING, native: true }, noTimers);
    announcePhone(iphone, 'ios', { deviceId: IPHONE, native: true });
    announcePhone(nothing, 'android', { deviceId: NOTHING, native: true });
    await flush();
    sent.length = 0; // each phone's "present" line
    const ev = JSON.stringify({ k: 'bytes', id: NOTHING, bytes: 7 });
    await nothing.sendCommand({ kind: 'aiEvent', text: ev });
    await flush();
    expect(sent).toHaveLength(1);

    await iphone.close(); // the relay can't say which phone left → host clears all
    for (let i = 0; i < 6; i++) await flush();
    // The Nothing phone answered whoIsThere (hello + refresh announce): accepted again.
    await nothing.sendCommand({ kind: 'aiEvent', text: ev });
    await flush();
    // Re-learned after the clear: present again (with its total), then the event.
    expect(sent).toHaveLength(3);
    expect(sent[2]).toMatchObject({ kind: 'bytes', total: 7, device: 'android', deviceLabel: 'Nothing phone' });
    // The phone that left is not re-learned.
    expect(rep.handle(JSON.stringify({ k: 'bytes', id: IPHONE, bytes: 0 }))).toBe(false);
    stopNothing();
    await nothing.close();
    await host.close();
  });
});
