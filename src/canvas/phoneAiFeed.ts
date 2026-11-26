// A phone's AI activity on the laptop's AI monitor. The phone shell runs the
// same modelPanels terminals as the laptop; their feed messages are turned
// here into compact `aiEvent` relay commands (phone side), and the laptop
// coerces them strictly and republishes them into its own AI feed tagged with
// the device (host side). Display only: an aiEvent is not model inference and
// is never recorded in any ledger or counted in any "sent to cloud" total —
// its `bytes` field is the PHONE's own honest cloud total, shown per device.
//
// Privacy: text an on-phone engine (Apple / Android on-device / rules) logged
// never leaves the phone unless it is app-authored — an allow-list of known
// templates (route lines, "N tiles filled", try-to-break refusals, fixed fail
// lines, handoff reasons). Anything else becomes a fixed line per verb
// ("replied on the phone"). Gemini lines already went to the cloud, so they
// keep the protectForCloud redaction. Every line also has IPv4/MAC addresses
// masked, and is capped at 120 chars with control/bidi/zero-width chars gone.
//
// Sender identity: the relay has no per-sender identity (every phone posts as
// `from: 'phone'`). Each event carries the phone's install deviceId; the
// laptop labels and rate-limits by the deviceId it saw in that phone's
// announce, and ignores the event's own claim of platform.

import type { AiFeed, AiFeedMsg, DistributiveOmit, FeedEngine } from './aiFeed';
import type { EngineState } from './engineBar';
import type { LogVerb } from './modelPanels';
import type { PhonePlatform } from './screenLayout';
import type { RelayCommand } from '../relay/protocol';
import { AI_EVENT_JSON_MAX } from '../relay/protocol';
import { nothingRaw, protectForCloud, type Person } from '../privacy/directory';
import { APPLE_ON_DEVICE_NOTE, NO_NANO_NOTE, PHONE_NANO_NOTE, ROUTE_VIA_HUB } from './engines';
import { ROUTE_LINES } from '../ux/routeCatalog';
import { LAMP_RANGE_REFUSAL, VOLUME_RANGE_REFUSAL } from './deviceGuard';
import * as FAIL_LINES from './failLines';

/** Which engine ran on the phone. 'apple' = Apple Foundation Models (iPhone),
 *  'nano' = an Android on-device model, 'gemini' = Gemini cloud via Firebase
 *  AI Logic, 'rules' = no model (rule-based steps such as redaction). */
export type PhoneAiEngine = 'apple' | 'nano' | 'gemini' | 'rules';

/** `id` is the sending phone's install deviceId (as in its announce). */
export type PhoneAiEvent =
  | { k: 'log'; id: string; engine: PhoneAiEngine; verb: LogVerb; text: string }
  | { k: 'state'; id: string; engine: PhoneAiEngine; state: EngineState }
  | { k: 'handoff'; id: string; from: PhoneAiEngine; to: PhoneAiEngine; text: string }
  | { k: 'bytes'; id: string; bytes: number };

export const AI_EVENT_TEXT_MAX = 120;
/** Phone send rate; the laptop allows double that per device. */
export const AI_EVENT_RATE = { max: 5, windowMs: 1000 } as const;
export const HOST_AI_EVENT_RATE = { max: 10, windowMs: 1000 } as const;
/** Lines the laptop holds per phone while over its rate: a catch-up batch
 *  (several seconds of a phone's lines arriving at once) is drained in order,
 *  not dropped. Past this the oldest goes. */
export const HOST_AI_EVENT_QUEUE_MAX = 300;
/** Log lines held on the phone while over the rate (oldest dropped past it). */
export const AI_EVENT_QUEUE_MAX = 10;
/** A phone's cloud total is a running byte count; anything past this is junk. */
const BYTES_MAX = 1_000_000_000;

const ENGINES: readonly PhoneAiEngine[] = ['apple', 'nano', 'gemini', 'rules'];
const VERBS: readonly LogVerb[] = ['received', 'redact', 'handoff', 'plan', 'build', 'fill', 'done', 'replied', 'queued', 'note', 'fail'];
const STATES: readonly EngineState[] = ['idle', 'working', 'done', 'queued', 'failed', 'unavailable'];

export const LOCAL_RECEIVED_LINE = 'request received · stayed on the phone';
/** The fixed line per verb for on-phone text that is not app-authored. */
export const LOCAL_FIXED_LINE: Record<LogVerb, string> = {
  received: LOCAL_RECEIVED_LINE,
  redact: 'a name was kept on the phone',
  handoff: 'handed off',
  plan: 'working on the phone',
  build: 'working on the phone',
  fill: 'working on the phone',
  done: 'replied on the phone',
  replied: 'replied on the phone',
  queued: 'queued on the phone',
  note: 'note kept on the phone',
  fail: 'failed on the phone',
};

// U+0000–U+001F, U+007F, zero-width + LRM/RLM (U+200B–U+200F), bidi embeds
// (U+202A–U+202E), bidi isolates (U+2066–U+2069).
// eslint-disable-next-line no-control-regex
const STRIP = /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]+/g;

/** Strip control/bidi/zero-width characters and cap at 120 chars. */
export function capText(s: string): string {
  const clean = s.replace(STRIP, ' ').replace(/\s{2,}/g, ' ').trim();
  return clean.length > AI_EVENT_TEXT_MAX ? `${clean.slice(0, AI_EVENT_TEXT_MAX - 1)}…` : clean;
}

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const MAC = /\b[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}\b/gi;
/** Mask IPv4 and MAC addresses (device addresses never leave the phone). */
export function maskAddresses(s: string): string {
  return s.replace(MAC, '[mac]').replace(IPV4, '[ip]');
}

const isEngine = (x: unknown): x is PhoneAiEngine => typeof x === 'string' && (ENGINES as readonly string[]).includes(x);
const isDeviceId = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(x);

/** Strictly coerce an aiEvent payload from the wire (JSON text or object).
 *  Unknown kinds → null; unknown fields (including any `platform` claim) are
 *  dropped; engine/verb/state are whitelisted; text is capped; bytes must be
 *  a finite non-negative integer. */
export function coerceAiEvent(raw: unknown): PhoneAiEvent | null {
  let o: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw || raw.length > AI_EVENT_JSON_MAX) return null;
    try { o = JSON.parse(raw); } catch { return null; }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const m = o as Record<string, unknown>;
  if (!isDeviceId(m.id)) return null;
  const id = m.id;
  const text = (): string | null => (typeof m.text === 'string' ? capText(m.text) : null);
  switch (m.k) {
    case 'log': {
      if (!isEngine(m.engine) || typeof m.verb !== 'string' || !(VERBS as readonly string[]).includes(m.verb)) return null;
      const t = text();
      return t === null ? null : { k: 'log', id, engine: m.engine, verb: m.verb as LogVerb, text: t };
    }
    case 'state':
      if (!isEngine(m.engine) || typeof m.state !== 'string' || !(STATES as readonly string[]).includes(m.state)) return null;
      return { k: 'state', id, engine: m.engine, state: m.state as EngineState };
    case 'handoff': {
      if (!isEngine(m.from) || !isEngine(m.to)) return null;
      const t = text();
      return t === null ? null : { k: 'handoff', id, from: m.from, to: m.to, text: t };
    }
    case 'bytes':
      if (typeof m.bytes !== 'number' || !Number.isInteger(m.bytes) || m.bytes < 0 || m.bytes > BYTES_MAX) return null;
      return { k: 'bytes', id, bytes: m.bytes };
    default:
      return null;
  }
}

/** The label the laptop shows for a phone, from that phone's announce. Only a
 *  native Android app is the Nothing phone; a narrow browser is just Android. */
export function phoneDeviceLabel(platform: PhonePlatform, native = true): string {
  if (platform === 'ios') return 'iPhone';
  return native ? 'Nothing phone' : 'Android phone';
}

type FeedOut = DistributiveOmit<AiFeedMsg, 'v' | 'sid' | 't'>;

export interface AnnouncedPhone { platform: PhonePlatform; label: string }

/** Host side: one coerced phone event → a device-tagged feed message. The
 *  device comes from the sender's announce, never from the event itself. */
export function phoneAiEventToFeed(ev: PhoneAiEvent, phone: AnnouncedPhone): FeedOut {
  const tag = { device: phone.platform === 'ios' ? 'iphone' as const : 'android' as const, deviceLabel: capText(phone.label).slice(0, 40) };
  const eng = (e: PhoneAiEngine): FeedEngine => e;
  switch (ev.k) {
    case 'log': return { kind: 'log', engine: eng(ev.engine), verb: ev.verb, text: ev.text, ...tag };
    case 'state': return { kind: 'state', engine: eng(ev.engine), state: ev.state, ...tag };
    case 'handoff': return { kind: 'handoff', from: eng(ev.from), to: eng(ev.to), text: ev.text, ...tag };
    case 'bytes': return { kind: 'bytes', total: ev.bytes, ...tag };
  }
}

/** Sliding-window limiter: at most `max` per `windowMs` per key. */
export function createRateLimiter(opts: { max?: number; windowMs?: number; now?: () => number } = {}) {
  const max = opts.max ?? AI_EVENT_RATE.max;
  const windowMs = opts.windowMs ?? AI_EVENT_RATE.windowMs;
  const now = opts.now ?? (() => Date.now());
  const hits = new Map<string, number[]>();
  const prune = (key: string, t: number): number[] => {
    const list = (hits.get(key) ?? []).filter((h) => t - h < windowMs);
    hits.set(key, list);
    return list;
  };
  return {
    allow(key = ''): boolean {
      const t = now();
      const list = prune(key, t);
      if (list.length >= max) return false;
      list.push(t);
      return true;
    },
    /** ms until the next slot opens for `key` (0 when one is free now). */
    waitMs(key = ''): number {
      const t = now();
      const list = prune(key, t);
      return list.length < max ? 0 : Math.max(0, windowMs - (t - list[0]!));
    },
    clear(): void { hits.clear(); },
  };
}

/** Host side: announced phones (by deviceId) → the laptop's AI feed. An event
 *  whose deviceId never announced is dropped; each phone is rate-limited on
 *  its own (10/s). Never touches a ledger. */
export function createPhoneAiRepublisher(opts: { feed: Pick<AiFeed, 'publish'>; now?: () => number; setTimer?: (fn: () => void, ms: number) => unknown }) {
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const phones = new Map<string, AnnouncedPhone>();
  /** Per phone: events waiting for a slot (FIFO), and whether a drain is due. */
  const queues = new Map<string, PhoneAiEvent[]>();
  const draining = new Set<string>();
  /** Each phone's latest own cloud total (replayed to a monitor that opens late). */
  const lastBytes = new Map<string, number>();
  const limiter = createRateLimiter({ ...HOST_AI_EVENT_RATE, now: opts.now });
  // "This phone is here": the monitor's tab for it stops saying Not connected
  // as soon as it pairs, before (and whether or not) it ever runs an AI turn.
  // Sent as the phone's own byte total, which changes nothing else there.
  const present = (id: string, phone: AnnouncedPhone): void => {
    const tag = { device: phone.platform === 'ios' ? 'iphone' as const : 'android' as const, deviceLabel: capText(phone.label).slice(0, 40) };
    opts.feed.publish({ kind: 'bytes', total: lastBytes.get(id) ?? 0, ...tag });
  };
  return {
    /** Record a phone's announce; returns its label. Without a deviceId the
     *  phone is placed as before but its aiEvents are not accepted. */
    announce(platform: PhonePlatform, deviceId?: unknown, native?: unknown): string {
      const label = phoneDeviceLabel(platform, native !== false);
      if (isDeviceId(deviceId)) {
        const known = phones.get(deviceId);
        const phone = { platform, label };
        phones.set(deviceId, phone);
        if (!known || known.platform !== platform || known.label !== label) present(deviceId, phone);
      }
      return label;
    },
    /** A monitor just opened (said hello): tell it which phones are here and
     *  what each has sent so far. Phone lines are never in the laptop snapshot. */
    replay(): void { phones.forEach((phone, id) => present(id, phone)); },
    /** Forget every announced phone (a phone dropped / the relay closed). */
    clear(): void { phones.clear(); limiter.clear(); queues.clear(); draining.clear(); lastBytes.clear(); },
    /** Returns whether the event was accepted: it reached the feed, or waits
     *  its turn (≤10/s per phone — over that it is queued, never dropped). */
    handle(text: string): boolean {
      const ev = coerceAiEvent(text);
      if (!ev) return false;
      const phone = phones.get(ev.id);
      if (!phone) return false;
      if (ev.k === 'bytes') lastBytes.set(ev.id, ev.bytes);
      const q = queues.get(ev.id);
      if (!q?.length && limiter.allow(ev.id)) {
        opts.feed.publish(phoneAiEventToFeed(ev, phone));
        return true;
      }
      const queue = q ?? [];
      queue.push(ev);
      if (queue.length > HOST_AI_EVENT_QUEUE_MAX) queue.shift();
      queues.set(ev.id, queue);
      schedule(ev.id);
      return true;
    },
    /** Events still waiting for a slot (all phones). */
    queued(): number { let n = 0; queues.forEach((q) => { n += q.length; }); return n; },
  };

  function schedule(id: string): void {
    if (draining.has(id)) return;
    draining.add(id);
    setTimer(() => drain(id), Math.max(1, limiter.waitMs(id)));
  }
  function drain(id: string): void {
    draining.delete(id);
    const q = queues.get(id);
    const phone = phones.get(id);
    if (!q || !phone) { queues.delete(id); return; }
    while (q.length && limiter.allow(id)) opts.feed.publish(phoneAiEventToFeed(q.shift()!, phone));
    if (q.length) schedule(id); else queues.delete(id);
  }
}

const ROUTE_NOTES: readonly string[] = [
  APPLE_ON_DEVICE_NOTE, NO_NANO_NOTE, PHONE_NANO_NOTE, ROUTE_VIA_HUB,
  'Nano · on device — nothing left this device',
  'Gemini · cloud — sent your words and device names to improve the layout',
  ...Object.values(ROUTE_LINES),
];
const FIXED_APP_LINES: readonly string[] = [
  ...ROUTE_NOTES,
  LAMP_RANGE_REFUSAL, VOLUME_RANGE_REFUSAL,
  ...(Object.values(FAIL_LINES) as unknown[]).filter((v): v is string => typeof v === 'string'),
  'no camera or gimbal here, so the photo is simulated.',
];

/** App-authored text an on-phone engine may send as-is (or a safe rewrite of
 *  it); null when the text is not a known template. */
export function appAuthoredLine(text: string): string | null {
  const t = text.replace(/^SIM · /, '');
  const sim = t !== text ? 'SIM · ' : '';
  if (FIXED_APP_LINES.includes(t)) return sim + t;
  if (/^\d{1,3} tiles? filled$/.test(t)) return sim + t;
  if (/^Kannada pack ready · \d{1,4} swaps$/.test(t)) return sim + t;
  // Try-to-break refusal names the thing she said — keep the template only.
  if (/^There's no .{1,60} connected\. Nothing changed\.$/.test(t)) return `${sim}No such device connected. Nothing changed.`;
  if (/^(?:SIM · )?the model didn’t answer; checking your request directly\.$/.test(t)) return text;
  return null;
}

const HANDOFF_REASONS: readonly string[] = [
  'group the lights',
  'group the lights and add a room plan',
  'plan the Kannada pack — too complex for on-device',
];
/** App-authored handoff reasons; anything else becomes "handed off". */
export function safeHandoffReason(reason: string): string {
  const r = reason.replace(/^[→←]\s*(?:nano|gemini):\s*/, '');
  const arrow = reason.slice(0, reason.length - r.length);
  if (HANDOFF_REASONS.includes(r) || /^apply \d{1,4} label swaps locally$/.test(r)) return arrow + r;
  if (/^edit one tile\b/.test(r)) return `${arrow}edit one tile`;
  return LOCAL_FIXED_LINE.handoff;
}

/** Phone side: make a feed line safe to leave the phone. `engine` is the
 *  engine the line is sent under. Never returns raw on-phone text. */
export function phoneSafeText(engine: PhoneAiEngine, verb: LogVerb, text: string, people: readonly Person[]): string {
  if (verb === 'redact') {
    const tok = /(\[[^\]\n]{1,40}\])\s*$/.exec(text);
    return tok ? `name kept on the phone → ${capText(tok[1]!)}` : LOCAL_FIXED_LINE.redact;
  }
  if (verb === 'handoff') return capText(safeHandoffReason(text));
  if (engine === 'gemini') {
    // Already sent to the cloud (redacted); keep that same redaction.
    const red = maskAddresses(protectForCloud(text, people).text);
    return nothingRaw(red, people) ? capText(red) : LOCAL_FIXED_LINE[verb];
  }
  if (verb === 'received') return LOCAL_RECEIVED_LINE;
  const app = appAuthoredLine(text);
  return app === null ? LOCAL_FIXED_LINE[verb] : capText(maskAddresses(app));
}

export interface PhoneAiForwarderOptions {
  /** This phone's install deviceId (the same one its announce carries). */
  deviceId: string;
  /** Which on-phone engine backs the "nano" terminal right now. */
  localEngine: () => Exclude<PhoneAiEngine, 'gemini'>;
  people?: () => readonly Person[];
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  max?: number;
  windowMs?: number;
}

export interface PhoneAiForwarder extends AiFeed {
  /** Bind (or clear) the relay session; without one, events are dropped.
   *  `onlyIf`: clear only while that session is still the bound one — a stale
   *  join that is torn down late must not unbind the session that replaced it. */
  bind(session: { sendCommand(cmd: RelayCommand): Promise<void> } | null, onlyIf?: object): void;
}

type Build = () => PhoneAiEvent | null;

/** The phone's AiFeed tap: modelPanels → compact aiEvent relay commands.
 *  ≤5/s. Over the limit, log lines wait in a FIFO of 10 (oldest dropped past
 *  that), and the latest state per engine and latest byte total replace any
 *  queued older one — all flushed in order as slots free. Lines are only
 *  redacted when they are actually sent. */
export function createPhoneAiForwarder(opts: PhoneAiForwarderOptions): PhoneAiForwarder {
  const limiter = createRateLimiter({ max: opts.max, windowMs: opts.windowMs, now: opts.now });
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const people = opts.people ?? (() => []);
  const id = opts.deviceId;
  let session: { sendCommand(cmd: RelayCommand): Promise<void> } | null = null;
  const queue: Array<{ key?: string; build: Build }> = [];
  let timer = false;

  const sendNow = (build: Build): void => {
    const ev = build();
    if (!ev || !session) return;
    const text = JSON.stringify(ev);
    if (text.length > AI_EVENT_JSON_MAX) return;
    try { void session.sendCommand({ kind: 'aiEvent', text }).catch(() => undefined); } catch { /* best-effort */ }
  };
  const schedule = (): void => {
    if (timer || !queue.length) return;
    timer = true;
    setTimer(flush, Math.max(1, limiter.waitMs()));
  };
  function flush(): void {
    timer = false;
    while (queue.length && session && limiter.allow()) sendNow(queue.shift()!.build);
    if (!session) queue.length = 0;
    schedule();
  }
  const emit = (build: Build, key?: string): void => {
    if (!session) return;
    if (key) {
      const i = queue.findIndex((q) => q.key === key);
      if (i >= 0) queue.splice(i, 1);
    }
    // Rate check first: only lines that are sent now get redacted now.
    if (!queue.length && limiter.allow()) { sendNow(build); return; }
    queue.push({ key, build });
    const logs = queue.filter((q) => !q.key);
    if (logs.length > AI_EVENT_QUEUE_MAX) queue.splice(queue.indexOf(logs[0]!), 1);
    schedule();
  };
  const mapEngine = (e: FeedEngine): PhoneAiEngine => (e === 'gemini' ? 'gemini' : e === 'nano' ? opts.localEngine() : e);

  return {
    bind(s, onlyIf) {
      if (!s && onlyIf && session !== onlyIf) return;
      session = s;
      if (!s) queue.length = 0;
    },
    onHello() { /* the phone has no monitor of its own */ },
    publish(m) {
      if (!session) return;
      switch (m.kind) {
        case 'log': {
          if (!(VERBS as readonly string[]).includes(m.verb)) return;
          const verb = m.verb as LogVerb;
          const ran = mapEngine(m.engine);
          // Receiving and redacting are rule-based steps, not a model's work.
          const engine: PhoneAiEngine = ran !== 'gemini' && (verb === 'received' || verb === 'redact') ? 'rules' : ran;
          const raw = m.text;
          emit(() => ({ k: 'log', id, engine, verb, text: phoneSafeText(ran === 'gemini' ? 'gemini' : engine, verb, raw, people()) }));
          return;
        }
        case 'state': {
          // State only — the line repeats a log detail that may be local text.
          const engine = mapEngine(m.engine);
          const state = m.state;
          emit(() => ({ k: 'state', id, engine, state }), `state:${engine}`);
          return;
        }
        case 'handoff': {
          const from = mapEngine(m.from);
          const to = mapEngine(m.to);
          const raw = m.text;
          emit(() => ({ k: 'handoff', id, from, to, text: capText(safeHandoffReason(raw)) }));
          return;
        }
        case 'bytes': {
          const bytes = Math.max(0, Math.round(m.total));
          emit(() => ({ k: 'bytes', id, bytes }), 'bytes');
          return;
        }
        default:
          return;
      }
    },
  };
}

/** Fan one feed's publish out to several (the phone keeps its local
 *  BroadcastChannel feed and also forwards to the laptop). */
export function teeFeed(...feeds: AiFeed[]): AiFeed {
  return {
    publish(m) { feeds.forEach((f) => { try { f.publish(m); } catch { /* best-effort */ } }); },
    onHello(f) { feeds.forEach((x) => x.onHello(f)); },
  };
}

/** Host side: which announces are live. The room keeps every old message and
 *  replays it when the laptop reloads, so an announce only counts when it
 *  names the laptop's CURRENT session id (the phone learns it from the
 *  laptop's whoIsThere / pong, which history cannot contain). Anything else
 *  is 'stale': the laptop asks who is there (at most once per `askGapMs`) and
 *  a phone that is really present answers with the right id. */
export function createAnnounceGate(opts: { now?: () => number; askGapMs?: number } = {}) {
  const now = opts.now ?? (() => Date.now());
  const askGapMs = opts.askGapMs ?? 2000;
  const seen = new Set<string>();
  let lastAsk = -Infinity;
  return {
    /** 'stale' — not for this session; 'first' — this phone's first live
     *  announce of the session (place it, show it); 'again' — a keep-alive. */
    check(announceSid: unknown, hostSid: string | null | undefined, key: string): 'stale' | 'first' | 'again' {
      if (!hostSid || announceSid !== hostSid) return 'stale';
      if (seen.has(key)) return 'again';
      seen.add(key);
      return 'first';
    },
    /** True when a whoIsThere may be sent now (and counts it as sent). */
    shouldAsk(): boolean {
      if (now() - lastAsk < askGapMs) return false;
      lastAsk = now();
      return true;
    },
    /** A phone dropped: every phone must prove itself again. */
    clear(): void { seen.clear(); },
  };
}
