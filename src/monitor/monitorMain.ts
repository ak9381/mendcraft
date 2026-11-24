// The AI monitor — "two minds, one boundary". A stage view for a wide second
// display, one device at a time: THIS DEVICE (its on-device model) on the
// left, a luminous vertical boundary in the middle, the CLOUD (Gemini, for
// requests from that device only) on the right. Tabs switch between the
// laptop, the iPhone and the Android phone; each keeps its own history.
// Packets cross the boundary only when the feed reports real bytes leaving
// that device; redactions are shown only from real `redact` log lines.
//
// Honesty: everything here is derived from what the canvas broadcasts over the
// feed channel — no line, byte, name, packet or task is ever invented. Built
// with createElement/textContent only so it runs under the suite's node-only
// fake DOM.
import './monitor.css';
import {
  FEED_CHANNEL, isAiFeedMsg, type AiFeedMsg, type FeedChannel, type FeedDevice, type FeedEngine,
} from '../canvas/aiFeed';
import type { EngineState } from '../canvas/engineBar';
import { formatFooterBytes } from '../canvas/modelPanels';

export type MonitorEngine = FeedEngine;
/** Raw log lines kept per half (only the newest few are visible). */
export const MONITOR_MAX_LINES = 40;
export const DEVICES: readonly FeedDevice[] = ['laptop', 'iphone', 'android'];

const STATE_TEXT: Record<EngineState, string> = {
  idle: 'Ready', working: 'Working', done: 'Done', queued: 'Queued', failed: 'Failed', unavailable: 'Unavailable',
};
const DEVICE_NAME: Record<FeedDevice, string> = { laptop: 'Laptop', iphone: 'iPhone', android: 'Android phone' };
const DEVICE_MODEL: Record<FeedDevice, string> = {
  laptop: 'Gemini Nano', iphone: 'Apple on-device model', android: 'No on-device model',
};
const ENGINE_MODEL: Record<Exclude<MonitorEngine, 'gemini'>, string> = {
  nano: 'Gemini Nano', apple: 'Apple on-device model', rules: 'On this phone · no model',
};
/** Devices with no on-device model: their top half honestly says so. */
const CLOUD_ONLY: ReadonlySet<FeedDevice> = new Set(['android']);

const isCloud = (e: MonitorEngine) => e === 'gemini';

// ---------------------------------------------------------------------------
// Pure derivations (exported for tests)
// ---------------------------------------------------------------------------

/** "412 B" / "2.2 KB" — formatFooterBytes without its suffix. */
export function bytesShort(n: number): string {
  return formatFooterBytes(n).replace(/ sent to cloud$/, '');
}

/** Strip a leading "SIM · " tag (the log keeps it; the headline shows a
 *  separate SIM badge instead, so it is never hidden). */
export function stripSim(text: string): { text: string; sim: boolean } {
  const m = /^\s*SIM\s*·\s*/.exec(text);
  return m ? { text: text.slice(m[0].length), sim: true } : { text, sim: /\bSIM\b/.test(text) };
}

const PROPER = /\b(kannada|hindi|tamil|telugu|marathi|bengali|english|gemini|nano|google|firebase|pinterest)\b/gi;
export function sentenceCase(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  const u = t.charAt(0).toUpperCase() + t.slice(1);
  return u.replace(PROPER, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** "Sharma → [Client A]" (modelPanels.redactLines) → its two halves, or null
 *  if the line doesn't have that shape (then nothing is animated). */
export function parseRedaction(text: string): { name: string; token: string } | null {
  const i = text.lastIndexOf(' → ');
  if (i <= 0) return null;
  const name = text.slice(0, i).trim();
  const token = text.slice(i + 3).trim();
  // A phone's redact line never carries the name ("name kept on the phone →
  // [Client A]"): there is no real name to strike, so show it as-is.
  if (/^name kept on\b/i.test(name)) return null;
  return name && /^\[[^\]]+\]$/.test(token) ? { name, token } : null;
}

export interface Headline { kicker: string; headline: string; tone?: 'fail' | 'done' }

/** What one half's big line says after a log line. Notes return null: they
 *  go to the smaller sub-line (unless nothing else has been said yet). */
export function deriveHeadline(engine: MonitorEngine, verb: string, rawText: string): Headline | null {
  const text = stripSim(rawText).text.replace(/\s+/g, ' ').trim();
  const cloud = isCloud(engine);
  switch (verb) {
    case 'received':
      return cloud ? { kicker: 'Received', headline: 'Received the request' } : { kicker: 'Heard', headline: clip(sentenceCase(text), 90) };
    case 'redact':
      return { kicker: 'Redacting', headline: 'Keeping a name on this device' };
    case 'handoff': {
      const m = /^(→|←)\s*(\w+):\s*(.*)$/.exec(text);
      const reason = m ? m[3]! : text;
      const [what, why] = reason.split(' — ');
      if (m && m[1] === '←') return { kicker: `From ${sentenceCase(m[2]!)}`, headline: clip(sentenceCase(what!), 90) };
      const to = m ? sentenceCase(m[2]!) : '';
      if (cloud) return { kicker: `Handing back${to ? ` to ${to}` : ''}`, headline: clip(`Handing back: ${what}`, 90) };
      return { kicker: `Handing off${to ? ` to ${to}` : ''}`, headline: clip(`Handing off: ${why ?? what}`, 90) };
    }
    case 'plan': return { kicker: 'Planning', headline: clip(sentenceCase(text), 90) };
    case 'build': return { kicker: 'Building', headline: clip(sentenceCase(text), 90) };
    case 'fill': return { kicker: 'Filling', headline: clip(sentenceCase(text), 90) };
    case 'done':
    case 'replied':
      return { kicker: verb === 'done' ? 'Done' : 'Replied', headline: clip(sentenceCase(text.split(' · ')[0]!), 90), tone: 'done' };
    case 'fail':
      return cloud
        ? { kicker: 'Failed', headline: clip(`Failed — ${text}`, 110), tone: 'fail' }
        : { kicker: 'Refused on this device', headline: clip(`Blocked — ${text}`, 110), tone: 'fail' };
    case 'queued':
      return { kicker: 'Queued', headline: clip(sentenceCase(text.split(' — ')[0]!), 90) };
    case 'note': return null;
    default: return { kicker: sentenceCase(verb), headline: clip(sentenceCase(text), 90) };
  }
}

/** A note's sub-line: SIM-stripped, first sentence-ish, clipped. */
export function noteLine(rawText: string): string {
  return clip(sentenceCase(stripSim(rawText).text), 120);
}

// ---------------------------------------------------------------------------
// The ledger: turns, packets and "kept on device" counting
// ---------------------------------------------------------------------------
//
// A TURN on a device opens with its on-device engine's `received` line (every
// AI turn logs one first, see modelPanels.logTurnReceipt), or — for a device
// with no on-device model — with Gemini's `received` line from that device.
//
// Bytes: each `bytes` message carries that device's cumulative ledger total;
// the positive delta since the last one is "pending" until a crossing claims
// it. An OUTBOUND PACKET is launched when the cloud has really received this
// turn's request (Gemini `received` from that device) and pending > 0 —
// whichever of the two arrives second triggers it. No delta, no packet.
//
// KEPT ON DEVICE: a turn counts once, when its on-device engine logs a
// terminal line (done / replied / fail) while the turn has sent 0 bytes, has
// no bytes pending, and Gemini has not touched it (no Gemini line from that
// device, no handoff to the cloud). A refusal decided on the device counts:
// it was handled there and nothing left.

export type Redaction = { text: string; name: string | null; token: string | null };

export type StageEffect =
  | { kind: 'packet'; device: FeedDevice; dir: 'out'; bytes: number; redactions: Redaction[] }
  | { kind: 'packet'; device: FeedDevice; dir: 'back'; label: string }
  | { kind: 'kept'; device: FeedDevice; refused: boolean };

interface Turn { bytes: number; cloud: boolean; cloudReceived: boolean; redactions: Redaction[]; ended: boolean; counted: boolean }

export interface DeviceLedger { lastTotal: number; pending: number; turn: Turn | null; kept: number }

const newTurn = (): Turn => ({ bytes: 0, cloud: false, cloudReceived: false, redactions: [], ended: false, counted: false });

export function createLedger() {
  const devs = {} as Record<FeedDevice, DeviceLedger>;
  const reset = () => { DEVICES.forEach((d) => { devs[d] = { lastTotal: 0, pending: 0, turn: null, kept: 0 }; }); };
  reset();

  const cross = (device: FeedDevice): StageEffect[] => {
    const d = devs[device];
    const t = d.turn;
    if (!t || t.ended || !t.cloudReceived || d.pending <= 0) return [];
    const bytes = d.pending;
    t.bytes += bytes;
    d.pending = 0;
    return [{ kind: 'packet', device, dir: 'out', bytes, redactions: [...t.redactions] }];
  };

  return {
    get: (device: FeedDevice): Readonly<DeviceLedger> => devs[device],
    reset,
    /** Snapshot baseline: the total so far, without animating it. */
    baseline(device: FeedDevice, total: number) { devs[device].lastTotal = Math.max(0, total); devs[device].pending = 0; },
    keptTotal: () => DEVICES.reduce((n, d) => n + devs[d].kept, 0),
    sentTotal: () => DEVICES.reduce((n, d) => n + devs[d].lastTotal, 0),
    bytes(device: FeedDevice, total: number): StageEffect[] {
      const d = devs[device];
      const delta = total - d.lastTotal;
      d.lastTotal = total;
      if (delta > 0) d.pending += delta;
      return cross(device);
    },
    log(device: FeedDevice, engine: MonitorEngine, verb: string, text: string): StageEffect[] {
      const d = devs[device];
      if (isCloud(engine)) {
        if (verb === 'received') {
          if (!d.turn || d.turn.ended || d.turn.cloudReceived) d.turn = newTurn();
          d.turn.cloud = true;
          d.turn.cloudReceived = true;
          return cross(device);
        }
        if (d.turn) d.turn.cloud = true;
        return [];
      }
      if (verb === 'received') { d.turn = newTurn(); return []; }
      const t = d.turn;
      if (!t) return [];
      if (verb === 'redact') {
        const p = parseRedaction(text);
        t.redactions.push({ text, name: p?.name ?? null, token: p?.token ?? null });
        return [];
      }
      if (verb === 'done' || verb === 'replied' || verb === 'fail') {
        t.ended = true;
        if (!t.counted && !t.cloud && t.bytes === 0 && d.pending === 0) {
          t.counted = true;
          d.kept++;
          return [{ kind: 'kept', device, refused: verb === 'fail' }];
        }
      }
      return [];
    },
    handoff(device: FeedDevice, from: MonitorEngine, to: MonitorEngine, text: string): StageEffect[] {
      const d = devs[device];
      if (!isCloud(from) && isCloud(to)) { if (d.turn && !d.turn.ended) d.turn.cloud = true; return []; }
      if (isCloud(from) && !isCloud(to)) return [{ kind: 'packet', device, dir: 'back', label: clip(sentenceCase(text), 48) }];
      return [];
    },
  };
}

export type Ledger = ReturnType<typeof createLedger>;

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

export interface Monitor {
  el: HTMLElement;
  ledger: Ledger;
  /** The device whose view is on screen. */
  active(): FeedDevice;
  select(device: FeedDevice): void;
  follow(): boolean;
  setFollow(on: boolean): void;
  /** Keyboard: 1/2/3 pick a tab, F toggles Follow. Returns true if handled. */
  key(k: string): boolean;
}
type KeySource = { addEventListener(t: 'keydown', f: (e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }) => void): void };
export interface MonitorOptions {
  /** Initial tab (from ?device=); default laptop. */
  device?: FeedDevice | null;
  /** Where keydown is listened for; default the root's document (if any). */
  keys?: KeySource | null;
}

type Half = {
  el: HTMLElement; pill: HTMLElement; pillText: HTMLElement; sim: HTMLElement; kicker: HTMLElement; headline: HTMLElement;
  sub: HTMLElement; redact: HTMLElement; moment: HTMLElement; ticker: HTMLElement; fx: HTMLElement; stat: HTMLElement; title: HTMLElement;
  said: boolean; state: EngineState;
};
type View = {
  el: HTMLElement; tab: HTMLElement; tabName: HTMLElement; tabDot: HTMLElement;
  who: HTMLElement; model: HTMLElement; from: HTMLElement;
  device: Half; cloud: Half; flight: HTMLElement; boundary: HTMLElement; live: boolean; label: string;
};

const PACKET_MS = 2400;
const REDACT_LEAD_MS = 1300;
const ON_DEVICE_IDLE: Record<FeedDevice, { headline: string; sub: string }> = {
  laptop: { headline: 'Ready', sub: '' },
  iphone: { headline: 'Ready', sub: '' },
  android: { headline: 'No on-device model', sub: 'This phone uses the cloud for its requests.' },
};

export function mountMonitor(root: HTMLElement, channel: FeedChannel | null, opts: MonitorOptions = {}): Monitor {
  const doc = root.ownerDocument;
  const make = <T extends HTMLElement = HTMLElement>(tag: string, cls: string, text?: string): T => {
    const e = doc.createElement(tag) as T;
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const later = (ms: number, f: () => void) => { if (typeof setTimeout === 'function') setTimeout(f, ms); };
  const on = (el: unknown, type: string, f: () => void) => {
    const t = el as { addEventListener?: (t: string, f: () => void) => void };
    if (typeof t.addEventListener === 'function') t.addEventListener(type, f);
  };
  const ledger = createLedger();
  let activeDevice: FeedDevice = opts.device ?? 'laptop';
  let following = false;

  const wrap = make('div', 'mon');
  wrap.setAttribute('data-idle', 'true');
  wrap.setAttribute('data-active', activeDevice);
  wrap.setAttribute('data-follow', 'false');
  const bg = make('div', 'mon-bg');
  bg.setAttribute('aria-hidden', 'true');

  // ---- top bar: brand · tabs · follow ----
  const top = make('header', 'mon-top');
  const brand = make('div', 'mon-brand');
  brand.append(make('span', 'mon-brand-name', 'Mendcraft'), make('span', 'mon-brand-tag', 'two minds, one boundary'));
  const tabs = make('nav', 'mon-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Devices');
  const right = make('div', 'mon-top-right');
  const followBtn = make('button', 'mon-follow');
  followBtn.setAttribute('type', 'button');
  followBtn.setAttribute('aria-pressed', 'false');
  followBtn.append(make('span', 'mon-follow-dot'), make('span', 'mon-follow-text', 'Follow'), make('kbd', 'mon-kbd', 'F'));
  const live = make('div', 'mon-live', 'Waiting');
  right.append(followBtn, live);
  top.append(brand, tabs, right);

  const stage = make('div', 'mon-stage');
  const views = {} as Record<FeedDevice, View>;

  const buildHalf = (side: 'device' | 'cloud', device: FeedDevice): Half => {
    const el = make('section', `mon-half mon-half--${side} mon-col`);
    el.setAttribute('data-engine', side === 'cloud' ? 'gemini' : device === 'iphone' ? 'apple' : 'nano');
    el.setAttribute('data-state', 'idle');
    const fx = make('div', 'mon-fx');
    fx.setAttribute('aria-hidden', 'true');
    const head = make('div', 'mon-half-head');
    const title = make('div', 'mon-half-title');
    const sim = make('span', 'mon-sim', 'SIM');
    sim.hidden = true;
    const pill = make('span', 'mon-pill');
    pill.setAttribute('data-state', 'idle');
    const pillText = make('span', 'mon-pill-text', STATE_TEXT.idle);
    pill.append(make('span', 'mon-pill-dot'), pillText);
    head.append(title, sim, pill);
    const kicker = make('div', 'mon-kicker', side === 'cloud' ? 'Gemini' : DEVICE_MODEL[device]);
    const idle = side === 'device' ? ON_DEVICE_IDLE[device] : { headline: 'Ready', sub: '' };
    const headline = make('div', 'mon-headline', idle.headline);
    headline.setAttribute('data-verb', 'idle');
    headline.setAttribute('data-len', 'short');
    const sub = make('div', 'mon-sub', idle.sub);
    const redact = make('div', 'mon-redact');
    const moment = make('div', 'mon-moment');
    const ticker = make('div', 'mon-ticker mon-lines');
    ticker.setAttribute('aria-hidden', 'true');
    const stat = make('div', 'mon-half-stat');
    const story = make('div', 'mon-story');
    story.append(kicker, headline, sub, redact, moment);
    el.append(fx, head, story, ticker, stat);
    return { el, pill, pillText, sim, kicker, headline, sub, redact, moment, ticker, fx, stat, title, said: false, state: 'idle' };
  };

  const buildView = (device: FeedDevice): View => {
    const el = make('div', 'mon-view');
    el.setAttribute('data-device', device);
    el.setAttribute('data-live', 'false');
    el.setAttribute('role', 'tabpanel');
    if (CLOUD_ONLY.has(device)) el.setAttribute('data-cloud-only', 'true');
    el.hidden = device !== activeDevice;

    const dev = buildHalf('device', device);
    const who = make('span', 'mon-where', `This device · ${DEVICE_NAME[device]}`);
    const model = make('span', 'mon-model', DEVICE_MODEL[device]);
    dev.title.append(who, model);

    const cloud = buildHalf('cloud', device);
    const from = make('span', 'mon-model', `requests from ${DEVICE_NAME[device]}`);
    cloud.title.append(make('span', 'mon-where', 'Cloud · Gemini'), from);

    const boundary = make('div', 'mon-boundary');
    boundary.setAttribute('aria-hidden', 'true');
    const bl = make('div', 'mon-boundary-label');
    bl.append(make('span', 'mon-bl-left', 'this device'), make('span', 'mon-bl-bar'), make('span', 'mon-bl-right', 'cloud'));
    boundary.append(make('span', 'mon-boundary-line'), bl);

    const flight = make('div', 'mon-flight');
    flight.setAttribute('aria-hidden', 'true');
    const off = make('div', 'mon-offline');
    off.append(make('span', 'mon-offline-text', 'Not connected'),
      make('span', 'mon-offline-sub', `Nothing has reported from the ${DEVICE_NAME[device]} yet.`));
    el.append(dev.el, boundary, cloud.el, flight, off);

    const tab = make('button', 'mon-tab');
    tab.setAttribute('type', 'button');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('data-device', device);
    tab.setAttribute('data-live', 'false');
    tab.setAttribute('aria-selected', String(device === activeDevice));
    const tabDot = make('span', 'mon-tab-dot');
    tabDot.setAttribute('data-activity', 'idle');
    const tabName = make('span', 'mon-tab-name', DEVICE_NAME[device]);
    tab.append(tabDot, tabName, make('kbd', 'mon-kbd', String(DEVICES.indexOf(device) + 1)));
    on(tab, 'click', () => select(device));

    return { el, tab, tabName, tabDot, who, model, from, device: dev, cloud, flight, boundary, live: false, label: DEVICE_NAME[device] };
  };
  DEVICES.forEach((d) => { views[d] = buildView(d); tabs.append(views[d].tab); stage.append(views[d].el); });

  // ---- footer ----
  const foot = make('footer', 'mon-foot');
  const sentBox = make('div', 'mon-total mon-total--cloud');
  const sentNum = make('span', 'mon-total-num', bytesShort(0));
  sentBox.append(make('span', 'mon-total-label', 'Sent to cloud'), sentNum, make('span', 'mon-total-unit', 'total'));
  const keptBox = make('div', 'mon-total mon-total--kept');
  const keptNum = make('span', 'mon-total-num', '0');
  const keptUnit = make('span', 'mon-total-unit', 'tasks');
  keptBox.append(make('span', 'mon-total-label', 'Kept on device'), keptNum, keptUnit);
  foot.append(keptBox, make('span', 'mon-foot-sep'), sentBox);

  const bytes = make('div', 'mon-bytes mon-sr', formatFooterBytes(0));
  bytes.setAttribute('role', 'status');

  const empty = make('div', 'mon-empty');
  empty.append(make('div', 'mon-empty-title', 'Mendcraft'), make('div', 'mon-empty-tag', 'two minds, one boundary'),
    make('div', 'mon-empty-wait', 'Waiting for the canvas…'));

  wrap.append(bg, top, stage, foot, bytes, empty);
  root.append(wrap);

  // ---- tabs / follow ----
  function select(device: FeedDevice): void {
    activeDevice = device;
    wrap.setAttribute('data-active', device);
    DEVICES.forEach((d) => {
      views[d].el.hidden = d !== device;
      views[d].tab.setAttribute('aria-selected', String(d === device));
    });
  }
  const setFollow = (v: boolean) => {
    following = v;
    followBtn.setAttribute('aria-pressed', String(v));
    wrap.setAttribute('data-follow', String(v));
  };
  on(followBtn, 'click', () => setFollow(!following));
  const key = (k: string): boolean => {
    const n = ['1', '2', '3'].indexOf(k);
    if (n >= 0) { select(DEVICES[n]!); return true; }
    if (k === 'f' || k === 'F') { setFollow(!following); return true; }
    return false;
  };
  const keySrc = opts.keys === undefined ? (doc as unknown as KeySource) : opts.keys;
  if (keySrc && typeof keySrc.addEventListener === 'function') {
    keySrc.addEventListener('keydown', (e) => { if (!e.metaKey && !e.ctrlKey && !e.altKey) key(e.key); });
  }

  // ---- rendering helpers ----
  const restart = (parent: HTMLElement, cls: string): HTMLElement => {
    // Re-creating the element restarts its CSS animation (no classList needed).
    Array.from(parent.children as unknown as HTMLElement[]).filter((c) => c.className === cls).forEach((c) => c.remove());
    const e = make('div', cls);
    parent.append(e);
    return e;
  };
  const activity = (d: FeedDevice) => {
    const s = [views[d].device.state, views[d].cloud.state];
    const a = s.includes('working') ? 'working' : s.includes('failed') ? 'failed' : s.includes('queued') ? 'queued' : s.includes('done') ? 'done' : 'idle';
    views[d].tabDot.setAttribute('data-activity', a);
  };
  const setLive = (device: FeedDevice) => {
    const v = views[device];
    if (v.live) return;
    v.live = true;
    v.el.setAttribute('data-live', 'true');
    v.tab.setAttribute('data-live', 'true');
  };
  const updateTotals = () => {
    const kept = ledger.keptTotal();
    keptNum.textContent = String(kept);
    keptUnit.textContent = kept === 1 ? 'task' : 'tasks';
    const total = ledger.sentTotal();
    sentNum.textContent = bytesShort(total);
    bytes.textContent = formatFooterBytes(total);
    DEVICES.forEach((d) => {
      const l = ledger.get(d);
      views[d].device.stat.textContent = `${l.kept} task${l.kept === 1 ? '' : 's'} kept on this device`;
      views[d].cloud.stat.textContent = `${bytesShort(l.lastTotal)} sent to cloud from ${views[d].label}`;
    });
  };
  const setLabel = (device: FeedDevice, label?: string) => {
    if (!label || !label.trim()) return;
    const l = clip(label.trim(), 32);
    const v = views[device];
    if (v.label === l) return;
    v.label = l;
    v.tabName.textContent = l;
    v.who.textContent = `This device · ${l}`;
    v.from.textContent = `requests from ${l}`;
    updateTotals();
  };
  // A model (nano/apple) names the left side; 'rules' (a phone's rule-based
  // steps, no model) only names it until a model has been seen there.
  const modelSeen = new Set<FeedDevice>();
  const setModel = (device: FeedDevice, engine: MonitorEngine) => {
    if (isCloud(engine)) return;
    if (engine === 'rules' && modelSeen.has(device)) return;
    if (engine !== 'rules') modelSeen.add(device);
    const m = ENGINE_MODEL[engine];
    views[device].model.textContent = m;
    views[device].device.el.setAttribute('data-engine', engine);
    if (!views[device].device.said) views[device].device.kicker.textContent = m;
  };
  const setState = (d: FeedDevice, h: Half, state: EngineState) => {
    h.state = state;
    h.el.setAttribute('data-state', state);
    h.pill.setAttribute('data-state', state);
    h.pillText.textContent = STATE_TEXT[state] ?? String(state);
    activity(d);
  };
  const setHeadline = (h: Half, verb: string, hl: Headline) => {
    h.kicker.textContent = hl.kicker;
    h.headline.textContent = hl.headline;
    h.headline.setAttribute('data-verb', verb);
    h.headline.setAttribute('data-len', hl.headline.length > 64 ? 'xlong' : hl.headline.length > 34 ? 'long' : 'short');
    h.headline.setAttribute('data-tone', hl.tone ?? '');
    h.sub.textContent = '';
    h.said = true;
  };
  const addTick = (h: Half, verb: string, text: string) => {
    const p = make('p', `mon-line mon-line--${verb}`);
    p.append(make('span', 'mon-verb', verb), make('span', 'mon-text', text));
    h.ticker.append(p);
    while (h.ticker.children.length > MONITOR_MAX_LINES) (h.ticker.children[0] as HTMLElement).remove();
  };
  const setSim = (h: Half, v: boolean) => { h.sim.hidden = !v; };
  const clearRedact = (h: Half) => { h.redact.innerHTML = ''; h.redact.setAttribute('data-count', '0'); };
  const showRedaction = (h: Half, text: string, n: number) => {
    if (n > 3) return; // three rows is plenty on screen; the ticker has every line
    const row = make('div', 'mon-redact-row');
    const r = parseRedaction(text);
    if (r) {
      const name = make('span', 'mon-redact-name');
      name.append(make('span', 'mon-redact-name-text', r.name));
      row.append(name, make('span', 'mon-redact-token', r.token));
    } else {
      row.append(make('span', 'mon-redact-raw', text));
    }
    h.redact.append(row);
    h.redact.setAttribute('data-count', String(n));
  };
  const clearFx = (h: Half) => { h.fx.innerHTML = ''; };

  const launch = (e: StageEffect) => {
    const v = views[e.device];
    if (e.kind === 'kept') {
      const chip = restart(v.device.moment, e.refused ? 'mon-settle mon-settle--refused' : 'mon-settle');
      chip.append(make('span', 'mon-settle-check', '✓'),
        make('span', 'mon-settle-text', e.refused ? 'Decided on this device · 0 B sent' : 'Stayed on this device · 0 B'));
      restart(v.device.fx, 'mon-settle-ring');
      restart(keptBox, 'mon-total-pulse');
      return;
    }
    const pk = make('div', `mon-packet mon-packet--${e.dir}`);
    pk.setAttribute('data-dir', e.dir);
    if (e.dir === 'out') {
      pk.setAttribute('data-bytes', String(e.bytes));
      pk.append(make('span', 'mon-packet-size', bytesShort(e.bytes)));
      const named = e.redactions.length;
      if (named > 0) {
        pk.append(make('span', 'mon-packet-note', `${named} name${named === 1 ? '' : 's'} redacted`));
        pk.setAttribute('data-after-redact', 'true');
      }
    } else {
      pk.append(make('span', 'mon-packet-size', 'Reply'), make('span', 'mon-packet-note', e.label));
    }
    v.flight.append(pk);
    const lead = e.dir === 'out' && e.redactions.length > 0 ? REDACT_LEAD_MS : 0;
    const flash = make('span', 'mon-boundary-flash');
    flash.setAttribute('data-dir', e.dir);
    if (lead) flash.setAttribute('data-after-redact', 'true');
    v.boundary.append(flash);
    // Leave when the flight has actually finished (a throttled or paused
    // animation is never cut short); the timer is only a backstop.
    const done = () => { pk.remove(); flash.remove(); };
    on(pk, 'animationend', done);
    later(lead + PACKET_MS + 8000, done);
    if (e.dir === 'out') restart(sentBox, 'mon-total-pulse');
  };
  const run = (effects: StageEffect[]) => { effects.forEach(launch); updateTotals(); };

  const onLog = (device: FeedDevice, engine: MonitorEngine, verb: string, text: string, animate = true) => {
    const v = views[device];
    const h = isCloud(engine) ? v.cloud : v.device;
    setModel(device, engine);
    const sim = stripSim(text).sim;
    if (verb === 'received') {
      setSim(h, sim);
      if (!isCloud(engine)) { clearRedact(h); clearFx(h); h.moment.innerHTML = ''; clearFx(v.cloud); setSim(v.cloud, false); }
    } else if (sim) setSim(h, true);
    addTick(h, verb, text);
    const effects = animate ? ledger.log(device, engine, verb, text) : [];
    const hl = deriveHeadline(engine, verb, text);
    if (hl) {
      if (verb === 'received' && isCloud(engine)) {
        const b = animate ? ledger.get(device).turn?.bytes ?? 0 : 0;
        hl.headline = b > 0 ? `Received ${bytesShort(b)}` : 'Received the request';
      }
      if (verb === 'redact') {
        const t = ledger.get(device).turn;
        const n = Math.max(1, animate && t ? t.redactions.length : h.redact.children.length + 1);
        hl.headline = `${n} name${n > 1 ? 's' : ''} kept on this device`;
        showRedaction(h, text, n);
      }
      setHeadline(h, verb, hl);
      if (verb === 'fail') {
        // A fail line is a failure even if its state message is lost/late.
        setState(device, h, 'failed');
        if (animate) restart(h.fx, isCloud(engine) ? 'mon-shock mon-shock--cloud' : 'mon-shock');
      }
    } else if (!h.said) {
      setHeadline(h, verb, { kicker: 'Note', headline: noteLine(text) });
    } else {
      h.sub.textContent = noteLine(text);
    }
    run(effects);
  };

  const resetView = (d: FeedDevice) => {
    const v = views[d];
    [v.device, v.cloud].forEach((h) => {
      h.ticker.innerHTML = ''; clearRedact(h); clearFx(h); h.moment.innerHTML = ''; setState(d, h, 'idle'); setSim(h, false); h.said = false;
      h.headline.setAttribute('data-verb', 'idle'); h.headline.setAttribute('data-tone', ''); h.headline.setAttribute('data-len', 'short');
    });
    v.device.headline.textContent = ON_DEVICE_IDLE[d].headline;
    v.device.sub.textContent = ON_DEVICE_IDLE[d].sub;
    v.device.kicker.textContent = DEVICE_MODEL[d];
    v.cloud.headline.textContent = 'Ready'; v.cloud.sub.textContent = ''; v.cloud.kicker.textContent = 'Gemini';
    v.flight.innerHTML = '';
  };
  const clear = () => { ledger.reset(); modelSeen.clear(); DEVICES.forEach(resetView); updateTotals(); };
  const splitTab = (s: string): [string, string] => {
    const i = s.indexOf('\t');
    return i < 0 ? ['note', s] : [s.slice(0, i), s.slice(i + 1)];
  };

  const touch = (m: { device?: FeedDevice; deviceLabel?: string }): FeedDevice => {
    const d = m.device ?? 'laptop';
    setLive(d);
    setLabel(d, m.deviceLabel);
    if (following && d !== activeDevice) select(d);
    return d;
  };

  const apply = (m: AiFeedMsg) => {
    switch (m.kind) {
      case 'log': onLog(touch(m), m.engine, m.verb, m.text); break;
      case 'state': {
        const d = touch(m);
        if (m.state in STATE_TEXT) setState(d, isCloud(m.engine) ? views[d].cloud : views[d].device, m.state);
        break;
      }
      case 'handoff': {
        const d = touch(m);
        // The handoff's words already land in both halves as `handoff` log
        // lines (modelPanels.showHandoff); here it only moves things.
        run(ledger.handoff(d, m.from, m.to, m.text));
        break;
      }
      case 'bytes': run(ledger.bytes(touch(m), m.total)); break;
      case 'snapshot': {
        // Joining mid-session: show the laptop's lines and states and set the
        // byte baseline, but replay no packets and count no turns.
        clear();
        setLive('laptop');
        (['nano', 'gemini'] as const).forEach((e) => {
          const s = m.engines[e];
          s.lines.forEach((l) => { const [vb, t] = splitTab(l); onLog('laptop', e, vb, t, false); });
          if (s.state in STATE_TEXT) setState('laptop', e === 'gemini' ? views.laptop.cloud : views.laptop.device, s.state);
        });
        ledger.baseline('laptop', m.total);
        updateTotals();
        break;
      }
      case 'hello': break;
    }
  };

  // Follow the newest tab: a different sender takes over only if its message
  // is not older than the current one. Any tab can win again later.
  let currentSid: string | null = null;
  let currentT = 0;
  const hello = () => { try { channel?.postMessage({ v: 1, sid: 'monitor', t: Date.now(), kind: 'hello' }); } catch { /* best effort */ } };

  channel?.addEventListener('message', (e) => {
    if (!isAiFeedMsg(e.data)) return;
    const m = e.data;
    if (m.kind === 'hello') return;
    if (currentSid !== m.sid) {
      if (currentSid !== null && m.t < currentT) return;
      const had = currentSid !== null;
      currentSid = m.sid;
      currentT = 0;
      if (had) { clear(); if (m.kind !== 'snapshot') hello(); }
    }
    currentT = Math.max(currentT, m.t);
    if (!empty.hidden) {
      empty.hidden = true;
      wrap.setAttribute('data-idle', 'false');
      live.textContent = 'Live';
      live.setAttribute('data-live', 'true');
    }
    apply(m);
  });

  updateTotals();
  hello();
  return { el: wrap, ledger, active: () => activeDevice, select, follow: () => following, setFollow, key };
}

/** `?device=laptop|iphone|android` → that tab, else null (laptop). */
export function parseDeviceParam(search: string): FeedDevice | null {
  const v = /[?&]device=([a-z]+)/i.exec(search)?.[1]?.toLowerCase();
  return v === 'laptop' || v === 'iphone' || v === 'android' ? v : null;
}

if (typeof document !== 'undefined' && document.getElementById('monitor')) {
  let channel: FeedChannel | null = null;
  try { channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(FEED_CHANNEL) : null; } catch { channel = null; }
  mountMonitor(document.getElementById('monitor')!, channel, { device: parseDeviceParam(location.search) });
}

