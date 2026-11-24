// A phone's AI activity on the laptop's AI monitor. The phone shell runs the
// same modelPanels terminals as the laptop; their feed messages are turned
// here into compact `aiEvent` relay commands (phone side), and the laptop
// coerces them strictly and republishes them into its own AI feed tagged with
// the device (host side). Display only: an aiEvent is not model inference and
// is never recorded in any ledger or counted in any "sent to cloud" total —
// its `bytes` field is the PHONE's own honest cloud total, shown per device.
//
// Privacy: the phone never forwards raw text it kept local. A local engine's
// `received` line (the raw utterance) becomes a fixed status line, a `redact`
// line keeps only its token, every other line goes through the same
// protectForCloud redaction the phone applies before a cloud call (and is
// dropped if a known name still shows), and every text is capped at 120 chars.

import type { AiFeed, AiFeedMsg, DistributiveOmit, FeedEngine } from './aiFeed';
import type { EngineState } from './engineBar';
import type { LogVerb } from './modelPanels';
import type { PhonePlatform } from './screenLayout';
import type { RelayCommand } from '../relay/protocol';
import { AI_EVENT_JSON_MAX } from '../relay/protocol';
import { nothingRaw, protectForCloud, type Person } from '../privacy/directory';

/** Which engine ran on the phone. 'apple' = Apple Foundation Models (iPhone),
 *  'nano' = an Android on-device model, 'gemini' = Gemini cloud via Firebase
 *  AI Logic, 'rules' = no model (local status lines only). */
export type PhoneAiEngine = 'apple' | 'nano' | 'gemini' | 'rules';

export type PhoneAiEvent =
  | { k: 'log'; platform: PhonePlatform; engine: PhoneAiEngine; verb: LogVerb; text: string }
  | { k: 'state'; platform: PhonePlatform; engine: PhoneAiEngine; state: EngineState }
  | { k: 'handoff'; platform: PhonePlatform; from: PhoneAiEngine; to: PhoneAiEngine; text: string }
  | { k: 'bytes'; platform: PhonePlatform; bytes: number };

export const AI_EVENT_TEXT_MAX = 120;
export const AI_EVENT_RATE = { max: 5, windowMs: 1000 } as const;
/** A phone's cloud total is a running byte count; anything past this is junk. */
const BYTES_MAX = 1_000_000_000;

const ENGINES: readonly PhoneAiEngine[] = ['apple', 'nano', 'gemini', 'rules'];
const VERBS: readonly LogVerb[] = ['received', 'redact', 'handoff', 'plan', 'build', 'fill', 'done', 'replied', 'queued', 'note', 'fail'];
const STATES: readonly EngineState[] = ['idle', 'working', 'done', 'queued', 'failed', 'unavailable'];

export const LOCAL_RECEIVED_LINE = 'request received · stayed on the phone';

/** Strip control characters and cap at 120 chars (with an ellipsis). */
export function capText(s: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return clean.length > AI_EVENT_TEXT_MAX ? `${clean.slice(0, AI_EVENT_TEXT_MAX - 1)}…` : clean;
}

const isEngine = (x: unknown): x is PhoneAiEngine => typeof x === 'string' && (ENGINES as readonly string[]).includes(x);
const isPlatform = (x: unknown): x is PhonePlatform => x === 'ios' || x === 'android';

/** Strictly coerce an aiEvent payload from the wire (JSON text or object).
 *  Unknown kinds → null; unknown fields are dropped; engine/verb/state are
 *  whitelisted; text is capped; bytes must be a finite non-negative integer. */
export function coerceAiEvent(raw: unknown): PhoneAiEvent | null {
  let o: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw || raw.length > AI_EVENT_JSON_MAX) return null;
    try { o = JSON.parse(raw); } catch { return null; }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const m = o as Record<string, unknown>;
  if (!isPlatform(m.platform)) return null;
  const platform = m.platform;
  const text = (): string | null => (typeof m.text === 'string' ? capText(m.text) : null);
  switch (m.k) {
    case 'log': {
      if (!isEngine(m.engine) || typeof m.verb !== 'string' || !(VERBS as readonly string[]).includes(m.verb)) return null;
      const t = text();
      return t === null ? null : { k: 'log', platform, engine: m.engine, verb: m.verb as LogVerb, text: t };
    }
    case 'state':
      if (!isEngine(m.engine) || typeof m.state !== 'string' || !(STATES as readonly string[]).includes(m.state)) return null;
      return { k: 'state', platform, engine: m.engine, state: m.state as EngineState };
    case 'handoff': {
      if (!isEngine(m.from) || !isEngine(m.to)) return null;
      const t = text();
      return t === null ? null : { k: 'handoff', platform, from: m.from, to: m.to, text: t };
    }
    case 'bytes':
      if (typeof m.bytes !== 'number' || !Number.isInteger(m.bytes) || m.bytes < 0 || m.bytes > BYTES_MAX) return null;
      return { k: 'bytes', platform, bytes: m.bytes };
    default:
      return null;
  }
}

/** The label the laptop shows for a phone, from that phone's announce. */
export function phoneDeviceLabel(platform: PhonePlatform): string {
  return platform === 'ios' ? 'iPhone' : 'Nothing phone';
}

type FeedOut = DistributiveOmit<AiFeedMsg, 'v' | 'sid' | 't'>;

/** The feed only knows Nano/Gemini/Apple; 'rules' (no model ran) has no
 *  monitor column, so it is not republished rather than mislabelled. */
const feedEngine = (e: PhoneAiEngine): FeedEngine | null => (e === 'rules' ? null : e);

/** Host side: one coerced phone event → a device-tagged feed message. */
export function phoneAiEventToFeed(ev: PhoneAiEvent, deviceLabel: string): FeedOut | null {
  const tag = { device: ev.platform === 'ios' ? 'iphone' as const : 'android' as const, deviceLabel: capText(deviceLabel).slice(0, 40) };
  switch (ev.k) {
    case 'log': {
      const engine = feedEngine(ev.engine);
      return engine ? { kind: 'log', engine, verb: ev.verb, text: ev.text, ...tag } : null;
    }
    case 'state': {
      const engine = feedEngine(ev.engine);
      return engine ? { kind: 'state', engine, state: ev.state, ...tag } : null;
    }
    case 'handoff': {
      const from = feedEngine(ev.from);
      const to = feedEngine(ev.to);
      return from && to ? { kind: 'handoff', from, to, text: ev.text, ...tag } : null;
    }
    case 'bytes':
      return { kind: 'bytes', total: ev.bytes, ...tag };
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
  };
}

/** Host side: phones that announced themselves → the laptop's AI feed.
 *  An aiEvent from a platform that never announced is dropped; each phone is
 *  rate-limited on its own. Never touches a ledger. */
export function createPhoneAiRepublisher(opts: { feed: Pick<AiFeed, 'publish'>; now?: () => number }) {
  const labels = new Map<PhonePlatform, string>();
  const limiter = createRateLimiter({ now: opts.now });
  return {
    announce(platform: PhonePlatform): string {
      const label = phoneDeviceLabel(platform);
      labels.set(platform, label);
      return label;
    },
    /** Returns whether the event reached the feed. */
    handle(text: string): boolean {
      const ev = coerceAiEvent(text);
      if (!ev) return false;
      const label = labels.get(ev.platform);
      if (!label || !limiter.allow(ev.platform)) return false;
      const msg = phoneAiEventToFeed(ev, label);
      if (!msg) return false;
      opts.feed.publish(msg);
      return true;
    },
  };
}

/** Phone side: make a feed line safe to leave the phone, or null to drop it. */
export function phoneSafeText(engine: PhoneAiEngine, verb: string, text: string, people: readonly Person[]): string | null {
  if (verb === 'received' && engine !== 'gemini') return LOCAL_RECEIVED_LINE;
  if (verb === 'redact') {
    const tok = /(\[[^\]\n]{1,40}\])\s*$/.exec(text);
    return tok ? `name kept on the phone → ${tok[1]}` : null;
  }
  const red = protectForCloud(text, people).text;
  if (!nothingRaw(red, people)) return null;
  return capText(red);
}

export interface PhoneAiForwarderOptions {
  platform: PhonePlatform;
  /** Which on-phone engine backs the "nano" terminal right now. */
  localEngine: () => Exclude<PhoneAiEngine, 'gemini'>;
  people?: () => readonly Person[];
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  max?: number;
  windowMs?: number;
}

export interface PhoneAiForwarder extends AiFeed {
  /** Bind (or clear) the relay session; without one, events are dropped. */
  bind(session: { sendCommand(cmd: RelayCommand): Promise<void> } | null): void;
}

/** The phone's AiFeed tap: modelPanels → compact aiEvent relay commands.
 *  ≤5/s; over the limit, log lines are dropped while the latest state per
 *  engine and the latest byte total are held and sent when a slot opens. */
export function createPhoneAiForwarder(opts: PhoneAiForwarderOptions): PhoneAiForwarder {
  const limiter = createRateLimiter({ max: opts.max, windowMs: opts.windowMs, now: opts.now });
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const people = opts.people ?? (() => []);
  let session: { sendCommand(cmd: RelayCommand): Promise<void> } | null = null;
  const pending = new Map<string, PhoneAiEvent>();
  let timer = false;

  const sendNow = (ev: PhoneAiEvent): void => {
    const text = JSON.stringify(ev);
    if (!session || text.length > AI_EVENT_JSON_MAX) return;
    try { void session.sendCommand({ kind: 'aiEvent', text }).catch(() => undefined); } catch { /* best-effort */ }
  };
  const flush = (): void => {
    timer = false;
    for (const [key, ev] of pending) {
      if (!session) { pending.clear(); return; }
      if (!limiter.allow()) break;
      pending.delete(key);
      sendNow(ev);
    }
    if (pending.size && !timer) { timer = true; setTimer(flush, Math.max(1, limiter.waitMs())); }
  };
  const emit = (ev: PhoneAiEvent, coalesceKey?: string): void => {
    if (!session) return;
    if (limiter.allow()) {
      if (coalesceKey) pending.delete(coalesceKey);
      sendNow(ev);
      return;
    }
    if (!coalesceKey) return; // a dropped log line
    pending.set(coalesceKey, ev);
    if (!timer) { timer = true; setTimer(flush, Math.max(1, limiter.waitMs())); }
  };
  const mapEngine = (e: FeedEngine): PhoneAiEngine => (e === 'gemini' ? 'gemini' : opts.localEngine());

  return {
    bind(s) { session = s; if (!s) pending.clear(); },
    onHello() { /* the phone has no monitor of its own */ },
    publish(m) {
      if (!session) return;
      const platform = opts.platform;
      switch (m.kind) {
        case 'log': {
          const engine = mapEngine(m.engine);
          const text = phoneSafeText(engine, m.verb, m.text, people());
          if (text === null || !(VERBS as readonly string[]).includes(m.verb)) return;
          emit({ k: 'log', platform, engine, verb: m.verb as LogVerb, text });
          return;
        }
        case 'state': {
          // State only — the line repeats a log detail that may be local text.
          const engine = mapEngine(m.engine);
          emit({ k: 'state', platform, engine, state: m.state }, `state:${engine}`);
          return;
        }
        case 'handoff': {
          const text = phoneSafeText('gemini', 'handoff', m.text, people());
          if (text === null) return;
          emit({ k: 'handoff', platform, from: mapEngine(m.from), to: mapEngine(m.to), text });
          return;
        }
        case 'bytes':
          emit({ k: 'bytes', platform, bytes: Math.max(0, Math.round(m.total)) }, 'bytes');
          return;
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
