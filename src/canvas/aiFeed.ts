// The AI feed: what Nano and Gemini are doing, broadcast over a
// BroadcastChannel so monitor.html (dragged onto a second display) can show it
// live. Same browser, same machine, no network. Every message carries a
// per-tab session id and a timestamp so the monitor can follow the newest tab
// and ignore stragglers. The feed also keeps a short history so a monitor that
// opens (or reloads) mid-turn gets a snapshot when it says hello.
import type { EngineId } from './aiTurn';
import type { EngineState } from './engineBar';

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Which device an event came from. Absent = the laptop (this canvas). */
export type FeedDevice = 'laptop' | 'iphone' | 'android';
/** Engines a feed event may name: the laptop's Nano/Gemini, plus Apple
 *  Foundation Models when an iPhone ran a turn on device. */
export type FeedEngine = EngineId | 'apple';
/** Optional device tags on log/state/handoff/bytes. A phone's events carry
 *  `device` + `deviceLabel` ("iPhone", "Nothing phone"); a `bytes` message
 *  with a phone `device` is that phone's OWN cloud total, not the laptop's. */
export interface FeedDeviceTag { device?: FeedDevice; deviceLabel?: string }

/** Snapshot `lines` entries are `verb\ttext`; snapshot `lane` entries are
 *  `handoff\tNano → Gemini: reason` or `redact\ttext`. */
export type AiFeedMsg = { v: 1; sid: string; t: number } & (
  | ({ kind: 'log'; engine: FeedEngine; verb: string; text: string } & FeedDeviceTag)
  | ({ kind: 'state'; engine: FeedEngine; state: EngineState; line?: string } & FeedDeviceTag)
  | ({ kind: 'handoff'; from: FeedEngine; to: FeedEngine; text: string } & FeedDeviceTag)
  | ({ kind: 'bytes'; total: number } & FeedDeviceTag)
  | { kind: 'snapshot'; engines: Record<EngineId, { state: EngineState; line?: string; lines: string[] }>; total: number; lane?: string[] }
  | { kind: 'hello' }
);

export interface FeedChannel {
  postMessage(m: unknown): void;
  addEventListener(t: 'message', f: (e: { data: unknown }) => void): void;
}

export interface AiFeed {
  publish(m: DistributiveOmit<AiFeedMsg, 'v' | 'sid' | 't'>): void;
  onHello(f: () => void): void;
}

export const FEED_CHANNEL = 'mendcraft-ai';
export const FEED_KEEP_LINES = 40;
const LANE_KEEP = 20;
const NAME: Record<FeedEngine, string> = { nano: 'Nano', gemini: 'Gemini', apple: 'Apple' };

export function handoffLabel(from: FeedEngine, to: FeedEngine, text: string): string {
  return `${NAME[from]} → ${NAME[to]}: ${text}`;
}

export function isAiFeedMsg(d: unknown): d is AiFeedMsg {
  if (!d || typeof d !== 'object') return false;
  const m = d as Record<string, unknown>;
  if (m.v !== 1 || typeof m.sid !== 'string' || typeof m.t !== 'number') return false;
  const eng = (x: unknown) => x === 'nano' || x === 'gemini' || x === 'apple';
  const tagOk = (m.device === undefined || m.device === 'laptop' || m.device === 'iphone' || m.device === 'android')
    && (m.deviceLabel === undefined || typeof m.deviceLabel === 'string');
  if (!tagOk) return false;
  switch (m.kind) {
    case 'log': return eng(m.engine) && typeof m.verb === 'string' && typeof m.text === 'string';
    case 'state': return eng(m.engine) && typeof m.state === 'string';
    case 'handoff': return eng(m.from) && eng(m.to) && typeof m.text === 'string';
    case 'bytes': return typeof m.total === 'number' && Number.isFinite(m.total);
    case 'snapshot': {
      const e = m.engines as Record<string, { lines?: unknown } | undefined> | undefined;
      return typeof m.total === 'number' && !!e && (['nano', 'gemini'] as const).every((k) => !!e[k] && Array.isArray(e[k]!.lines));
    }
    case 'hello': return true;
    default: return false;
  }
}

function defaultChannel(): FeedChannel | null {
  try {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel(FEED_CHANNEL) : null;
  } catch { return null; }
}

function newSid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createAiFeed(opts: { channel?: FeedChannel | null } = {}): AiFeed {
  const channel = opts.channel === undefined ? defaultChannel() : opts.channel;
  const sid = newSid();
  const engines: Record<EngineId, { state: EngineState; line?: string; lines: string[] }> = {
    nano: { state: 'idle', lines: [] },
    gemini: { state: 'idle', lines: [] },
  };
  let total = 0;
  const lane: string[] = [];
  const helloListeners: Array<() => void> = [];

  const send = (m: DistributiveOmit<AiFeedMsg, 'v' | 'sid' | 't'>) => {
    try { channel?.postMessage({ v: 1, sid, t: Date.now(), ...m }); } catch { /* the feed is best-effort */ }
  };
  const pushLane = (s: string) => {
    lane.push(s);
    if (lane.length > LANE_KEEP) lane.splice(0, lane.length - LANE_KEEP);
  };

  channel?.addEventListener('message', (e) => {
    const d = e.data as { kind?: unknown; v?: unknown } | null;
    if (!d || typeof d !== 'object' || d.v !== 1 || d.kind !== 'hello') return;
    const copy = JSON.parse(JSON.stringify(engines)) as typeof engines;
    send({ kind: 'snapshot', engines: copy, total, lane: [...lane] });
    helloListeners.forEach((f) => f());
  });

  return {
    publish(m) {
      // A phone's events pass straight through: they never touch the laptop's
      // engine cards, lane or byte total (the snapshot stays laptop-only).
      if (isPhoneTagged(m)) { send(m); return; }
      if (m.kind === 'log') {
        if (m.engine === 'apple') { send(m); return; }
        const l = engines[m.engine].lines;
        l.push(`${m.verb}\t${m.text}`);
        if (l.length > FEED_KEEP_LINES) l.splice(0, l.length - FEED_KEEP_LINES);
        if (m.verb === 'redact') pushLane(`redact\t${m.text}`);
      } else if (m.kind === 'state') {
        if (m.engine === 'apple') { send(m); return; }
        engines[m.engine].state = m.state;
        if (m.line !== undefined) engines[m.engine].line = m.line;
      } else if (m.kind === 'bytes') {
        total = m.total;
      } else if (m.kind === 'handoff') {
        pushLane(`handoff\t${handoffLabel(m.from, m.to, m.text)}`);
      }
      send(m);
    },
    onHello(f) { helloListeners.push(f); },
  };
}

/** True when a message is tagged as coming from a phone (not this laptop). */
export function isPhoneTagged(m: object): boolean {
  const d = (m as { device?: unknown }).device;
  return d === 'iphone' || d === 'android';
}
